// Browser entry for the page generator. Bundled by scripts/build-web.js into docs/generator/generator.js.
/* global document */
import { stringify } from 'yaml';
import { generatePage, MAX_GRID } from '../src/generator/index.js';
import manifest from '../companion/manifest.json' with { type: 'json' };

// Same placeholder as templates/: Companion asks which connection to bind on import.
const CONNECTION_ID = 'sode-panels';
const LABEL = 'Sode panels';

const $ = (id) => document.getElementById(id);
const rows = $('rows');
const cols = $('cols');
const error = $('error');

rows.max = cols.max = String(MAX_GRID);

$('form').addEventListener('submit', (event) => {
  event.preventDefault();
  error.textContent = '';
  try {
    const doc = generatePage({ rows: Number(rows.value), cols: Number(cols.value) }, CONNECTION_ID, {
      label: LABEL,
      connection: {},
      moduleVersion: manifest.version,
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([stringify(doc)], { type: 'application/octet-stream' }));
    link.download = `sode-${rows.value}x${cols.value}.companionconfig`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    error.textContent = e instanceof RangeError ? e.message : 'Could not build the page.';
  }
});
