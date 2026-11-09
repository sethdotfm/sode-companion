// A small Sode for seam 1: serves the /api/v1 reads the runtime makes and records every request.
// Keys are never printed: tests compare them with assert.ok so a failure shows no value.
import http from 'node:http';

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

// opts.panel, opts.names; opts.refuse = { status, code } answers every call with that error.
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
  await new Promise((ok) => server.listen(opts.port || 0, '127.0.0.1', ok));
  fake.port = server.address().port;
  fake.close = () => new Promise((ok) => (server.closeAllConnections(), server.close(ok)));
  return fake;
}
