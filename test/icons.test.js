import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { iconMarkup } from '../src/icons.js';
import { panelOf } from './fake-sode.js';

const vendorDir = new URL('../src/vendor/lucide/', import.meta.url);

test('an icon: art string resolves to the symbol drawing of the named Lucide icon', () => {
  const markup = iconMarkup('icon:a-arrow-down');
  assert.ok(markup.includes('<path d="M3.5 13h6" />'));
  assert.ok(markup.includes('<path d="m14 12 4 4 4-4" />'));
  assert.ok(!markup.includes('<symbol'));
});

test('art that is not an icon, or names an icon that does not exist, does not resolve', () => {
  assert.equal(iconMarkup(undefined), undefined);
  assert.equal(iconMarkup(''), undefined);
  assert.equal(iconMarkup('3f2a9c10b7'), undefined);
  assert.equal(iconMarkup('icon:'), undefined);
  assert.equal(iconMarkup('icon:Camera'), undefined);
  assert.equal(iconMarkup('icon:no-such-icon'), undefined);
});

// The choices Sode's editor offers (ART_ICONS), one Cell each.
const EDITOR_ICONS = [
  'arrow-right-from-line',
  'arrow-right-to-line',
  'bookmark',
  'zap',
  'eraser',
  'eye',
  'check',
  'equal',
  'x',
  'search',
  'undo-2',
  'redo-2',
  'refresh-cw',
  'rotate-ccw',
  'arrow-left-right',
  'arrow-up-down',
  'arrow-up',
  'arrow-down',
  'arrow-left',
  'arrow-right',
  'plus',
  'minus',
  'combine',
  'split',
  'hand',
  'pointer',
  'video',
  'tv',
  'monitor',
  'camera',
];

test('every icon name a panel uses resolves', () => {
  const panel = panelOf(
    EDITOR_ICONS.map((name, i) => ({ r: 1 + Math.floor(i / 5), c: 1 + (i % 5), kind: 'source', n: 0, art: `icon:${name}` })),
  );
  const missing = panel.cells.filter((cell) => cell.art.startsWith('icon:') && iconMarkup(cell.art) === undefined).map((cell) => cell.art);
  assert.deepEqual(missing, []);
});

test('the copy records the Sode commit, branch and Lucide version, and carries the ISC licence', () => {
  const record = readFileSync(new URL('SOURCE', vendorDir), 'utf8').trim();
  assert.match(record, /^[0-9a-f]{40} \S+ lucide-static v\d+\.\d+\.\d+$/);
  assert.match(readFileSync(new URL('LICENSE-lucide', vendorDir), 'utf8'), /^ISC License/);
});
