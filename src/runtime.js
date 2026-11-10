// The panel runtime. Independent of Companion: the shell forwards config in and renders what comes out.
import { parseSodeLink } from './sodelink.js';
import { randomUUID } from 'node:crypto';
import { namesFrom, envFrom, errorText, currentLabel } from './vendor/panelrules.js';
import * as model from './vendor/panelmodel.js';
import { openStream, mergeTally } from './live.js';
import { deviceName, startInstance } from './instance.js';
import { keySquares, visibleSquares } from './visible.js';
import { createTiming } from './timing.js';
import { flashWord } from './flash.js';
import { fullKey } from './vendor/panellink.js';
import { createPictures, textHidden } from './pictures.js';

// namesFrom has no label for a Take cell.
const labelOf = (cell, names) => (cell.kind === 'take' ? cell.caption || 'Take' : names.of(cell));

// Fixed wording for the module's own failures, none of which holds the key. A refused take shows Sode's message, as its page does.
const FAILS = {
  'key-refused': 'Sode refused the key. It is wrong or was revoked, so make a new one.',
  'key-expired': 'The key has expired. Make a new key for this panel.',
  'network-refused': "This network is not in the panel's allowed list. Use the key from an allowed network or change the list.",
  'session-mode': 'This panel acts as a user. Switch it to act as its own API client in the Sode editor.',
  'panel-not-found': 'Sode has no panel with this id or short name that this key may use.',
  'api-off': 'The API is switched off in Sode. Ask an administrator to turn it on.',
  unreachable: 'Sode did not answer. Check the host, port and TLS choice.',
  offline: 'Sode or the router is not answering. Every key shows Offline until it does.',
  'bad-config': 'Set the host, port, panel and key in the connection settings.',
  'bad-link': 'The Sode link is not an http or https link to a panel. Paste the whole link from Sode, or clear the field.',
  'bad-device': 'The device name is over 40 characters. Shorten it, or the connection label when the device name is blank.',
};

export const FAILURE_CODES = Object.keys(FAILS);

const REFUSALS = {
  invalid_key: 'key-refused',
  key_required: 'key-refused',
  key_expired: 'key-expired',
  network_not_allowed: 'network-refused',
  api_off: 'api-off',
};

class Refused extends Error {
  constructor(code, http = 0, api = '') {
    super(code);
    this.fail = code;
    this.http = http;
    this.api = api;
  }
}

// A 403 that is not one of the named refusals is a missing scope, not a refused key.
const isRefusal = (e) => e.fail && e.fail !== 'unreachable';
const scopeDenied = (e) => e.http === 403 && !isRefusal(e);

const NO_PANEL = { rows: 0, cols: 0 };
const NONE = { text: '', colour: 'none', pulse: 0 };
const BLANK = { text: '', colour: 'blank', pulse: 0 };
// How often a hold's fill is redrawn.
const TICK_MS = 100;

const SLOW_EVERY = 5;

export function createRuntime({
  host: hostOpt,
  port: portOpt,
  tls: tlsOpt = false,
  panel: panelOpt,
  key: keyOpt,
  device: deviceOpt = '',
  link = '',
  label = '',
  fetch: doFetch = globalThis.fetch,
  WebSocket: WS = globalThis.WebSocket,
  retryMs = 5000,
  pollMs = 2000,
  rereadMs = 30_000,
  liveMs = 5000,
  takeMessages = false,
  now = Date.now,
  timers = { setTimeout, clearTimeout },
  log = () => {},
}) {
  // A pasted link replaces the separate fields; one that does not parse fails start().
  const parsed = String(link || '').trim() ? parseSodeLink(link) : undefined;
  const { host, port, tls, panel: panelRef, key: linkKey } = parsed ?? { host: hostOpt, port: portOpt, tls: tlsOpt, panel: panelOpt, key: keyOpt };
  const device = parsed?.device || deviceOpt;
  const key = fullKey(String(linkKey || '').trim());
  const base = `${tls ? 'https' : 'http'}://${host}:${port}/api/v1`;
  let status = { code: 'connecting', text: 'Connecting' };
  let panel = NO_PANEL;
  let names = namesFrom({});
  let squares = [];
  let drawn = [];
  let stopped = false;
  let halted = false; // a refused key ends every timer, and nothing may re-arm one
  let stopInstance = null;
  const name = deviceName(device, label);
  let seenRev;
  let newer = null; // the saved copy of the panel that differs from the one applied
  let polls = 0;
  let state = model.createState();
  let env = envFrom({}, {});
  let tallyRaw = {};
  let protectedRead = {};
  let presetsRead = {};
  // true or false from the status read, null when the key has no status scope: the link is unknown, not down.
  let routerUp = null;
  let noStatusScope = false;
  let sodeLost = false;
  let streamUp = false;
  let tallyFrames = 0; // frames applied to tallyRaw; a re-read that overlaps one is stale
  let stream = null;
  let flash = null; // { cell, at }: the Cell whose press set the error shown
  let pressed = null; // the Cell of the press in progress
  let seenError = null;
  const listeners = [];
  const changed = () => {
    if (state.error !== seenError) {
      seenError = state.error;
      if (state.error && pressed) flash = { cell: pressed, at: state.error.at };
    }
    timing.sync();
    listeners.forEach((fn) => fn());
  };
  const pictures = createPictures({ request, changed });
  const timing = createTiming({ timers, now, read: () => state, notify: changed });

  const set = (code, text = FAILS[code]) => {
    status = { code, text };
    changed();
  };

  // One timer per named job, all on the injected timers, so a refusal or a stop clears them in one place.
  const wakes = new Map();
  const unwake = (job) => {
    timers.clearTimeout(wakes.get(job));
    wakes.delete(job);
  };
  const wake = (job, ms, fn) => {
    unwake(job);
    wakes.set(job, timers.setTimeout(fn, ms));
  };
  const unwakeAll = () => wakes.forEach((_, job) => unwake(job));
  const dead = () => stopped || halted;

  // A scope 403 reads as denied rather than failing the panel. Any other failure throws, so the last good read stands.
  const optional = (path) =>
    get(path).then(
      (body) => ({ body, denied: false }),
      (e) => {
        if (!scopeDenied(e)) throw e;
        return { body: {}, denied: true };
      },
    );

  // False when the key lacks the presets scope, so Preset cells say so instead of "no preset".
  let presetsOpen = true;

  function rebuildEnv() {
    env = envFrom(tallyRaw, protectedRead, presetsRead, panel.rights);
    state = model.applyTally(state, env);
  }

  async function readTally() {
    tallyRaw = await get('tally');
    rebuildEnv();
  }

  // Protected and presets change rarely, so they are read on every Nth poll; the last read stands between.
  async function readSlow() {
    const [prot, presets] = await Promise.all([optional('protected'), optional('presets')]);
    protectedRead = prot.body;
    presetsRead = presets.body;
    presetsOpen = !presets.denied;
    rebuildEnv();
  }

  async function readStatus() {
    if (noStatusScope) return;
    const { body, denied } = await optional('status');
    noStatusScope = denied;
    routerUp = denied ? null : body.routerUp;
  }

  // Offline is Sode not answering or the router down; either clears by itself.
  function syncOffline() {
    const text = sodeLost
      ? 'Sode did not answer. Every key shows Offline until it does.'
      : routerUp === false
        ? 'Sode lost contact with the router. Every key shows Offline until it is back.'
        : '';
    if (text && (status.code !== 'offline' || status.text !== text)) set('offline', text);
    else if (!text && status.code === 'offline') set('ok', `Panel ${panel.name}`);
  }

  // While the stream is up only the slow reads are polled; down, tally and status are polled every pollMs.
  async function poll() {
    if (dead()) return;
    try {
      const reads = [];
      if (!streamUp) reads.push(readTally(), readStatus());
      if (++polls % SLOW_EVERY === 0) reads.push(readSlow());
      // A quiet tick with the stream up reads nothing and tells nobody.
      if (reads.length || sodeLost) {
        await Promise.all(reads);
        sodeLost = false;
        syncOffline();
        changed();
      }
    } catch (e) {
      // A refusal ends all attempts; anything else is a lost Sode.
      if (isRefusal(e)) return refuse(e.fail);
      log(`poll failed: ${e.fail || 'error'}`);
      sodeLost = true;
      syncOffline();
    }
    if (!dead() && pollMs > 0) wake('poll', pollMs, poll);
  }

  // Safety net for a delta the stream missed: while it is up, re-read the tally every rereadMs.
  // Separate from poll() and the post-take refresh, so neither resets it.
  function armReread() {
    unwake('reread');
    if (!streamUp || dead() || rereadMs <= 0) return;
    wake('reread', rereadMs, async () => {
      const seen = tallyFrames;
      try {
        const fresh = await get('tally');
        if (streamUp && tallyFrames === seen) {
          tallyRaw = fresh;
          rebuildEnv();
          changed();
        }
      } catch (e) {
        if (isRefusal(e)) return refuse(e.fail);
      }
      armReread();
    });
  }

  function refuse(code) {
    halted = true;
    unwakeAll();
    if (state.holdAt) state = model.guardCancel(state);
    stream?.close();
    stopInstance?.();
    set(code);
  }

  function onFrame({ t, topic, data }) {
    if (topic === 'names') names = namesFrom(data);
    else if (topic === 'tally') {
      tallyRaw = t === 'snapshot' ? data : mergeTally(tallyRaw, data);
      tallyFrames++;
      rebuildEnv();
    } else if (topic === 'status') {
      routerUp = data.routerUp;
      syncOffline();
    } else return;
    changed();
  }

  // Blank key squares get a variable and a look but no preset.
  function usePanel(p) {
    squares = keySquares(p);
    drawn = visibleSquares(p)
      .filter((s) => s.root)
      .map((s) => s.cell);
    pictures.sync(p.id, drawn);
  }

  function settle() {
    if (!newer || state.busy) return;
    panel = newer;
    newer = null;
    seenRev = panel.rev;
    usePanel(panel);
    state = model.createState(panel.settings);
    changed();
  }

  async function checkPanel() {
    if (dead()) return;
    try {
      const p = await get(`panels/${encodeURIComponent(panelRef)}`);
      // A server without rev sends none: nothing ever differs then.
      if (typeof p.rev === 'number' && p.rev !== seenRev) newer = p;
    } catch (e) {
      // Any other failure leaves the panel as it is; the next check tries again.
      if (isRefusal(e)) return refuse(e.fail);
    }
    settle();
    if (!dead()) wake('live', liveMs, checkPanel);
  }

  async function request(path, { method = 'GET', headers, body } = {}) {
    const res = await doFetch(`${base}/${path}`, { method, headers: { Authorization: `Bearer ${key}`, ...headers }, body });
    log(`${method} ${path} ${res.status}`);
    return res;
  }

  const get = async (path) => {
    const res = await request(path);
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const code =
      REFUSALS[body?.error?.code] || (res.status === 401 ? 'key-refused' : res.status === 404 ? 'panel-not-found' : 'unreachable');
    throw new Refused(code, res.status, body?.error?.code);
  };

  async function load() {
    unwake('load');
    try {
      const p = await get(`panels/${encodeURIComponent(panelRef)}`);
      if (p.acts !== 'api' && p.acts !== 'both') throw new Refused('session-mode');
      const fetchedNames = await get('names');
      if (stopped) return;
      panel = p;
      names = namesFrom(fetchedNames);
      usePanel(p);
      seenRev = p.rev;
      newer = null;
      state = model.createState(p.settings);
      await Promise.all([readTally(), readSlow(), readStatus()]);
      if (stopped) return;
      sodeLost = false;
      stopInstance ??= startInstance({ base, panelId: p.id, key, device: name, fetch: doFetch, retryMs, log });
      set('ok', `Panel ${p.name}`);
      syncOffline();
      stream ||= openStream({
        base,
        key,
        topics: ['names', 'tally', ...(noStatusScope ? [] : ['status'])],
        WebSocket: WS,
        retryMs,
        onUp: () => {
          streamUp = true;
          sodeLost = false;
          syncOffline();
          armReread();
        },
        onDown: () => {
          streamUp = false;
          unwake('reread');
        },
        onFrame,
      });
      if (pollMs > 0) wake('poll', pollMs, poll);
      if (liveMs > 0) wake('live', liveMs, checkPanel);
    } catch (e) {
      if (stopped) return;
      // A refusal ends the attempts: only a changed key, list or panel helps. A lost connection is retried.
      const code = e.fail || 'unreachable';
      log(`panel not loaded: ${code}`);
      set(code);
      if (code === 'unreachable') wake('load', retryMs, load);
    }
  }

  // Colour is the Cell kind, or kind-state while a view, a stage or an armed Take changes it.
  function cellLook(cell) {
    const text = labelOf(cell, names);
    switch (cell.kind) {
      case 'source': {
        const s = model.sourceState(state, cell.n, env);
        return { text, colour: s === 'idle' ? 'source' : `source-${s}`, pulse: s === 'pending' ? 1 : 0 };
      }
      case 'destination': {
        const shown = model.resultShown(state, cell.n, now());
        if (shown) return { text: `${text}\n${shown.word}`, colour: `result-${shown.result}`, pulse: 0, speaks: true };
        const s = model.destinationState(state, cell.n);
        if (s === 'staged')
          return {
            text: `${text}\n${names.source(state.staged.find((x) => x.dst === cell.n).src)}`,
            colour: 'destination-staged',
            pulse: 1,
          };
        return { text, colour: s === 'idle' ? 'destination' : `destination-${s}`, pulse: 0 };
      }
      case 'take': {
        const armed = model.armed(state, env);
        // Sode's web page has no confirm look; the key is small, so the second press is asked for in text.
        const confirm = armed && model.guardWaiting(state, now());
        const look = confirm
          ? { text: 'Press\nTake\nagain', colour: 'take-confirm', pulse: 1, speaks: true }
          : { text, colour: armed ? 'take-armed' : 'take', pulse: armed ? 1 : 0 };
        return state.holdAt
          ? { ...look, text: 'Keep\nholding', speaks: true, fill: Math.min(1, (now() - state.holdAt) / model.GUARD_HOLD_MS) }
          : look;
      }
      case 'preset': {
        if (!presetsOpen) return { text: 'Unavailable', colour: 'unavailable', pulse: 0 };
        const pending = model.presetState(state, cell, env) === 'pending';
        return { text, colour: pending ? 'preset-pending' : 'preset', pulse: pending ? 1 : 0 };
      }
      case 'current': {
        if (!state.view) return { text: cell.caption || 'Currently', colour: 'current', pulse: 0 };
        const cur = model.currentSource(env, state);
        return {
          text: `${currentLabel(cell, names.destination(state.view.dst))}\n${cur >= 0 ? names.source(cur) : 'None'}`,
          colour: 'current',
          pulse: 0,
        };
      }
      default:
        return { text, colour: cell.kind, pulse: 0 };
    }
  }

  function takePrompt() {
    if (!model.armed(state, env)) return null;
    if (state.holdAt) return { text: 'Keep\nholding', colour: 'take-armed', pulse: 1, speaks: true };
    return model.guardWaiting(state, now()) ? { text: 'Press\nTake\nagain', colour: 'take-confirm', pulse: 1, speaks: true } : null;
  }

  // The viewed Destination and the staged Sources, which the option lets share the Take's prompt.
  const onRoute = (cell) =>
    (cell.kind === 'destination' && state.view?.dst === cell.n) || (cell.kind === 'source' && state.staged.some((x) => x.src === cell.n));

  const cellAt = (r, c) => drawn.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);

  async function sendTake(started = model.startTake(state, env, now())) {
    if (!started || status.code !== 'ok') return;
    state = started.state;
    changed();
    try {
      const res = await request('takes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ routes: started.routes }),
      });
      const body = await res.json().catch(() => ({}));
      state = res.ok
        ? model.finishTake(state, body, now())
        : model.failTake(state, body?.error?.code || 'refused', body?.error?.message || '', now());
    } catch {
      state = model.failTake(state, 'unreachable', 'Sode did not answer the take', now());
    }
    changed();
    if (!stopped) refreshTally();
    settle();
  }

  // One extra tally read after a take, so the keys show what the router did without waiting for the next tick.
  const refreshTally = () => readTally().then(changed, () => {});

  // The model owns the hold guard's rules. These timers wake the runtime when it is due and while the fill grows,
  // since Companion sends no event during a hold.
  const holdStop = () => {
    unwake('hold');
    unwake('beat');
  };
  const beat = () =>
    wake('beat', TICK_MS, () => {
      changed();
      beat();
    });
  const holdStart = () => {
    holdStop();
    wake('hold', model.GUARD_HOLD_MS, async () => {
      holdStop();
      const guard = model.guardHeld(state, now());
      state = guard.state;
      changed();
      if (guard.go) await sendTake();
    });
    beat();
  };

  // Instant mode: the press that staged something is the Confirm. A refused press leaves an older failed route staged, so it must not resend.
  const confirmInstant = () => (state.error ? undefined : sendTake(model.startInstant(state, env, now())));

  async function pressKey(cell) {
    if (!cell || status.code !== 'ok') return;
    const before = state;
    switch (cell.kind) {
      case 'destination':
        state = model.pressDestination(state, cell, env, now());
        break;
      case 'source':
        state = model.pressSource(state, cell, env, now());
        changed();
        return confirmInstant();
      case 'preset':
        if (!presetsOpen) return;
        state = model.pressPreset(state, cell, env, now());
        changed();
        return confirmInstant();
      case 'clear':
        state = model.clear(state);
        holdStop();
        break;
      case 'take': {
        // An unarmed press must not start a guard that a later arming would complete.
        if (!model.armed(state, env)) return;
        const guard = model.guardDown(state, now());
        state = guard.state;
        if (guard.go) await sendTake();
        else if (state.holdAt) holdStart();
        break;
      }
      default:
        return;
    }
    if (state !== before) changed();
    settle();
  }

  const api = {
    async start() {
      if (parsed === null) return set('bad-link');
      if (!host || !port || !panelRef || !key) return set('bad-config');
      if (name === null) return set('bad-device');
      set('connecting', 'Connecting');
      await load();
    },
    stop() {
      stopped = true;
      timing.stop();
      pictures.stop();
      unwakeAll();
      stream?.close();
      stopInstance?.();
    },
    release() {
      if (!state.holdAt) return;
      holdStop();
      state = model.guardCancel(state);
      changed();
    },
    async press(r, c) {
      pressed = cellAt(r, c);
      try {
        await pressKey(pressed);
      } finally {
        pressed = null;
      }
    },
    variables() {
      const view = state.view;
      const cur = model.currentSource(env, state);
      return {
        viewed: view ? names.destination(view.dst) : '',
        current: cur >= 0 ? names.source(cur) : '',
        staged: state.staged.length,
        error: errorText(model.errorOf(state, now()), names),
        router: routerUp === null ? 'unknown' : routerUp ? 'up' : 'down',
      };
    },
    onChange: (fn) => listeners.push(fn),
    status: () => status,
    grid: () => ({ rows: panel.rows, cols: panel.cols }),
    cells: () => drawn,
    squares: () => squares,
    look(r, c) {
      const cell = cellAt(r, c);
      const isKey = squares.some((s) => s.r === r && s.c === c);
      const root = !cell || (cell.r === r && cell.c === c);
      if (status.code === 'offline' && isKey) return { text: root ? 'Offline' : '', colour: 'offline', pulse: 0 };
      if (!cell) return isKey ? BLANK : NONE;
      const err = model.errorOf(state, now());
      const flashing = err && flash?.cell === cell && flash.at === err.at;
      const prompt = takeMessages && !flashing && onRoute(cell) ? takePrompt() : null;
      const { colour, pulse, text, fill, speaks } = flashing
        ? { colour: 'error', pulse: 0, text: flashWord(err), speaks: true }
        : prompt || cellLook(cell);
      return {
        text: root && (speaks || !textHidden(cell)) ? text : '',
        colour,
        pulse: pulse ? timing.phase() : 0,
        ...(fill === undefined ? {} : { fill }),
        ...pictures.at(cell, r, c, colour),
      };
    },
  };

  return api;
}
