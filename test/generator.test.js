import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { generatePage } from '../src/generator/index.js';
import { actionDefinitions, feedbackDefinitions } from '../src/surface.js';

const panelOf = (cells, over = {}) => ({ id: 'p-1', name: 'Speedtest', slug: 'speedtest', acts: 'api', rows: 3, cols: 5, cells, rev: 1, ...over });
const controlAt = (page, r, c) => page.controls?.[r]?.[c];
const textOf = (page, r, c) => controlAt(page, r, c).style.layers.find((l) => l.id === 'text').text;

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

test('a source cell becomes one button bound to its row and column', () => {
  const page = generatePage(panelOf([{ r: 2, c: 3, kind: 'source', n: 0 }]), 'conn123');
  const btn = controlAt(page, 2, 3);
  assert.ok(btn);
  assert.equal(Object.keys(page.controls).length, 1);
  assert.equal(Object.keys(page.controls[2]).length, 1);
  assert.deepEqual(btn.steps[0].action_sets.down[0].options, { row: 2, col: 3, event: 'down' });
});

test('a full grid gives one button per key square and matches the golden page', () => {
  const page = generatePage(panelOf(FULL), 'conn123', { label: 'sode' });
  const squares = Object.values(page.controls).flatMap((row) => Object.keys(row));
  assert.equal(squares.length, 14);
  const file = new URL('./golden/speedtest-page.json', import.meta.url);
  if (process.env.UPDATE_GOLDEN) writeFileSync(file, JSON.stringify(page, null, 2) + '\n');
  assert.deepEqual(JSON.parse(JSON.stringify(page)), JSON.parse(readFileSync(file, 'utf8')));
});

test('every generated action and feedback names the given connection', () => {
  const page = generatePage(panelOf(FULL), 'abc-999');
  let seen = 0;
  for (const row of Object.values(page.controls)) {
    for (const btn of Object.values(row)) {
      const refs = [...btn.feedbacks, ...Object.values(btn.steps).flatMap((s) => [...s.action_sets.down, ...s.action_sets.up])];
      assert.equal(refs.length, 3);
      for (const ref of refs) assert.equal(ref.connectionId, 'abc-999');
      seen++;
    }
  }
  assert.equal(seen, 14);
});

test('Cells with no Source, Destination or Preset are left out', () => {
  const page = generatePage(
    panelOf([
      { r: 1, c: 1, kind: 'source' },
      { r: 1, c: 2, kind: 'destination' },
      { r: 1, c: 3, kind: 'preset', scope: 'everyone' },
      { r: 1, c: 4, kind: 'source', n: 0 },
    ]),
    'c',
  );
  assert.deepEqual(Object.keys(page.controls), ['1']);
  assert.deepEqual(Object.keys(page.controls[1]), ['4']);
});

test('a panel larger than the Companion grid keeps the squares that fit and does not fail', () => {
  const cells = [];
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 9; c++) cells.push({ r, c, kind: 'source', n: r * 10 + c });
  const page = generatePage(panelOf(cells, { rows: 5, cols: 9 }), 'c');
  assert.deepEqual(page.gridSize, { rows: 4, columns: 8 });
  assert.equal(Object.keys(page.controls).length, 4);
  for (const row of Object.values(page.controls)) assert.equal(Object.keys(row).length, 8);
  assert.equal(controlAt(page, 5, 1), undefined);
  assert.equal(controlAt(page, 1, 9), undefined);
  assert.ok(controlAt(page, 4, 8));
});

test('a merged Cell has a button on every square and each presses its own row and column', () => {
  const page = generatePage(panelOf([{ r: 1, c: 1, kind: 'take', rs: 2, cs: 2 }]), 'c', { label: 'sode' });
  assert.equal(Object.values(page.controls).flatMap((row) => Object.keys(row)).length, 4);
  for (const [r, c] of [[1, 1], [1, 2], [2, 1], [2, 2]]) {
    assert.deepEqual(controlAt(page, r, c).steps[0].action_sets.down[0].options, { row: r, col: c, event: 'down' });
    // The runtime fills this variable: text on the root square, empty on the others.
    assert.equal(textOf(page, r, c), `$(sode:key_${r}_${c})`);
  }
});

test('a merged Cell cut by the grid edge keeps the squares inside it', () => {
  const page = generatePage(panelOf([{ r: 1, c: 2, kind: 'take', cs: 2 }], { rows: 1, cols: 3 }), 'c', { grid: { rows: 1, cols: 2 } });
  assert.deepEqual(Object.keys(page.controls[1]), ['2']);
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
    assert.ok(choices.includes(ref.options.event));
  }
  assert.deepEqual([down[0].options.event, up[0].options.event], ['down', 'up']);
  assert.ok(btn.feedbacks[0].definitionId in feedbacks);
});
