// The panel runtime. Independent of Companion: the shell forwards config in and renders what comes out.
import { cellsIn, namesFrom, envFrom, errorText, currentLabel } from './vendor/panelrules.js';
import * as model from './vendor/panelmodel.js';
import { createTiming } from './timing.js';
import { flashWord } from './flash.js';

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
  'bad-config': 'Set the host, port, panel and key in the connection settings.',
};

export const FAILURE_CODES = Object.keys(FAILS);

const REFUSALS = { invalid_key: 'key-refused', key_required: 'key-refused', key_expired: 'key-expired', network_not_allowed: 'network-refused', api_off: 'api-off' };

class Refused extends Error {
  constructor(code) {
    super(code);
    this.fail = code;
  }
}

const NO_PANEL = { rows: 0, cols: 0 };
const NONE = { text: '', colour: 'none', pulse: 0 };

// Protected and presets change rarely, so they are read on every Nth tally poll.
const SLOW_EVERY = 5;

export function createRuntime({ host, port, tls = false, panel: panelRef, key, fetch: doFetch = globalThis.fetch, retryMs = 5000, pollMs = 2000, now = Date.now, timers = { setTimeout, clearTimeout }, log = () => {} }) {
  const base = `${tls ? 'https' : 'http'}://${host}:${port}/api/v1`;
  let status = { code: 'connecting', text: 'Connecting' };
  let panel = NO_PANEL;
  let names = namesFrom({});
  let drawn = [];
  let stopped = false;
  let timer = 0;
  let pollTimer = 0;
  let polls = 0;
  let st = model.createState();
  let env = envFrom({}, {});
  let flash = null; // { cell, at }: the Cell whose press set the error shown
  const listeners = [];
  const changed = () => {
    timing.sync();
    listeners.forEach((fn) => fn());
  };
  const timing = createTiming({ timers, now, read: () => st, write: (next) => (st = next), notify: changed });

  const set = (code, text = FAILS[code]) => {
    status = { code, text };
    changed();
  };

  // Settings the panel does not grant (scope 403) read as empty rather than failing the panel.
  const soft = (path) => get(path).catch(() => ({}));

  // Protected and presets are read only when slow is set; the last read stands between.
  let slowReads = [{}, {}];
  async function readRouter(slow) {
    const tally = await get('tally');
    if (slow) slowReads = await Promise.all([soft('protected'), soft('presets')]);
    env = envFrom(tally, slowReads[0], slowReads[1], panel.rights);
    st = model.applyTally(st, env);
  }

  async function poll() {
    if (stopped) return;
    try {
      await readRouter(++polls % SLOW_EVERY === 0);
      changed();
    } catch (e) {
      // Offline handling belongs to its own slice; a lost poll keeps the last state.
      log(`poll failed: ${e.fail || 'error'}`);
    }
    if (!stopped && pollMs > 0) pollTimer = setTimeout(poll, pollMs);
  }

  const get = async (path) => {
    const res = await doFetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${key}` } });
    log(`GET ${path} ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const code = REFUSALS[body?.error?.code] || (res.status === 404 ? 'panel-not-found' : 'unreachable');
    throw new Refused(code);
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
      drawn = cellsIn(p).sort((a, b) => a.r - b.r || a.c - b.c);
      st = model.createState(p.settings);
      await readRouter(true);
      if (stopped) return;
      set('ok', `Panel ${p.name}`);
      clearTimeout(pollTimer);
      if (pollMs > 0) pollTimer = setTimeout(poll, pollMs);
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
        const shown = model.resultShown(st, cell.n, now());
        if (shown) return { text: `${text}\n${shown.word}`, colour: `result-${shown.result}`, pulse: 0 };
        const s = model.destinationState(st, cell.n);
        if (s === 'staged') return { text: `${text}\n${names.source(st.staged.find((x) => x.dst === cell.n).src)}`, colour: 'destination-staged', pulse: 1 };
        return { text, colour: s === 'idle' ? 'destination' : `destination-${s}`, pulse: 0 };
      }
      case 'take': {
        const armed = model.armed(st, env);
        return { text, colour: armed ? 'take-armed' : 'take', pulse: armed ? 1 : 0 };
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

  const cellAt = (r, c) => drawn.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);

  async function sendTake() {
    const started = model.startTake(st, env, now());
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
    st = { ...st, touchedAt: now() };
    changed();
    if (!stopped) poll1();
  }

  // One extra tally read after a take, so the keys show what the router did without waiting for the next tick.
  const poll1 = () => readRouter(false).then(changed, () => {});

  return {
    async start() {
      if (!host || !port || !panelRef || !key) return set('bad-config');
      set('connecting', 'Connecting');
      await load();
    },
    stop() {
      stopped = true;
      timing.stop();
      clearTimeout(timer);
      clearTimeout(pollTimer);
    },
    release() {},
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
          break;
        case 'clear':
          st = model.pressClear(st, now());
          break;
        case 'take': {
          const g = model.guardDown(st, now());
          st = g.state;
          if (g.go) await sendTake();
          break;
        }
        default:
          return;
      }
      if (st.error && st.error !== before.error) flash = { cell, at: st.error.at };
      if (st !== before) changed();
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
      const err = model.errorOf(st, now());
      const flashing = err && flash?.cell === cell && flash.at === err.at;
      const { colour, pulse, text } = flashing ? { colour: 'error', pulse: 0, text: flashWord(err) } : cellLook(cell);
      return { text: root ? text : '', colour, pulse: pulse ? timing.phase() : 0 };
    },
  };
}
