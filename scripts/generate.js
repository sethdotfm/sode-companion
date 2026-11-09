// The Generator's command line: writes a Companion page file of N by M universal buttons. It reads nothing from Sode
// and needs no key. The core is src/generator.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { generatePage, MAX_GRID } from '../src/generator/index.js';
import { COMPANION_GRID } from '../src/visible.js';

const USAGE = `Usage: node scripts/generate.js --label <connection label> --connection-id <id> --out <file> [options]
  --rows <n>              default ${COMPANION_GRID.rows}, 1 to ${MAX_GRID}
  --cols <m>              default ${COMPANION_GRID.cols}, 1 to ${MAX_GRID}
  --label <name>          the Companion connection's label (required)
  --connection-id <id>    id of the connection in the file (required)
  --out <file>            where to write the page (required)
  --host <host>           written to the connection's config
  --port <port>           written to the connection's config
  --tls                   written to the connection's config`;

const fail = (message) => {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(1);
};

const OPTIONS = {
  rows: { type: 'string', default: String(COMPANION_GRID.rows) },
  cols: { type: 'string', default: String(COMPANION_GRID.cols) },
  label: { type: 'string' },
  'connection-id': { type: 'string' },
  out: { type: 'string' },
  host: { type: 'string' },
  port: { type: 'string' },
  tls: { type: 'boolean', default: false },
};

let args;
try {
  args = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: false }).values;
} catch (e) {
  fail(e.message);
}

for (const [flag, name] of [
  ['label', '--label'],
  ['connection-id', '--connection-id'],
  ['out', '--out'],
])
  if (!args[flag]) fail(`${name} is required.`);

const whole = (text) => (/^\d+$/.test(text) ? Number(text) : NaN);
const rows = whole(args.rows);
const cols = whole(args.cols);
const connection = {};
if (args.host) connection.host = args.host;
if (args.port !== undefined) {
  const port = whole(args.port);
  if (!(port >= 1 && port <= 65535)) fail('--port must be a number from 1 to 65535.');
  connection.port = port;
}
if (args.tls) connection.tls = true;

const manifest = JSON.parse(readFileSync(new URL('../companion/manifest.json', import.meta.url), 'utf8'));
let doc;
try {
  doc = generatePage({ rows, cols }, args['connection-id'], { label: args.label, connection, moduleVersion: manifest.version });
} catch (e) {
  fail(e instanceof RangeError ? e.message : 'Could not build the page.');
}
writeFileSync(args.out, stringify(doc));
process.stdout.write(
  `Wrote ${args.out}: ${rows} by ${cols} buttons. Import it in Companion, then set the panel and key on the connection.\n`,
);
