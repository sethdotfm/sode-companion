import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { createSurface, actionDefinitions, COLOURS } from '../src/surface.js';
import { fakeClock } from './fake-clock.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { until, quiet } from './until.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

const CELLS = [
  { r: 2, c: 1, kind: 'preset', scope: 'everyone', name: 'Both' },
  { r: 1, c: 1, kind: 'source', n: 0 },
  { r: 1, c: 2, kind: 'source', n: 1 },
  { r: 1, c: 3, kind: 'destination', n: 0 },
  { r: 1, c: 4, kind: 'take', rs: 2, cs: 2 },
  { r: 2, c: 2, kind: 'clear' },
];
const PRESETS = { presets: [{ scope: 'everyone', name: 'Both', items: [{ src: 1, dsts: [0], levels: [] }] }] };

const hostOf = () => ({
  defs: [],
  presets: [],
  values: [],
  checks: 0,
  updateStatus() {},
  setVariableDefinitions(d) {
    this.defs.push(d);
  },
  setPresetDefinitions(structure, presets) {
    this.presets.push({ structure, presets });
  },
  setVariableValues(v) {
    this.values.push(v);
  },
  checkFeedbacks() {
    this.checks++;
  },
});

async function connect({ cells = CELLS, over = {}, fake: given } = {}) {
  const clock = fakeClock();
  const fake = given || (await startFakeSode({ panel: panelOf(cells), presets: PRESETS }));
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device: 'Deck', pollMs: 0, liveMs: 0, now: clock.now, timers: clock.timers, ...over });
  const host = hostOf();
  const surface = createSurface({ runtime: rt, host, label: 'sode' });
  rt.onChange(surface.sync);
  open.push(() => rt.stop(), () => fake.close());
  await rt.start();
  return { rt, host, fake, clock };
}

const valuesSoFar = (host) => Object.assign({}, ...host.values);

test('presets exist for every drawn Cell, in grid order, each pressing down and up at its row and column', async () => {
  const { host } = await connect();
  assert.equal(host.presets.length, 1);
  const [{ structure, presets }] = host.presets;
  const ids = ['cell_1_1', 'cell_1_2', 'cell_1_3', 'cell_1_4', 'cell_2_1', 'cell_2_2'];
  assert.deepEqual(structure, [{ id: 'cells', name: 'Panel cells', definitions: ids }]);
  assert.deepEqual(Object.keys(presets), ids);
  const [step] = presets.cell_1_4.steps;
  assert.deepEqual(step.down, [{ actionId: 'press', options: { row: 1, col: 4, event: 'down' } }]);
  assert.deepEqual(step.up, [{ actionId: 'press', options: { row: 1, col: 4, event: 'up' } }]);
  assert.deepEqual(presets.cell_1_4.feedbacks, [{ feedbackId: 'look', options: { row: 1, col: 4 } }]);
});

test('pulse steps and presses do not rebuild presets or variable definitions', async () => {
  const { rt, host, clock } = await connect();
  const defs = host.defs.length;
  await rt.press(1, 3);
  await rt.press(1, 2);
  const before = host.checks;
  for (let i = 0; i < 8; i++) clock.advance(500);
  assert.ok(host.checks >= before + 8, 'the keys were redrawn');
  assert.equal(host.presets.length, 1);
  assert.equal(host.defs.length, defs);
});

test('a changed Cell list rebuilds presets and variable definitions once', async () => {
  const { host, fake } = await connect({ over: { liveMs: 15 } });
  const defs = host.defs.length;
  fake.panel = panelOf([...CELLS, { r: 3, c: 1, kind: 'source', n: 1 }], { rev: 2 });
  await until(() => host.presets.length === 2, 'the rebuilt presets');
  assert.ok('cell_3_1' in host.presets[1].presets);
  assert.ok('key_3_1' in host.defs.at(-1));
  await quiet(150);
  assert.equal(host.presets.length, 2);
  assert.equal(host.defs.length, defs + 1);
});

test('a changed grid size rebuilds the variable definitions', async () => {
  const { host, fake } = await connect({ over: { liveMs: 15 } });
  assert.ok(!('key_4_1' in host.defs.at(-1)));
  fake.panel = panelOf([...CELLS, { r: 4, c: 1, kind: 'source', n: 1 }], { rev: 2, rows: 4 });
  await until(() => 'key_4_1' in host.defs.at(-1), 'the rebuilt definitions');
});

test('variables cover the router status and a text variable for every key square, text on the root square only', async () => {
  const { rt, host } = await connect();
  for (const id of ['viewed', 'current', 'staged', 'error', 'router', 'key_1_1', 'key_1_4', 'key_1_5', 'key_2_4', 'key_2_5']) assert.ok(id in host.defs.at(-1), id);
  const v = valuesSoFar(host);
  assert.equal(v.router, 'up');
  assert.equal(v.key_1_1, 'CAM 1');
  assert.equal(v.key_1_4, 'Take');
  for (const id of ['key_1_5', 'key_2_4', 'key_2_5']) assert.equal(v[id], '');
  assert.equal(rt.variables().key_1_4, 'Take');
  const sent = host.values.length;
  await rt.press(1, 3);
  assert.equal(valuesSoFar(host).viewed, 'MON A');
  assert.ok(host.values.slice(sent).every((x) => !('key_1_1' in x)), 'unchanged variables are not sent again');
});

test('the router variable follows the stream, and is unknown without the status scope', async () => {
  const fake = await startFakeSode({ panel: panelOf(CELLS), presets: PRESETS, stream: true });
  const { rt } = await connect({ fake });
  await until(() => fake.sockets.size > 0, 'the stream');
  assert.equal(rt.variables().router, 'up');
  fake.push('status', { router: 'down', routerUp: false, error: true });
  await until(() => rt.variables().router === 'down', 'router down');
  const bare = await startFakeSode({ panel: panelOf(CELLS), presets: PRESETS });
  bare.noStatusScope = true;
  const other = await connect({ fake: bare });
  assert.equal(other.rt.variables().router, 'unknown');
});

test('every colour the runtime shows has a Companion colour', async () => {
  const fake = await startFakeSode({ panel: panelOf(CELLS), presets: PRESETS, tally: { levels: [{ level: 1, label: '1' }], routes: [{ dst: 0, level: 1, src: 0 }] } });
  const { rt } = await connect({ fake, over: { pollMs: 15 } });
  const seen = new Set();
  const snap = () => {
    for (let r = 1; r <= 3; r++) for (let c = 1; c <= 5; c++) seen.add(rt.look(r, c).colour);
  };
  snap();
  await rt.press(1, 3);
  snap();
  await rt.press(1, 2);
  snap();
  await rt.press(1, 4);
  snap();
  await until(() => rt.look(1, 3).colour.startsWith('result-'), 'a result');
  snap();
  await rt.press(2, 1);
  snap();
  fake.status = { router: 'down', routerUp: false, error: true };
  await until(() => rt.status().code === 'offline', 'Offline');
  snap();
  for (const colour of seen) assert.ok(colour in COLOURS, `no Companion colour for ${colour}`);
  assert.ok(seen.has('offline') && seen.has('take-armed') && seen.has('destination-staged'));
});

test('the press action presses on down and releases on up', async () => {
  const calls = [];
  const runtime = { press: async (r, c) => calls.push(['press', r, c]), release: (r, c) => calls.push(['release', r, c]) };
  const { press } = actionDefinitions(() => runtime);
  assert.deepEqual(
    press.options.find((o) => o.id === 'event').choices.map((x) => x.id),
    ['down', 'up'],
  );
  await press.callback({ options: { row: 2, col: 3, event: 'down' } });
  await press.callback({ options: { row: 2, col: 3, event: 'up' } });
  assert.deepEqual(calls, [
    ['press', 2, 3],
    ['release', 2, 3],
  ]);
});
