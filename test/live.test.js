import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

// Row 1: CAM 1, CAM 2, MON A, Take.
const CELLS = [
  { r: 1, c: 1, kind: 'source', n: 0 },
  { r: 1, c: 2, kind: 'source', n: 1 },
  { r: 1, c: 3, kind: 'destination', n: 0 },
  { r: 1, c: 4, kind: 'take' },
];
const SRC1 = [1, 1];
const SRC2 = [1, 2];
const DST_A = [1, 3];
const TAKE = [1, 4];
const route = (dst, level, src) => ({ dst, level, src });
const tallyFrom = (src) => ({ levels: [{ level: 1, label: '1' }], routes: [route(0, 1, src)] });

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(fn, what, ms = 2000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(5);
  }
}
const tallyReads = (fake) => fake.requests.filter((q) => q.path === '/api/v1/tally').length;

async function connect(opts = {}, over = {}) {
  const fake = opts.fake || (await startFakeSode({ panel: panelOf(CELLS), tally: tallyFrom(0), stream: true, ...opts }));
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device: 'Deck', pollMs: 15, retryMs: 20, ...over });
  open.push(() => rt.stop(), () => fake.close());
  await rt.start();
  if (fake.streamEnabled) await until(() => fake.sockets.size > 0, 'the stream to open');
  return { rt, fake };
}

test('a tally change pushed on the stream reaches a key without a poll', async () => {
  const { rt, fake } = await connect();
  await rt.press(...DST_A);
  assert.equal(rt.look(...SRC1).colour, 'source-current');
  await sleep(60);
  const reads = tallyReads(fake);
  fake.push('tally', { routes: [route(0, 1, 1)] });
  await until(() => rt.look(...SRC2).colour === 'source-current', 'the pushed route');
  assert.equal(rt.look(...SRC1).colour, 'source');
  assert.equal(tallyReads(fake), reads);
  assert.ok(fake.upgrades.every((u) => u.auth === `Bearer ${KEY}` && !u.url.includes(KEY)));
});

test('names pushed on the stream rename the keys', async () => {
  const { rt, fake } = await connect();
  fake.push('names', { numberOffset: 1, sources: [{ n: 0, name: 'GFX' }], destinations: [{ n: 0, name: 'MON A' }] });
  await until(() => rt.look(...SRC1).text === 'GFX', 'the new name');
});

test('dropping the stream switches to polling, and reconnecting stops it', async () => {
  const { rt, fake } = await connect();
  await sleep(60);
  assert.equal(tallyReads(fake), 1, 'polled while the stream was up');
  fake.streamEnabled = false;
  fake.dropStream();
  fake.tally = tallyFrom(1);
  await rt.press(...DST_A);
  await until(() => rt.look(...SRC2).colour === 'source-current', 'a polled tally');
  fake.streamEnabled = true;
  await until(() => fake.sockets.size > 0, 'the stream to reconnect');
  await sleep(40);
  const reads = tallyReads(fake);
  await sleep(80);
  assert.equal(tallyReads(fake), reads);
});

test('with no stream, polling runs from the start', async () => {
  const { fake } = await connect({ stream: false });
  await sleep(100);
  assert.ok(tallyReads(fake) >= 3);
});

test('Sode going away shows Offline and ignores presses, then clears when it returns', async () => {
  const { rt, fake } = await connect();
  await rt.press(...DST_A);
  const { port, panel, tally } = fake;
  await fake.close();
  await until(() => rt.status().code === 'offline', 'Offline');
  assert.deepEqual(rt.look(...SRC1), { text: 'Offline', colour: 'offline', pulse: 0 });
  assert.equal(rt.look(...TAKE).text, 'Offline');
  const before = rt.variables();
  await rt.press(...SRC2);
  await rt.press(...TAKE);
  assert.deepEqual(rt.variables(), before);
  const back = await startFakeSode({ panel, tally, port, stream: true });
  open.push(() => back.close());
  await until(() => rt.status().code === 'ok', 'recovery');
  assert.equal(rt.look(...SRC1).text, 'CAM 1');
  assert.equal(back.takes.length, 0);
});

test('a router that is down shows Offline and ignores presses, then clears', async () => {
  const { rt, fake } = await connect();
  fake.push('status', { router: 'down', routerUp: false, error: true });
  await until(() => rt.status().code === 'offline', 'Offline');
  assert.equal(rt.look(...DST_A).text, 'Offline');
  await rt.press(...DST_A);
  assert.equal(rt.variables().viewed, '');
  fake.push('status', { router: 'up', routerUp: true, error: false });
  await until(() => rt.status().code === 'ok', 'recovery');
  await rt.press(...DST_A);
  assert.equal(rt.variables().viewed, 'MON A');
});

test('a polled status that says the router is down shows Offline until it is up', async () => {
  const { rt, fake } = await connect({ stream: false });
  fake.status = { router: 'down', routerUp: false, error: true };
  await until(() => rt.status().code === 'offline', 'Offline');
  fake.status = { router: 'up', routerUp: true, error: false };
  await until(() => rt.status().code === 'ok', 'recovery');
});

test('a key without the status scope is not Offline, whether polling or streaming', async () => {
  for (const stream of [true, false]) {
    const fake = await startFakeSode({ panel: panelOf(CELLS), tally: tallyFrom(0), stream });
    fake.noStatusScope = true;
    const { rt } = await connect({ fake });
    await sleep(80);
    assert.equal(rt.status().code, 'ok');
    assert.equal(rt.look(...SRC1).text, 'CAM 1');
    if (stream) assert.ok(fake.upgrades.every((u) => !u.topics.includes('status')));
  }
});

test('a key refused mid-run stops all polling and says why', async () => {
  const { rt, fake } = await connect();
  fake.refuse = { status: 401, code: 'invalid_key' };
  fake.streamEnabled = false;
  fake.dropStream();
  await until(() => rt.status().code === 'key-refused', 'the refusal');
  assert.match(rt.status().text, /refused the key/);
  await sleep(40);
  const n = fake.requests.length + fake.upgrades.length;
  await sleep(100);
  assert.equal(fake.requests.length + fake.upgrades.length, n);
});

test('a network refused mid-run is reported as such and stops polling', async () => {
  const { rt, fake } = await connect({ stream: false });
  fake.refuse = { status: 403, code: 'network_not_allowed' };
  await until(() => rt.status().code === 'network-refused', 'the refusal');
  await sleep(40);
  const n = fake.requests.length;
  await sleep(100);
  assert.equal(fake.requests.length, n);
});
