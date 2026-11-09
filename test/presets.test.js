import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { until } from './until.js';

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
  { r: 2, c: 1, kind: 'preset', scope: 'everyone', name: 'Both' },
  { r: 2, c: 2, kind: 'preset', scope: 'everyone', name: 'Solo' },
];
const SRC2 = [1, 2];
const DST_A = [1, 3];
const DST_B = [1, 4];
const TAKE = [1, 5];
const BOTH = [2, 1];
const SOLO = [2, 2];

const levels2 = [
  { level: 1, label: '1' },
  { level: 2, label: '2' },
];
const route = (dst, level, src) => ({ dst, level, src });
const ALL_CAM1 = [route(0, 1, 0), route(0, 2, 0), route(1, 1, 0), route(1, 2, 0)];
const PRESETS = {
  presets: [
    { scope: 'everyone', name: 'Both', items: [{ src: 1, dsts: [0, 1], levels: [] }] },
    { scope: 'everyone', name: 'Solo', items: [{ src: 1, dsts: [1], levels: [] }] },
  ],
};

// clock.t is the injected time; the hold timer itself still runs on real time.
async function connect({ settings = {}, protectedDsts, presetsRefuse, takeReply } = {}) {
  const clock = { t: 1000 };
  const fake = await startFakeSode({
    panel: panelOf(CELLS, { settings }),
    tally: { levels: levels2, routes: ALL_CAM1 },
    protected: protectedDsts && { protected: protectedDsts.map((dst) => ({ dst })) },
    presets: PRESETS,
    takeReply,
  });
  fake.presetsRefuse = presetsRefuse;
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, pollMs: 15, now: () => clock.t });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, fake, clock };
}

const press = (rt, [r, c]) => rt.press(r, c);
const look = (rt, [r, c]) => rt.look(r, c);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('a Preset stages every route and views its first destination', async () => {
  const { rt, fake } = await connect();
  await press(rt, BOTH);
  assert.equal(look(rt, DST_A).colour, 'destination-staged');
  assert.equal(look(rt, DST_B).colour, 'destination-staged');
  assert.equal(look(rt, BOTH).colour, 'preset-pending');
  assert.equal(rt.variables().staged, 2);
  assert.equal(rt.variables().viewed, 'MON A');
  await press(rt, TAKE);
  assert.deepEqual(fake.takes[0].body, {
    routes: [
      { src: 1, dst: 0, levels: [1, 2] },
      { src: 1, dst: 1, levels: [1, 2] },
    ],
  });
});

test('one refused route refuses the whole Preset and stages nothing', async () => {
  const { rt, fake } = await connect({ protectedDsts: [1] });
  await press(rt, BOTH);
  assert.equal(rt.variables().staged, 0);
  assert.equal(look(rt, DST_A).colour, 'destination');
  assert.equal(rt.variables().error, 'MON B is protected');
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0);
});

test('with multi-destination off a Preset with two destinations is refused and one with a single destination stages', async () => {
  const { rt } = await connect({ settings: { multi: false } });
  await press(rt, BOTH);
  assert.equal(rt.variables().staged, 0);
  assert.notEqual(rt.variables().error, '');
  await press(rt, SOLO);
  assert.equal(rt.variables().staged, 1);
  assert.equal(look(rt, DST_B).colour, 'destination-staged');
});

test('a key without the presets scope shows its Preset cells as unavailable and ignores them', async () => {
  const { rt } = await connect({ presetsRefuse: { status: 403, code: 'scope_required' } });
  assert.equal(look(rt, BOTH).colour, 'unavailable');
  assert.equal(look(rt, SOLO).colour, 'unavailable');
  assert.equal(rt.status().code, 'ok');
  await press(rt, BOTH);
  assert.equal(rt.variables().staged, 0);
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(look(rt, SRC2).colour, 'source-pending');
});

test('Instant mode sends on the Source press with no Take', async () => {
  const { rt, fake } = await connect({ settings: { mode: 'instant' } });
  await press(rt, DST_A);
  assert.equal(fake.takes.length, 0);
  await press(rt, SRC2);
  assert.equal(fake.takes.length, 1);
  assert.deepEqual(fake.takes[0].body, { routes: [{ src: 1, dst: 0, levels: [1, 2] }] });
  assert.equal(look(rt, TAKE).colour, 'take');
});

test('Instant mode sends a Preset on the press', async () => {
  const { rt, fake } = await connect({ settings: { mode: 'instant' } });
  await press(rt, BOTH);
  assert.equal(fake.takes.length, 1);
  assert.equal(fake.takes[0].body.routes.length, 2);
});

test('in Instant mode a failed route stays staged and the next press replaces it', async () => {
  let n = 0;
  const { rt, fake } = await connect({
    settings: { mode: 'instant' },
    takeReply: (body) => ({
      status: 200,
      body: { ok: true, results: body.routes.map((r) => ({ ...r, result: ++n === 1 ? 'failed' : 'connected', ok: n > 1 })) },
    }),
  });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(rt.variables().staged, 1);
  await press(rt, DST_B);
  await press(rt, SRC2);
  assert.equal(fake.takes.length, 2);
  assert.deepEqual(
    fake.takes[1].body.routes.map((x) => x.dst),
    [1],
  );
});

test('a double-press guard needs a second Take press within 1.5 seconds', async () => {
  const { rt, fake, clock } = await connect({ settings: { guard: 'double' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0);
  clock.t += 1600;
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0, 'a late second press only starts a new wait');
  clock.t += 1500;
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 1);
});

test('a Take press with nothing staged does not start the double-press wait', async () => {
  const { rt, fake, clock } = await connect({ settings: { guard: 'double' } });
  await press(rt, TAKE);
  await press(rt, DST_A);
  await press(rt, SRC2);
  clock.t += 100;
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0);
});

test('a hold guard fires after 0.8 seconds held and shows its fill meanwhile', async () => {
  const { rt, fake, clock } = await connect({ settings: { guard: 'hold' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(look(rt, TAKE).fill, undefined);
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0);
  clock.t += 400;
  assert.equal(look(rt, TAKE).fill, 0.5);
  clock.t += 400;
  await until(() => fake.takes.length === 1, 'the held take');
  assert.equal(look(rt, TAKE).fill, undefined);
});

test('releasing a hold early cancels it', async () => {
  const { rt, fake, clock } = await connect({ settings: { guard: 'hold' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  clock.t += 300;
  rt.release(...TAKE);
  assert.equal(look(rt, TAKE).fill, undefined);
  clock.t += 600;
  await wait(900);
  assert.equal(fake.takes.length, 0);
  assert.equal(rt.variables().staged, 1);
});

test('a hold that comes due while Offline sends nothing', async () => {
  const { rt, fake, clock } = await connect({ settings: { guard: 'hold' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  fake.status = { router: 'down', routerUp: false, error: true };
  await until(() => rt.status().code === 'offline', 'Offline');
  clock.t += 900;
  await wait(900);
  fake.status = { router: 'up', routerUp: true, error: false };
  await until(() => rt.status().code === 'ok', 'recovery');
  assert.equal(fake.takes.length, 0);
  assert.equal(look(rt, TAKE).fill, undefined, 'the hold had run its course');
  assert.equal(rt.variables().staged, 1);
});
