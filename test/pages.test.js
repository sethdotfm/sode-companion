import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { startFakeSode, pagedPanelOf, KEY } from './fake-sode.js';
import { until } from './until.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

const levels = [{ level: 1, label: '1' }];

async function connect(pages, extra = {}) {
  const fake = await startFakeSode({
    panel: pagedPanelOf(pages, extra),
    tally: { levels, routes: [] },
    status: { router: 'up', routerUp: true, error: false },
  });
  const rt = createRuntime({ host: '127.0.0.1', port: fake.port, panel: 'speedtest', key: KEY, device: 'Deck', pollMs: 15, liveMs: 15 });
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, fake };
}

const NEXT = { r: 3, c: 5, kind: 'nextPage' };
const PREV = { r: 3, c: 4, kind: 'previousPage' };
const A = { id: 'aaaa1111', name: 'Cameras', cells: [{ r: 1, c: 1, kind: 'source', n: 0 }, NEXT, PREV] };
const B = { id: 'bbbb2222', cells: [{ r: 1, c: 1, kind: 'source', n: 1 }, NEXT, PREV] };
const C = { id: 'cccc3333', name: 'Spare', cells: [{ r: 2, c: 2, kind: 'source', n: 0 }, NEXT, PREV] };

test('a panel opens on its first enabled Page and draws that Page only', async () => {
  const { rt } = await connect([{ ...A, enabled: false }, B]);
  assert.equal(rt.look(1, 1).text, 'CAM 2');
  assert.equal(rt.variables().page, 'Page 2');
});

test('Next and Previous step through Pages, wrap, and skip disabled ones', async () => {
  const { rt } = await connect([A, { ...B, enabled: false }, C]);
  assert.equal(rt.look(1, 1).text, 'CAM 1');
  assert.equal(rt.variables().page, 'Cameras');
  await rt.press(3, 5);
  assert.equal(rt.variables().page, 'Spare');
  assert.equal(rt.look(2, 2).text, 'CAM 1');
  assert.equal(rt.look(1, 1).colour, 'blank');
  await rt.press(3, 5);
  assert.equal(rt.variables().page, 'Cameras');
  await rt.press(3, 4);
  assert.equal(rt.variables().page, 'Spare');
});

test('without wrap Next and Previous grey out at the ends and do nothing', async () => {
  const { rt } = await connect([A, B], { settings: { wrapPages: false } });
  assert.equal(rt.look(3, 4).colour, 'unavailable');
  assert.equal(rt.look(3, 5).colour, 'nextPage');
  await rt.press(3, 4);
  assert.equal(rt.variables().page, 'Cameras');
  await rt.press(3, 5);
  assert.equal(rt.look(3, 5).colour, 'unavailable');
});

test('Go to Page follows the Page id and greys out for a missing or disabled target', async () => {
  const go = (page, c) => ({ r: 2, c, kind: 'goToPage', page });
  const { rt } = await connect([
    { ...A, cells: [go('cccc3333', 1), go('gone0000', 2), go('dddd4444', 3)] },
    C,
    { id: 'dddd4444', enabled: false, cells: [] },
  ]);
  assert.equal(rt.look(2, 1).text, 'Spare');
  assert.equal(rt.look(2, 1).colour, 'goToPage');
  assert.equal(rt.look(2, 2).colour, 'unavailable');
  assert.equal(rt.look(2, 3).colour, 'unavailable');
  await rt.press(2, 2);
  await rt.press(2, 3);
  assert.equal(rt.variables().page, 'Cameras');
  await rt.press(2, 1);
  assert.equal(rt.variables().page, 'Spare');
});

test('Go to Page reaches an empty Page', async () => {
  const { rt } = await connect([
    { ...A, cells: [{ r: 1, c: 1, kind: 'goToPage', page: 'eeee5555' }] },
    { id: 'eeee5555', cells: [] },
  ]);
  await rt.press(1, 1);
  assert.equal(rt.variables().page, 'Page 2');
});

test('Page Name and Info cells name the Page they sit on', async () => {
  const { rt } = await connect([
    {
      ...A,
      cells: [
        { r: 1, c: 1, kind: 'pageName' },
        { r: 1, c: 2, kind: 'pageName', show: ['number', 'name'], caption: 'Now' },
        { r: 1, c: 3, kind: 'info' },
        NEXT,
      ],
    },
    B,
  ]);
  assert.equal(rt.look(1, 1).text, 'Cameras');
  assert.equal(rt.look(1, 2).text, 'Now\nPage 1, Cameras');
  assert.equal(rt.look(1, 3).text, `${'Test panel'}\nCameras\nDeck`);
  assert.equal(rt.look(1, 1).colour, 'pageName');
});

test('the view and staged routes survive a Page change, and a Take on another Page sends them', async () => {
  const dest = { r: 1, c: 2, kind: 'destination', n: 0 };
  const take = { r: 1, c: 3, kind: 'take' };
  const { rt, fake } = await connect(
    [
      { ...A, cells: [dest, NEXT] },
      { ...B, cells: [{ r: 1, c: 1, kind: 'source', n: 1 }, take, PREV] },
    ],
    { settings: { mode: 'take' } },
  );
  await rt.press(1, 2);
  await rt.press(3, 5);
  await rt.press(1, 1);
  assert.equal(rt.look(1, 1).colour, 'source-pending');
  await rt.press(3, 4);
  assert.equal(rt.look(1, 2).colour, 'destination-staged');
  await rt.press(3, 5);
  assert.equal(rt.look(1, 1).colour, 'source-pending');
  await rt.press(1, 3);
  await until(() => fake.takes.length === 1, 'the take');
  assert.deepEqual(fake.takes[0].body.routes, [{ src: 1, dst: 0, levels: [1] }]);
});

test('a Page change works while Sode is offline', async () => {
  const { rt, fake } = await connect([A, B]);
  fake.status = { router: 'down', routerUp: false, error: true };
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(rt.status().code, 'offline');
  await rt.press(3, 5);
  assert.equal(rt.variables().page, 'Page 2');
});

test('a saved copy of the panel keeps the Page shown, or falls back when it was disabled', async () => {
  const { rt, fake } = await connect([A, B, C]);
  await rt.press(3, 5);
  assert.equal(rt.variables().page, 'Page 2');
  const pages = (list) => list.map((p) => ({ enabled: true, ...p }));
  fake.panel = { ...fake.panel, rev: 2, pages: pages([A, { ...B, name: 'Renamed' }, C]) };
  await until(() => rt.variables().page === 'Renamed', 'the update, still on the same Page');
  fake.panel = { ...fake.panel, rev: 3, pages: pages([A, { ...B, enabled: false }, C]) };
  await until(() => rt.variables().page === 'Cameras', 'the fallback');
});
