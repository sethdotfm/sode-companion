import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

// The injected clock gates the 10 second wait; liveMs is real time between panel reads.
async function connect(fake, over = {}) {
  const clock = { t: 1_000_000 };
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device: 'Deck', pollMs: 0, liveMs: 15, now: () => clock.t, ...over });
  open.push(() => rt.stop(), () => fake.close());
  await rt.start();
  return { rt, clock };
}

const until = async (fn, ms = 1500) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail('condition not met in time');
};
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
  await until(() => rt.look(1, 1).text === 'MON B');
  assert.equal(rt.look(1, 1).colour, 'destination');
});

test('a changed grid size or Cell list rebuilds the cell list and tells the shell', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt } = await connect(fake);
  let told = 0;
  rt.onChange(() => told++);
  fake.panel = panelOf([...BASE, { r: 4, c: 1, kind: 'source', n: 1 }], { rev: 2, rows: 4 });
  await until(() => rt.cells().length === 4);
  assert.equal(rt.grid().rows, 4);
  assert.ok(told > 0);
});

test('a newer panel applies at once when nothing is viewed or staged', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt } = await connect(fake);
  fake.panel = panelOf([{ r: 1, c: 1, kind: 'source', n: 1 }, ...BASE.slice(1)], { rev: 2 });
  await until(() => rt.look(1, 1).text === 'CAM 2'); // the clock never moved
});

test('a newer panel waits 10 seconds while a destination is viewed, and the view is kept', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt, clock } = await connect(fake);
  await rt.press(1, 2);
  fake.panel = panelOf([{ r: 1, c: 1, kind: 'source', n: 1 }, ...BASE.slice(1)], { rev: 2 });
  await idle();
  assert.equal(rt.look(1, 1).text, 'CAM 1');
  clock.t += 9_000;
  await idle();
  assert.equal(rt.look(1, 1).text, 'CAM 1');
  clock.t += 1_500;
  await until(() => rt.look(1, 1).text === 'CAM 2');
  assert.equal(rt.look(1, 2).colour, 'destination-view');
});

test('a newer panel does not replace staged routes; it applies once they are cleared', async () => {
  const fake = await startFakeSode({ panel: panelOf(BASE) });
  const { rt, clock } = await connect(fake);
  await rt.press(1, 2);
  await rt.press(1, 1);
  fake.panel = panelOf([{ r: 1, c: 1, kind: 'source', n: 1 }, ...BASE.slice(1)], { rev: 2 });
  clock.t += 60_000;
  await idle();
  assert.equal(rt.look(1, 1).text, 'CAM 1');
  assert.equal(rt.variables().staged, 1);
  await rt.press(1, 3);
  await until(() => rt.look(1, 1).text === 'CAM 2');
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
  for (const [r, c] of [[2, 5], [3, 4], [3, 5]]) assert.deepEqual(rt.look(r, c), { text: '', colour: 'take-armed', pulse: 1 });
  await rt.press(3, 5);
  assert.equal(fake.takes.length, 1);
});

test('a panel larger than the Companion grid uses the squares from the top left, with no error', async () => {
  const fake = await startFakeSode({
    panel: panelOf(
      [
        { r: 1, c: 1, kind: 'source', n: 0 },
        { r: 5, c: 1, kind: 'source', n: 1 },
        { r: 1, c: 9, kind: 'source', n: 1 },
        { r: 4, c: 8, kind: 'take', rs: 2, cs: 2 },
      ],
      { rows: 6, cols: 10 },
    ),
  });
  const { rt } = await connect(fake);
  assert.equal(rt.status().code, 'ok');
  assert.deepEqual(rt.cells().map((x) => [x.r, x.c]), [[1, 1], [4, 8]]);
  assert.equal(rt.look(4, 8).text, 'Take');
  for (const [r, c] of [[5, 1], [1, 9], [5, 8], [4, 9]]) {
    assert.deepEqual(rt.look(r, c), { text: '', colour: 'none', pulse: 0 });
    await rt.press(r, c);
  }
  assert.equal(rt.status().code, 'ok');
  assert.equal(rt.variables().staged, 0);
});
