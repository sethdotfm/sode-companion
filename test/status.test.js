import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InstanceStatus } from '@companion-module/base';
import { instanceStatusOf } from '../src/companion-status.js';

test('a refused key, a disallowed network and a Session-mode panel map to three different Companion statuses', () => {
  const of = instanceStatusOf;
  assert.equal(of('connecting'), InstanceStatus.Connecting);
  assert.equal(of('ok'), InstanceStatus.Ok);
  const three = [of('key-refused'), of('network-refused'), of('session-mode')];
  assert.equal(new Set(three).size, 3);
  assert.equal(of('unreachable'), InstanceStatus.ConnectionFailure);
});

test('every failure code the runtime can report has a status', async () => {
  const { FAILURE_CODES } = await import('../src/runtime.js');
  for (const code of FAILURE_CODES) assert.ok(instanceStatusOf(code), `no status for ${code}`);
});
