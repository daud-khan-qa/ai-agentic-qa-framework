/**
 * Example: wiring the driver + hydration-wait logic into an
 * "observe -> act -> verify" loop an LLM agent can drive.
 *
 * This file intentionally does NOT hardcode a specific LLM provider -
 * `decideNextAction` is a stub you'd replace with a real model call
 * (Claude, GPT, Gemini, etc.) that receives the observation and returns
 * a structured action.
 */

const { launchBrowser } = require('./cdp-driver');
const { goAndSettle } = require('./hydration-wait');

/**
 * Replace this with a real LLM call. The contract:
 *   input:  { text, screenshotPath, url, step }
 *   output: { action: 'click'|'verify'|'done', selectorExpr?, note? }
 */
async function decideNextAction(observation) {
  // Placeholder logic - a real implementation would send `observation`
  // to an LLM with the test's goal and let it choose the next action.
  return { action: 'done', note: 'stub - wire up your model call here' };
}

async function runAgentTest({ url, goal, maxSteps = 12 }) {
  const browser = await launchBrowser();
  const page = browser.newPage();
  const trace = [];

  const load = await goAndSettle(page, url);
  if (load.status === 'LOAD-FAILED') {
    await browser.close();
    // Report as an infrastructure/load problem, NOT a product finding.
    // Conflating these two is the most common cause of noisy AI QA output.
    return { verdict: 'LOAD-FAILED', trace, bodyLength: load.bodyLength };
  }

  for (let step = 0; step < maxSteps; step++) {
    const text = await page.evaluate('document.body.innerText.slice(0, 4000)');
    const screenshotPath = `./step-${step}.jpg`;
    await page.screenshot({ path: screenshotPath });

    const observation = { text, screenshotPath, url, step, goal };
    const decision = await decideNextAction(observation);
    trace.push({ step, decision });

    if (decision.action === 'done') break;
    if (decision.action === 'click' && decision.selectorExpr) {
      const clicked = await page.click(decision.selectorExpr);
      if (!clicked) {
        // Element genuinely absent after a settled load = a real finding,
        // not a timing artifact - safe to report as such.
        trace.push({ step, note: 'ELEMENT-ABSENT after settled load' });
        break;
      }
      // Re-settle after any state-changing click (modal open, route change).
      await goAndSettle(page, page.url ? page.url() : url);
    }
  }

  await browser.close();
  return { verdict: 'COMPLETED', trace };
}

module.exports = { runAgentTest };
