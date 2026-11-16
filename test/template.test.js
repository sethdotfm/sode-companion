import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { generatePage } from '../src/generator/index.js';
import { TEMPLATES } from '../src/main.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const { version } = JSON.parse(read('../companion/manifest.json'));

// Regenerate with: npm run generate -- --rows <n> --cols <m> --label "Sode panels" --connection-id sode-panels --out templates/<file>
for (const { file, rows, cols } of TEMPLATES)
  test(`the committed ${rows}x${cols} template matches the Generator and the module version`, () => {
    const doc = generatePage({ rows, cols }, 'sode-panels', { label: 'Sode panels', connection: {}, moduleVersion: version });
    assert.equal(read(`../templates/${file}`), stringify(doc));
  });

test('the browser generator bundle is current', async () => {
  const { bundle } = await import('../scripts/build-web.js');
  assert.equal(read('../docs/generator/generator.js'), await bundle(), 'run npm run build-web');
});
