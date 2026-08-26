/**
 * Minimal Chrome DevTools Protocol driver.
 * No Playwright / Puppeteer dependency - just Node's native fetch + WebSocket.
 * Sanitized/generalized example - not tied to any specific application.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchBrowser({
  chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  port = 9222,
  profileDir = path.join(__dirname, '.cdp-profile-' + Date.now()),
  headless = true,
  windowSize = '1440,2200',
} = {}) {
  const args = [
    headless ? '--headless=new' : '',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--no-first-run',
    `--window-size=${windowSize}`,
  ].filter(Boolean);

  const chromeProcess = spawn(chromePath, args, { stdio: 'ignore' });

  let wsUrl;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = list.find((t) => t.type === 'page');
      if (target) {
        wsUrl = target.webSocketDebuggerUrl;
        break;
      }
    } catch (_) {
      /* Chrome still starting up */
    }
  }
  if (!wsUrl) throw new Error('Chrome did not expose a debuggable page in time');

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => (ws.onopen = resolve));

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });

  await send('Page.enable');
  await send('Runtime.enable');

  return {
    newPage() {
      return {
        async goto(url) {
          await send('Page.navigate', { url });
        },
        async evaluate(expression) {
          const result = await send('Runtime.evaluate', {
            expression: typeof expression === 'function' ? `(${expression})()` : expression,
            returnByValue: true,
          });
          return result.result?.result?.value;
        },
        async screenshot({ path: outPath, quality = 60 } = {}) {
          const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality });
          const buffer = Buffer.from(shot.result.data, 'base64');
          if (outPath) fs.writeFileSync(outPath, buffer);
          return buffer;
        },
        async click(selectorExpr) {
          const box = await this.evaluate(`(function(){
            var el = ${selectorExpr};
            if (!el) return null;
            var r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()`);
          if (!box) return false;
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
          return true;
        },
      };
    },
    async close() {
      ws.close();
      chromeProcess.kill();
      await sleep(500);
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch (_) {}
    },
  };
}

module.exports = { launchBrowser };
