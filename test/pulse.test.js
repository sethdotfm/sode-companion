import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { pulseLevel } from '../src/timing.js';
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

// Polling is off and `timers` is the fake clock's, so clock.pending() counts only the runtime's own pulse and expiry timers.
async function connect(over = {}, panelExtra = {}) {
  const clock = fakeClock();
  const fake = await startFakeSode({
    panel: panelOf(over.cells || CELLS, panelExtra),
    tally: { levels: levels2, routes: BOTH_FROM_CAM1 },
    protected: over.protected,
    takeReply: over.takeReply,
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

test('with nothing staged, pending or armed the runtime schedules no pulse updates', async () => {
  const { rt, clock } = await connect();
  assert.equal(clock.pending(), 0);
  let n = 0;
  rt.onChange(() => n++);
  await press(rt, DST_A);
  n = 0;
  clock.advance(5000);
  assert.equal(n, 0);
  await press(rt, SRC2);
  n = 0;
  clock.advance(5000);
  assert.equal(n, 10);
  await press(rt, CLEAR);
  assert.equal(clock.pending(), 0);
  n = 0;
  clock.advance(5000);
  assert.equal(n, 0);
});

test('staged, pending and armed keys step through eight 500 ms phases and wrap', async () => {
  const { rt, clock } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  const seen = [];
  for (let i = 0; i < 9; i++) {
    const phases = [DST_A, SRC2, TAKE].map((k) => look(rt, k).pulse);
    assert.equal(new Set(phases).size, 1);
    seen.push(phases[0]);
    clock.advance(499);
    assert.equal(look(rt, TAKE).pulse, phases[0]);
    clock.advance(1);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 1]);
  assert.equal(look(rt, SRC1).pulse, 0);
  assert.equal(look(rt, DST_B).pulse, 0);
});

test('a pulse step notifies listeners so the surface redraws', async () => {
  const { rt, clock } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  let n = 0;
  rt.onChange(() => n++);
  clock.advance(1500);
  assert.equal(n, 3);
});

test('a Result word shows on each destination for 1.5 seconds and then goes', async () => {
  const { rt, clock } = await connect({
    takeReply: (body) => ({
      status: 200,
      body: { ok: true, results: body.routes.map((r) => ({ ...r, result: r.dst === 0 ? 'connected' : 'failed', ok: r.dst === 0 })) },
    }),
  });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, DST_B);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.equal(look(rt, DST_A).text, 'MON A\nConnected');
  assert.equal(look(rt, DST_B).text, 'MON B\nFailed');
  clock.advance(1500);
  assert.match(look(rt, DST_A).text, /Connected/);
  let n = 0;
  rt.onChange(() => n++);
  clock.advance(1);
  assert.ok(n > 0);
  assert.equal(look(rt, DST_A).text, 'MON A');
  assert.equal(look(rt, DST_B).text, 'MON B\nCAM 2');
});

test('Already shows as its word', async () => {
  const { rt } = await connect({
    takeReply: (body) => ({ status: 200, body: { ok: true, results: body.routes.map((r) => ({ ...r, result: 'already', ok: true })) } }),
  });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.equal(look(rt, DST_A).text, 'MON A\nAlready');
});

test('a Protected press flashes a short word on the pressed key for 4 seconds, with the full sentence in the error variable', async () => {
  const { rt, clock } = await connect({ protected: { protected: [{ dst: 0 }] } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.deepEqual([look(rt, SRC2).text, look(rt, SRC2).colour], ['Protected', 'error']);
  assert.equal(look(rt, DST_A).text, 'MON A');
  assert.equal(rt.variables().error, 'MON A is protected');
  clock.advance(4000);
  assert.equal(look(rt, SRC2).text, 'Protected');
  clock.advance(1);
  assert.deepEqual([look(rt, SRC2).text, look(rt, SRC2).colour], ['CAM 2', 'source']);
  assert.equal(rt.variables().error, '');
});

test('the flash is on the pressed key only and a later press ends it', async () => {
  const { rt } = await connect({ protected: { protected: [{ dst: 0 }] } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(look(rt, SRC1).text, 'CAM 1');
  await press(rt, CLEAR);
  assert.equal(look(rt, SRC2).text, 'CAM 2');
});

test('outside Rights flashes a short word and gives the full sentence', async () => {
  const { rt } = await connect({}, { rights: { sources: [0], destinations: [0, 1] } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(look(rt, SRC2).text, 'Rights');
  assert.match(rt.variables().error, /outside this panel's rights/);
});

test('no common level flashes a short word and gives the full sentence', async () => {
  const { rt } = await connect({
    cells: [
      { r: 1, c: 1, kind: 'source', n: 0, levels: [1] },
      { r: 1, c: 3, kind: 'destination', n: 0, levels: [2] },
    ],
  });
  await press(rt, DST_A);
  await press(rt, SRC1);
  assert.equal(look(rt, SRC1).text, 'No level');
  assert.equal(rt.variables().error, 'CAM 1 and MON A have no level in common');
});

test('a Source press with no destination viewed flashes on that key', async () => {
  const { rt } = await connect();
  await press(rt, SRC1);
  assert.equal(look(rt, SRC1).text, 'No dest');
  assert.equal(rt.variables().error, 'Pick a destination first');
});

test('a refused take flashes on the Take key', async () => {
  const { rt } = await connect({ takeReply: () => ({ status: 409, body: { error: { code: 'busy', message: 'The router is busy' } } }) });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.equal(look(rt, TAKE).text, 'Refused');
  assert.equal(rt.variables().error, 'The router is busy');
});

test('the view and plan clear after 30 idle seconds of no presses', async () => {
  const { rt, clock } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  clock.advance(29_000);
  assert.equal(look(rt, DST_A).colour, 'destination-staged');
  await press(rt, DST_B);
  clock.advance(29_000);
  assert.equal(look(rt, DST_A).colour, 'destination-staged');
  clock.advance(1_001);
  assert.equal(look(rt, DST_A).colour, 'destination');
  assert.equal(look(rt, DST_B).colour, 'destination');
  assert.equal(look(rt, TAKE).colour, 'take');
  assert.equal(rt.variables().staged, 0);
  assert.equal(rt.variables().viewed, '');
  assert.equal(clock.pending(), 0);
});

test('the idle clear never runs during a take', async () => {
  let release;
  const held = new Promise((ok) => (release = ok));
  const { rt, clock } = await connect({
    takeReply: async (body) => {
      await held;
      return { status: 200, body: { ok: true, results: body.routes.map((r) => ({ ...r, result: 'failed', ok: false })) } };
    },
  });
  await press(rt, DST_A);
  await press(rt, SRC2);
  const taking = press(rt, TAKE);
  clock.advance(60_000);
  assert.equal(rt.variables().staged, 1);
  assert.equal(rt.variables().viewed, 'MON A');
  release();
  await taking;
  assert.equal(look(rt, DST_A).text, 'MON A\nFailed');
  // The idle count restarts when the take ends, so a failed route stays staged for another 30 seconds.
  clock.advance(29_000);
  assert.equal(rt.variables().staged, 1);
  clock.advance(1_001);
  assert.equal(rt.variables().staged, 0);
});

test('the pulse breathes between 72% and 100% of the state colour', () => {
  const levels = [1, 2, 3, 4, 5, 6, 7, 8].map(pulseLevel);
  assert.equal(Math.min(...levels), 0.72);
  assert.equal(Math.max(...levels), 1);
  assert.ok(levels.every((l) => l >= 0.72 && l <= 1));
});
