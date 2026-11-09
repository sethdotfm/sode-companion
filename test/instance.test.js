import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  mock.timers.reset();
  while (open.length) await open.pop()();
});

const cells = [{ r: 1, c: 1, kind: 'source', n: 0 }];
const settle = () => new Promise((ok) => setTimeout(ok, 50));

// Only setInterval is faked, so HTTP and the retry timers still run for real.
async function connect(fake, over = {}) {
  mock.timers.enable({ apis: ['setInterval'] });
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device: 'Deck', label: 'Studio deck', ...over });
  open.push(() => rt.stop(), () => fake.close());
  await rt.start();
  await settle();
  return rt;
}

test('the fake Sode sees a keepalive with the device name every 15 seconds', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  await connect(fake);
  assert.deepEqual(fake.keepalives, [{ device: 'Deck' }]);
  mock.timers.tick(14999);
  await settle();
  assert.equal(fake.keepalives.length, 1);
  mock.timers.tick(1);
  await settle();
  assert.equal(fake.keepalives.length, 2);
  mock.timers.tick(15000);
  await settle();
  assert.deepEqual(fake.keepalives, [{ device: 'Deck' }, { device: 'Deck' }, { device: 'Deck' }]);
});

test('the instances stream is held with the device name and the Bearer key', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  await connect(fake);
  assert.equal(fake.streams.length, 1);
  assert.equal(fake.streams[0].device, 'Deck');
  assert.ok(fake.streams[0].open);
  const calls = fake.requests.filter((q) => q.path.endsWith('/instances/stream') || q.path.endsWith('/instances'));
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((q) => q.auth === `Bearer ${KEY}` && !q.url.includes(KEY)));
});

test('stopping the Connection ends the held stream and the keepalive', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  const rt = await connect(fake);
  rt.stop();
  await settle();
  assert.equal(fake.streams[0].open, false);
  mock.timers.tick(45000);
  await settle();
  assert.equal(fake.keepalives.length, 1);
  assert.equal(fake.streams.length, 1, 'stream reopened after stop');
});

test('a dropped stream is reopened', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  await connect(fake, { retryMs: 10 });
  fake.streams[0].end();
  await settle();
  assert.equal(fake.streams.length, 2);
  assert.ok(fake.streams[1].open);
});

test('an empty device name uses the connection label', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  await connect(fake, { device: '  ' });
  assert.deepEqual(fake.keepalives, [{ device: 'Studio deck' }]);
  assert.equal(fake.streams[0].device, 'Studio deck');
});

test('a device name over 40 characters is refused with a clear message and nothing is sent', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  const rt = await connect(fake, { device: 'x'.repeat(41) });
  assert.equal(rt.status().code, 'bad-device');
  assert.match(rt.status().text, /40 characters/);
  assert.equal(fake.requests.length, 0);
});

test('a device name of exactly 40 characters is accepted', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  const rt = await connect(fake, { device: 'x'.repeat(40) });
  assert.equal(rt.status().code, 'ok');
  assert.equal(fake.keepalives[0].device.length, 40);
});

test('a long label is refused too when the device name is empty', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells) });
  const rt = await connect(fake, { device: '', label: 'y'.repeat(41) });
  assert.equal(rt.status().code, 'bad-device');
});

test('a refused key sends no keepalive and opens no stream', async () => {
  const fake = await startFakeSode({ panel: panelOf(cells), refuse: { status: 401, code: 'invalid_key' } });
  await connect(fake);
  assert.deepEqual(fake.keepalives, []);
  assert.deepEqual(fake.streams, []);
});
