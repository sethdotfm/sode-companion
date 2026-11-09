import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Polls fn on real timers, so it works while a test fakes only setInterval.
export async function until(fn, what, ms = 3000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

// For asserting that something does not happen: a bounded wait is the only way to see an absence.
export const quiet = (ms = 100) => sleep(ms);
