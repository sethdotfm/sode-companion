import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { pulseLevel } from '../src/timing.js';
import { styleOf, COLOURS } from '../src/surface.js';
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
  assert.equal(n, 15);
  await press(rt, CLEAR);
  assert.equal(clock.pending(), 0);
  n = 0;
  clock.advance(5000);
  assert.equal(n, 0);
});

test('staged, pending and armed keys step through four 333 ms phases and wrap', async () => {
  const { rt, clock } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const phases = [DST_A, SRC2, TAKE].map((k) => look(rt, k).pulse);
    assert.equal(new Set(phases).size, 1);
    seen.push(phases[0]);
    clock.advance(332);
    assert.equal(look(rt, TAKE).pulse, phases[0]);
    clock.advance(1);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 1]);
  assert.equal(look(rt, SRC1).pulse, 0);
  assert.equal(look(rt, DST_B).pulse, 0);
});

test('a pulse step notifies listeners so the surface redraws', async () => {
  const { rt, clock } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  let n = 0;
  rt.onChange(() => n++);
  clock.advance(999);
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

test('the view and plan have no idle clock, as on Sode\'s panel page', async () => {
  const { rt, clock } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  clock.advance(600_000);
  assert.equal(look(rt, DST_A).colour, 'destination-staged');
  assert.equal(rt.variables().staged, 1);
  assert.equal(rt.variables().viewed, 'MON A');
  assert.equal(clock.pending(), 1, 'only the pulse timer runs');
});

test('the pulse breathes between 72% and 100% of the state colour', () => {
  const levels = [1, 2, 3, 4].map(pulseLevel);
  assert.equal(Math.min(...levels), 0.72);
  assert.equal(Math.max(...levels), 1);
  assert.ok(levels.every((l) => l >= 0.72 && l <= 1));
});

test('a double-press Take shows "Press\\nagain" in its own colour for 1.5 seconds, then goes back to armed', async () => {
  const { rt, clock } = await connect({}, { settings: { guard: 'double' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(look(rt, TAKE).colour, 'take-armed');
  await press(rt, TAKE);
  assert.equal(look(rt, TAKE).text, 'Press\nagain');
  assert.equal(look(rt, TAKE).colour, 'take-confirm');
  let n = 0;
  rt.onChange(() => n++);
  clock.advance(1500);
  assert.equal(look(rt, TAKE).colour, 'take-confirm');
  clock.advance(1);
  assert.ok(n > 0, 'the lapse redraws the key');
  assert.equal(look(rt, TAKE).colour, 'take-armed');
  assert.equal(look(rt, TAKE).text, 'Take');
});

test('the second press fires the take and the confirm look goes', async () => {
  const { rt, fake, clock } = await connect({}, { settings: { guard: 'double' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  clock.advance(700);
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 1);
  assert.notEqual(look(rt, TAKE).colour, 'take-confirm');
  assert.equal(look(rt, TAKE).text, 'Take');
});

test('the confirm look reaches the key colour variables through styleOf', async () => {
  const { rt } = await connect({}, { settings: { guard: 'double' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  const style = styleOf(look(rt, TAKE));
  assert.equal(style.text, 'Press\nagain');
  assert.notEqual(style.bgcolor, styleOf({ text: '', colour: 'take-armed', pulse: 0 }).bgcolor);
  assert.ok(COLOURS['take-confirm'] !== undefined);
  assert.notEqual(COLOURS['take-confirm'], COLOURS['take-armed']);
});

// WCAG 2.x contrast ratio, computed independently of the module's text rule.
const luminance = (rgb) => {
  const [r, g, b] = [16, 8, 0].map((s) => {
    const v = ((rgb >> s) & 255) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the armed Take is red and its text is at least 4.5:1 against it, dimmed or not', () => {
  assert.equal(COLOURS['take-armed'], 0xf0605a);
  for (const pulse of [0, 1, 2, 3, 4]) {
    const style = styleOf({ text: 'TAKE', colour: 'take-armed', pulse });
    assert.equal(style.color, 0x14131f);
    assert.ok(contrast(style.color, COLOURS['take-armed']) >= 4.5);
  }
});

test('the confirm Take is amber, apart from the red armed Take', () => {
  assert.equal(COLOURS['take-confirm'], 0xf2b84b);
  assert.equal(styleOf({ text: 'Press\nagain', colour: 'take-confirm', pulse: 0 }).color, 0x14131f);
});

test('a hold guard keeps the armed look and its fill, with no confirm text', async () => {
  const { rt } = await connect({}, { settings: { guard: 'hold' } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.equal(look(rt, TAKE).colour, 'take-armed');
  assert.equal(look(rt, TAKE).text, 'Take');
  assert.equal(look(rt, TAKE).fill, 0);
  rt.release();
});

test('after a take the view stays until Clear, however long the panel sits', async () => {
  const { rt, clock } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.equal(rt.variables().staged, 0);
  clock.advance(600_000);
  assert.equal(look(rt, DST_A).colour, 'destination-view');
  assert.equal(rt.variables().viewed, 'MON A');
  assert.equal(clock.pending(), 0);
});
