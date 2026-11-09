import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { until } from './until.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

// liveMs is real time between panel reads.
async function connect(fake, over = {}) {
  const rt = createRuntime({
    host: '127.0.0.1',
    port: fake.port,
    panel: 'speedtest',
    key: KEY,
    device: 'Deck',
    pollMs: 0,
    liveMs: 15,
    ...over,
  });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt };
}

const idle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const BASE = [
  { r: 1, c: 1, kind: 'source', n: 0 },
  { r: 1, c: 2, kind: 'destination', n: 0 },
  { r: 1, c: 3, kind: 'clear' },
];

test('changing a Cell reaches the key at that row and column', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt } = await connect(fake);
  assert.equal(rt.look(1, 1).text, 'CAM 1');
  fake.panel = panelOf([{ r: 1, c: 1, kind: 'destination', n: 1 }, ...BASE.slice(1)], { rev: 2 });
  await until(() => rt.look(1, 1).text === 'MON B', 'the change');
  assert.equal(rt.look(1, 1).colour, 'destination');
});

test('a changed grid size or Cell list rebuilds the cell list and tells the shell', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt } = await connect(fake);
  let told = 0;
  rt.onChange(() => told++);
  fake.panel = panelOf([...BASE, { r: 4, c: 1, kind: 'source', n: 1 }], { rev: 2, rows: 4 });
  await until(() => rt.cells().length === 4, 'the change');
  assert.equal(rt.grid().rows, 4);
  assert.ok(told > 0);
});

test('a newer panel applies at once when nothing is viewed or staged', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt } = await connect(fake);
  fake.panel = panelOf([{ r: 1, c: 1, kind: 'source', n: 1 }, ...BASE.slice(1)], { rev: 2 });
  await until(() => rt.look(1, 1).text === 'CAM 2', 'the change');
});

test('a newer panel applies at once while a destination is viewed or routes are staged, and drops both', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt } = await connect(fake);
  await rt.press(1, 2);
  await rt.press(1, 1);
  assert.equal(rt.variables().staged, 1);
  fake.panel = panelOf([{ r: 1, c: 1, kind: 'source', n: 1 }, ...BASE.slice(1)], { rev: 2 });
  await until(() => rt.look(1, 1).text === 'CAM 2', 'the change');
  assert.equal(rt.variables().staged, 0);
  assert.equal(rt.variables().viewed, '');
  assert.equal(rt.look(1, 2).colour, 'destination');
});

test('a newer panel waits for a take in flight, then applies', async () => {
  let release;
  const held = new Promise((ok) => (release = ok));
  const fake = await startFakeSode({
    panel: panelOf([...BASE, { r: 2, c: 1, kind: 'take' }]),
    takeReply: async (body) => {
      await held;
      return { status: 200, body: { ok: true, results: body.routes.map((r) => ({ ...r, result: 'connected', ok: true })) } };
    },
  });
  const { rt } = await connect(fake);
  await rt.press(1, 2);
  await rt.press(1, 1);
  const taking = rt.press(2, 1);
  fake.panel = panelOf([{ r: 1, c: 1, kind: 'source', n: 1 }, ...BASE.slice(1), { r: 2, c: 1, kind: 'take' }], { rev: 2 });
  await idle();
  assert.equal(rt.look(1, 1).text, 'CAM 1');
  release();
  await taking;
  await until(() => rt.look(1, 1).text === 'CAM 2', 'the change');
});

test('a merged Take shows its text on the Root square only and presses from any covered square', async () => {
  const fake = await startFakeSode({
    panel: panelOf([
      { r: 1, c: 1, kind: 'source', n: 0 },
      { r: 1, c: 2, kind: 'destination', n: 0 },
      { r: 2, c: 4, kind: 'take', rs: 2, cs: 2 },
    ]),
    tally: { levels: [{ level: 1, label: '1' }], routes: [] },
  });
  const { rt } = await connect(fake);
  await rt.press(1, 2);
  await rt.press(1, 1);
  assert.equal(rt.look(2, 4).text, 'Take');
  for (const [r, c] of [
    [2, 5],
    [3, 4],
    [3, 5],
  ])
    assert.deepEqual(rt.look(r, c), { text: '', colour: 'take-armed', pulse: 1 });
  await rt.press(3, 5);
  assert.equal(fake.takes.length, 1);
});

test('a key refused on a panel read stops all polling', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt } = await connect(fake);
  fake.refuse = { status: 401, code: 'invalid_key' };
  await until(() => rt.status().code === 'key-refused', 'the change');
  await idle();
  const n = fake.requests.length;
  await idle();
  assert.equal(fake.requests.length, n);
});
