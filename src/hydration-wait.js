/**
 * Reliable page-load detection for modern SPAs.
 *
 * The problem: DOMContentLoaded / a fixed sleep() fires long before a
 * client-rendered app is actually interactive. Depending on network and
 * server load, real hydration can take anywhere from ~2s to ~19s - and a
 * naive fixed wait either wastes time on the fast case or returns an
 * empty/broken capture on the slow case, which an AI agent (or a human)
 * will misreport as "element not found" when the real problem was timing.
 *
 * This module polls document.body.innerText.length until it stabilizes
 * across consecutive samples, and retries the whole navigation via an
 * about:blank bounce (forcing a clean SPA remount) before giving up.
 *
 * Timing is injectable (see DEFAULTS below) so the decision logic can be
 * unit-tested in milliseconds instead of waiting on real timers - see
 * test/hydration-wait.test.js.
 */

const DEFAULTS = {
  minBodyLength: 120, // below this, treat as not-yet-rendered
  stableSamplesRequired: 3,
  pollIntervalMs: 1000,
  maxPolls: 45, // ~45s ceiling per attempt at the default interval
  maxAttempts: 4,
  sleepFn: (ms) => new Promise((r) => setTimeout(r, ms)),
};

async function waitForSettle(page, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let lastLength = -1;
  let stableCount = 0;

  for (let i = 0; i < cfg.maxPolls; i++) {
    await cfg.sleepFn(cfg.pollIntervalMs);
    const length = (await page.evaluate('document.body ? document.body.innerText.length : 0')) || 0;

    if (length === lastLength && length > cfg.minBodyLength) {
      stableCount++;
      if (stableCount >= cfg.stableSamplesRequired) return length;
    } else {
      stableCount = 0;
    }
    lastLength = length;
  }
  return lastLength;
}

/**
 * Navigate and wait for a genuinely settled page.
 * Returns { status: 'OK', bodyLength } or { status: 'LOAD-FAILED', bodyLength, attempts }
 * Never silently returns a half-loaded page as success.
 */
async function goAndSettle(page, url, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  let bodyLength = 0;

  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    // Bounce through about:blank to force a fresh SPA mount rather than
    // a stale client-side route transition.
    await page.goto('about:blank');
    await cfg.sleepFn(700);
    await page.goto(url);

    bodyLength = await waitForSettle(page, cfg);

    if (bodyLength >= cfg.minBodyLength) {
      return { status: 'OK', bodyLength, attempts: attempt };
    }
  }

  return { status: 'LOAD-FAILED', bodyLength, attempts: cfg.maxAttempts };
}

module.exports = { goAndSettle, waitForSettle };
