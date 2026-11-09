import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { createSurface, COLOURS } from '../src/surface.js';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';
import { until } from './until.js';
import { png, jpg, gif, decodeKeyPicture, RED, BLUE, GREEN } from './images.js';
import { cropSvg, keyPicture, keyPictures, MAX_BYTES } from '../src/artwork.js';
import { textFor, WHITE } from '../src/colours.js';

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

test('Artwork that is too large or not an image leaves the key plain without an error', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: 'a-00000001' },
    { r: 1, c: 2, kind: 'source', n: 1, art: 'a-00000002' },
    { r: 1, c: 3, kind: 'source', n: 0, art: 'a-00000003' },
    { r: 1, c: 4, kind: 'source', n: 1, art: ART },
  ];
  const artwork = {
    'a-00000001': { type: 'image/svg+xml', bytes: Buffer.from('<html><svg/></html>') },
    'a-00000002': { type: 'image/png', bytes: Buffer.from('not an image at all') },
    'a-00000003': { type: 'image/png', bytes: Buffer.concat([png(10, 10, () => RED), Buffer.alloc(1024 * 1024)]) },
    [ART]: wide,
  };
  const { host, rt } = await connect({ cells, artwork });
  await until(() => pic(host, 1, 4), 'the good picture');
  for (const c of [1, 2, 3]) assert.equal(pic(host, 1, c), '', `column ${c}`);
  assert.equal(rt.status().code, 'ok');
});

const sides = (v, r, c) => ['l', 't', 'r', 'b'].map((s) => v[`key_${r}_${c}_b${s}`]);
const alphaAt = (img, x, y) => img.at(x, y)[3];

test('a merged Cell cuts its Artwork across its squares, which together show the whole picture', async () => {
  const { host } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART, rs: 1, cs: 2 }] });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both Key pictures');
  const left = decodeKeyPicture(pic(host, 1, 1));
  const right = decodeKeyPicture(pic(host, 1, 2));
  // The group is 144 by 72 px with a 6 px Border band on its outer edges. The 200 by 100 picture fits the
  // 132 by 60 inside as 120 by 60, at x 12 to 132 and y 6 to 66. Red is its left half and blue its right.
  assert.deepEqual([left.width, left.height], [66, 60]);
  assert.deepEqual([right.width, right.height], [66, 60]);
  assert.equal(alphaAt(left, 2, 30), 0);
  assert.equal(alphaAt(left, 6, 30), 255);
  assert.ok(near(left.at(6, 30), RED));
  assert.ok(near(left.at(65, 0), RED));
  assert.ok(near(right.at(0, 59), BLUE));
  assert.ok(near(right.at(59, 30), BLUE));
  assert.equal(alphaAt(right, 62, 30), 0);
});

test('a merged Cell has the Border on the outer edges of the group only', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, art: ART, rs: 2, cs: 2 }];
  const { host } = await connect({ cells });
  await until(() => pic(host, 2, 2), 'the Key pictures');
  const v = host.values;
  assert.deepEqual(sides(v, 1, 1), [8, 8, 0, 0]);
  assert.deepEqual(sides(v, 1, 2), [0, 8, 8, 0]);
  assert.deepEqual(sides(v, 2, 1), [8, 0, 0, 8]);
  assert.deepEqual(sides(v, 2, 2), [0, 0, 8, 8]);
  for (const [r, c] of [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ]) {
    assert.equal(v[`key_${r}_${c}_inset`], 1);
    assert.equal(v[`key_${r}_${c}_bg`], COLOURS.source);
  }
  assert.equal(v.key_1_1, 'CAM 1');
  assert.equal(v.key_1_2, '');
});

test('pressing any square of a merged picture Cell presses the Cell', async () => {
  const cells = [{ r: 1, c: 1, kind: 'destination', n: 0, art: ART, rs: 1, cs: 2 }];
  const { host, rt } = await connect({ cells });
  await until(() => pic(host, 1, 2), 'the Key pictures');
  await rt.press(1, 2);
  await until(() => host.values.viewed === 'MON A', 'the destination viewed');
});

test('a merged SVG gets a narrower view box on each square, which together cover the picture', async () => {
  const { host } = await connect({
    cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART, rs: 1, cs: 2 }],
    artwork: { [ART]: svgOf(SVG) },
  });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both pictures');
  const box = (c) =>
    /viewBox="([^"]+)"/
      .exec(svgBytes(pic(host, 1, c)))[1]
      .split(' ')
      .map(Number);
  const [lx, ly, lw, lh] = box(1);
  const [rx, ry, rw, rh] = box(2);
  // A square 10 by 10 picture in the 132 by 60 inside is 60 px wide at x 42 to 102 of 144, so scale 6 px per unit.
  assert.ok(Math.abs(lx - -6) < 0.01 && Math.abs(ly - 0) < 0.01, `left origin ${lx} ${ly}`);
  assert.ok(Math.abs(lw - 11) < 0.01 && Math.abs(lh - 10) < 0.01, `left size ${lw} ${lh}`);
  assert.ok(Math.abs(rx - 5) < 0.01 && Math.abs(ry - 0) < 0.01, `right origin ${rx} ${ry}`);
  assert.ok(Math.abs(rw - 11) < 0.01 && Math.abs(rh - 10) < 0.01, `right size ${rw} ${rh}`);
  assert.ok(svgBytes(pic(host, 1, 1)).includes('<rect width="10" height="10" fill="red"/>'));
});

test('a merged Icon spans its group with no Border and the Icon colour', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, art: 'icon:camera', rs: 1, cs: 2 }];
  const { host } = await connect({ cells });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both Icon pictures');
  const v = host.values;
  for (const c of [1, 2]) {
    assert.equal(iconStroke(host, 1, c), hex(0xffffff));
    assert.equal(v[`key_1_${c}_inset`], 0);
    assert.deepEqual(sides(v, 1, c), [0, 0, 0, 0]);
  }
  const [lx, , lw] = /viewBox="([^"]+)"/
    .exec(iconSvg(host, 1, 1))[1]
    .split(' ')
    .map(Number);
  const [rx, , rw] = /viewBox="([^"]+)"/
    .exec(iconSvg(host, 1, 2))[1]
    .split(' ')
    .map(Number);
  // The 32 unit square Icon is centred in a 2 by 1 key group, so each square sees half of it plus padding.
  assert.ok(Math.abs(lx + lw - rx) < 0.01, 'the squares abut');
  assert.ok(Math.abs(lw - 32) < 0.01 && Math.abs(rw - 32) < 0.01);
});

test('a group cut by the grid edge shows its visible squares and no error', async () => {
  const cells = [{ r: 3, c: 7, kind: 'source', n: 0, art: ART, rs: 2, cs: 3 }];
  const { host, rt } = await connect({ cells, panelExtra: { rows: 5, cols: 10 } });
  await until(() => pic(host, 4, 8), 'the visible squares');
  assert.equal(rt.status().code, 'ok');
  assert.equal(host.values.key_3_9_pic, undefined);
  assert.equal(host.values.key_5_7_pic, undefined);
  const v = host.values;
  assert.deepEqual(sides(v, 3, 7), [8, 8, 0, 0]);
  assert.deepEqual(sides(v, 4, 8), [0, 0, 0, 8]);
  const tile = decodeKeyPicture(pic(host, 3, 7));
  assert.ok(tile.width > 0 && tile.height > 0);
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

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>';
const svgOf = (text) => ({ type: 'image/svg+xml', bytes: Buffer.from(text) });
// What Companion receives: a data URL it decodes itself.
const svgBytes = (value) => {
  const m = /^data:image\/svg\+xml;base64,(.+)$/.exec(value);
  assert.ok(m, 'an SVG data URL');
  return Buffer.from(m[1], 'base64').toString();
};

test('SVG Artwork reaches the key as the same bytes, not decoded', async () => {
  const { host } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART }], artwork: { [ART]: svgOf(SVG) } });
  await until(() => pic(host, 1, 1), 'the Key picture');
  assert.equal(svgBytes(pic(host, 1, 1)), SVG);
});

test('SVG with an XML prolog and a byte order mark is accepted', async () => {
  const text = `\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n${SVG}`;
  const { host } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART }], artwork: { [ART]: svgOf(text) } });
  await until(() => pic(host, 1, 1), 'the Key picture');
  assert.equal(svgBytes(pic(host, 1, 1)), text);
});

test('a script inside an SVG is passed on as text and never run', async () => {
  globalThis.svgScriptRan = false;
  const text = '<svg xmlns="http://www.w3.org/2000/svg"><script>globalThis.svgScriptRan = true</script></svg>';
  const { host } = await connect({ cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART }], artwork: { [ART]: svgOf(text) } });
  await until(() => pic(host, 1, 1), 'the Key picture');
  assert.equal(svgBytes(pic(host, 1, 1)), text);
  assert.equal(globalThis.svgScriptRan, false);
  delete globalThis.svgScriptRan;
});

test('SVG Artwork follows the same Border, inset and Offline rules as raster Artwork', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: ART },
    { r: 1, c: 2, kind: 'source', n: 1, art: OTHER, hideText: true },
  ];
  const artwork = { [ART]: svgOf(SVG), [OTHER]: wide };
  const { host, rt, fake } = await connect({ cells, artwork, over: { pollMs: 15 } });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both pictures');
  const v = host.values;
  for (const c of [1, 2]) {
    assert.equal(v[`key_1_${c}_inset`], 1);
    for (const side of ['l', 't', 'r', 'b']) assert.equal(v[`key_1_${c}_b${side}`], 8);
    assert.equal(v[`key_1_${c}_bg`], COLOURS.source);
  }
  assert.equal(v.key_1_1, 'CAM 1');
  assert.equal(v.key_1_2, '');
  fake.status = { router: 'down', routerUp: false, error: true };
  await until(() => rt.status().code === 'offline', 'Offline');
  await until(() => pic(host, 1, 1) === '' && pic(host, 1, 2) === '', 'both dropped');
});

const iconSvg = (host, r, c) => svgBytes(pic(host, r, c));
const iconStroke = (host, r, c) => /stroke="(#[0-9a-f]{6})"/.exec(iconSvg(host, r, c))?.[1];
const hex = (rgb) => `#${rgb.toString(16).padStart(6, '0')}`;

test('an Icon Cell gets its Icon as a drawing in the text colour, over the solid fill and with no Border or Artwork request', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, art: 'icon:camera' }];
  const { host, fake } = await connect({ cells });
  await until(() => pic(host, 1, 1), 'the Icon');
  assert.match(iconSvg(host, 1, 1), /^<svg [^>]*viewBox="[^"]+"/);
  assert.ok(iconSvg(host, 1, 1).includes('<path'));
  assert.equal(iconStroke(host, 1, 1), hex(0xffffff));
  const v = host.values;
  assert.equal(v.key_1_1_inset, 0);
  assert.deepEqual([v.key_1_1_bl, v.key_1_1_bt, v.key_1_1_br, v.key_1_1_bb], [0, 0, 0, 0]);
  assert.equal(v.key_1_1_bg, COLOURS.source);
  assert.equal(v.key_1_1, 'CAM 1');
  assert.equal(artReads(fake).length, 0);
});

test('the Icon colour follows the key text colour as the state changes', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'destination', n: 0 },
    { r: 1, c: 2, kind: 'source', n: 0, art: 'icon:camera' },
  ];
  const { host, rt } = await connect({ cells });
  await until(() => pic(host, 1, 2), 'the Icon');
  const idle = iconStroke(host, 1, 2);
  await rt.press(1, 1);
  await rt.press(1, 2);
  await until(() => host.values.key_1_2_bg === COLOURS['source-pending'], 'the pending colour');
  await until(() => iconStroke(host, 1, 2) !== idle, 'the Icon recoloured');
  assert.equal(iconStroke(host, 1, 2), hex(host.values.key_1_2_fg));
  assert.equal(host.values.key_1_2_inset, 0);
});

test('a hidden-text Icon Cell draws a white Icon and an empty label, whatever the state colour', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'destination', n: 0 },
    { r: 1, c: 2, kind: 'source', n: 0, art: 'icon:camera', hideText: true },
  ];
  const { host, rt } = await connect({ cells });
  await until(() => pic(host, 1, 2), 'the Icon');
  await rt.press(1, 1);
  await rt.press(1, 2);
  await until(() => host.values.key_1_2_bg === COLOURS['source-pending'], 'the pending colour');
  assert.equal(host.values.key_1_2, '');
  assert.equal(iconStroke(host, 1, 2), hex(0xffffff));
});

test('an unknown icon name leaves the key without a picture, and hidden text stays hidden', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, art: 'icon:no-such-icon', hideText: true }];
  const { host, fake } = await connect({ cells });
  await until(() => host.values.key_1_1 !== undefined, 'values');
  assert.equal(pic(host, 1, 1), '');
  assert.equal(host.values.key_1_1_inset, 0);
  assert.equal(host.values.key_1_1, '');
  assert.equal(artReads(fake).length, 0);
});

test('an Icon drops with Offline, and a Cell changed from Artwork to an Icon swaps its picture', async () => {
  const cell = { r: 1, c: 1, kind: 'source', n: 0 };
  const { host, fake, rt } = await connect({ cells: [{ ...cell, art: ART }], over: { liveMs: 15, pollMs: 15 } });
  await until(() => pic(host, 1, 1), 'the Artwork');
  assert.equal(host.values.key_1_1_inset, 1);
  fake.panel = panelOf([{ ...cell, art: 'icon:camera' }], { rev: 2 });
  await until(() => pic(host, 1, 1).startsWith('data:image/svg+xml'), 'the Icon');
  assert.equal(host.values.key_1_1_inset, 0);
  fake.status = { router: 'down', routerUp: false, error: true };
  await until(() => rt.status().code === 'offline', 'Offline');
  await until(() => pic(host, 1, 1) === '', 'the Icon dropped');
});

test('hidden text stays empty when the art string is malformed, but "Press again" still speaks', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: 'a-zzz', hideText: true },
    { r: 1, c: 2, kind: 'source', n: 1, art: 'icon:', hideText: true },
    { r: 1, c: 3, kind: 'destination', n: 0 },
    { r: 1, c: 4, kind: 'take', art: 'bogus', hideText: true },
  ];
  const { host, rt } = await connect({ cells, panelExtra: { settings: { guard: 'double' } } });
  await until(() => host.values.key_1_1 !== undefined, 'values');
  assert.equal(host.values.key_1_1, '');
  assert.equal(host.values.key_1_2, '');
  assert.equal(pic(host, 1, 1), '');
  await rt.press(1, 3);
  await rt.press(1, 2);
  assert.equal(host.values.key_1_4, '');
  await rt.press(1, 4);
  await until(() => host.values.key_1_4 === 'Press\nagain', 'the confirm text');
});

// A runtime stub, so each state colour can be checked without driving a take to it.
const stubValues = (look) => {
  const values = {};
  const runtime = {
    grid: () => ({ rows: 1, cols: 1 }),
    cells: () => [],
    squares: () => [{ r: 1, c: 1 }],
    variables: () => ({}),
    look: () => look,
    status: () => ({ code: 'ok', text: '' }),
  };
  const host = {
    updateStatus() {},
    setVariableDefinitions() {},
    setPresetDefinitions() {},
    setVariableValues: (v) => Object.assign(values, v),
    checkFeedbacks() {},
  };
  createSurface({ runtime, host, label: 'sode' }).sync();
  return values;
};

test('the label on an Artwork key is light over the dark inset in every state; an Icon or plain key keeps the state text colour', () => {
  for (const colour of ['source', 'source-current', 'source-pending', 'take-armed', 'take-confirm', 'result-connected']) {
    const edges = { bl: true, bt: true, br: true, bb: true };
    const art = stubValues({ text: 'X', colour, pulse: 0, picture: 'p', border: 8, edges });
    assert.equal(art.key_1_1_fg, WHITE, `Artwork on ${colour}`);
    assert.equal(art.key_1_1_bg, COLOURS[colour], `Border on ${colour}`);
    const icon = stubValues({ text: 'X', colour, pulse: 0, picture: 'data:image/svg+xml;base64,AA==', border: 0 });
    assert.equal(icon.key_1_1_fg, textFor(colour), `Icon on ${colour}`);
    const plain = stubValues({ text: 'X', colour, pulse: 0 });
    assert.equal(plain.key_1_1_fg, textFor(colour), `no picture on ${colour}`);
  }
});

test('Artwork whose Content-Length is over the cap is not read', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: 'a-00000003' },
    { r: 1, c: 2, kind: 'source', n: 1, art: ART },
  ];
  const big = { type: 'image/png', bytes: Buffer.concat([png(10, 10, () => RED), Buffer.alloc(MAX_BYTES)]) };
  const bodiesRead = [];
  const fetch = async (url, init) => {
    const res = await globalThis.fetch(url, init);
    if (!String(url).includes('/artwork/')) return res;
    return {
      ok: res.ok,
      status: res.status,
      headers: res.headers,
      body: null,
      arrayBuffer: () => {
        bodiesRead.push(String(url));
        return res.arrayBuffer();
      },
    };
  };
  const { host } = await connect({ cells, artwork: { 'a-00000003': big, [ART]: wide }, over: { fetch } });
  await until(() => pic(host, 1, 2), 'the good picture');
  assert.equal(pic(host, 1, 1), '');
  assert.equal(bodiesRead.filter((u) => u.includes('a-00000003')).length, 0);
});

test('a PNG or GIF whose header dimensions are over the pixel cap is refused before decoding', () => {
  const huge = png(5000, 5000, () => RED);
  assert.ok(huge.length < MAX_BYTES, 'a small file with a large canvas');
  const t = performance.now();
  assert.equal(keyPicture(huge), null);
  assert.equal(keyPictures(huge, { rs: 1, cs: 2, border: 8 }), null);
  assert.ok(performance.now() - t < 100, 'refused from the header');
  const bigGif = gif(10, 10, () => 0, RED, BLUE);
  bigGif.writeUInt16LE(5000, 6);
  bigGif.writeUInt16LE(5000, 8);
  assert.equal(keyPicture(bigGif), null);
  assert.notEqual(keyPicture(png(100, 100, () => RED)), null);
});

const urlText = (url) => Buffer.from(url.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString();
const GROUP = { rs: 1, cs: 2, border: 8 };

test('cropSvg uses the view box when width and height are percentages or missing', () => {
  for (const attrs of ['width="100%" height="100%"', 'width="50%"', '']) {
    const tiles = cropSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" ${attrs}><rect/></svg>`, GROUP);
    assert.equal(tiles?.[0].length, 2, attrs);
    assert.match(urlText(tiles[0][0]), /viewBox="-?[\d.]+ 0 11 10"/, attrs);
  }
});

test('cropSvg returns null when there is no view box and no plain width and height', () => {
  for (const attrs of ['width="100%" height="100%"', 'width="10" height="50%"', '', 'width="auto" height="auto"']) {
    assert.equal(cropSvg(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect/></svg>`, GROUP), null, attrs);
  }
  assert.ok(cropSvg('<svg width="10" height="20"><rect/></svg>', GROUP));
  assert.ok(cropSvg('<svg width="10px" height="20px"><rect/></svg>', GROUP));
});

test('cropSvg keeps a self-closing root well formed', () => {
  const tiles = cropSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', GROUP);
  const text = urlText(tiles[0][0]);
  assert.match(text, /^<svg [^>]*viewBox="[^"]+" width="66" height="60"\/>$/);
  assert.equal(text.match(/viewBox=/g).length, 1);
});

test('cropSvg reads a root whose attribute value contains ">"', () => {
  const tiles = cropSvg('<svg viewBox="0 0 10 10" data-note="a > b" width="10" height="10"><rect/></svg>', GROUP);
  const text = urlText(tiles[0][0]);
  assert.match(text, /^<svg data-note="a > b" viewBox="[^"]+" width="66" height="60"><rect\/><\/svg>$/);
});

test('a merged SVG that cannot be cropped leaves its keys plain without an error', async () => {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect/></svg>');
  const { host, rt, fake } = await connect({
    cells: [{ r: 1, c: 1, kind: 'source', n: 0, art: ART, rs: 1, cs: 2 }],
    artwork: { [ART]: { type: 'image/svg+xml', bytes } },
  });
  await until(() => artReads(fake).length === 1 && host.values.key_1_1 !== undefined, 'the fetch');
  assert.equal(pic(host, 1, 1), '');
  assert.equal(host.values.key_1_1_inset, 0);
  assert.equal(rt.status().code, 'ok');
});

test('a group cut by the grid edge has no Border on the cut sides', async () => {
  // The Companion grid is 4 by 8, so this 2 by 3 group at row 4, column 7 shows a 1 by 2 corner of it.
  const cells = [{ r: 4, c: 7, kind: 'source', n: 0, art: ART, rs: 2, cs: 3 }];
  const { host, rt } = await connect({ cells, panelExtra: { rows: 6, cols: 10 } });
  await until(() => pic(host, 4, 7) && pic(host, 4, 8), 'the visible squares');
  assert.equal(rt.status().code, 'ok');
  assert.equal(host.values.key_4_9_pic, undefined);
  assert.equal(host.values.key_5_7_pic, undefined);
  assert.deepEqual(sides(host.values, 4, 7), [8, 8, 0, 0]);
  assert.deepEqual(sides(host.values, 4, 8), [0, 8, 0, 0]);
});

const op = (host, r, c) => host.values[`key_${r}_${c}_op`];

test('Artwork and Icons are drawn at 30% under a label and at full strength once the text is hidden; a plain key is full strength', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, art: ART },
    { r: 1, c: 2, kind: 'source', n: 1, art: ART, hideText: true },
    { r: 1, c: 3, kind: 'source', n: 2, art: 'icon:camera' },
    { r: 1, c: 4, kind: 'source', n: 3, art: 'icon:camera', hideText: true },
    { r: 1, c: 5, kind: 'source', n: 0 },
  ];
  const { host } = await connect({ cells });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'the Artwork pictures');
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((c) => op(host, 1, c)),
    [30, 100, 30, 100, 100],
  );
  assert.equal(op(host, 3, 5), 100, 'a blank square');
});

test('a merged Artwork Cell has one strength on every square', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, art: ART, rs: 1, cs: 2 }];
  const { host } = await connect({ cells });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both pictures');
  assert.deepEqual([op(host, 1, 1), op(host, 1, 2)], [30, 30]);
});

const glyphs = (host, r, c) => [...iconSvg(host, r, c).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const fillOf = (host, r, c) => /<text[^>]*fill="(#[0-9a-f]{6})"/.exec(iconSvg(host, r, c))?.[1];
const fontOf = (host, r, c) => Number(/<text[^>]*font-size="([\d.]+)"/.exec(iconSvg(host, r, c))?.[1]);

test('Icon B alone is a text glyph in the key text colour, with no sprite, Border or Artwork request', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, artB: '7' }];
  const { host, fake } = await connect({ cells });
  await until(() => pic(host, 1, 1), 'the Icon B picture');
  assert.deepEqual(glyphs(host, 1, 1), ['7']);
  assert.ok(!iconSvg(host, 1, 1).includes('<path'));
  assert.equal(fillOf(host, 1, 1), hex(textFor('source')));
  assert.equal(host.values.key_1_1_inset, 0);
  assert.equal(op(host, 1, 1), 30);
  assert.equal(host.values.key_1_1, 'CAM 1');
  assert.equal(artReads(fake).length, 0);
});

test('Icon B sits beside Icon A, each narrower than alone, and a two character glyph is smaller than one', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'source', n: 0, artB: 'B' },
    { r: 1, c: 2, kind: 'source', n: 0, art: 'icon:camera', artB: 'B' },
    { r: 1, c: 3, kind: 'source', n: 0, art: 'icon:camera', artB: '16' },
    { r: 1, c: 4, kind: 'source', n: 0, art: 'icon:camera' },
  ];
  const { host } = await connect({ cells });
  await until(() => [1, 2, 3, 4].every((c) => pic(host, 1, c)), 'the pictures');
  assert.ok(iconSvg(host, 1, 2).includes('<path'));
  assert.deepEqual(glyphs(host, 1, 2), ['B']);
  assert.deepEqual(glyphs(host, 1, 3), ['16']);
  assert.ok(fontOf(host, 1, 2) < fontOf(host, 1, 1), 'beside Icon A the glyph shrinks');
  assert.ok(fontOf(host, 1, 3) < fontOf(host, 1, 2), 'two characters shrink further');
  assert.notEqual(iconSvg(host, 1, 2), iconSvg(host, 1, 4), 'Icon A moves aside');
  assert.deepEqual(glyphs(host, 1, 4), []);
});

test('hidden text applies to Icon B, which then draws white', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'destination', n: 0 },
    { r: 1, c: 2, kind: 'source', n: 0, artB: 'Z', hideText: true },
    { r: 1, c: 3, kind: 'source', n: 1, art: 'icon:camera', artB: '3', hideText: true },
  ];
  const { host, rt } = await connect({ cells });
  await until(() => pic(host, 1, 2) && pic(host, 1, 3), 'the pictures');
  await rt.press(1, 1);
  await rt.press(1, 2);
  await until(() => host.values.key_1_2_bg === COLOURS['source-pending'], 'the pending colour');
  assert.equal(host.values.key_1_2, '');
  assert.equal(host.values.key_1_3, '');
  assert.equal(fillOf(host, 1, 2), hex(0xffffff));
  assert.equal(fillOf(host, 1, 3), hex(0xffffff));
  assert.equal(iconStroke(host, 1, 3), hex(0xffffff));
});

test('the Icon B colour follows the key text colour as the state changes', async () => {
  const cells = [
    { r: 1, c: 1, kind: 'destination', n: 0 },
    { r: 1, c: 2, kind: 'source', n: 0, artB: 'A' },
  ];
  const { host, rt } = await connect({ cells });
  await until(() => pic(host, 1, 2), 'the picture');
  const idle = fillOf(host, 1, 2);
  await rt.press(1, 1);
  await rt.press(1, 2);
  await until(() => host.values.key_1_2_bg === COLOURS['source-pending'], 'the pending colour');
  await until(() => fillOf(host, 1, 2) !== idle, 'the glyph recoloured');
  assert.equal(fillOf(host, 1, 2), hex(host.values.key_1_2_fg));
});

test('an Icon B outside 0 to 16 and A to Z draws nothing and leaves the label showing, even with hidden text', async () => {
  const cells = ['17', '-1', 'a', 'AB', '', 7, null].map((artB, i) => ({ r: 1, c: i + 1, kind: 'source', n: 0, artB, hideText: true }));
  const { host } = await connect({ cells, panelExtra: { cols: 7 } });
  await until(() => host.values.key_1_7 !== undefined, 'values');
  for (let c = 1; c <= 7; c++) {
    assert.equal(pic(host, 1, c), '', `square ${c}`);
    assert.equal(host.values[`key_1_${c}`], 'CAM 1');
  }
});

test('a merged Icon B Cell spans its group like Icon A, drawing the glyph on every square', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, art: 'icon:camera', artB: '5', rs: 1, cs: 2 }];
  const { host } = await connect({ cells });
  await until(() => pic(host, 1, 1) && pic(host, 1, 2), 'both pictures');
  const view = (c) =>
    /viewBox="([^"]+)"/
      .exec(iconSvg(host, 1, c))[1]
      .split(' ')
      .map(Number);
  const [lx, , lw] = view(1);
  const [rx] = view(2);
  assert.ok(Math.abs(lx + lw - rx) < 0.01, 'the squares abut');
  for (const c of [1, 2]) {
    assert.deepEqual(glyphs(host, 1, c), ['5']);
    assert.equal(host.values[`key_1_${c}_inset`], 0);
  }
});

test('with Artwork, Icon B is not drawn but still hides the text', async () => {
  const cells = [{ r: 1, c: 1, kind: 'source', n: 0, art: ART, artB: '2', hideText: true }];
  const { host } = await connect({ cells });
  await until(() => pic(host, 1, 1), 'the Artwork');
  assert.ok(!pic(host, 1, 1).startsWith('data:image/svg'));
  assert.equal(host.values.key_1_1, '');
});

test('a Cell changed to another Icon B updates its key, and the glyph drops with Offline', async () => {
  const cell = { r: 1, c: 1, kind: 'source', n: 0 };
  const { host, fake, rt } = await connect({ cells: [{ ...cell, artB: '1' }], over: { liveMs: 15, pollMs: 15 } });
  await until(() => pic(host, 1, 1), 'the glyph');
  fake.panel = panelOf([{ ...cell, artB: '2' }], { rev: 2 });
  await until(() => glyphs(host, 1, 1)[0] === '2', 'the new glyph');
  fake.status = { router: 'down', routerUp: false, error: true };
  await until(() => rt.status().code === 'offline', 'Offline');
  await until(() => pic(host, 1, 1) === '', 'the glyph dropped');
});
