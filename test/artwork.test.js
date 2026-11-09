import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { createSurface, COLOURS } from '../src/surface.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { until } from './until.js';
import { png, jpg, gif, decodeKeyPicture, RED, BLUE, GREEN } from './images.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop()();
});

const hostOf = () => ({
  values: {},
  logs: [],
  updateStatus(_code, text) {
    this.logs.push(text);
  },
  setVariableDefinitions() {},
  setPresetDefinitions() {},
  setVariableValues(v) {
    Object.assign(this.values, v);
  },
  checkFeedbacks() {},
});

const ART = 'a-0123abcd';
const OTHER = 'a-4567ef01';
const wide = { type: 'image/png', bytes: png(200, 100, (x) => (x < 100 ? RED : BLUE)) };

async function connect({ cells, artwork = { [ART]: wide }, over = {}, panelExtra, fake: given } = {}) {
  const fake = given || (await startFakeSode({ panel: panelOf(cells, panelExtra), artwork }));
  const logs = [];
  const rt = createRuntime({
    host: '127.0.0.1',
    port: fake.port,
    panel: 'speedtest',
    key: KEY,
    device: 'Deck',
    pollMs: 0,
    liveMs: 0,
    log: (l) => logs.push(l),
    ...over,
  });
  const host = hostOf();
  const surface = createSurface({ runtime: rt, host, label: 'sode' });
  rt.onChange(surface.sync);
  open.push(
    () => rt.stop(),
    () => fake.close(),
  );
  await rt.start();
  return { rt, host, fake, logs };
}

const pic = (host, r, c) => host.values[`key_${r}_${c}_pic`];

test('a Cell with PNG Artwork gets a Key picture of key size, fitted and centred', async () => {
  const { host } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART }] });
  await until(() => pic(host, 1, 1), 'the Key picture');
  const img = decodeKeyPicture(pic(host, 1, 1));
  assert.deepEqual([img.width, img.height], [72, 72]);
  // 200 by 100 fits as 72 by 36, centred: red left, blue right, empty above and below.
  assert.deepEqual(
    img
      .at(10, 36)
      .slice(0, 3)
      .map((v) => Math.round(v / 40)),
    RED.map((v) => Math.round(v / 40)),
  );
  assert.deepEqual(
    img
      .at(62, 36)
      .slice(0, 3)
      .map((v) => Math.round(v / 40)),
    BLUE.map((v) => Math.round(v / 40)),
  );
  assert.equal(img.at(36, 5)[3], 0);
  assert.equal(img.at(36, 66)[3], 0);
});

const near = (px, want) => px.slice(0, 3).every((v, i) => Math.abs(v - want[i]) < 40);
const artReads = (fake) => fake.requests.filter((q) => q.path.includes('/artwork/'));

test('JPEG and GIF Artwork give a Key picture of key size too', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: ART },
    { r: 1, c: 2, kind: 'source', n: 1, art: OTHER },
  ];
  const artwork = {
    [ART]: { type: 'image/jpeg', bytes: jpg(90, 90, () => GREEN) },
    [OTHER]: { type: 'image/gif', bytes: gif(40, 40, () => 1, RED, BLUE) },
  };
  const { host } = await connect({ cells, artwork });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both pictures');
  const fromJpeg = decodeKeyPicture(pic(host, 1, 1));
  const fromGif = decodeKeyPicture(pic(host, 1, 2));
  assert.deepEqual([fromJpeg.width, fromJpeg.height, fromGif.width, fromGif.height], [72, 72, 72, 72]);
  assert.ok(near(fromJpeg.at(36, 36), GREEN));
  assert.ok(near(fromGif.at(36, 36), BLUE));
});

test('an Artwork key shows its state as a Border; a key with no Artwork keeps the solid fill', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: ART },
    { r: 1, c: 2, kind: 'source', n: 1 },
  ];
  const { host } = await connect({ cells });
  await until(() => pic(host, 1, 1), 'the Key picture');
  const v = host.values;
  assert.equal(v.key_1_1_inset, 1);
  assert.deepEqual([v.key_1_1_bl, v.key_1_1_bt, v.key_1_1_br, v.key_1_1_bb], [8, 8, 8, 8]);
  assert.equal(v.key_1_1_bg, COLOURS.source);
  assert.equal(v.key_1_2_inset, 0);
  assert.deepEqual([v.key_1_2_bl, v.key_1_2_bt, v.key_1_2_br, v.key_1_2_bb], [0, 0, 0, 0]);
  assert.equal(v.key_1_2_bg, COLOURS.source);
  assert.equal(pic(host, 1, 2), '');
});

test('blank squares have no Key picture', async () => {
  const { host } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART }] });
  await until(() => pic(host, 1, 1), 'the Key picture');
  assert.equal(pic(host, 3, 5), '');
  assert.equal(host.values.key_3_5_inset, 0);
});

test('a Cell with hidden text has an empty text variable; one without keeps its label', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: ART, hideText: true },
    { r: 1, c: 2, kind: 'source', n: 1, art: ART },
    { r: 1, c: 3, kind: 'source', n: 1, hideText: true },
  ];
  const { host } = await connect({ cells });
  await until(() => pic(host, 1, 1), 'the Key picture');
  assert.equal(host.values.key_1_1, '');
  assert.equal(host.values.key_1_2, 'CAM 2');
  // Sode hides text only under artwork.
  assert.equal(host.values.key_1_3, 'CAM 2');
});

test('each Artwork is fetched once however many Cells use it, with the key as a Bearer and nowhere in view', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: ART },
    { r: 1, c: 2, kind: 'source', n: 1, art: ART },
  ];
  const { host, fake, logs, rt } = await connect({ cells });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both pictures');
  const reads = artReads(fake);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].path, `/api/v1/panels/p-1a2b3c4d/artwork/${ART}`);
  assert.ok(reads[0].auth === `Bearer ${KEY}`);
  const everything = JSON.stringify([logs, host.logs, host.values, rt.status()]);
  assert.ok(!everything.includes(KEY.slice(5)));
});

test('a Cell that no longer has Artwork loses its picture, and a dropped id is fetched again if a Cell names it later', async () => {
  const cell = { r: 1, c: 1, kind: 'source', n: 0 };
  const { host, fake } = await connect({ cells: [{ ...cell, art: ART }], over: { liveMs: 15 } });
  await until(() => pic(host, 1, 1), 'the Key picture');
  fake.panel = panelOf([cell], { rev: 2 });
  await until(() => pic(host, 1, 1) === '', 'the picture dropped');
  assert.equal(host.values.key_1_1_inset, 0);
  fake.panel = panelOf([{ ...cell, art: ART }], { rev: 3 });
  await until(() => pic(host, 1, 1), 'the picture back');
  assert.equal(artReads(fake).length, 2);
});

test('a changed art id swaps the picture', async () => {
  const cell = { r: 1, c: 1, kind: 'source', n: 0 };
  const green = { type: 'image/png', bytes: png(50, 50, () => GREEN) };
  const { host, fake } = await connect({
    cells: [{ ...cell, art: ART }],
    artwork: { [ART]: wide, [OTHER]: green },
    over: { liveMs: 15 },
  });
  await until(() => pic(host, 1, 1), 'the Key picture');
  const first = pic(host, 1, 1);
  fake.panel = panelOf([{ ...cell, art: OTHER }], { rev: 2 });
  await until(() => pic(host, 1, 1) && pic(host, 1, 1) !== first, 'the new picture');
  assert.ok(near(decodeKeyPicture(pic(host, 1, 1)).at(36, 36), GREEN));
});

test('a failed fetch leaves the key plain and is tried again at the next panel change', async () => {
  const cell = { r: 1, c: 1, kind: 'source', n: 0, art: ART };
  const fake = await startFakeSode({ panel: panelOf([cell]), artwork: {} });
  const { host, rt } = await connect({ fake, over: { liveMs: 15 } });
  await until(() => artReads(fake).length === 1, 'the fetch');
  assert.equal(pic(host, 1, 1), '');
  assert.equal(rt.status().code, 'ok');
  assert.equal(rt.look(1, 1).colour, 'source');
  fake.artwork[ART] = wide;
  fake.panel = panelOf([cell], { rev: 2 });
  await until(() => pic(host, 1, 1), 'the picture after retry');
});

test('Artwork that is too large, an SVG or not an image leaves the key plain without an error', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: 'a-00000001' },
    { r: 1, c: 2, kind: 'source', n: 1, art: 'a-00000002' },
    { r: 1, c: 3, kind: 'source', n: 0, art: 'a-00000003' },
    { r: 1, c: 4, kind: 'source', n: 1, art: ART },
  ];
  const artwork = {
    'a-00000001': { type: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>') },
    'a-00000002': { type: 'image/png', bytes: Buffer.from('not an image at all') },
    'a-00000003': { type: 'image/png', bytes: Buffer.concat([png(10, 10, () => RED), Buffer.alloc(1024 * 1024)]) },
    [ART]: wide,
  };
  const { host, rt } = await connect({ cells, artwork });
  await until(() => pic(host, 1, 4), 'the good picture');
  for (const c of [1, 2, 3]) assert.equal(pic(host, 1, c), '', `column ${c}`);
  assert.equal(rt.status().code, 'ok');
});

test('a merged Cell with Artwork stays plain', async () => {
  const { host, fake } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART, rs: 1, cs: 2 }] });
  await until(() => host.values.key_1_1 !== undefined, 'values');
  assert.equal(pic(host, 1, 1), '');
  assert.equal(pic(host, 1, 2), '');
  assert.equal(artReads(fake).length, 0);
});

test('Offline drops every picture and brings them back with the router, without a second fetch', async () => {
  const { host, rt, fake } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART }], over: { pollMs: 15 } });
  await until(() => pic(host, 1, 1), 'the Key picture');
  fake.status = { router: 'down', routerUp: false, error: true };
  await until(() => rt.status().code === 'offline', 'Offline');
  await until(() => pic(host, 1, 1) === '', 'the picture dropped');
  assert.equal(host.values.key_1_1_inset, 0);
  assert.equal(host.values.key_1_1_bl, 0);
  fake.status = { router: 'up', routerUp: true, error: false };
  await until(() => pic(host, 1, 1), 'the picture back');
  assert.equal(artReads(fake).length, 1);
});
