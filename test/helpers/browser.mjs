import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { hash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/app.mjs';
import { createSourceService } from '../../src/source.mjs';
import { createStore } from '../../src/store.mjs';
import { createTryonService } from '../../src/tryon.mjs';
import { createWardrobe } from '../../src/wardrobe.mjs';

export const MODEL = 'codex/gpt-image-2.5';
export const imageBytes = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(8192)]);

export async function createFixture({ models = [MODEL], env: envOverrides = {}, onEdit, sourceFetch, products = [], suggestOutfit } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tryon-frontend-'));
  const catalogFile = join(dir, 'catalog.json');
  const resultsDir = join(dir, 'results');
  await writeFile(catalogFile, JSON.stringify({ products }));
  const env = { IMAGE_API_BASE_URL: 'http://127.0.0.1:3425/v1', IMAGE_MODEL: MODEL, DEMO_MODE: '1', ...envOverrides };
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/images/edits')) await onEdit?.(init.body);
    return Response.json(String(url).endsWith('/models') ? { data: models.map(id => ({ id, modalities: { output: ['image'] } })) }
      : { data: [{ b64_json: imageBytes.toString('base64'), mime_type: 'image/png' }] });
  };
  const store = createStore({ dir, catalogFile }); await store.ready();
  const sources = createSourceService({ runCli: null, fetchImpl: sourceFetch ?? fetchImpl, settleMs: 0 });
  const wardrobe = createWardrobe({ dir, env, fetchImpl, sources, captioner: async () => '' });
  const tryon = createTryonService({ store, env, fetchImpl, resultsDir });
  const suggest = async request => {
    const items = await wardrobe.list();
    if (suggestOutfit) return suggestOutfit(request, items);
    return { slots: { top: items.find(item => item.category === 'top') ?? null, bottom: items.find(item => item.category === 'bottom') ?? null }, reason: '按通勤场景选择', missing: [] };
  };
  const app = createApp({ env, store, sources, wardrobe, tryon, fetchImpl, stylist: { suggest, suggestByRule: suggest }, login: {}, resultsDir });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, method = 'GET', body, extraHeaders = {}) {
    const response = await fetch(base + path, { method, headers: { origin: base, 'content-type': 'application/json', ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text(); return { status: response.status, payload: text ? JSON.parse(text) : null };
  }
  const seeds = [['独特白色衬衫', 'top', '衬衫'], ['黑色长裤', 'bottom', '牛仔裤'], ['短外套', 'outer', '夹克'], ['吊带连衣裙', 'dress', '吊带裙'], ['白色运动鞋', 'shoes', '运动鞋'], ['细项链', 'accessory', '项链']];
  const items = [];
  for (const [name, category, subtype] of seeds) {
    const response = await call('/api/wardrobe', 'POST', { name, category, subtype, image: `data:image/png;base64,${imageBytes.toString('base64')}` });
    assert.equal(response.status, 201); items.push(response.payload.item);
  }
  await call('/api/outfit/suggest', 'POST', { request: '测试' });
  return { dir, app, base, call, items, async close() { await new Promise(resolve => app.close(resolve)); await rm(dir, { recursive: true, force: true }); } };
}

export function observeStudioOrders(app) {
  const orders = [];
  app.on('request', request => {
    if (request.method !== 'POST' || request.url !== '/api/orders') return;
    const chunks = []; request.on('data', chunk => chunks.push(chunk));
    request.once('end', () => {
      const { personSource, photographyMode = 'preserve', person } = JSON.parse(Buffer.concat(chunks));
      orders.push({ source: personSource, mode: photographyMode, hash: hash('sha256', Buffer.from(person.split(',')[1], 'base64')) });
    });
  });
  return orders;
}

export async function setStudioPhotoFile(browser, path, selector = '.dropzone input[type=file]') {
  const { root } = await browser.send('DOM.getDocument');
  const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  await browser.send('DOM.setFileInputFiles', { nodeId, files: [path] });
}

export const stepButton = step => `[data-studio-step="${step}"]`;
export const trialButton = 'button.studio__trial, .studio__trial button';
export const trialNode = `document.querySelector(${JSON.stringify(trialButton)})`;
export const shootLocks = `[${trialNode}.disabled, document.querySelector('.studio__submit .btn').disabled]`;

export async function holdNextStudioRead({ evaluate }) {
  await evaluate(`{
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(file) {
      FileReader.prototype.readAsDataURL = read;
      window.finishHeldStudioRead = () => new Promise(resolve => {
        delete window.finishHeldStudioRead;
        this.addEventListener('loadend', () => resolve(this.error?.name ?? null), { once: true });
        read.call(this, file);
      });
    };
  }`);
  return () => evaluate('window.finishHeldStudioRead()');
}

export async function pickTrialGarment({ click, evaluate }) {
  await click(stepButton('pieces'));
  await click('[aria-label="从衣橱选择第 1 个单品"]');
  const shirt = 'dialog[open] .picker__item[aria-label="选择独特白色衬衫"]';
  await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(shirt)}))`), 'wardrobe shirt');
  await click(shirt);
  await waitFor(() => evaluate('document.querySelector(".studio__submit .btn")?.disabled === false'), 'person and shirt ready');
  await click('.studio-next .btn--primary');
}

export async function openReadyTrial(t) {
  const fixture = await createFixture(); t.after(() => fixture.close());
  const browser = await openBrowser(); t.after(() => browser.close());
  const posts = observeStudioOrders(fixture.app);
  await browser.goto(`${fixture.base}/#/studio`, 390);
  await pickTrialGarment(browser); await browser.click('[data-photography-mode=studio]');
  assert.deepEqual(await browser.evaluate(shootLocks), [false, false]);
  return { browser, fixture, posts };
}

export async function assertCannotShoot({ evaluate, click }, posts, reason) {
  assert.deepEqual(await evaluate(shootLocks), [true, true], reason);
  await click(trialButton); await click('.studio__submit .btn');
  assert.equal(posts.length, 0, reason);
}

export async function assertTrialResult(browser, fixture, expected, balanceBefore) {
  const { evaluate } = browser;
  await waitFor(() => evaluate(`document.querySelector('.result img')?.naturalWidth > 0 && ${trialNode}.disabled === false`), 'decoded single result and unlocked action');
  const { orders, sessions } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
  assert.equal(orders.length, 1, '只应保存一单');
  assert.partialDeepStrictEqual(orders[0], { ...expected, photographyMode: 'studio', posePreset: 'crouch-chin', status: 'success' });
  assert.equal(sessions.find(({ id }) => id === expected.sessionId).balanceCents, balanceBefore - expected.priceCents);
  const images = await evaluate('Array.from(document.querySelectorAll(".result img"), image => image.currentSrc)');
  assert.deepEqual(images.map(src => new URL(src).pathname), [`/api/results/${orders[0].resultFile}`]);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".result a[download]"), link => link.href)'), images);
  const text = await evaluate('document.querySelector(".result").innerText');
  assert.match(text, /蹲姿托腮/); assert.match(text, /1\s*\/\s*1\s*张完成/);
  const status = await evaluate('document.querySelector(".studio__preview [role=status]").textContent');
  assert.match(status, /完成/); assert.doesNotMatch(status, /[3三]\s*(?:个?姿势|张)/);
  assert.deepEqual(await evaluate(shootLocks), [false, false]);
}

export async function holdResponse(browser, path, method) {
  await browser.evaluate(`{
    const original = window.fetch;
    window.fetch = async (resource, options) => {
      if (resource !== ${JSON.stringify(path)} || options?.method !== ${JSON.stringify(method)}) return original(resource, options);
      window.fetch = original;
      const response = await original(resource, options);
      const bytes = await response.arrayBuffer();
      await new Promise(resolve => { window.deliverHeldResponse = resolve; });
      return new Response(bytes, {status: response.status, headers: response.headers});
    };
  }`);
  return { ready: () => waitFor(() => browser.evaluate('typeof window.deliverHeldResponse === "function"'), 'completed HTTP response held'),
    release: () => browser.evaluate('window.deliverHeldResponse(); delete window.deliverHeldResponse;') };
}

export const chromePath = [
  process.env.TRYON_TEST_CHROME,
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path));

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
      await evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); input.select(); })()`);
      if (value) await send('Input.insertText', { text: value });
      else await key('Backspace');
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
