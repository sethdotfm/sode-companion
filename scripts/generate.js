// The Generator's command line: reads a panel from Sode and writes a Companion page file. The core is src/generator.
// The key comes from the SODE_KEY environment variable only, and is never printed or written.
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { generatePage } from '../src/generator/index.js';
import { keySquares } from '../src/visible.js';
import { readPanel, ReadFailed } from './read-panel.js';

const USAGE = `Usage: SODE_KEY=<panel key> node scripts/generate.js --host <host> --panel <id or short name> [options]
  --host <host>           Sode host (required)
  --panel <id|slug>       panel id or short name (required)
  --port <port>           default 8080
  --tls                   use https
  --label <name>          the Companion connection's label, default sode
  --connection-id <id>    id of the connection in the file, default the label
  --out <file>            default <panel short name>.companionconfig
The key is read from SODE_KEY only and is not accepted as an argument.`;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const OPTIONS = {
  host: { type: 'string' },
  panel: { type: 'string' },
  port: { type: 'string', default: '8080' },
  tls: { type: 'boolean', default: false },
  label: { type: 'string', default: 'sode' },
  'connection-id': { type: 'string' },
  out: { type: 'string' },
};

// parseArgs errors quote the offending argument, which could be a key, so its message is never shown.
let args;
try {
  args = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: false }).values;
} catch {
  fail(`Unrecognised arguments. The key is read from SODE_KEY only and is not accepted as an argument.\n${USAGE}`);
}

if (!process.env.SODE_KEY?.trim()) fail(`Set SODE_KEY to the panel's API client instance key.\n${USAGE}`);
if (!args.host || !args.panel) fail(`Give --host and --panel.\n${USAGE}`);
const port = Number(args.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port must be a number from 1 to 65535.');

let panel;
try {
  panel = await readPanel({ host: args.host, port, tls: args.tls, panel: args.panel, key: process.env.SODE_KEY });
} catch (e) {
  fail(e instanceof ReadFailed ? e.message : 'Could not read the panel from Sode.');
}

if (!keySquares(panel).length) fail('The panel has no key squares to draw.');

const manifest = JSON.parse(readFileSync(new URL('../companion/manifest.json', import.meta.url), 'utf8'));
const doc = generatePage(panel, args['connection-id'] || args.label, {
  label: args.label,
  connection: { host: args.host, port, tls: args.tls },
  moduleVersion: manifest.version,
});
const out = args.out || `${panel.slug || panel.id}.companionconfig`;
writeFileSync(out, stringify(doc));
process.stdout.write(
  `Wrote ${out}: page "${panel.name}", ${keySquares(panel).length} buttons. Import it in Companion, then set the key on the connection.\n`,
);
