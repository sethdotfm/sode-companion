import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { startFakeSode, panelOf, KEY } from './fake-sode.js';

// Servers still open when an assertion throws would hold the process; after() closes them.
const open = [];
const serve = async (opts) => {
  const fake = await startFakeSode(opts);
  open.push(fake);
  return fake;
};
after(() => Promise.all(open.map((f) => f.close())));

const SCRIPT = new URL('../scripts/generate.js', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'sode-gen-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const CELLS = [
  { r: 1, c: 1, kind: 'source', n: 0 },
  { r: 2, c: 1, kind: 'destination', n: 0 },
  { r: 3, c: 4, kind: 'take', cs: 2 },
];

// The key reaches the command only through the environment; the child sees nothing else of ours.
const run = (args, env = { SODE_KEY: KEY }) =>
  new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env } }, (error, stdout, stderr) =>
      done({ code: error ? error.code : 0, stdout, stderr }),
    );
  });

const argsFor = (fake, out, extra = []) => [
  '--host',
  '127.0.0.1',
  '--port',
  String(fake.port),
  '--panel',
  'speedtest',
  '--out',
  out,
  ...extra,
];
const bare = KEY.slice('sode_'.length);
// assert.ok shows no operands on failure, so a leaked key is not printed by the test either.
const noKey = (text) => assert.ok(!text.includes(bare));

test('it reads the panel and writes an importable page file, never printing the key', async () => {
  const fake = await serve({ panel: panelOf(CELLS) });
  const out = join(dir, 'ok.companionconfig');
  const res = await run(argsFor(fake, out, ['--label', 'sode']));
  await fake.close();
  assert.equal(res.code, 0);
  assert.ok(existsSync(out));
  const doc = parse(readFileSync(out, 'utf8'));
  assert.equal(doc.type, 'page');
  assert.equal(doc.page.name, 'Test panel');
  assert.deepEqual(Object.keys(doc.page.controls), ['0', '1', '2']);
  assert.deepEqual(Object.keys(doc.page.controls[2]), ['0', '1', '2', '3', '4']);
  const [inst] = Object.values(doc.instances);
  assert.equal(inst.moduleId, 'sode-panels');
  assert.equal(inst.label, 'sode');
  assert.deepEqual(inst.secrets, {});
  assert.equal(inst.config.panel, 'speedtest');
  assert.equal(inst.config.host, '127.0.0.1');
  noKey(res.stdout);
  noKey(res.stderr);
  noKey(readFileSync(out, 'utf8'));
  assert.ok(fake.requests.every((r) => r.auth === `Bearer ${KEY}`));
});

test('a key shown without the sode_ prefix gets the prefix', async () => {
  const fake = await serve({ panel: panelOf(CELLS) });
  const out = join(dir, 'bare.companionconfig');
  const res = await run(argsFor(fake, out), { SODE_KEY: bare });
  await fake.close();
  assert.equal(res.code, 0);
  assert.ok(fake.requests.length > 0);
  assert.ok(fake.requests.every((r) => r.auth === `Bearer ${KEY}`));
});

test('an unreachable Sode fails with a clear message and writes no file', async () => {
  const fake = await serve({ panel: panelOf(CELLS) });
  const args = argsFor(fake, join(dir, 'down.companionconfig'));
  await fake.close();
  const res = await run(args);
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /did not answer/);
  assert.ok(!existsSync(join(dir, 'down.companionconfig')));
  noKey(res.stdout + res.stderr);
});

test('a refused key fails with a clear message and writes no file', async () => {
  const fake = await serve({ panel: panelOf(CELLS), refuse: { status: 401, code: 'invalid_key' } });
  const out = join(dir, 'refused.companionconfig');
  const res = await run(argsFor(fake, out));
  await fake.close();
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /refused the key/);
  assert.ok(!existsSync(out));
  noKey(res.stdout + res.stderr);
});

test('a panel that acts as a user is refused with no file', async () => {
  const fake = await serve({ panel: panelOf(CELLS, { acts: 'user' }) });
  const out = join(dir, 'session.companionconfig');
  const res = await run(argsFor(fake, out));
  await fake.close();
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /acts as a user/);
  assert.ok(!existsSync(out));
});

test('a panel with unassigned Cells still writes a button for every square', async () => {
  const fake = await serve({ panel: panelOf([{ r: 1, c: 1, kind: 'source' }]) });
  const out = join(dir, 'unassigned.companionconfig');
  const res = await run(argsFor(fake, out));
  await fake.close();
  assert.equal(res.code, 0);
  assert.match(res.stdout, /15 buttons/);
  assert.equal(Object.values(parse(readFileSync(out, 'utf8')).page.controls).flatMap((row) => Object.keys(row)).length, 15);
});

test('a panel with no squares at all writes no file', async () => {
  const fake = await serve({ panel: panelOf([], { rows: 0, cols: 0 }) });
  const out = join(dir, 'empty.companionconfig');
  const res = await run(argsFor(fake, out));
  await fake.close();
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /no key squares/);
  assert.ok(!existsSync(out));
});

test('a key on the command line is refused without echoing it and nothing is read or written', async () => {
  const fake = await serve({ panel: panelOf(CELLS) });
  const out = join(dir, 'argv.companionconfig');
  for (const extra of [['--key', KEY], [`--key=${KEY}`], [KEY]]) {
    const res = await run(argsFor(fake, out, extra));
    assert.notEqual(res.code, 0);
    assert.match(res.stderr, /SODE_KEY/);
    noKey(res.stdout + res.stderr);
  }
  await fake.close();
  assert.equal(fake.requests.length, 0);
  assert.ok(!existsSync(out));
});

test('a missing SODE_KEY fails before any request', async () => {
  const fake = await serve({ panel: panelOf(CELLS) });
  const out = join(dir, 'nokey.companionconfig');
  const res = await run(argsFor(fake, out), {});
  await fake.close();
  assert.notEqual(res.code, 0);
  assert.match(res.stderr, /SODE_KEY/);
  assert.equal(fake.requests.length, 0);
  assert.ok(!existsSync(out));
});
