// The panel runtime. Independent of Companion: the shell forwards config in and renders what comes out.
import { namesFrom, envFrom, errorText, currentLabel } from './vendor/panelrules.js';
import * as model from './vendor/panelmodel.js';
import { openStream, mergeTally } from './live.js';
import { createHold } from './hold.js';
import { deviceName, startInstance } from './instance.js';
import { COMPANION_GRID, visibleSquares } from './visible.js';
import { createLivePanel } from './live-panel.js';

// namesFrom has no label for a Take cell; its hold-guard wording belongs with the takes ticket.
const labelOf = (cell, names) => (cell.kind === 'take' ? cell.caption || 'Take' : names.of(cell));

// Fixed wording only: Sode's own error text is never shown, and no message holds the key.
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
  'bad-device': 'The device name is over 40 characters. Shorten it, or the connection label when the device name is blank.',
};

export const FAILURE_CODES = Object.keys(FAILS);

const REFUSALS = { invalid_key: 'key-refused', key_required: 'key-refused', key_expired: 'key-expired', network_not_allowed: 'network-refused', api_off: 'api-off' };

class Refused extends Error {
  constructor(code, http = 0, api = '') {
    super(code);
    this.fail = code;
    this.http = http;
    this.api = api;
  }
}

const NO_PANEL = { rows: 0, cols: 0 };
const NONE = { text: '', colour: 'none', pulse: 0 };

// Protected and presets change rarely, so they are read on every Nth tally poll.
const SLOW_EVERY = 5;

export function createRuntime({ host, port, tls = false, panel: panelRef, key, device = '', label = '', fetch: doFetch = globalThis.fetch, WebSocket: WS = globalThis.WebSocket, retryMs = 5000, pollMs = 2000, liveMs = 5000, grid = COMPANION_GRID, now = Date.now, log = () => {} }) {
  const base = `${tls ? 'https' : 'http'}://${host}:${port}/api/v1`;
  let status = { code: 'connecting', text: 'Connecting' };
  let panel = NO_PANEL;
  let names = namesFrom({});
  let drawn = [];
  let stopped = false;
  let timer = 0;
  let stopInstance = null;
  const name = deviceName(device, label);
  let pollTimer = 0;
  let liveTimer = 0;
  let live = null;
  let polls = 0;
  let st = model.createState();
  let env = envFrom({}, {});
  let tallyRaw = {};
  // true or false from the status read, null when the key has no status scope: the link is unknown, not down.
  let routerUp = null;
  let noStatusScope = false;
  let sodeLost = false;
  let streamUp = false;
  let stream = null;
  const listeners = [];
  const changed = () => listeners.forEach((fn) => fn());

  const set = (code, text = FAILS[code]) => {
    status = { code, text };
    changed();
  };

  // Settings the panel does not grant (scope 403) read as empty rather than failing the panel.
  const soft = (path) => get(path).catch(() => ({}));

  // Protected and presets are read only when slow is set; the last read stands between.
  let slowReads = [{}, {}];
  // False when the key lacks the presets scope (403), so Preset cells say so instead of "no preset".
  let presetsOpen = true;
  const readPresets = () =>
    get('presets').then(
      (r) => ((presetsOpen = true), r),
      (e) => ((presetsOpen = e.http !== 403), {}),
    );
  async function readRouter(slow, withTally = true) {
    if (withTally) tallyRaw = await get('tally');
    if (slow) slowReads = await Promise.all([soft('protected'), readPresets()]);
    rebuildEnv();
  }

  function rebuildEnv() {
    env = envFrom(tallyRaw, slowReads[0], slowReads[1], panel.rights);
    st = model.applyTally(st, env);
  }

  async function readStatus() {
    if (noStatusScope) return;
    try {
      routerUp = (await get('status')).routerUp;
    } catch (e) {
      if (!(e.http === 403 && e.api === 'scope')) throw e;
      noStatusScope = true;
      routerUp = null;
    }
  }

  // Offline is Sode not answering or the router down; either clears by itself.
  function syncOffline() {
    const text = sodeLost ? 'Sode did not answer. Every key shows Offline until it does.' : routerUp === false ? 'Sode lost contact with the router. Every key shows Offline until it is back.' : '';
    if (text && (status.code !== 'offline' || status.text !== text)) set('offline', text);
    else if (!text && status.code === 'offline') set('ok', `Panel ${panel.name}`);
  }

  // While the stream is up only the slow reads are polled; down, tally and status are polled every pollMs.
  async function poll() {
    if (stopped) return;
    try {
      const slow = ++polls % SLOW_EVERY === 0;
      if (streamUp) await readRouter(slow, false);
      else {
        await readRouter(slow);
        await readStatus();
      }
      sodeLost = false;
      syncOffline();
      changed();
    } catch (e) {
      // A refusal ends all attempts; anything else is a lost Sode.
      if (e.fail && e.fail !== 'unreachable') return refuse(e.fail);
      log(`poll failed: ${e.fail || 'error'}`);
      sodeLost = true;
      syncOffline();
    }
    if (!stopped && pollMs > 0) pollTimer = setTimeout(poll, pollMs);
  }

  function refuse(code) {
    clearTimeout(pollTimer);
    clearTimeout(liveTimer);
    stream?.close();
    stopInstance?.();
    set(code);
  }

  function onFrame({ t, topic, data }) {
    if (topic === 'names') names = namesFrom(data);
    else if (topic === 'tally') {
      tallyRaw = t === 'snapshot' ? data : mergeTally(tallyRaw, data);
      rebuildEnv();
    } else if (topic === 'status') {
      routerUp = data.routerUp;
      syncOffline();
    } else return;
    changed();
  }

  // Only Cells with a Root square inside the Companion grid are kept; the rest are ignored without an error.
  const drawnOf = (p) => visibleSquares(p, grid).filter((s) => s.root).map((s) => s.cell);

  // Applies a newer panel copy once the rules allow. The viewed destination is carried over.
  function settle() {
    const fresh = live?.due({ busy: st.busy, viewed: !!st.view, staged: st.staged.length > 0 }, now());
    if (!fresh) return;
    panel = fresh;
    drawn = drawnOf(fresh);
    st = model.carryView(model.createState(fresh.settings), st, drawn);
    changed();
  }

  async function checkPanel() {
    if (stopped) return;
    try {
      live.notice(await get(`panels/${encodeURIComponent(panelRef)}`), now());
    } catch {
      // A failed read leaves the panel as it is; the next check tries again.
    }
    settle();
    if (!stopped) liveTimer = setTimeout(checkPanel, liveMs);
  }

  const get = async (path) => {
    const res = await doFetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${key}` } });
    log(`GET ${path} ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const code = REFUSALS[body?.error?.code] || (res.status === 404 ? 'panel-not-found' : 'unreachable');
    throw new Refused(code, res.status, body?.error?.code);
  };

  async function load() {
    clearTimeout(timer);
    try {
      const p = await get(`panels/${encodeURIComponent(panelRef)}`);
      if (p.acts !== 'api') throw new Refused('session-mode');
      const nm = await get('names');
      if (stopped) return;
      panel = p;
      names = namesFrom(nm);
      drawn = drawnOf(p);
      live = createLivePanel(p.rev);
      st = model.createState(p.settings);
      await readRouter(true);
      await readStatus();
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
        },
        onDown: () => (streamUp = false),
        onFrame,
      });
      clearTimeout(pollTimer);
      if (pollMs > 0) pollTimer = setTimeout(poll, pollMs);
      clearTimeout(liveTimer);
      if (liveMs > 0) liveTimer = setTimeout(checkPanel, liveMs);
    } catch (e) {
      if (stopped) return;
      // A refusal ends the attempts: only a changed key, list or panel helps. A lost connection is retried.
      const code = e.fail || 'unreachable';
      log(`panel not loaded: ${code}`);
      set(code);
      if (code === 'unreachable') timer = setTimeout(load, retryMs);
    }
  }

  // Colour is the Cell kind, or kind-state while a view, a stage or an armed Take changes it.
  function cellLook(cell) {
    const text = labelOf(cell, names);
    const t = now();
    switch (cell.kind) {
      case 'source': {
        const s = model.sourceState(st, cell.n, env);
        return { text, colour: s === 'idle' ? 'source' : `source-${s}`, pulse: s === 'pending' ? 1 : 0 };
      }
      case 'destination': {
        const s = model.destinationState(st, cell.n);
        if (s === 'staged') return { text: `${text}\n${names.source(st.staged.find((x) => x.dst === cell.n).src)}`, colour: 'destination-staged', pulse: 1 };
        return { text, colour: s === 'idle' ? 'destination' : `destination-${s}`, pulse: 0 };
      }
      case 'take': {
        const armed = model.armed(st, env);
        const look = { text, colour: armed ? 'take-armed' : 'take', pulse: armed ? 1 : 0 };
        return st.holdAt ? { ...look, fill: Math.min(1, (now() - st.holdAt) / model.GUARD_HOLD_MS) } : look;
      }
      case 'preset': {
        if (!presetsOpen) return { text: 'Unavailable', colour: 'unavailable', pulse: 0 };
        const pending = model.presetState(st, cell, env) === 'pending';
        return { text, colour: pending ? 'preset-pending' : 'preset', pulse: pending ? 1 : 0 };
      }
      case 'current': {
        if (!st.view) return { text: cell.caption || 'Currently', colour: 'current', pulse: 0 };
        const cur = model.currentSource(env, st);
        return { text: `${currentLabel(cell, names.destination(st.view.dst))}\n${cur >= 0 ? names.source(cur) : 'None'}`, colour: 'current', pulse: 0 };
      }
      default:
        return { text, colour: cell.kind, pulse: 0 };
    }
  }

  const cellAt = (r, c) => r <= grid.rows && c <= grid.cols && drawn.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);

  async function sendTake(started = model.startTake(st, env, now())) {
    if (!started) return;
    st = started.state;
    changed();
    try {
      const res = await doFetch(`${base}/takes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ routes: started.routes }),
      });
      log(`POST takes ${res.status}`);
      const body = await res.json().catch(() => ({}));
      st = res.ok ? model.finishTake(st, body, now()) : model.failTake(st, body?.error?.code || 'refused', body?.error?.message || '', now());
    } catch {
      st = model.failTake(st, 'unreachable', 'Sode did not answer the take', now());
    }
    changed();
    if (!stopped) poll1();
  }

  // One extra tally read after a take, so the keys show what the router did without waiting for the next tick.
  const poll1 = () => readRouter(false).then(changed, () => {});

  const hold = createHold({
    ms: model.GUARD_HOLD_MS,
    tick: () => changed(),
    async due() {
      hold.stop();
      const g = model.guardHeld(st, now());
      st = g.state;
      changed();
      if (g.go) await sendTake();
    },
  });

  // Instant mode: the press that staged something is the Confirm. A refused press leaves an older failed route staged, so it must not resend.
  const confirmInstant = () => (st.error ? undefined : sendTake(model.startInstant(st, env, now())));

  return {
    async start() {
      if (!host || !port || !panelRef || !key) return set('bad-config');
      if (name === null) return set('bad-device');
      set('connecting', 'Connecting');
      await load();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(pollTimer);
      stream?.close();
      hold.stop();
      stopInstance?.();
      clearTimeout(liveTimer);
    },
    release() {
      if (!st.holdAt) return;
      hold.stop();
      st = model.guardCancel(st);
      changed();
    },
    async press(r, c) {
      const cell = cellAt(r, c);
      if (!cell || status.code !== 'ok') return;
      const before = st;
      switch (cell.kind) {
        case 'destination':
          st = model.pressDestination(st, cell, env, now());
          break;
        case 'source':
          st = model.pressSource(st, cell, env, now());
          changed();
          return confirmInstant();
        case 'preset':
          if (!presetsOpen) return;
          st = model.pressPreset(st, cell, env, now());
          changed();
          return confirmInstant();
        case 'clear':
          st = model.pressClear(st, now());
          hold.stop();
          break;
        case 'take': {
          // An unarmed press must not start a guard that a later arming would complete.
          if (!model.armed(st, env)) return;
          const g = model.guardDown(st, now());
          st = g.state;
          if (g.go) await sendTake();
          else if (st.holdAt) hold.start();
          break;
        }
        default:
          return;
      }
      if (st !== before) changed();
      settle();
    },
    variables() {
      const view = st.view;
      const cur = model.currentSource(env, st);
      return {
        viewed: view ? names.destination(view.dst) : '',
        current: cur >= 0 ? names.source(cur) : '',
        staged: st.staged.length,
        error: errorText(model.errorOf(st, now()), names),
      };
    },
    onChange: (fn) => listeners.push(fn),
    status: () => status,
    grid: () => ({ rows: panel.rows, cols: panel.cols }),
    cells: () => drawn,
    look(r, c) {
      const cell = cellAt(r, c);
      if (!cell) return NONE;
      const root = cell.r === r && cell.c === c;
      if (status.code === 'offline') return { text: root ? 'Offline' : '', colour: 'offline', pulse: 0 };
      const { colour, pulse, text, fill } = cellLook(cell);
      return { text: root ? text : '', colour, pulse, ...(fill === undefined ? {} : { fill }) };
    },
  };
}
