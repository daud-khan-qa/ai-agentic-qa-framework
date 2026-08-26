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
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIN_BODY_LENGTH = 120; // below this, treat as not-yet-rendered
const STABLE_SAMPLES_REQUIRED = 3;
const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 45; // ~45s ceiling per attempt
const MAX_ATTEMPTS = 4;

async function waitForSettle(page) {
  let lastLength = -1;
  let stableCount = 0;

  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const length = (await page.evaluate('document.body ? document.body.innerText.length : 0')) || 0;

    if (length === lastLength && length > MIN_BODY_LENGTH) {
      stableCount++;
      if (stableCount >= STABLE_SAMPLES_REQUIRED) return length;
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
async function goAndSettle(page, url) {
  let bodyLength = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Bounce through about:blank to force a fresh SPA mount rather than
    // a stale client-side route transition.
    await page.goto('about:blank');
    await sleep(700);
    await page.goto(url);

    bodyLength = await waitForSettle(page);

    if (bodyLength >= MIN_BODY_LENGTH) {
      return { status: 'OK', bodyLength, attempts: attempt };
    }
  }

  return { status: 'LOAD-FAILED', bodyLength, attempts: MAX_ATTEMPTS };
}

module.exports = { goAndSettle, waitForSettle };
