/**
 * Unit tests for the hydration-wait polling/retry logic, using Node's
 * built-in test runner (no extra dependencies to install).
 *
 * Timing is injected via `opts` (see src/hydration-wait.js DEFAULTS) so
 * these tests run in milliseconds against a fake `page`, proving the
 * *decision logic* is correct independent of any real browser/network
 * flakiness or of waiting on real production-scale timeouts.
 */

const test = require('node:test');
const assert = require('node:assert');
const { waitForSettle, goAndSettle } = require('../src/hydration-wait');

const FAST = {
  pollIntervalMs: 0,
  maxPolls: 8,
  maxAttempts: 3,
  sleepFn: () => Promise.resolve(),
};

// A fake page whose innerText length grows for a few polls, then holds
// steady - simulating a real SPA hydrating.
function makeGrowThenStablePage(growthSteps) {
  let calls = 0;
  return {
    async evaluate() {
      calls++;
      const idx = Math.min(calls - 1, growthSteps.length - 1);
      return growthSteps[idx];
    },
    async goto() {},
  };
}

test('waitForSettle returns once length stabilizes above the minimum', async () => {
  // Grows 0 -> 50 -> 200 -> 200 -> 200 -> ... should settle at 200.
  const page = makeGrowThenStablePage([0, 50, 200, 200, 200, 200, 200]);
  const result = await waitForSettle(page, FAST);
  assert.strictEqual(result, 200);
});

test('waitForSettle never reports success below the minimum body length', async () => {
  // Stable, but under the 120-char floor - should exhaust its polls and
  // return the last (too-short) value, never a false "settled" verdict.
  const page = makeGrowThenStablePage([50, 50, 50]);
  const result = await waitForSettle(page, FAST);
  assert.ok(result < 120, 'a too-short body should not be reported as a real load');
});

test('goAndSettle reports LOAD-FAILED after exhausting retries, not a false OK', async () => {
  // Page that never grows past an empty shell, across every attempt.
  const page = {
    async evaluate() {
      return 0;
    },
    async goto() {},
  };
  const result = await goAndSettle(page, 'https://example.invalid/never-loads', FAST);
  assert.strictEqual(result.status, 'LOAD-FAILED');
});

test('goAndSettle reports OK once content is present and stable', async () => {
  const page = makeGrowThenStablePage([0, 300, 300, 300]);
  const result = await goAndSettle(page, 'https://example.invalid/loads-fine', FAST);
  assert.strictEqual(result.status, 'OK');
  assert.ok(result.bodyLength >= 120);
});
