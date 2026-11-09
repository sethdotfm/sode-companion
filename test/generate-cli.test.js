import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const SCRIPT = new URL('../scripts/generate.js', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'sode-gen-'));
after(() => rmSync(dir, { recursive: true, force: true }));

// The child sees none of our environment, so nothing secret can reach it.
const run = (args) =>
  new Promise((done) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH } }, (error, stdout, stderr) =>
      done({ code: error ? error.code : 0, stdout, stderr }),
    );
  });

const base = (out, extra = []) => ['--label', 'panels', '--connection-id', 'abc123', '--out', out, ...extra];
const buttons = (doc) => Object.values(doc.page.controls).flatMap((row) => Object.keys(row)).length;

test('it writes a 4 by 8 page by default, bound to the given connection', async () => {
  const out = join(dir, 'default.companionconfig');
  const res = await run(base(out, ['--host', 'localhost', '--port', '8081']));
  assert.equal(res.code, 0);
  const doc = parse(readFileSync(out, 'utf8'));
  assert.equal(doc.type, 'page');
  assert.equal(buttons(doc), 32);
  const [id] = Object.keys(doc.instances);
  assert.equal(id, 'abc123');
  assert.equal(doc.instances[id].label, 'panels');
  assert.deepEqual(doc.instances[id].config, { host: 'localhost', port: 8081 });
  assert.deepEqual(doc.instances[id].secrets, {});
});

test('--rows and --cols set the size and --tls is written', async () => {
  const out = join(dir, 'size.companionconfig');
  const res = await run(base(out, ['--rows', '2', '--cols', '3', '--tls']));
  assert.equal(res.code, 0);
  const doc = parse(readFileSync(out, 'utf8'));
  assert.equal(buttons(doc), 6);
  assert.deepEqual(Object.values(doc.instances)[0].config, { tls: true });
});

test('two runs write identical bytes', async () => {
  const a = join(dir, 'a.companionconfig');
  const b = join(dir, 'b.companionconfig');
  await run(base(a, ['--host', 'h', '--port', '1']));
  await run(base(b, ['--host', 'h', '--port', '1']));
  assert.ok(readFileSync(a).equals(readFileSync(b)));
});

test('bad input exits non-zero with a message and writes no file', async () => {
  const cases = [
    [['--rows', '0'], /rows must be/],
    [['--cols', 'x'], /cols must be/],
    [['--rows', '99'], /rows must be/],
    [['--rows', '2.5'], /rows must be/],
    [['--port', '70000'], /--port/],
    [['--bogus'], /bogus/],
  ];
  for (const [extra, message] of cases) {
    const out = join(dir, 'bad.companionconfig');
    const res = await run(base(out, extra));
    assert.notEqual(res.code, 0, extra.join(' '));
    assert.match(res.stderr, message);
    assert.ok(!existsSync(out));
  }
  for (const flag of ['--label', '--connection-id', '--out']) {
    const args = base(join(dir, 'missing.companionconfig'));
    args.splice(args.indexOf(flag), 2);
    const res = await run(args);
    assert.notEqual(res.code, 0, flag);
    assert.match(res.stderr, new RegExp(`${flag} is required`));
  }
  assert.ok(!existsSync(join(dir, 'missing.companionconfig')));
});
