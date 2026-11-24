import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const chromePath = [process.env.TRYON_TEST_CHROME, '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((path) => path && existsSync(path));

export async function waitFor(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

/** 复用项目既有 Chromium/CDP 回归方法，测试真实页面，不安装浏览器或新驱动。 */
export async function openBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'tryon-ui-test-'));
  const process = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--hide-scrollbars', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let socket;
  const pending = new Map();
  const errors = [];
  let nextId = 0;
  async function close() {
    socket?.close();
    process.kill();
    if (process.exitCode === null) await new Promise((resolve) => process.once('exit', resolve));
    for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(new Error('Browser closed')); }
    pending.clear();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
  try {
    let port;
    await waitFor(async () => {
      try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); return Boolean(port); }
      catch { return false; }
    }, 'Chrome debug port');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    socket = new WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timeout);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
    async function evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    let navigation = 0;
    async function goto(url, width = 1440) {
      const target = new URL(url);
      target.searchParams.set('ui-test-navigation', String(++navigation));
      await send('Emulation.setDeviceMetricsOverride', { width, height: width < 620 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 620 });
      await send('Page.navigate', { url: target.href });
      await waitFor(() => evaluate(`location.href === ${JSON.stringify(target.href)} && Boolean(document.querySelector('h1'))`), 'new page heading');
    }
    async function click(selector) {
      const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing click target'); element.scrollIntoView({block:'center',behavior:'instant'}); const r = element.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    }
    async function key(key, code = key) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key === 'Enter' ? '\r' : undefined, unmodifiedText: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 }[key] });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    }
    async function fill(selector, value) {
      await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    }
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    return { evaluate, goto, click, key, fill, send, errors, close };
  } catch (error) {
    await close();
    throw error;
  }
}
