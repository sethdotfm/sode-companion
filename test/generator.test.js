import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { generatePage, MAX_GRID } from '../src/generator/index.js';
import { actionDefinitions, feedbackDefinitions, createSurface, COLOURS } from '../src/surface.js';
import { createRuntime } from '../src/runtime.js';
import { fakeClock } from './fake-clock.js';
import { startFakeSode, panelOf as sodePanelOf, KEY } from './fake-sode.js';

const grid = (rows, cols, ...rest) => generatePage({ rows, cols }, ...rest);
// Companion keys controls by row then column as strings from 0; the Bound position counts from 1.
const controlAt = (doc, r, c) => doc.page.controls?.[r - 1]?.[c - 1];
const layer = (btn, id) => btn.style.layers.find((l) => l.id === id);
const textOf = (doc, r, c) => layer(controlAt(doc, r, c), 'text0').text.value;
const expr = (name) => ({ isExpression: true, value: name });
const bgOf = (doc, r, c) => layer(controlAt(doc, r, c), 'box0').color;
const fgOf = (doc, r, c) => layer(controlAt(doc, r, c), 'text0').color;
const squareCount = (doc) => Object.values(doc.page.controls).flatMap((row) => Object.keys(row)).length;
const REAL = parse(readFileSync(new URL('./fixtures/speedtest-export.companionconfig', import.meta.url), 'utf8'));
const FULL = [
  ...[1, 2, 3, 4].map((c) => ({ r: 1, c, kind: 'source', n: c - 1 })),
  ...[1, 2, 3, 4].map((c) => ({ r: 2, c, kind: 'destination', n: c - 1 })),
  { r: 1, c: 5, kind: 'clear' },
  { r: 2, c: 5, kind: 'current' },
  { r: 3, c: 1, kind: 'preset', scope: 'everyone', name: 'Opening' },
  { r: 3, c: 2, kind: 'preset', scope: 'me', name: 'Close' },
  { r: 3, c: 4, kind: 'take', cs: 2 },
];

const pressOf = (r, c, event) => ({
  row: { value: r, isExpression: false },
  col: { value: c, isExpression: false },
  event: { value: event, isExpression: false },
});

test('every square is a button bound to its own row and column', () => {
  const doc = grid(2, 3, 'conn123', { label: 'sode' });
  assert.equal(squareCount(doc), 6);
  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= 3; c++) {
      const { down, up } = controlAt(doc, r, c).steps[0].action_sets;
      assert.deepEqual(down[0].options, pressOf(r, c, 'down'));
      assert.deepEqual(up[0].options, pressOf(r, c, 'up'));
      assert.deepEqual(bgOf(doc, r, c), expr(`$(sode:key_${r}_${c}_bg)`));
      assert.equal(textOf(doc, r, c), `$(sode:key_${r}_${c})`);
    }
  }
});

test('the 4 by 8 page matches the golden page', () => {
  const doc = grid(4, 8, 'conn123', { label: 'sode', connection: { host: 'localhost', port: 8081 } });
  assert.equal(squareCount(doc), 32);
  const file = new URL('./golden/grid-4x8-page.json', import.meta.url);
  if (process.env.UPDATE_GOLDEN) writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), JSON.parse(readFileSync(file, 'utf8')));
});

test('the same input gives the same bytes', () => {
  const make = () => stringify(grid(4, 8, 'c', { label: 'sode', connection: { host: 'h', port: 1 } }));
  assert.equal(make(), make());
});

test('sizes from 1 by 1 to the upper bound give rows by cols buttons and a matching gridSize', () => {
  for (const [rows, cols] of [
    [1, 1],
    [4, 8],
    [8, 8],
    [MAX_GRID, MAX_GRID],
  ]) {
    const doc = grid(rows, cols, 'c');
    assert.equal(squareCount(doc), rows * cols);
    assert.deepEqual(doc.page.gridSize, { minColumn: 0, maxColumn: cols - 1, minRow: 0, maxRow: rows - 1 });
    assert.ok(controlAt(doc, rows, cols));
    assert.equal(controlAt(doc, rows + 1, 1), undefined);
  }
});

test('bad sizes and a missing connection id are refused', () => {
  for (const [rows, cols] of [
    [0, 8],
    [4, 0],
    [-1, 8],
    [4, MAX_GRID + 1],
    [1.5, 2],
    [NaN, 2],
    ['4', 8],
    [undefined, 8],
  ])
    assert.throws(() => grid(rows, cols, 'c'), RangeError, `${rows} by ${cols}`);
  assert.throws(() => grid(4, 8, ''), RangeError);
});

test('the page carries no key and no panel', () => {
  const text = stringify(grid(4, 8, 'c', { label: 'sode', connection: { host: 'localhost', port: 8081 } }));
  assert.ok(!/sode_[A-Za-z0-9]{20,}/.test(text));
  assert.ok(!/key:|panel:/i.test(text.replace(/\$\(sode:[^)]*\)/g, '')));
});

// Leaves become their type; the {value, isExpression} wrapper stays so a bare value where Companion wraps one fails.
const shapeOf = (v) =>
  Array.isArray(v)
    ? v.map(shapeOf)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)]))
      : v === null
        ? 'null'
        : typeof v;

test('a generated button has the real export layer set, keys and wrapped values', () => {
  const real = REAL.page.controls[0][1];
  const made = controlAt(grid(1, 2, 'c', { label: 'sode' }), 1, 2);
  assert.deepEqual(Object.keys(made), Object.keys(real));
  assert.equal(made.type, real.type);
  assert.deepEqual(
    made.style.layers.map((l) => l.id),
    ['canvas', 'box0', 'box1', 'image0', 'text0'],
  );
  // The inset plate is a second Background box, so it is checked against the real box layer.
  const realOf = (id) => real.style.layers.find((l) => l.id === (id === 'box1' ? 'box0' : id));
  for (const got of made.style.layers) {
    const l = realOf(got.id);
    assert.deepEqual(Object.keys(got), Object.keys(l), got.id);
    for (const k of ['usage', 'type', 'pinnedProperties']) assert.deepEqual(got[k], l[k], `${got.id}.${k}`);
    // Expression fields are plain values in the export; only their value type and isExpression flag differ.
    const plain = structuredClone(got);
    for (const [k, v] of Object.entries(got)) {
      if (!v?.isExpression) continue;
      assert.equal(typeof v.value, 'string', `${got.id}.${k}`);
      plain[k] = l[k];
    }
    assert.deepEqual(shapeOf(plain), shapeOf(l), got.id);
  }
  assert.deepEqual(shapeOf(made.options), shapeOf(real.options));
  assert.deepEqual(Object.keys(made.steps), Object.keys(real.steps));
  assert.deepEqual(shapeOf(made.steps[0].options), shapeOf(real.steps[0].options));
  assert.deepEqual(Object.keys(made.steps[0].action_sets), Object.keys(real.steps[0].action_sets));
  assert.deepEqual(made.localVariables, real.localVariables);
});

test('the page file has the real export wrapper and gridSize, with controls keyed from "0"', () => {
  const doc = grid(3, 5, 'c', { label: 'sode' });
  for (const k of [
    'version',
    'type',
    'companionBuild',
    'page',
    'instances',
    'connectionCollections',
    'oldPageNumber',
    'imageLibrary',
    'imageLibraryCollections',
  ])
    assert.ok(k in doc, k);
  assert.deepEqual(
    Object.keys(doc),
    Object.keys(REAL).filter((k) => k in doc || k === 'companionBuild'),
  );
  assert.equal(doc.version, REAL.version);
  assert.equal(doc.type, 'page');
  assert.deepEqual(Object.keys(doc.page), Object.keys(REAL.page));
  assert.equal(doc.page.name, 'Sode 3x5');
  assert.deepEqual(grid(4, 8, 'c').page.gridSize, REAL.page.gridSize);
  assert.deepEqual(Object.keys(doc.page.controls), ['0', '1', '2']);
  assert.deepEqual(Object.keys(doc.page.controls[0]), ['0', '1', '2', '3', '4']);
  assert.deepEqual(shapeOf(doc.oldPageNumber), shapeOf(REAL.oldPageNumber));
});

test('the instances entry is a sode-panels connection with the given id and label and no secrets', () => {
  const doc = grid(3, 5, 'conn123', { label: 'sode', connection: { host: 'sode.local', port: 8080, tls: false } });
  const [inst] = Object.values(doc.instances);
  assert.deepEqual(Object.keys(doc.instances), ['conn123']);
  assert.deepEqual(Object.keys(inst), Object.keys(Object.values(REAL.instances)[0]));
  assert.equal(inst.moduleInstanceType, 'connection');
  assert.equal(inst.moduleId, 'sode-panels');
  assert.equal(inst.label, 'sode');
  assert.deepEqual(inst.secrets, {});
  assert.deepEqual(inst.config, { host: 'sode.local', port: 8080, tls: false });
});

test('the generated YAML parses back to the same page and reads like the export', () => {
  const doc = grid(3, 5, 'conn123', { label: 'sode' });
  const text = stringify(doc);
  assert.deepEqual(parse(text), JSON.parse(JSON.stringify(doc)));
  assert.match(text, /^version: 12\ntype: page\n/);
});

test('state colours are the dark patchbay accents of Sode panels', () => {
  assert.equal(COLOURS['source-current'], 0x5ccf8f);
  assert.equal(COLOURS['destination-view'], 0xe8673c);
  assert.equal(COLOURS['take-armed'], 0xf0605a);
  assert.equal(COLOURS['take-confirm'], 0xf2b84b);
  assert.equal(COLOURS['result-failed'], 0xf0605a);
});

test('colours come from layer expressions on the key square colour variables', () => {
  const doc = grid(3, 5, 'c', { label: 'sode' });
  for (const [r, c] of [
    [1, 1],
    [3, 3],
    [3, 5],
  ]) {
    assert.deepEqual(bgOf(doc, r, c), expr(`$(sode:key_${r}_${c}_bg)`));
    assert.deepEqual(fgOf(doc, r, c), expr(`$(sode:key_${r}_${c}_fg)`));
    assert.equal(textOf(doc, r, c), `$(sode:key_${r}_${c})`);
  }
});

test('buttons draw a Border and inset plate, a picture layer and the label from expressions on the picture variables', () => {
  const doc = grid(3, 5, 'c', { label: 'sode' });
  const btn = controlAt(doc, 2, 3);
  const k = (suffix) => `$(sode:key_2_3_${suffix})`;
  const geometry = {
    x: expr(k('bl')),
    y: expr(k('bt')),
    width: expr(`100 - ${k('bl')} - ${k('br')}`),
    height: expr(`100 - ${k('bt')} - ${k('bb')}`),
  };
  const plate = layer(btn, 'box1');
  assert.deepEqual(plate.opacity, expr(`100 * ${k('inset')}`));
  assert.deepEqual(plate.color, { value: COLOURS.blank, isExpression: false });
  const picture = layer(btn, 'image0');
  assert.deepEqual(picture.base64Image, expr(k('pic')));
  assert.deepEqual(picture.opacity, expr(k('op')));
  for (const l of [plate, picture])
    for (const [field, want] of Object.entries(geometry)) assert.deepEqual(l[field], want, `${l.id}.${field}`);
  assert.deepEqual(layer(btn, 'box0').color, expr(k('bg')));
  assert.deepEqual(layer(btn, 'box0').width.value, 100, 'the Border plate fills the key');
  assert.equal(layer(btn, 'text0').text.value, '$(sode:key_2_3)');
});

test('the core imports nothing that needs Node', () => {
  const seen = new Set();
  const walk = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const src = readFileSync(url, 'utf8');
    assert.ok(!/\b(process|Buffer|__dirname|require)\b/.test(src.replace(/\/\/.*$/gm, '')), `${url.pathname} uses a Node global`);
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      assert.ok(m[1].startsWith('.'), `${url.pathname} imports ${m[1]}`);
      walk(new URL(m[1], url));
    }
  };
  walk(new URL('../src/generator/index.js', import.meta.url));
  assert.ok(seen.size >= 4);
});

test('generated buttons use the module press action and carry no look feedback', () => {
  const actions = actionDefinitions(() => null);
  const choices = actions.press.options.find((o) => o.id === 'event').choices.map((x) => x.id);
  const doc = grid(3, 5, 'c');
  for (const row of Object.values(doc.page.controls)) {
    for (const btn of Object.values(row)) {
      assert.deepEqual(btn.feedbacks, []);
      const { down, up } = btn.steps[0].action_sets;
      for (const ref of [...down, ...up]) {
        assert.ok(ref.definitionId in actions);
        assert.ok(choices.includes(ref.options.event.value));
      }
      assert.deepEqual([down[0].options.event.value, up[0].options.event.value], ['down', 'up']);
    }
  }
  assert.ok('look' in feedbackDefinitions(() => null), 'the feedback stays for hand-built buttons');
});

test('every variable a generated button reads is defined by the module for the same panel', async () => {
  const cells = FULL.map((c) => ({ ...c }));
  const sodePanel = sodePanelOf(cells, { rows: 3, cols: 5 });
  const doc = grid(3, 5, 'c', { label: 'sode' });
  const fake = await startFakeSode({ panel: sodePanel });
  const clock = fakeClock();
  const rt = createRuntime({
    host: '127.0.0.1',
    port: fake.port,
    panel: 'speedtest',
    key: KEY,
    pollMs: 0,
    liveMs: 0,
    now: clock.now,
    timers: clock.timers,
  });
  const defs = {};
  const values = {};
  const host = {
    updateStatus() {},
    setVariableDefinitions: (d) => Object.assign(defs, d),
    setPresetDefinitions() {},
    setVariableValues: (v) => Object.assign(values, v),
    checkFeedbacks() {},
  };
  const surface = createSurface({ runtime: rt, host, label: 'sode' });
  rt.onChange(surface.sync);
  try {
    await rt.start();
    let read = 0;
    for (const row of Object.values(doc.page.controls)) {
      for (const btn of Object.values(row)) {
        const fields = btn.style.layers.flatMap((l) =>
          Object.values(l)
            .filter((v) => typeof v?.value === 'string')
            .map((v) => v.value),
        );
        for (const f of fields) {
          for (const [, ref] of f.matchAll(/\$\(sode:([^)]+)\)/g)) {
            assert.ok(ref in defs, `${ref} is not defined`);
            assert.ok(ref in values, `${ref} has no value`);
            read++;
          }
        }
      }
    }
    assert.equal(read, 270);
  } finally {
    rt.stop();
    await fake.close();
  }
});
