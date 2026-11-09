import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { fakeClock } from './fake-clock.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

const CELLS = [
  { r: 1, c: 1, kind: 'source', n: 0 },
  { r: 1, c: 2, kind: 'source', n: 1 },
  { r: 1, c: 3, kind: 'destination', n: 0 },
  { r: 1, c: 4, kind: 'destination', n: 1 },
  { r: 1, c: 5, kind: 'take' },
  { r: 2, c: 1, kind: 'clear' },
];
const SRC1 = [1, 1];
const SRC2 = [1, 2];
const DST_A = [1, 3];
const DST_B = [1, 4];
const TAKE = [1, 5];
const CLEAR = [2, 1];

const levels2 = [
  { level: 1, label: '1' },
  { level: 2, label: '2' },
];
const route = (dst, level, src) => ({ dst, level, src });
const BOTH_FROM_CAM1 = [route(0, 1, 0), route(0, 2, 0), route(1, 1, 0), route(1, 2, 0)];

async function connect({ guard = 'double', takeMessages, cells = CELLS } = {}) {
  const clock = fakeClock();
  const fake = await startFakeSode({
    panel: panelOf(cells, { settings: { guard } }),
    tally: { levels: levels2, routes: BOTH_FROM_CAM1 },
  });
  const rt = createRuntime({
    host: '127.0.0.1',
    port: fake.port,
    panel: 'speedtest',
    key: KEY,
    device: 'Deck',
    pollMs: 0,
    now: clock.now,
    timers: clock.timers,
    ...(takeMessages === undefined ? {} : { takeMessages }),
  });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, fake, clock };
}

const press = (rt, [r, c]) => rt.press(r, c);
const look = (rt, [r, c]) => rt.look(r, c);
const stage = async (rt) => {
  await press(rt, DST_A);
  await press(rt, SRC2);
};

test('with the option off, the route keys keep their names while the Take asks for the second press', async () => {
  const { rt } = await connect();
  await stage(rt);
  await press(rt, TAKE);
  assert.equal(look(rt, TAKE).text, 'Press\nTake\nagain');
  for (const key of [DST_A, SRC2, SRC1, DST_B]) assert.notEqual(look(rt, key).text, 'Press\nTake\nagain');
});

test('with the option on, the viewed Destination and each staged Source show "Press Take again" in the confirm colour', async () => {
  const { rt } = await connect({ takeMessages: true });
  await stage(rt);
  const others = [SRC1, DST_B, CLEAR];
  const names = others.map((k) => look(rt, k).text);
  await press(rt, TAKE);
  for (const key of [DST_A, SRC2]) {
    assert.equal(look(rt, key).text, 'Press\nTake\nagain');
    assert.equal(look(rt, key).colour, 'take-confirm');
  }
  assert.deepEqual(
    others.map((k) => look(rt, k).text),
    names,
  );
});

test('the names return when the double-press window lapses and when the second press fires', async () => {
  const { rt, fake, clock } = await connect({ takeMessages: true });
  await stage(rt);
  const before = [DST_A, SRC2].map((k) => look(rt, k));
  await press(rt, TAKE);
  clock.advance(1501);
  assert.deepEqual(
    [DST_A, SRC2].map((k) => look(rt, k)),
    before,
  );
  await press(rt, TAKE);
  clock.advance(100);
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 1);
  for (const key of [DST_A, SRC2]) assert.notEqual(look(rt, key).text, 'Press\nTake\nagain');
});

test('a hold guard shows "Keep holding" on the route keys while the press lasts, without the fill', async () => {
  const { rt } = await connect({ guard: 'hold', takeMessages: true });
  await stage(rt);
  const before = look(rt, SRC2).text;
  await press(rt, TAKE);
  for (const key of [DST_A, SRC2]) {
    const l = look(rt, key);
    assert.equal(l.text, 'Keep\nholding');
    assert.equal(l.colour, 'take-armed');
    assert.equal(l.fill, undefined);
  }
  assert.equal(look(rt, SRC1).text.includes('Keep'), false);
  rt.release();
  assert.equal(look(rt, SRC2).text, before);
});

test('results stay as they were and are not a Take message', async () => {
  const { rt, fake } = await connect({ guard: 'none', takeMessages: true });
  await stage(rt);
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 1);
  assert.ok(look(rt, DST_A).colour.startsWith('result-'));
  assert.notEqual(look(rt, SRC2).text, 'Press\nTake\nagain');
});

test('a hidden-text Cell on the route speaks the prompt, and only the root square of a merged Cell carries it', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0 },
    { r: 1, c: 2, kind: 'source', n: 1, art: 'icon:camera', hideText: true },
    { r: 1, c: 3, kind: 'take' },
    { r: 2, c: 1, kind: 'destination', n: 0, rs: 1, cs: 2 },
  ];
  const { rt } = await connect({ takeMessages: true, cells });
  await rt.press(2, 1);
  await rt.press(1, 2);
  assert.equal(look(rt, SRC2).text, '');
  await rt.press(1, 3);
  assert.equal(look(rt, SRC2).text, 'Press\nTake\nagain');
  assert.equal(look(rt, [2, 1]).text, 'Press\nTake\nagain');
  assert.equal(look(rt, [2, 2]).text, '');
});

test('the key variables carry the prompt too', async () => {
  const { rt } = await connect({ takeMessages: true });
  await stage(rt);
  await press(rt, TAKE);
  assert.equal(rt.variables().key_1_2, 'Press\nTake\nagain');
});
