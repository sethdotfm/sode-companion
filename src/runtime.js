// The panel runtime. Independent of Companion: the shell forwards config in and renders what comes out.
import { randomUUID } from 'node:crypto';
import { namesFrom, envFrom, errorText, currentLabel } from './vendor/panelrules.js';
import * as model from './vendor/panelmodel.js';
import { openStream, mergeTally } from './live.js';
import { createHold } from './hold.js';
import { deviceName, startInstance } from './instance.js';
import { COMPANION_GRID, keySquares, visibleSquares, squareVariable } from './visible.js';
import { createLivePanel } from './live-panel.js';
import { createTiming } from './timing.js';
import { flashWord } from './flash.js';
import { withPrefix } from './sode-key.js';
import { keyPicture, keyPictures, cropSvg, svgDataUrl, MAX_BYTES } from './artwork.js';
import { iconMarkup, glyphOf, iconSvg } from './icons.js';
import { textFor, WHITE } from './colours.js';

// namesFrom has no label for a Take cell.
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
// Sode's pattern for an artwork id (web/panellook.js); any other art string is an icon or dropped.
const ART_ID = /^a-[0-9a-f]{8}$/;
// The Border is this share of the key on each side of an Artwork key.
const BORDER_PERCENT = 8;
// Artwork is dimmed so the label stays readable; with the text hidden, and for Icons, nothing sits over the picture.
const ARTWORK_OPACITY = 30;
const NONE = { text: '', colour: 'none', pulse: 0 };
const BLANK = { text: '', colour: 'blank', pulse: 0 };

// Protected and presets change rarely, so they are read on every Nth tally poll.
const SLOW_EVERY = 5;

export function createRuntime({
  host,
  port,
  tls = false,
  panel: panelRef,
  key: rawKey,
  device = '',
  label = '',
  fetch: doFetch = globalThis.fetch,
  WebSocket: WS = globalThis.WebSocket,
  retryMs = 5000,
  pollMs = 2000,
  rereadMs = 30_000,
  liveMs = 5000,
  grid = COMPANION_GRID,
  now = Date.now,
  timers = { setTimeout, clearTimeout },
  log = () => {},
}) {
  const key = withPrefix(rawKey);
  const base = `${tls ? 'https' : 'http'}://${host}:${port}/api/v1`;
  let status = { code: 'connecting', text: 'Connecting' };
  let panel = NO_PANEL;
  let names = namesFrom({});
  let squares = [];
  let drawn = [];
  let stopped = false;
  let halted = false; // a refused key ends every timer, and nothing may re-arm one
  let timer = 0;
  let stopInstance = null;
  const name = deviceName(device, label);
  let pollTimer = 0;
  let liveTimer = 0;
  let live = null;
  let polls = 0;
  let state = model.createState();
  let env = envFrom({}, {});
  let tallyRaw = {};
  // true or false from the status read, null when the key has no status scope: the link is unknown, not down.
  let routerUp = null;
  let noStatusScope = false;
  let sodeLost = false;
  let streamUp = false;
  let rereadTimer = 0;
  let tallyFrames = 0; // frames applied to tallyRaw; a re-read that overlaps one is stale
  let stream = null;
  let flash = null; // { cell, at }: the Cell whose press set the error shown
  let pressed = null; // the Cell of the press in progress
  let seenError = null;
  const listeners = [];
  // Artwork by art id: its bytes, the picture for one key square, and the crops made per merged group size. Each id is
  // fetched once; failed ids are retried when a newer panel applies.
  const pictures = new Map();
  const fetching = new Set();
  const changed = () => {
    if (state.error !== seenError) {
      seenError = state.error;
      if (state.error && pressed) flash = { cell: pressed, at: state.error.at };
    }
    timing.sync();
    listeners.forEach((fn) => fn());
  };
  const timing = createTiming({ timers, now, read: () => state, notify: changed });

  const set = (code, text = FAILS[code]) => {
    status = { code, text };
    changed();
  };

  // A scope 403 reads as empty rather than failing the panel. Any other failure throws, so the last good read stands.
  const soft = (path) =>
    get(path).catch((e) => {
      if (scopeDenied(e)) return {};
      throw e;
    });

  // Protected and presets are read only when slow is set; the last read stands between.
  let slowReads = [{}, {}];
  // False when the key lacks the presets scope (403), so Preset cells say so instead of "no preset".
  let presetsOpen = true;
  const readPresets = () =>
    get('presets').then(
      (r) => ((presetsOpen = true), r),
      (e) => {
        if (!scopeDenied(e)) throw e;
        presetsOpen = false;
        return {};
      },
    );
  async function readRouter(slow, withTally = true) {
    if (withTally) tallyRaw = await get('tally');
    if (slow) slowReads = await Promise.all([soft('protected'), readPresets()]);
    rebuildEnv();
  }

  function rebuildEnv() {
    env = envFrom(tallyRaw, slowReads[0], slowReads[1], panel.rights);
    state = model.applyTally(state, env);
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
    if (stopped || halted) return;
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
      if (isRefusal(e)) return refuse(e.fail);
      log(`poll failed: ${e.fail || 'error'}`);
      sodeLost = true;
      syncOffline();
    }
    if (!stopped && !halted && pollMs > 0) pollTimer = setTimeout(poll, pollMs);
  }

  // Safety net for a delta the stream missed: while it is up, re-read the tally every rereadMs.
  // Separate from poll() and the post-take refresh, so neither resets it.
  function armReread() {
    timers.clearTimeout(rereadTimer);
    if (!streamUp || stopped || halted || rereadMs <= 0) return;
    rereadTimer = timers.setTimeout(async () => {
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
    }, rereadMs);
  }

  function refuse(code) {
    halted = true;
    clearTimeout(pollTimer);
    timers.clearTimeout(rereadTimer);
    clearTimeout(liveTimer);
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

  // A Cell whose Root square is off the Companion grid is not drawn. Blank key squares get a variable and a look but no preset.
  function useGrid(p) {
    squares = keySquares(p, grid);
    drawn = visibleSquares(p, grid)
      .filter((s) => s.root)
      .map((s) => s.cell);
    syncArtwork(p);
  }

  const artIdOf = (cell) => (typeof cell.art === 'string' && ART_ID.test(cell.art) ? cell.art : '');
  const iconOf = (cell) => iconMarkup(cell.art);
  const sizeOf = (cell) => ({ rs: cell.rs ?? 1, cs: cell.cs ?? 1 });

  // The square at (r, c) of a Cell's group from cut(rs, cs), which gives rows of columns or null when the group cannot be cut.
  const squareOf = (cell, r, c, cut) => {
    const { rs, cs } = sizeOf(cell);
    return cut(rs, cs)?.[r - cell.r]?.[c - cell.c];
  };
  const artworkAt = (cell, r, c) => {
    const entry = pictures.get(artIdOf(cell));
    if (!entry) return undefined;
    return squareOf(cell, r, c, (rs, cs) => {
      if (rs === 1 && cs === 1) return [[entry.single]];
      const id = `${rs}x${cs}`;
      if (!entry.groups.has(id)) entry.groups.set(id, keyPictures(entry.bytes, { rs, cs, border: BORDER_PERCENT }));
      return entry.groups.get(id);
    });
  };
  const iconAt = (cell, r, c, markup, glyph, rgb) => {
    const svg = iconSvg(markup, glyph, rgb);
    return squareOf(cell, r, c, (rs, cs) => (rs === 1 && cs === 1 ? [[svgDataUrl(svg)]] : cropSvg(svg, { rs, cs, border: 0 })));
  };
  const edgesOf = (cell, r, c) => {
    const { rs, cs } = sizeOf(cell);
    return { bl: c === cell.c, bt: r === cell.r, br: c === cell.c + cs - 1, bb: r === cell.r + rs - 1 };
  };
  // Sode hides text only under art or a valid Icon B, so a Cell with neither keeps its label. Any art string counts, valid or
  // not, so a bad id or icon name does not bring the label back.
  const textHidden = (cell) => cell.hideText === true && ((typeof cell.art === 'string' && cell.art !== '') || glyphOf(cell) !== '');

  // Fetches the Artwork the drawn Cells name, and drops pictures no Cell names any more.
  function syncArtwork(p) {
    const wanted = new Set(drawn.map(artIdOf).filter(Boolean));
    for (const id of [...pictures.keys()]) if (!wanted.has(id)) pictures.delete(id);
    for (const id of wanted) if (!pictures.has(id) && !fetching.has(id)) fetchArtwork(p.id, id);
  }

  async function fetchArtwork(panelId, id) {
    fetching.add(id);
    let entry = null;
    try {
      const path = `panels/${encodeURIComponent(panelId)}/artwork/${id}`;
      const res = await doFetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${key}` } });
      log(`GET ${path} ${res.status}`);
      // The header is checked before the body so an oversize file is never buffered.
      if (res.ok && !(Number(res.headers.get('content-length')) > MAX_BYTES)) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        const single = keyPicture(bytes);
        if (single) entry = { bytes, single, groups: new Map() };
      }
    } catch {
      // Any failure leaves the key plain; the next applied panel tries again.
    }
    fetching.delete(id);
    // A panel applied meanwhile may have dropped the id.
    if (stopped || !entry || !drawn.some((cell) => artIdOf(cell) === id)) return;
    pictures.set(id, entry);
    changed();
  }

  function settle() {
    const fresh = live?.due({ busy: state.busy, viewed: !!state.view, staged: state.staged.length > 0 }, now());
    if (!fresh) return;
    panel = fresh;
    useGrid(fresh);
    state = model.createState(fresh.settings);
    changed();
  }

  async function checkPanel() {
    if (stopped || halted) return;
    try {
      live.notice(await get(`panels/${encodeURIComponent(panelRef)}`), now());
    } catch (e) {
      // Any other failure leaves the panel as it is; the next check tries again.
      if (isRefusal(e)) return refuse(e.fail);
    }
    settle();
    if (!stopped && !halted) liveTimer = setTimeout(checkPanel, liveMs);
  }

  const get = async (path) => {
    const res = await doFetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${key}` } });
    log(`GET ${path} ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const code =
      REFUSALS[body?.error?.code] || (res.status === 401 ? 'key-refused' : res.status === 404 ? 'panel-not-found' : 'unreachable');
    throw new Refused(code, res.status, body?.error?.code);
  };

  async function load() {
    clearTimeout(timer);
    try {
      const p = await get(`panels/${encodeURIComponent(panelRef)}`);
      if (p.acts !== 'api' && p.acts !== 'both') throw new Refused('session-mode');
      const fetchedNames = await get('names');
      if (stopped) return;
      panel = p;
      names = namesFrom(fetchedNames);
      useGrid(p);
      live = createLivePanel(p.rev);
      state = model.createState(p.settings);
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
          armReread();
        },
        onDown: () => {
          streamUp = false;
          timers.clearTimeout(rereadTimer);
        },
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
    switch (cell.kind) {
      case 'source': {
        const s = model.sourceState(state, cell.n, env);
        return { text, colour: s === 'idle' ? 'source' : `source-${s}`, pulse: s === 'pending' ? 1 : 0 };
      }
      case 'destination': {
        const shown = model.resultShown(state, cell.n, now());
        if (shown) return { text: `${text}\n${shown.word}`, colour: `result-${shown.result}`, pulse: 0 };
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
          ? { text: 'Press\nagain', colour: 'take-confirm', pulse: 1 }
          : { text, colour: armed ? 'take-armed' : 'take', pulse: armed ? 1 : 0 };
        return state.holdAt ? { ...look, text: 'Keep\nholding', fill: Math.min(1, (now() - state.holdAt) / model.GUARD_HOLD_MS) } : look;
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

  const cellAt = (r, c) => r <= grid.rows && c <= grid.cols && drawn.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);

  async function sendTake(started = model.startTake(state, env, now())) {
    if (!started || status.code !== 'ok') return;
    state = started.state;
    changed();
    try {
      const res = await doFetch(`${base}/takes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ routes: started.routes }),
      });
      log(`POST takes ${res.status}`);
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
  const refreshTally = () => readRouter(false).then(changed, () => {});

  const hold = createHold({
    ms: model.GUARD_HOLD_MS,
    tick: () => changed(),
    async due() {
      hold.stop();
      const guard = model.guardHeld(state, now());
      state = guard.state;
      changed();
      if (guard.go) await sendTake();
    },
  });

  // Instant mode: the press that staged something is the Confirm. A refused press leaves an older failed route staged, so it must not resend.
  const confirmInstant = () => (state.error ? undefined : sendTake(model.startInstant(state, env, now())));

  const api = {
    async start() {
      if (!host || !port || !panelRef || !key) return set('bad-config');
      if (name === null) return set('bad-device');
      set('connecting', 'Connecting');
      await load();
    },
    stop() {
      stopped = true;
      timing.stop();
      clearTimeout(timer);
      clearTimeout(pollTimer);
      timers.clearTimeout(rereadTimer);
      stream?.close();
      hold.stop();
      stopInstance?.();
      clearTimeout(liveTimer);
    },
    release() {
      if (!state.holdAt) return;
      hold.stop();
      state = model.guardCancel(state);
      changed();
    },
    async press(r, c) {
      const cell = cellAt(r, c);
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
          hold.stop();
          break;
        case 'take': {
          // An unarmed press must not start a guard that a later arming would complete.
          if (!model.armed(state, env)) return;
          const guard = model.guardDown(state, now());
          state = guard.state;
          if (guard.go) await sendTake();
          else if (state.holdAt) hold.start();
          break;
        }
        default:
          return;
      }
      if (state !== before) changed();
      settle();
    },
    variables() {
      const view = state.view;
      const cur = model.currentSource(env, state);
      const out = {
        viewed: view ? names.destination(view.dst) : '',
        current: cur >= 0 ? names.source(cur) : '',
        staged: state.staged.length,
        error: errorText(model.errorOf(state, now()), names),
        router: routerUp === null ? 'unknown' : routerUp ? 'up' : 'down',
      };
      for (const sq of squares) out[squareVariable(sq.r, sq.c)] = api.look(sq.r, sq.c).text;
      return out;
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
      const { colour, pulse, text, fill } = flashing ? { colour: 'error', pulse: 0, text: flashWord(err) } : cellLook(cell);
      const picture = artworkAt(cell, r, c);
      const icon = iconOf(cell);
      // Icon B is text, so it cannot share a raster Artwork picture; beside Artwork it is not drawn.
      const glyph = artIdOf(cell) ? '' : glyphOf(cell);
      const iconPicture = (icon || glyph) && iconAt(cell, r, c, icon, glyph, cell.hideText === true ? WHITE : textFor(colour));
      // A Result, refusal, "Press again" or "Keep holding" still speaks over hidden text.
      const speaks = flashing || colour.startsWith('result-') || colour === 'take-confirm' || fill !== undefined;
      return {
        text: root && (speaks || !textHidden(cell)) ? text : '',
        colour,
        pulse: pulse ? timing.phase() : 0,
        ...(fill === undefined ? {} : { fill }),
        ...(picture
          ? { picture, border: BORDER_PERCENT, edges: edgesOf(cell, r, c), opacity: textHidden(cell) ? 100 : ARTWORK_OPACITY }
          : {}),
        // An Icon keeps the solid fill, so it has no Border.
        ...(iconPicture ? { picture: iconPicture, border: 0, opacity: textHidden(cell) ? 100 : ARTWORK_OPACITY } : {}),
      };
    },
  };

  // Errors a press raises flash on that press's key, so the pressed Cell is known while changed() runs.
  const pressNow = api.press;
  api.press = async (r, c) => {
    pressed = cellAt(r, c);
    try {
      await pressNow(r, c);
    } finally {
      pressed = null;
    }
  };
  return api;
}
