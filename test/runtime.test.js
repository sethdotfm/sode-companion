import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

async function connect(fake, over = {}) {
  const log = [];
  const rt = createRuntime({
    host: '127.0.0.1',
    port: fake.port,
    tls: false,
    panel: 'speedtest',
    key: KEY,
    device: 'Deck',
    log: (m) => log.push(m),
    ...over,
  });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, log };
}

test('the look of a row and column is the name of the Cell there', async () => {
  const fake = await startFakeSode({
    panel: panelOf([
      { r: 1, c: 1, kind: 'source', n: 1 },
      { r: 1, c: 2, kind: 'destination', n: 0 },
      { r: 2, c: 1, kind: 'source', n: 0, caption: 'Wide' },
    ]),
  });
  const { rt } = await connect(fake);
  assert.deepEqual(rt.grid(), { rows: 3, cols: 5 });
  assert.equal(rt.look(1, 1).text, 'CAM 2');
  assert.equal(rt.look(1, 2).text, 'MON A');
  assert.equal(rt.look(2, 1).text, 'Wide');
  assert.deepEqual(rt.status(), { code: 'ok', text: 'Panel Test panel' });
});

test('Cells without a Source, Destination or Preset and empty squares look blank and are not listed as presets', async () => {
  const fake = await startFakeSode({
    panel: panelOf([
      { r: 1, c: 1, kind: 'source' },
      { r: 1, c: 2, kind: 'destination' },
      { r: 1, c: 3, kind: 'preset', scope: 'everyone' },
      { r: 1, c: 4, kind: 'source', n: 0 },
    ]),
  });
  const { rt } = await connect(fake);
  for (const [r, c] of [
    [1, 1],
    [1, 2],
    [1, 3],
    [3, 5],
  ]) {
    assert.deepEqual(rt.look(r, c), { text: '', colour: 'blank', pulse: 0 });
    await rt.press(r, c);
  }
  assert.equal(rt.look(1, 4).text, 'CAM 1');
  assert.equal(rt.variables().staged, 0);
  assert.equal(rt.variables().key_3_5, '');
  assert.equal(rt.variables().key_1_1, '');
  assert.deepEqual(
    rt.cells().map((x) => [x.r, x.c]),
    [[1, 4]],
  );
});

test('cells list in grid order and a merged Cell shows its text on the root square only', async () => {
  const fake = await startFakeSode({
    panel: panelOf([
      { r: 2, c: 1, kind: 'preset', scope: 'everyone', name: 'Opening' },
      { r: 1, c: 4, kind: 'take', rs: 2, cs: 2 },
      { r: 1, c: 1, kind: 'clear' },
    ]),
  });
  const { rt } = await connect(fake);
  assert.deepEqual(
    rt.cells().map((x) => [x.r, x.c]),
    [
      [1, 1],
      [1, 4],
      [2, 1],
    ],
  );
  assert.equal(rt.look(1, 4).text, 'Take');
  for (const [r, c] of [
    [1, 5],
    [2, 4],
    [2, 5],
  ]) {
    assert.deepEqual(rt.look(r, c), { text: '', colour: 'take', pulse: 0 });
  }
  assert.equal(rt.look(2, 1).text, 'Opening');
});

test('a panel that acts as both an API client and a user connects', async () => {
  const { rt } = await connect(await startFakeSode({ panel: panelOf([{ r: 1, c: 1, kind: 'source', n: 0 }], { acts: 'both' }) }));
  assert.equal(rt.status().code, 'ok');
});

const failure = async (fake) => {
  const { rt } = await connect(fake);
  return rt.status();
};

test('each refusal gives its own failure code and message', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0 }];
  const cases = {
    'key-refused': { panel: panelOf(cells), refuse: { status: 401, code: 'invalid_key' } },
    'key-expired': { panel: panelOf(cells), refuse: { status: 401, code: 'key_expired' } },
    'network-refused': { panel: panelOf(cells), refuse: { status: 403, code: 'network_not_allowed' } },
    'session-mode': { panel: panelOf(cells, { acts: 'session' }) },
    'panel-not-found': { panel: panelOf(cells, { slug: 'other', id: 'p-other' }) },
    'api-off': { panel: panelOf(cells), refuse: { status: 503, code: 'api_off' } },
  };
  const seen = [];
  for (const [code, opts] of Object.entries(cases)) {
    const s = await failure(await startFakeSode(opts));
    assert.equal(s.code, code);
    assert.ok(s.text.length > 10, `no message for ${code}`);
    seen.push(s.text);
  }
  assert.equal(new Set(seen).size, seen.length, 'messages are not distinct');
});

test('the key goes out as a Bearer header and shows up nowhere else', async () => {
  const out = [];
  const spies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => {
    const orig = console[k];
    console[k] = (...a) => out.push(a.map(String).join(' '));
    return () => (console[k] = orig);
  });
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0 }];
  const texts = [];
  const logs = [];
  try {
    for (const refuse of [null, { status: 401, code: 'invalid_key' }, { status: 403, code: 'network_not_allowed' }]) {
      const fake = await startFakeSode({ panel: panelOf(cells), refuse });
      const { rt, log } = await connect(fake);
      texts.push(rt.status().text, JSON.stringify(rt.look(1, 1)));
      logs.push(...log);
      assert.ok(
        fake.requests.every((q) => q.auth === `Bearer ${KEY}`),
        'auth header missing',
      );
      assert.ok(
        fake.requests.every((q) => !q.url.includes(KEY)),
        'key sent in the URL',
      );
    }
  } finally {
    spies.forEach((undo) => undo());
  }
  assert.ok(logs.length > 0, 'nothing was logged to check');
  const all = [...texts, ...logs, ...out].join('\n');
  assert.ok(!all.includes(KEY) && !all.includes(KEY.slice(5)), 'key leaked into status, look, log or console');
});

test('a Session-mode panel says to switch it to act as its own API client', async () => {
  const fake = await startFakeSode({ panel: panelOf([], { acts: 'session' }) });
  assert.match((await failure(fake)).text, /own API client/);
});

test('a refused key stops the runtime from asking again', async () => {
  const fake = await startFakeSode({ panel: panelOf([]), refuse: { status: 401, code: 'invalid_key' } });
  await connect(fake, { retryMs: 10 });
  const n = fake.requests.length;
  await new Promise((ok) => setTimeout(ok, 80));
  assert.equal(fake.requests.length, n);
});

test('a failed panel read draws nothing and keeps the failure status', async () => {
  const fake = await startFakeSode({
    panel: panelOf([{ r: 1, c: 1, kind: 'source', n: 0 }]),
    refuse: { status: 403, code: 'network_not_allowed' },
  });
  const { rt } = await connect(fake);
  assert.deepEqual(rt.cells(), []);
  assert.deepEqual(rt.look(1, 1), { text: '', colour: 'none', pulse: 0 });
  assert.deepEqual(rt.grid(), { rows: 0, cols: 0 });
});

test('status is Connecting until the panel is read, and every change is announced', async () => {
  const fake = await startFakeSode({ panel: panelOf([]) });
  const seen = [];
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device: 'Deck' });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  rt.onChange(() => seen.push(rt.status().code));
  assert.equal(rt.status().code, 'connecting');
  await rt.start();
  assert.deepEqual(seen, ['connecting', 'ok']);
});

test('an unreachable Sode is reported, and the runtime recovers when it answers', async () => {
  const fake = await startFakeSode({ panel: panelOf([{ r: 1, c: 1, kind: 'source', n: 0 }]) });
  const port = fake.port;
  await fake.close();
  const rt = createRuntime({ host: '127.0.0.1', port, panel: 'speedtest', key: KEY, device: 'Deck', retryMs: 20 });
  open.push(() => rt.stop());
  await rt.start();
  assert.equal(rt.status().code, 'unreachable');
  const back = await startFakeSode({ panel: panelOf([{ r: 1, c: 1, kind: 'source', n: 0 }]), port });
  open.push(() => back.close());
  await new Promise((ok) => {
    rt.onChange(() => rt.status().code === 'ok' && ok());
  });
  assert.equal(rt.look(1, 1).text, 'CAM 1');
});

test('a key pasted without the sode_ prefix is sent with it, and a full key is not doubled', async () => {
  for (const key of [KEY.slice(5), KEY]) {
    const fake = await startFakeSode({ panel: panelOf([{ r: 1, c: 1, kind: 'source', n: 0 }]) });
    const { rt } = await connect(fake, { key });
    assert.equal(rt.status().code, 'ok');
    assert.ok(fake.requests.length > 0);
    assert.ok(fake.requests.every((q) => q.auth === `Bearer ${KEY}`));
  }
});
