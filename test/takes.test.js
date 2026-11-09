import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

// Row 1: CAM 1, CAM 2, MON A, MON B, Take. Row 2: Clear, Current.
const CELLS = [
  { r: 1, c: 1, kind: 'source', n: 0 },
  { r: 1, c: 2, kind: 'source', n: 1 },
  { r: 1, c: 3, kind: 'destination', n: 0 },
  { r: 1, c: 4, kind: 'destination', n: 1 },
  { r: 1, c: 5, kind: 'take' },
  { r: 2, c: 1, kind: 'clear' },
  { r: 2, c: 2, kind: 'current' },
];
const SRC1 = [1, 1];
const SRC2 = [1, 2];
const DST_A = [1, 3];
const DST_B = [1, 4];
const TAKE = [1, 5];
const CLEAR = [2, 1];
const CURRENT = [2, 2];

const levels2 = [
  { level: 1, label: '1' },
  { level: 2, label: '2' },
];
const route = (dst, level, src) => ({ dst, level, src });
const BOTH_FROM_CAM1 = [route(0, 1, 0), route(0, 2, 0), route(1, 1, 0), route(1, 2, 0)];

async function connect(over = {}, panelExtra = {}) {
  const fake = await startFakeSode({
    panel: panelOf(over.cells || CELLS, panelExtra),
    tally: { levels: levels2, routes: BOTH_FROM_CAM1 },
    protected: over.protected,
    takeReply: over.takeReply,
  });
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device: 'Deck', pollMs: 15 });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, fake };
}

const press = (rt, [r, c]) => rt.press(r, c);
const look = (rt, [r, c]) => rt.look(r, c);
const until = async (fn) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  assert.fail('condition not reached');
};

test('a Destination then a Source stages a route and Take sends exactly it with the model levels', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  assert.equal(look(rt, DST_A).colour, 'destination-view');
  await press(rt, SRC2);
  assert.equal(look(rt, SRC2).colour, 'source-pending');
  assert.equal(look(rt, DST_A).colour, 'destination-staged');
  assert.equal(look(rt, DST_A).text, 'MON A\nCAM 2');
  assert.equal(look(rt, TAKE).colour, 'take-armed');
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 1);
  assert.deepEqual(fake.takes[0].body, { routes: [{ src: 1, dst: 0, levels: [1, 2] }] });
  assert.ok(/^[\x21-\x7e]{1,128}$/.test(fake.takes[0].idempotencyKey));
});

test('each Take press sends a fresh Idempotency-Key', async () => {
  const { rt, fake } = await connect();
  for (const src of [SRC2, SRC1]) {
    await press(rt, DST_A);
    await press(rt, src);
    await press(rt, TAKE);
    fake.tally = { levels: levels2, routes: [route(0, 1, src === SRC2 ? 1 : 0), route(0, 2, src === SRC2 ? 1 : 0)] };
    await press(rt, DST_A);
    await until(() => look(rt, src).colour === 'source-current');
    await press(rt, CLEAR);
  }
  assert.equal(fake.takes.length, 2);
  assert.notEqual(fake.takes[0].idempotencyKey, fake.takes[1].idempotencyKey);
});

test('the levels sent are the panel, Source and Destination levels in common', async () => {
  const { rt, fake } = await connect({
    cells: [
      { r: 1, c: 1, kind: 'source', n: 1, levels: [1, 2] },
      { r: 1, c: 3, kind: 'destination', n: 0, levels: [2] },
      { r: 1, c: 5, kind: 'take' },
    ],
  });
  await press(rt, DST_A);
  await press(rt, SRC1);
  await press(rt, TAKE);
  assert.deepEqual(fake.takes[0].body.routes, [{ src: 1, dst: 0, levels: [2] }]);
});

test('Take sends several staged destinations in one POST', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, DST_B);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 1);
  assert.deepEqual(fake.takes[0].body.routes, [
    { src: 1, dst: 0, levels: [1, 2] },
    { src: 1, dst: 1, levels: [1, 2] },
  ]);
});

test('pressing a staged Destination again unstages only that one', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, DST_B);
  await press(rt, SRC2);
  await press(rt, DST_A);
  assert.equal(look(rt, DST_A).colour, 'destination-staged');
  await press(rt, DST_A);
  assert.equal(look(rt, DST_A).colour, 'destination-view');
  assert.equal(look(rt, DST_B).colour, 'destination-staged');
  await press(rt, TAKE);
  assert.deepEqual(
    fake.takes[0].body.routes.map((x) => x.dst),
    [1],
  );
});

test('Take is not armed with nothing staged and a press does nothing', async () => {
  const { rt, fake } = await connect();
  assert.equal(look(rt, TAKE).colour, 'take');
  await press(rt, TAKE);
  await press(rt, DST_A);
  assert.equal(look(rt, TAKE).colour, 'take');
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0);
});

test('a Protected destination refuses the Source before anything is staged', async () => {
  const { rt, fake } = await connect({ protected: { protected: [{ dst: 0 }] } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(look(rt, TAKE).colour, 'take');
  assert.equal(look(rt, DST_A).colour, 'destination-view');
  assert.equal(rt.variables().error, 'MON A is protected');
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0);
});

test('a route outside the Rights is refused before arming', async () => {
  const { rt, fake } = await connect({}, { rights: { sources: [0], destinations: [0, 1] } });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.equal(look(rt, TAKE).colour, 'take');
  assert.match(rt.variables().error, /outside this panel's rights/);
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 0);
});

test('a failed route stays staged and Take can be pressed again', async () => {
  let n = 0;
  const { rt, fake } = await connect({
    takeReply: (body) => ({
      status: 200,
      body: { ok: true, results: body.routes.map((r) => ({ ...r, result: ++n === 1 ? 'failed' : 'connected', ok: n > 1 })) },
    }),
  });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  // The Failed word covers the key for a moment, but the route is still staged.
  assert.equal(look(rt, DST_A).text, 'MON A\nFailed');
  assert.equal(rt.variables().staged, 1);
  assert.equal(look(rt, TAKE).colour, 'take-armed');
  await press(rt, TAKE);
  assert.equal(fake.takes.length, 2);
  assert.deepEqual(fake.takes[1].body, fake.takes[0].body);
});

test('a refused take (403) keeps the plan staged and reports the reason', async () => {
  const { rt } = await connect({ takeReply: () => ({ status: 403, body: { error: { code: 'outside_rights', message: 'no' } } }) });
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  // The Take key flashes the refusal; the plan is still staged.
  assert.equal(look(rt, TAKE).colour, 'error');
  assert.equal(rt.variables().staged, 1);
  assert.ok(rt.variables().error.length > 0);
});

test('a double press on Take while one is in flight sends once', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  await Promise.all([press(rt, TAKE), press(rt, TAKE)]);
  assert.equal(fake.takes.length, 1);
});

test('Current Destination shows the source on the viewed destination and ignores presses', async () => {
  const { rt, fake } = await connect();
  assert.equal(look(rt, CURRENT).text, 'Currently');
  await press(rt, DST_A);
  assert.equal(look(rt, CURRENT).text, 'MON A is currently:\nCAM 1');
  await press(rt, CURRENT);
  assert.equal(look(rt, CURRENT).text, 'MON A is currently:\nCAM 1');
  assert.equal(look(rt, DST_A).colour, 'destination-view');
  assert.equal(fake.takes.length, 0);
});

test('the viewed destination shows its current source solid green, others idle, and a router change shows up', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  assert.equal(look(rt, SRC1).colour, 'source-current');
  assert.equal(look(rt, SRC2).colour, 'source');
  fake.tally = { levels: levels2, routes: [route(0, 1, 1), route(0, 2, 1)] };
  await until(() => look(rt, SRC2).colour === 'source-current');
  assert.equal(look(rt, SRC1).colour, 'source');
});

test('Clear drops the view and the plan and never calls the router', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, DST_B);
  const posts = () => fake.requests.filter((q) => q.method !== 'GET').length;
  await press(rt, CLEAR);
  for (const k of [DST_A, DST_B]) assert.equal(look(rt, k).colour, 'destination');
  assert.equal(look(rt, SRC2).colour, 'source');
  assert.equal(look(rt, TAKE).colour, 'take');
  assert.equal(posts(), 0);
  assert.equal(fake.takes.length, 0);
});

test('variables hold the viewed destination, its current source and the staged count', async () => {
  const { rt } = await connect();
  const fields = () => {
    const { viewed, current, staged, error } = rt.variables();
    return { viewed, current, staged, error };
  };
  assert.deepEqual(fields(), { viewed: '', current: '', staged: 0, error: '' });
  await press(rt, DST_A);
  await press(rt, SRC2);
  assert.deepEqual(fields(), { viewed: 'MON A', current: 'CAM 1', staged: 1, error: '' });
});

test('a route the router already satisfies leaves the plan on the next poll', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  fake.tally = { levels: levels2, routes: [route(0, 1, 1), route(0, 2, 1), route(1, 1, 0), route(1, 2, 0)] };
  await until(() => look(rt, TAKE).colour === 'take');
});

test('after a take the destination stays viewed, shows its new source and the plan is empty', async () => {
  let fake;
  const hold = await connect({
    takeReply: (body) => {
      fake.tally = { levels: levels2, routes: [route(0, 1, 1), route(0, 2, 1), route(1, 1, 0), route(1, 2, 0)] };
      return { status: 200, body: { ok: true, results: body.routes.map((r) => ({ ...r, result: 'connected', ok: true })) } };
    },
  });
  const rt = hold.rt;
  fake = hold.fake;
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  await until(() => look(rt, SRC2).colour === 'source-current');
  assert.equal(rt.variables().staged, 0);
  assert.equal(rt.variables().viewed, 'MON A');
  assert.equal(look(rt, SRC1).colour, 'source');
  assert.equal(look(rt, CURRENT).text, 'MON A is currently:\nCAM 2');
  assert.equal(look(rt, TAKE).colour, 'take');
});

test('the key goes out only as a Bearer header on takes and polls', async () => {
  const { rt, fake } = await connect();
  await press(rt, DST_A);
  await press(rt, SRC2);
  await press(rt, TAKE);
  assert.ok(fake.requests.some((q) => q.method === 'POST'));
  assert.ok(fake.requests.every((q) => q.auth === `Bearer ${KEY}` && !q.url.includes(KEY)));
});
