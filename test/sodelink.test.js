import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSodeLink } from '../src/sodelink.js';
import { createRuntime } from '../src/runtime.js';

test('a full link gives host, port, panel, key and instance name', () => {
  assert.deepEqual(parseSodeLink('http://10.0.0.5:8080/panels/speedtest?instance=Studio%20A#key=abc123&kiosk=1'), {
    host: '10.0.0.5',
    port: 8080,
    tls: false,
    panel: 'speedtest',
    key: 'abc123',
    device: 'Studio A',
  });
});

test('https without a port takes 443, http without one takes 80', () => {
  assert.equal(parseSodeLink('https://sode.example.com/panels/p1#key=k').port, 443);
  assert.equal(parseSodeLink('https://sode.example.com/panels/p1#key=k').tls, true);
  assert.equal(parseSodeLink('http://sode.local/panels/p1').port, 80);
});

test('a link without a key or instance leaves them blank', () => {
  const l = parseSodeLink('http://h:1/panels/p1');
  assert.equal(l.key, '');
  assert.equal(l.device, '');
});

test('a path prefix before panels is ignored and an IPv6 host keeps its brackets', () => {
  assert.equal(parseSodeLink('http://h:1/sode/panels/p1').panel, 'p1');
  assert.equal(parseSodeLink('http://[::1]:9/panels/p1').host, '[::1]');
});

test('text that is not a panel link is null', () => {
  for (const t of ['', 'sode.local', 'ftp://h/panels/p', 'http://h:1/', 'http://h:1/panels/']) assert.equal(parseSodeLink(t), null, t);
});

test('a runtime given a bad link fails with bad-link, and a good link needs no other fields', async () => {
  const bad = createRuntime({ link: 'nonsense' });
  await bad.start();
  assert.equal(bad.status().code, 'bad-link');
  const seen = [];
  const good = createRuntime({
    link: 'http://127.0.0.1:1/panels/p#key=k',
    fetch: async (url) => {
      seen.push(String(url));
      throw new Error('down');
    },
    retryMs: 1e9,
  });
  await good.start();
  good.stop();
  assert.ok(seen[0].startsWith('http://127.0.0.1:1/api/v1/'), seen[0]);
});
