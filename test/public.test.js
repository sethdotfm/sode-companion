import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

async function connect(fake, over = {}) {
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', device: 'Deck', ...over });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return rt;
}

const publicPanel = () => panelOf([{ r: 1, c: 1, kind: 'source', n: 0 }], { acts: 'public' });
const authsOf = (fake, path) => fake.requests.filter((r) => r.path === path).map((r) => r.auth);

test('a Public panel with no key asks Sode for one and loads with it', async () => {
  const fake = await startFakeSode({ panel: publicPanel() });
  const rt = await connect(fake);
  assert.equal(rt.status().code, 'ok');
  assert.equal(rt.look(1, 1).text, 'CAM 1');
  const ask = fake.requests.find((r) => r.path.endsWith('/public'));
  assert.equal(ask.method, 'POST');
  assert.ok(ask.auth === '');
  assert.ok(authsOf(fake, '/api/v1/names').every((a) => a === 'Bearer sode_pub.1'));
});

test('a key that ended is replaced once and the call repeats with the new one', async () => {
  const fake = await startFakeSode({ panel: publicPanel() });
  const rt = await connect(fake, { liveMs: 20 });
  fake.endedKeys.add('sode_pub.1');
  await new Promise((ok) => setTimeout(ok, 150));
  assert.equal(rt.status().code, 'ok');
  assert.equal(fake.publicIssued, 2);
  assert.ok(authsOf(fake, '/api/v1/panels/speedtest').at(-1) === 'Bearer sode_pub.2');
});

test('a panel that is not Public with no key fails as not-public', async () => {
  const fake = await startFakeSode({ panel: panelOf([]) });
  const rt = await connect(fake);
  assert.equal(rt.status().code, 'not-public');
  assert.ok(!fake.requests.some((r) => r.path === '/api/v1/names'));
});

test('a link without a key on a Public panel works', async () => {
  const fake = await startFakeSode({ panel: publicPanel() });
  const rt = await connect(fake, { host: undefined, port: undefined, link: `http://127.0.0.1:${fake.port}/panels/speedtest` });
  assert.equal(rt.status().code, 'ok');
});

test('a key still works on a Public panel and nothing is asked', async () => {
  const fake = await startFakeSode({ panel: publicPanel() });
  const rt = await connect(fake, { key: 'sode_KEY' });
  assert.equal(rt.status().code, 'ok');
  assert.ok(!fake.requests.some((r) => r.path.endsWith('/public')));
});
