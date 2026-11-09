// Sode's /stream WebSocket: frames in, reconnect on loss. No Companion and no runtime state in here.

// Node's WebSocket takes a non-standard headers option, which the Bearer header needs; a browser cannot set it.
// The key goes in that header only, never the URL.
export function openStream({ base, key, topics, WebSocket: WS = globalThis.WebSocket, retryMs, onUp, onDown, onFrame }) {
  const url = `${base.replace(/^http/, 'ws')}/stream?topics=${topics.join(',')}`;
  let ws = null;
  let timer = 0;
  let closed = false;
  let up = false;

  const connect = () => {
    let sock;
    try {
      sock = new WS(url, { headers: { Authorization: `Bearer ${key}` } });
    } catch {
      return retry();
    }
    ws = sock;
    sock.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'hello') {
        up = true;
        onUp();
      } else if (up) onFrame(msg);
    };
    // onerror is followed by onclose, so only close needs to act.
    sock.onerror = () => {};
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (up) {
        up = false;
        if (!closed) onDown();
      }
      retry();
    };
  };
  const retry = () => {
    if (!closed) timer = setTimeout(connect, retryMs);
  };
  connect();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // Already closed.
      }
    },
  };
}

// A tally frame after the snapshot carries only the routes that changed.
export function mergeTally(tally, delta) {
  const routes = [...(tally.routes || [])];
  for (const r of delta.routes || []) {
    const i = routes.findIndex((x) => x.dst === r.dst && x.level === r.level);
    if (i >= 0) routes[i] = r;
    else routes.push(r);
  }
  return { ...tally, routes };
}
