import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { until } from './until.js';
import { fakeClock } from './fake-clock.js';

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
const tallyReads = (fake) => fake.requests.filter((q) => q.path === '/api/v1/tally').length;

// The runtime stops polling tally once it has read the stream's hello, which the fake cannot signal.
async function pollsStopped(fake) {
  let last = -1;
  let calm = 0;
  await until(() => {
    const n = tallyReads(fake);
    calm = n === last ? calm + 1 : 0;
    last = n;
    return calm >= 10;
  }, 'tally polling to stop');
}

async function connect(opts = {}, over = {}) {
  const fake = opts.fake || (await startFakeSode({ panel: panelOf(CELLS), tally: tallyFrom(0), stream: true, ...opts }));
  const rt = createRuntime({
    host: '127.0.0.1',
    port: fake.port,
    panel: 'speedtest',
    key: KEY,
    device: 'Deck',
    pollMs: 15,
    retryMs: 20,
    ...over,
  });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  if (fake.streamEnabled) {
    await until(() => fake.sockets.size > 0, 'the stream to open');
    await pollsStopped(fake);
  }
  return { rt, fake };
}

test('a tally change pushed on the stream reaches a key without a poll', async () => {
  const { rt, fake } = await connect();
  await rt.press(...DST_A);
  assert.equal(rt.look(...SRC1).colour, 'source-current');
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

test('tally, names and status change frames reach the keys', async () => {
  const { rt, fake } = await connect();
  await rt.press(...DST_A);
  fake.push('tally', { routes: [route(0, 1, 1)] });
  await until(() => rt.look(...SRC2).colour === 'source-current', 'the tally frame');
  fake.push('names', { numberOffset: 1, sources: [{ n: 0, name: 'GFX' }], destinations: [{ n: 0, name: 'MON A' }] });
  await until(() => rt.look(...SRC1).text === 'GFX', 'the names frame');
  fake.push('status', { router: 'down', routerUp: false, error: true });
  await until(() => rt.look(...SRC1).colour === 'offline', 'the status frame');
});

test('ping, unknown and topic-less change frames are ignored', async () => {
  const { rt, fake } = await connect();
  await rt.press(...DST_A);
  const before = rt.variables();
  fake.pushRaw({ t: 'ping' });
  fake.pushRaw({ t: 'ping', topic: 'tally', data: {} });
  fake.pushRaw({ t: 'mystery', topic: 'mystery', data: { routes: [route(0, 1, 1)] } });
  fake.pushRaw({ t: 'tally', data: { routes: [route(0, 1, 1)] } });
  fake.pushRaw({ t: 'status', data: { router: 'down', routerUp: false, error: true } });
  fake.push('tally', { routes: [route(0, 1, 1)] });
  await until(() => rt.look(...SRC2).colour === 'source-current', 'the frame after the ignored ones');
  assert.equal(rt.status().code, 'ok');
  assert.equal(rt.look(...SRC1).colour, 'source');
  assert.notDeepEqual(rt.variables(), before);
});

test('while the stream is up the tally is re-read every 30 s, so a missed delta heals', async () => {
  const clock = fakeClock();
  const { rt, fake } = await connect({}, { timers: clock.timers });
  await rt.press(...DST_A);
  fake.tally = tallyFrom(1);
  const reads = tallyReads(fake);
  clock.advance(29_999);
  await sleep(50);
  assert.equal(tallyReads(fake), reads);
  clock.advance(1);
  await until(() => rt.look(...SRC2).colour === 'source-current', 'the re-read tally');
  assert.equal(tallyReads(fake), reads + 1);
  // A take's own refresh does not move the next re-read.
  await rt.press(...SRC1);
  await rt.press(...TAKE);
  const afterTake = tallyReads(fake);
  clock.advance(30_000);
  await until(() => tallyReads(fake) > afterTake, 'the next re-read');
});

test('dropping the stream stops the 30 s re-read', async () => {
  const clock = fakeClock();
  const { fake } = await connect({}, { timers: clock.timers, pollMs: 0 });
  fake.streamEnabled = false;
  fake.dropStream();
  await sleep(100);
  const reads = tallyReads(fake);
  clock.advance(60_000);
  await sleep(50);
  assert.equal(tallyReads(fake), reads);
});

test('dropping the stream switches to polling, and reconnecting stops it', async () => {
  const { rt, fake } = await connect();
  const upReads = tallyReads(fake);
  await sleep(100);
  assert.equal(tallyReads(fake), upReads, 'polled while the stream was up');
  fake.streamEnabled = false;
  fake.dropStream();
  fake.tally = tallyFrom(1);
  await rt.press(...DST_A);
  await until(() => rt.look(...SRC2).colour === 'source-current', 'a polled tally');
  fake.streamEnabled = true;
  await until(() => fake.sockets.size > 0, 'the stream to reconnect');
  // An in-flight poll may land just after the reconnect, so let it pass before counting.
  await sleep(150);
  const reads = tallyReads(fake);
  await sleep(100);
  assert.equal(tallyReads(fake), reads);
});

test('with no stream, polling runs from the start', async () => {
  const { fake } = await connect({ stream: false });
  await until(() => tallyReads(fake) >= 3, 'three polled tally reads');
});

test('Sode going away shows Offline and ignores presses, then clears when it returns', async () => {
  const { rt, fake } = await connect();
  await rt.press(...DST_A);
  const { port, panel, tally } = fake;
  await fake.close();
  await until(() => rt.status().code === 'offline', 'Offline');
  assert.deepEqual(rt.look(...SRC1), { text: 'Offline', colour: 'offline', pulse: 0 });
  assert.equal(rt.look(...TAKE).text, 'Offline');
  // Every key square of the panel shows Offline, blank ones too; squares beyond the panel stay blank.
  assert.deepEqual(rt.look(2, 1), { text: 'Offline', colour: 'offline', pulse: 0 });
  assert.deepEqual(rt.look(3, 5), { text: 'Offline', colour: 'offline', pulse: 0 });
  assert.deepEqual(rt.look(4, 8), { text: '', colour: 'none', pulse: 0 });
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
  await sleep(150);
  const n = fake.requests.length + fake.upgrades.length;
  await sleep(100);
  assert.equal(fake.requests.length + fake.upgrades.length, n);
});

test('a network refused mid-run is reported as such and stops polling', async () => {
  const { rt, fake } = await connect({ stream: false });
  fake.refuse = { status: 403, code: 'network_not_allowed' };
  await until(() => rt.status().code === 'network-refused', 'the refusal');
  await sleep(150);
  const n = fake.requests.length;
  await sleep(100);
  assert.equal(fake.requests.length, n);
});

test('a refusal on a slow read while the stream is up stops polling and says why', async () => {
  const { rt, fake } = await connect();
  fake.fail = { path: '/api/v1/protected', status: 401, code: 'invalid_key' };
  await until(() => rt.status().code === 'key-refused', 'the refusal');
  await sleep(150);
  const n = fake.requests.length;
  await sleep(100);
  assert.equal(fake.requests.length, n);
});

test('an outage on a slow read while the stream is up shows Offline, and clears when it ends', async () => {
  const { rt, fake } = await connect();
  fake.fail = { path: '/api/v1/protected', status: 500, code: 'boom' };
  await until(() => rt.status().code === 'offline', 'Offline');
  fake.fail = null;
  await until(() => rt.status().code === 'ok', 'recovery');
});

test('a key without the protected scope is not Offline', async () => {
  const { rt, fake } = await connect();
  fake.fail = { path: '/api/v1/protected', status: 403, code: 'scope_required' };
  const reads = () => fake.requests.filter((q) => q.path === '/api/v1/protected').length;
  const before = reads();
  await until(() => reads() >= before + 2, 'two more protected reads');
  assert.equal(rt.status().code, 'ok');
});
