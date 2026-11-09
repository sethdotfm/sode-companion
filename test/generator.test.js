import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { generatePage } from '../src/generator/index.js';
import { actionDefinitions, feedbackDefinitions, createSurface, COLOURS } from '../src/surface.js';
import { createRuntime } from '../src/runtime.js';
import { fakeClock } from './fake-clock.js';
import { startFakeSode, panelOf as sodePanelOf, KEY } from './fake-sode.js';

const panelOf = (cells, over = {}) => ({
  id: 'p-1',
  name: 'Speedtest',
  slug: 'speedtest',
  acts: 'api',
  rows: 3,
  cols: 5,
  cells,
  rev: 1,
  ...over,
});
// Companion keys controls by row then column as strings from 0; the Bound position counts from 1.
const controlAt = (doc, r, c) => doc.page.controls?.[r - 1]?.[c - 1];
const layer = (btn, id) => btn.style.layers.find((l) => l.id === id);
const textOf = (doc, r, c) => layer(controlAt(doc, r, c), 'text0').text.value;
const expr = (name) => ({ isExpression: true, value: name });
const bgOf = (doc, r, c) => layer(controlAt(doc, r, c), 'box0').color;
const fgOf = (doc, r, c) => layer(controlAt(doc, r, c), 'text0').color;
const squareCount = (doc) => Object.values(doc.page.controls).flatMap((row) => Object.keys(row)).length;
const REAL = parse(readFileSync(new URL('./fixtures/speedtest-export.companionconfig', import.meta.url), 'utf8'));

// The 3 by 5 test panel with only (3,3) blank: 15 key squares, the last two belonging to one Take Cell.
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

test('a source cell becomes one button bound to its row and column', () => {
  const doc = generatePage(panelOf([{ r: 2, c: 3, kind: 'source', n: 0 }]), 'conn123');
  const btn = controlAt(doc, 2, 3);
  assert.ok(btn);
  assert.deepEqual(btn.steps[0].action_sets.down[0].options, pressOf(2, 3, 'down'));
});

test('a full grid gives one button per key square and matches the golden page', () => {
  const doc = generatePage(panelOf(FULL), 'conn123', { label: 'sode' });
  assert.equal(squareCount(doc), 15);
  const file = new URL('./golden/speedtest-page.json', import.meta.url);
  if (process.env.UPDATE_GOLDEN) writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), JSON.parse(readFileSync(file, 'utf8')));
});

test('every generated action names the given connection', () => {
  const doc = generatePage(panelOf(FULL), 'abc-999');
  let seen = 0;
  for (const row of Object.values(doc.page.controls)) {
    for (const btn of Object.values(row)) {
      const refs = Object.values(btn.steps).flatMap((s) => [...s.action_sets.down, ...s.action_sets.up]);
      assert.equal(refs.length, 2);
      for (const ref of refs) assert.equal(ref.connectionId, 'abc-999');
      seen++;
    }
  }
  assert.equal(seen, 15);
  assert.deepEqual(Object.keys(doc.instances), ['abc-999']);
});

test('Cells with no Source, Destination or Preset and squares with no Cell still get a bound blank button', () => {
  const doc = generatePage(
    panelOf(
      [
        { r: 1, c: 1, kind: 'source' },
        { r: 1, c: 2, kind: 'destination' },
        { r: 1, c: 3, kind: 'preset', scope: 'everyone' },
        { r: 1, c: 4, kind: 'source', n: 0 },
      ],
      { rows: 2, cols: 4 },
    ),
    'c',
    { label: 'sode' },
  );
  assert.equal(squareCount(doc), 8);
  for (const [r, c] of [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 2],
  ]) {
    const btn = controlAt(doc, r, c);
    assert.deepEqual(bgOf(doc, r, c), expr(`$(sode:key_${r}_${c}_bg)`));
    assert.equal(textOf(doc, r, c), `$(sode:key_${r}_${c})`);
    assert.deepEqual(btn.steps[0].action_sets.down[0].options, pressOf(r, c, 'down'));
    assert.deepEqual(btn.steps[0].action_sets.up[0].options, pressOf(r, c, 'up'));
  }
});

test('a panel smaller than the Companion grid emits only its own squares', () => {
  const doc = generatePage(panelOf([], { rows: 2, cols: 3 }), 'c');
  assert.equal(squareCount(doc), 6);
  assert.deepEqual(doc.page.gridSize, { minColumn: 0, maxColumn: 7, minRow: 0, maxRow: 3 });
  assert.equal(controlAt(doc, 3, 1), undefined);
  assert.equal(controlAt(doc, 1, 4), undefined);
  assert.ok(controlAt(doc, 2, 3));
});

test('a panel with no squares emits no buttons', () => {
  assert.equal(squareCount(generatePage(panelOf([], { rows: 0, cols: 0 }), 'c')), 0);
});

test('a panel larger than the Companion grid keeps the squares that fit and does not fail', () => {
  const cells = [];
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 9; c++) cells.push({ r, c, kind: 'source', n: r * 10 + c });
  const doc = generatePage(panelOf(cells, { rows: 5, cols: 9 }), 'c');
  assert.deepEqual(doc.page.gridSize, { minColumn: 0, maxColumn: 7, minRow: 0, maxRow: 3 });
  assert.equal(Object.keys(doc.page.controls).length, 4);
  for (const row of Object.values(doc.page.controls)) assert.equal(Object.keys(row).length, 8);
  assert.equal(controlAt(doc, 5, 1), undefined);
  assert.equal(controlAt(doc, 1, 9), undefined);
  assert.ok(controlAt(doc, 4, 8));
});

test('a merged Cell has a button on every square and each presses its own row and column', () => {
  const doc = generatePage(panelOf([{ r: 1, c: 1, kind: 'take', rs: 2, cs: 2 }], { rows: 2, cols: 2 }), 'c', { label: 'sode' });
  assert.equal(squareCount(doc), 4);
  for (const [r, c] of [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ]) {
    assert.deepEqual(controlAt(doc, r, c).steps[0].action_sets.down[0].options, pressOf(r, c, 'down'));
    // The runtime fills this variable: text on the root square, empty on the others.
    assert.equal(textOf(doc, r, c), `$(sode:key_${r}_${c})`);
  }
});

test('a merged Cell cut by the grid edge keeps the squares inside it', () => {
  const doc = generatePage(panelOf([{ r: 1, c: 2, kind: 'take', cs: 2 }], { rows: 1, cols: 3 }), 'c', { grid: { rows: 1, cols: 2 } });
  // Panel 1 by 3 in a 1 by 2 grid: the Take's second square at column 3 is cut, column 1 is blank.
  assert.deepEqual(Object.keys(doc.page.controls[0]), ['0', '1']);
  assert.deepEqual(bgOf(doc, 1, 1), expr('$(c:key_1_1_bg)'));
  assert.deepEqual(bgOf(doc, 1, 2), expr('$(c:key_1_2_bg)'));
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
  const made = controlAt(generatePage(panelOf([{ r: 1, c: 2, kind: 'source', n: 0 }]), 'c', { label: 'sode' }), 1, 2);
  assert.deepEqual(Object.keys(made), Object.keys(real));
  assert.equal(made.type, real.type);
  assert.deepEqual(
    made.style.layers.map((l) => l.id),
    real.style.layers.map((l) => l.id),
  );
  for (const [i, l] of real.style.layers.entries()) {
    const got = made.style.layers[i];
    assert.deepEqual(Object.keys(got), Object.keys(l), l.id);
    for (const k of ['name', 'usage', 'type', 'pinnedProperties']) assert.deepEqual(got[k], l[k], `${l.id}.${k}`);
    // Colours are expressions here and plain numbers in the export; only that one field differs in shape.
    const plain = structuredClone(got);
    if (l.id === 'box0' || l.id === 'text0') {
      assert.equal(got.color.isExpression, true, `${l.id}.color`);
      assert.equal(typeof got.color.value, 'string', `${l.id}.color`);
      plain.color = l.color;
    }
    assert.deepEqual(shapeOf(plain), shapeOf(l), l.id);
  }
  assert.deepEqual(shapeOf(made.options), shapeOf(real.options));
  assert.deepEqual(Object.keys(made.steps), Object.keys(real.steps));
  assert.deepEqual(shapeOf(made.steps[0].options), shapeOf(real.steps[0].options));
  assert.deepEqual(Object.keys(made.steps[0].action_sets), Object.keys(real.steps[0].action_sets));
  assert.deepEqual(made.localVariables, real.localVariables);
});

test('the page file has the real export wrapper and gridSize, with controls keyed from "0"', () => {
  const doc = generatePage(panelOf(FULL), 'c', { label: 'sode' });
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
  assert.equal(doc.page.name, 'Speedtest');
  assert.deepEqual(doc.page.gridSize, REAL.page.gridSize);
  assert.deepEqual(Object.keys(doc.page.controls), ['0', '1', '2']);
  assert.deepEqual(Object.keys(doc.page.controls[0]), ['0', '1', '2', '3', '4']);
  assert.deepEqual(shapeOf(doc.oldPageNumber), shapeOf(REAL.oldPageNumber));
});

test('the instances entry is a sode-panels connection with the given id and label and no secrets', () => {
  const doc = generatePage(panelOf(FULL), 'conn123', { label: 'sode', connection: { host: 'sode.local', port: 8080, tls: false } });
  const [inst] = Object.values(doc.instances);
  assert.deepEqual(Object.keys(doc.instances), ['conn123']);
  assert.deepEqual(Object.keys(inst), Object.keys(Object.values(REAL.instances)[0]));
  assert.equal(inst.moduleInstanceType, 'connection');
  assert.equal(inst.moduleId, 'sode-panels');
  assert.equal(inst.label, 'sode');
  assert.deepEqual(inst.secrets, {});
  assert.deepEqual(inst.config, { host: 'sode.local', port: 8080, tls: false, panel: 'speedtest' });
});

test('the generated YAML parses back to the same page and reads like the export', () => {
  const doc = generatePage(panelOf(FULL), 'conn123', { label: 'sode' });
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
  const doc = generatePage(panelOf(FULL), 'c', { label: 'sode' });
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
  const doc = generatePage(panelOf(FULL), 'c');
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
  const doc = generatePage({ ...sodePanel, slug: 'speedtest' }, 'c', { label: 'sode' });
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
        const fields = [layer(btn, 'text0').text.value, layer(btn, 'text0').color.value, layer(btn, 'box0').color.value];
        for (const f of fields) {
          for (const [, ref] of f.matchAll(/\$\(sode:([^)]+)\)/g)) {
            assert.ok(ref in defs, `${ref} is not defined`);
            assert.ok(ref in values, `${ref} has no value`);
            read++;
          }
        }
      }
    }
    assert.equal(read, 45);
  } finally {
    rt.stop();
    await fake.close();
  }
});
