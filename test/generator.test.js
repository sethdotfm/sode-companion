import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { generatePage } from '../src/generator/index.js';
import { actionDefinitions, feedbackDefinitions, COLOURS } from '../src/surface.js';

const panelOf = (cells, over = {}) => ({ id: 'p-1', name: 'Speedtest', slug: 'speedtest', acts: 'api', rows: 3, cols: 5, cells, rev: 1, ...over });
// Companion keys controls by row then column as strings from 0; the Bound position counts from 1.
const controlAt = (doc, r, c) => doc.page.controls?.[r - 1]?.[c - 1];
const layer = (btn, id) => btn.style.layers.find((l) => l.id === id);
const textOf = (doc, r, c) => layer(controlAt(doc, r, c), 'text0').text.value;
const squareCount = (doc) => Object.values(doc.page.controls).flatMap((row) => Object.keys(row)).length;
const REAL = parse(readFileSync(new URL('./fixtures/speedtest-export.companionconfig', import.meta.url), 'utf8'));

// The 3 by 5 test panel with only (3,3) empty: 14 key squares, the last two belonging to one Take Cell.
const FULL = [
  ...[1, 2, 3, 4].map((c) => ({ r: 1, c, kind: 'source', n: c - 1 })),
  ...[1, 2, 3, 4].map((c) => ({ r: 2, c, kind: 'destination', n: c - 1 })),
  { r: 1, c: 5, kind: 'clear' },
  { r: 2, c: 5, kind: 'current' },
  { r: 3, c: 1, kind: 'preset', scope: 'everyone', name: 'Opening' },
  { r: 3, c: 2, kind: 'preset', scope: 'me', name: 'Close' },
  { r: 3, c: 4, kind: 'take', cs: 2 },
];

const pressOf = (r, c, event) => ({ row: { value: r, isExpression: false }, col: { value: c, isExpression: false }, event: { value: event, isExpression: false } });

test('a source cell becomes one button bound to its row and column', () => {
  const doc = generatePage(panelOf([{ r: 2, c: 3, kind: 'source', n: 0 }]), 'conn123');
  const btn = controlAt(doc, 2, 3);
  assert.ok(btn);
  assert.deepEqual(Object.keys(doc.page.controls), ['1']);
  assert.deepEqual(Object.keys(doc.page.controls[1]), ['2']);
  assert.deepEqual(btn.steps[0].action_sets.down[0].options, pressOf(2, 3, 'down'));
});

test('a full grid gives one button per key square and matches the golden page', () => {
  const doc = generatePage(panelOf(FULL), 'conn123', { label: 'sode' });
  assert.equal(squareCount(doc), 14);
  const file = new URL('./golden/speedtest-page.json', import.meta.url);
  if (process.env.UPDATE_GOLDEN) writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  assert.deepEqual(JSON.parse(JSON.stringify(doc)), JSON.parse(readFileSync(file, 'utf8')));
});

test('every generated action and feedback names the given connection', () => {
  const doc = generatePage(panelOf(FULL), 'abc-999');
  let seen = 0;
  for (const row of Object.values(doc.page.controls)) {
    for (const btn of Object.values(row)) {
      const refs = [...btn.feedbacks, ...Object.values(btn.steps).flatMap((s) => [...s.action_sets.down, ...s.action_sets.up])];
      assert.equal(refs.length, 3);
      for (const ref of refs) assert.equal(ref.connectionId, 'abc-999');
      seen++;
    }
  }
  assert.equal(seen, 14);
  assert.deepEqual(Object.keys(doc.instances), ['abc-999']);
});

test('Cells with no Source, Destination or Preset are left out', () => {
  const doc = generatePage(
    panelOf([
      { r: 1, c: 1, kind: 'source' },
      { r: 1, c: 2, kind: 'destination' },
      { r: 1, c: 3, kind: 'preset', scope: 'everyone' },
      { r: 1, c: 4, kind: 'source', n: 0 },
    ]),
    'c',
  );
  assert.deepEqual(Object.keys(doc.page.controls), ['0']);
  assert.deepEqual(Object.keys(doc.page.controls[0]), ['3']);
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
  const doc = generatePage(panelOf([{ r: 1, c: 1, kind: 'take', rs: 2, cs: 2 }]), 'c', { label: 'sode' });
  assert.equal(squareCount(doc), 4);
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
    assert.deepEqual(controlAt(doc, r, c).steps[0].action_sets.down[0].options, pressOf(r, c, 'down'));
    // The runtime fills this variable: text on the root square, empty on the others.
    assert.equal(textOf(doc, r, c), `$(sode:key_${r}_${c})`);
  }
});

test('a merged Cell cut by the grid edge keeps the squares inside it', () => {
  const doc = generatePage(panelOf([{ r: 1, c: 2, kind: 'take', cs: 2 }], { rows: 1, cols: 3 }), 'c', { grid: { rows: 1, cols: 2 } });
  assert.deepEqual(Object.keys(doc.page.controls[0]), ['1']);
});

// Leaves become their type; the {value, isExpression} wrapper stays so a bare value where Companion wraps one fails.
const shapeOf = (v) => (Array.isArray(v) ? v.map(shapeOf) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)])) : v === null ? 'null' : typeof v);

test('a generated button has the real export layer set, keys and wrapped values', () => {
  const real = REAL.page.controls[0][1];
  const made = controlAt(generatePage(panelOf([{ r: 1, c: 2, kind: 'source', n: 0 }]), 'c', { label: 'sode' }), 1, 2);
  assert.deepEqual(Object.keys(made), Object.keys(real));
  assert.equal(made.type, real.type);
  assert.deepEqual(made.style.layers.map((l) => l.id), real.style.layers.map((l) => l.id));
  for (const [i, l] of real.style.layers.entries()) {
    const got = made.style.layers[i];
    assert.deepEqual(Object.keys(got), Object.keys(l), l.id);
    for (const k of ['name', 'usage', 'type', 'pinnedProperties']) assert.deepEqual(got[k], l[k], `${l.id}.${k}`);
    assert.deepEqual(shapeOf(got), shapeOf(l), l.id);
  }
  assert.deepEqual(shapeOf(made.options), shapeOf(real.options));
  assert.deepEqual(Object.keys(made.steps), Object.keys(real.steps));
  assert.deepEqual(shapeOf(made.steps[0].options), shapeOf(real.steps[0].options));
  assert.deepEqual(Object.keys(made.steps[0].action_sets), Object.keys(real.steps[0].action_sets));
  assert.deepEqual(made.localVariables, real.localVariables);
});

test('the page file has the real export wrapper and gridSize, with controls keyed from "0"', () => {
  const doc = generatePage(panelOf(FULL), 'c', { label: 'sode' });
  for (const k of ['version', 'type', 'companionBuild', 'page', 'instances', 'connectionCollections', 'oldPageNumber', 'imageLibrary', 'imageLibraryCollections']) assert.ok(k in doc, k);
  assert.deepEqual(Object.keys(doc), Object.keys(REAL).filter((k) => k in doc || k === 'companionBuild'));
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
  assert.equal(COLOURS['take-armed'], 0xf2b84b);
  assert.equal(COLOURS['result-failed'], 0xf0605a);
});

test('default backgrounds are the module colours for each Cell kind', () => {
  const doc = generatePage(panelOf(FULL), 'c');
  const bg = (r, c) => layer(controlAt(doc, r, c), 'box0').color.value;
  assert.equal(bg(1, 1), COLOURS.source);
  assert.equal(bg(2, 1), COLOURS.destination);
  assert.equal(bg(3, 1), COLOURS.preset);
  assert.equal(bg(1, 5), COLOURS.clear);
  assert.equal(bg(2, 5), COLOURS.current);
  assert.equal(bg(3, 4), COLOURS.take);
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

test('generated buttons use the one press action and the look feedback the module defines', () => {
  const actions = actionDefinitions(() => null);
  const feedbacks = feedbackDefinitions(() => null);
  const choices = actions.press.options.find((o) => o.id === 'event').choices.map((x) => x.id);
  const btn = controlAt(generatePage(panelOf([{ r: 1, c: 1, kind: 'source', n: 0 }]), 'c'), 1, 1);
  const { down, up } = btn.steps[0].action_sets;
  for (const ref of [...down, ...up]) {
    assert.ok(ref.definitionId in actions);
    assert.ok(choices.includes(ref.options.event.value));
  }
  assert.deepEqual([down[0].options.event.value, up[0].options.event.value], ['down', 'up']);
  assert.ok(btn.feedbacks[0].definitionId in feedbacks);
  assert.deepEqual(btn.feedbacks[0].options, { row: { value: 1, isExpression: false }, col: { value: 1, isExpression: false } });
});
