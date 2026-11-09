// A small Sode for seam 1: serves the /api/v1 reads the runtime makes and records every request.
// Keys are never printed: tests compare them with assert.ok so a failure shows no value.
import http from 'node:http';
import { createHash } from 'node:crypto';

export const KEY = 'sode_TESTKEY0123456789abcdefghijklmnopqrstuvw';

export const panelOf = (cells, extra = {}) => ({
  id: 'p-1a2b3c4d',
  name: 'Test panel',
  slug: 'speedtest',
  acts: 'api',
  rows: 3,
  cols: 5,
  cells,
  settings: {},
  rev: 1,
  ...extra,
});

export const NAMES = {
  numberOffset: 1,
  sources: [
    { n: 0, name: 'CAM 1' },
    { n: 1, name: 'CAM 2' },
  ],
  destinations: [
    { n: 0, name: 'MON A' },
    { n: 1, name: 'MON B' },
  ],
};

const apiError = (res, status, code, message = code) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
};

// WebSocket frames from server to client are never masked; payloads here stay under 64 KiB.
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsFrame = (text) => {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
};

// opts.panel, opts.names; opts.refuse = { status, code } answers every call with that error.
// opts.stream = true serves GET /stream as a WebSocket. Off by default, so the upgrade answers 404 and the runtime polls.
// fake.streamEnabled turns it off and on later; fake.push(topic, data) sends a frame; fake.dropStream() closes every socket.
// fake.noStatusScope makes /status and the status topic 403 scope. fake.upgrades records each upgrade attempt.
export async function startFakeSode(opts = {}) {
  const fake = {
    panel: opts.panel,
    names: opts.names || NAMES,
    refuse: opts.refuse || null,
    requests: [],
    // keepalives: parsed bodies of POST /panels/{id}/instances. streams: one per held instances stream, end() drops it.
    keepalives: [],
    streams: [],
    // Router state the polled reads serve; tests assign these between presses.
    tally: opts.tally || { levels: [{ level: 1, label: '1' }], routes: [] },
    protected: opts.protected || { protected: [] },
    presets: opts.presets || { presets: [] },
    // takes: { body, idempotencyKey } per POST /takes. takeReply(body) returns { status, body }, default connected for every route.
    takes: [],
    status: opts.status || { router: 'up', routerUp: true, error: false },
    noStatusScope: false,
    streamEnabled: !!opts.stream,
    upgrades: [],
    sockets: new Set(),
    takeReply: opts.takeReply || ((body) => ({ status: 200, body: { ok: true, results: body.routes.map((r, i) => ({ id: i + 1, ...r, result: 'connected', ok: true })) } })),
  };
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    fake.requests.push({ method: req.method, path, auth: req.headers.authorization || '', url: req.url });
    if (fake.refuse) return apiError(res, fake.refuse.status, fake.refuse.code);
    const json = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const inst = /^\/api\/v1\/panels\/([^/]+)\/instances(\/stream)?$/.exec(path);
    if (inst && (inst[1] === fake.panel?.id || inst[1] === fake.panel?.slug)) {
      if (inst[2] && req.method === 'GET') {
        const entry = { device: new URL(req.url, 'http://x').searchParams.get('device'), open: true, end: () => res.end() };
        fake.streams.push(entry);
        res.on('close', () => (entry.open = false));
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        return res.write('{"online":true,"graceSeconds":8}\n');
      }
      if (!inst[2] && req.method === 'POST') {
        let raw = '';
        req.on('data', (d) => (raw += d));
        return req.on('end', () => {
          fake.keepalives.push(JSON.parse(raw || '{}'));
          json({ ok: true });
        });
      }
    }
    const m = /^\/api\/v1\/panels\/([^/]+)$/.exec(path);
    if (m && (m[1] === fake.panel?.id || m[1] === fake.panel?.slug)) return json(fake.panel);
    if (m) return apiError(res, 404, 'not_found');
    if (path === '/api/v1/names') return json(fake.names);
    if (path === '/api/v1/tally') return json(fake.tally);
    if (path === '/api/v1/protected') return json(fake.protected);
    if (path === '/api/v1/status') return fake.noStatusScope ? apiError(res, 403, 'scope') : json(fake.status);
    // presetsRefuse = { status, code }: a key without the presets scope.
    if (path === '/api/v1/presets' && fake.presetsRefuse) return apiError(res, fake.presetsRefuse.status, fake.presetsRefuse.code);
    if (path === '/api/v1/presets') return json(fake.presets);
    if (path === '/api/v1/takes' && req.method === 'POST') {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        fake.takes.push({ body, idempotencyKey: req.headers['idempotency-key'] || '' });
        // takeReply may return a promise, so a test can hold a take in flight.
        Promise.resolve(fake.takeReply(body)).then((reply) => {
          res.writeHead(reply.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(reply.body));
        });
      });
      return;
    }
    return apiError(res, 404, 'not_found');
  });
  fake.push = (topic, data, t = topic) => {
    for (const sock of fake.sockets) sock.write(wsFrame(JSON.stringify({ t, topic, data })));
  };
  fake.dropStream = () => {
    for (const sock of fake.sockets) sock.destroy();
    fake.sockets.clear();
  };
  server.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://x');
    const topics = (url.searchParams.get('topics') || '').split(',').filter(Boolean);
    fake.upgrades.push({ path: url.pathname, auth: req.headers.authorization || '', url: req.url, topics });
    const deny = (status, code) => {
      const body = JSON.stringify({ error: { code, message: code } });
      sock.end(`HTTP/1.1 ${status} X\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    };
    if (url.pathname !== '/api/v1/stream' || !fake.streamEnabled) return deny(404, 'not_found');
    if (fake.refuse) return deny(fake.refuse.status, fake.refuse.code);
    if (topics.includes('status') && fake.noStatusScope) return deny(403, 'scope');
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + WS_GUID).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    fake.sockets.add(sock);
    sock.on('close', () => fake.sockets.delete(sock));
    sock.on('error', () => {});
    // A client close frame (opcode 8) is answered with one; every other client frame is ignored, as Sode does.
    sock.on('data', (buf) => (buf[0] & 15) === 8 && sock.end(Buffer.from([0x88, 0])));
    const send = (t, topic, data) => sock.write(wsFrame(JSON.stringify({ t, topic, data })));
    send('hello', undefined, { v: 1, topics, numberOffset: 1 });
    const snaps = { names: fake.names, tally: fake.tally, status: fake.status };
    for (const t of topics) if (snaps[t]) send('snapshot', t, snaps[t]);
  });
  await new Promise((ok) => server.listen(opts.port || 0, '127.0.0.1', ok));
  fake.port = server.address().port;
  fake.close = () => new Promise((ok) => (fake.dropStream(), server.closeAllConnections(), server.close(ok)));
  return fake;
}
