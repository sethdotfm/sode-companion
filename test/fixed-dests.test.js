import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

// Destination cells stay stored on a fixed panel; Sode's page leaves them out.
const CELLS = [
  { r: 1, c: 1, kind: 'source', n: 0 },
  { r: 1, c: 2, kind: 'source', n: 1 },
  { r: 1, c: 3, kind: 'destination', n: 5 },
  { r: 1, c: 5, kind: 'take' },
  { r: 2, c: 2, kind: 'current' },
];
const levels = [{ level: 1, label: '1' }];

async function connect(fixedDests) {
  const fake = await startFakeSode({
    panel: panelOf(CELLS, { settings: { fixedDests } }),
    tally: { levels, routes: [{ dst: 0, level: 1, src: 0 }, { dst: 1, level: 1, src: 0 }] },
  });
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, pollMs: 15 });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, fake };
}

test('a Source press on a fixed panel stages every fixed destination and Take sends them', async () => {
  const { rt, fake } = await connect([0, 1]);
  await rt.press(1, 2);
  assert.notEqual(rt.look(1, 2).text, 'No dest');
  assert.equal(rt.look(1, 2).colour, 'source-pending');
  await rt.press(1, 5);
  assert.equal(fake.takes.length, 1);
  assert.deepEqual(fake.takes[0].body.routes, [
    { src: 1, dst: 0, levels: [1] },
    { src: 1, dst: 1, levels: [1] },
  ]);
});

test('a fixed panel draws no Destination cell and Current shows the first fixed destination', async () => {
  const { rt } = await connect([1, 0]);
  assert.equal(rt.look(1, 3).colour, 'blank');
  assert.equal(rt.look(1, 1).colour, 'source-current');
});
