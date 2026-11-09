// The panel runtime. Independent of Companion: the shell forwards config in and renders what comes out.
import { cellsIn, namesFrom } from './vendor/panelrules.js';
import { deviceName, startInstance } from './instance.js';

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
  'bad-device': 'The device name is over 40 characters. Shorten it, or the connection label when the device name is blank.',
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

export function createRuntime({ host, port, tls = false, panel: panelRef, key, device = '', label = '', fetch: doFetch = globalThis.fetch, retryMs = 5000, log = () => {} }) {
  const base = `${tls ? 'https' : 'http'}://${host}:${port}/api/v1`;
  let status = { code: 'connecting', text: 'Connecting' };
  let panel = NO_PANEL;
  let names = namesFrom({});
  let drawn = [];
  let stopped = false;
  let timer = 0;
  let stopInstance = null;
  const name = deviceName(device, label);
  const listeners = [];

  const set = (code, text = FAILS[code]) => {
    status = { code, text };
    listeners.forEach((fn) => fn());
  };

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
      stopInstance ??= startInstance({ base, panelId: p.id, key, device: name, fetch: doFetch, retryMs, log });
      set('ok', `Panel ${p.name}`);
    } catch (e) {
      if (stopped) return;
      // A refusal ends the attempts: only a changed key, list or panel helps. A lost connection is retried.
      const code = e.fail || 'unreachable';
      log(`panel not loaded: ${code}`);
      set(code);
      if (code === 'unreachable') timer = setTimeout(load, retryMs);
    }
  }

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
      stopInstance?.();
    },
    onChange: (fn) => listeners.push(fn),
    status: () => status,
    grid: () => ({ rows: panel.rows, cols: panel.cols }),
    cells: () => drawn,
    look(r, c) {
      const cell = drawn.find((x) => r >= x.r && r < x.r + x.rs && c >= x.c && c < x.c + x.cs);
      if (!cell) return { text: '', colour: 'none', pulse: 0 };
      const root = cell.r === r && cell.c === c;
      return { text: root ? labelOf(cell, names) : '', colour: cell.kind, pulse: 0 };
    },
  };
}
