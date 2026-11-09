import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest } from '@companion-module/base/manifest';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test("the manifest passes Companion's own validation and matches the installed API", () => {
  const m = read('../companion/manifest.json');
  validateManifest(m, true);
  assert.equal(m.id, 'sode-panels');
  assert.equal(m.runtime.type, 'node22');
  assert.equal(m.runtime.apiVersion, read('../node_modules/@companion-module/base/package.json').version);
});
