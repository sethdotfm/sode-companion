// Makes the Connection an online Sode Instance: the 15 second keepalive plus the held instances stream.
// The stream lets Sode notice a closed Connection after 8 seconds instead of 45; the keepalive stays as its fallback.

const KEEPALIVE_MS = 15000;
const MAX_DEVICE = 40;

// The device name Sode shows: the setting, else the connection's label. null when it is too long for Sode.
export function deviceName(device, label) {
  const name = String(device || '').trim() || String(label || '').trim();
  return name.length <= MAX_DEVICE ? name : null;
}

// Never throws and never logs the key. Returns stop().
export function startInstance({ base, panelId, key, device, fetch: doFetch, retryMs, log }) {
  const url = `${base}/panels/${encodeURIComponent(panelId)}/instances`;
  const headers = { Authorization: `Bearer ${key}` };
  const abort = new AbortController();
  let retry = 0;

  const keepalive = () =>
    doFetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device }),
      signal: abort.signal,
    })
      .then((res) => log(`POST instances ${res.status}`))
      .catch(() => {});

  async function hold() {
    try {
      const res = await doFetch(`${url}/stream?device=${encodeURIComponent(device)}`, { headers, signal: abort.signal });
      log(`GET instances/stream ${res.status}`);
      // The held body only matters for how long it stays open.
      if (res.ok && res.body) for await (const _chunk of res.body);
    } catch {
      // Aborted by stop, or the connection dropped: reopen below.
    }
    if (!abort.signal.aborted) retry = setTimeout(hold, retryMs);
  }

  keepalive();
  const tick = setInterval(keepalive, KEEPALIVE_MS);
  hold();
  return () => {
    abort.abort();
    clearInterval(tick);
    clearTimeout(retry);
  };
}
