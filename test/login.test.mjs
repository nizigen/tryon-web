import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLoginService } from '../src/login.mjs';
import { loadCookies } from '../src/cookies.mjs';

/**
 * 假 launcher：替代「起 Chrome + CDP 抓 cookie」，把要返回的 cookie 直接给出去。
 * 真扫码在测试里做不了，所以把浏览器那一层整体注入掉。
 */
function makeLauncher(cookies, { onClose } = {}) {
  const launches = [];
  const launcher = async ({ platform, loginUrl, profileDir }) => {
    const entry = { platform, loginUrl, profileDir, closed: false };
    launches.push(entry);
    return {
      async cookies() {
        return typeof cookies === 'function' ? cookies(entry) : cookies;
      },
      async close() {
        entry.closed = true;
        onClose?.(entry);
      },
    };
  };
  return { launcher, launches };
}

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'tryon-login-'));
}

/** 轮询到会话不再是 waiting；登录服务内部是后台轮询，测试只等结果。 */
async function waitSettled(login, platform, sessionId, limitMs = 3000) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const state = await login.status(platform, sessionId);
    if (state.status !== 'waiting') return state;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error(`会话 ${sessionId} 在 ${limitMs}ms 内没有结束`);
}

async function readTable(dir) {
  return JSON.parse(await readFile(join(dir, 'cookies.json'), 'utf8'));
}

test('不支持的平台：抛 400 UNSUPPORTED_PLATFORM', async () => {
  const dir = await tempDir();
  const login = createLoginService({ dir, launcher: makeLauncher([]).launcher });
  await assert.rejects(() => login.start('douyin'), { status: 400, code: 'UNSUPPORTED_PLATFORM' });
  await assert.rejects(() => login.status('douyin', 'x'), { status: 400, code: 'UNSUPPORTED_PLATFORM' });
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('没有 Chrome：抛 503 LOGIN_UNAVAILABLE', async () => {
  const dir = await tempDir();
  const login = createLoginService({
    dir,
    env: {},
    chromePath: join(dir, '不存在的', 'chrome.exe'),
  });
  await assert.rejects(() => login.start('taobao'), { status: 503, code: 'LOGIN_UNAVAILABLE' });
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('同一平台重复 start：409 LOGIN_IN_PROGRESS，另一个平台可以同时开', async () => {
  const dir = await tempDir();
  // cookie 一直给空数组，会话停在 waiting。
  const { launcher } = makeLauncher([]);
  const login = createLoginService({ dir, launcher, env: { LOGIN_TIMEOUT_MS: '5000' } });
  const first = await login.start('taobao');
  await assert.rejects(() => login.start('taobao'), { status: 409, code: 'LOGIN_IN_PROGRESS' });
  const other = await login.start('jd');
  assert.notEqual(other.sessionId, first.sessionId);
  assert.equal((await login.status('taobao', first.sessionId)).status, 'waiting');
  await login.cancel('taobao', first.sessionId);
  await login.cancel('jd', other.sessionId);
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('超时：状态变 expired 且浏览器被关掉', async () => {
  const dir = await tempDir();
  const closed = [];
  const { launcher } = makeLauncher([], { onClose: (entry) => closed.push(entry.platform) });
  const login = createLoginService({ dir, launcher, env: { LOGIN_TIMEOUT_MS: '200' } });
  const { sessionId } = await login.start('pdd');
  const state = await waitSettled(login, 'pdd', sessionId);
  assert.equal(state.status, 'expired');
  assert.deepEqual(closed, ['pdd']);
  // 过期后可以重新发起：不能一直卡在 409。
  const again = await login.start('pdd');
  assert.notEqual(again.sessionId, sessionId);
  await login.cancel('pdd', again.sessionId);
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('同名 cookie 分属 taobao.com 与 tmall.com 时，先认平台域列表里靠前的那个', async () => {
  const dir = await tempDir();
  // tmall.com 的 host 更短，旧实现只看域宽度会选中它；平台域顺序必须优先。
  const { launcher } = makeLauncher([
    { domain: '.tmall.com', name: '_tb_token_', value: 'tmall-wrong' },
    { domain: '.taobao.com', name: '_tb_token_', value: 'taobao-right' },
    { domain: '.taobao.com', name: 'unb', value: '220001' },
  ]);
  const login = createLoginService({ dir, launcher });
  const { sessionId } = await login.start('taobao');
  assert.equal((await waitSettled(login, 'taobao', sessionId)).status, 'done');
  assert.equal((await readTable(dir)).taobao, '_tb_token_=taobao-right; unb=220001');
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('轮询期间取消不会因 browser 已被置空而报错', async () => {
  const dir = await tempDir();
  // 会话一直判不出登录态，轮询会反复进 checkOnce；此时取消会先 shutdown 把 browser 置 null。
  const { launcher } = makeLauncher([{ domain: '.jd.com', name: 'pt_key', value: 'k' }]);
  const login = createLoginService({ dir, launcher, env: { LOGIN_TIMEOUT_MS: '5000' } });
  const { sessionId } = await login.start('jd');
  await login.cancel('jd', sessionId);
  await new Promise((done) => setTimeout(done, 120));
  assert.deepEqual(await login.status('jd', sessionId), { status: 'expired' });
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('成功路径：写入对应平台字段、保留其它平台、格式 k=v; k2=v2', async () => {
  const dir = await tempDir();
  const existing = { jd: 'pt_key=old; pt_pin=me', pdd: 'PASS_ID=pid' };
  await writeFile(join(dir, 'cookies.json'), JSON.stringify(existing), 'utf8');
  const { launcher, launches } = makeLauncher([
    { domain: '.taobao.com', name: 'unb', value: '220001', httpOnly: false },
    { domain: '.taobao.com', name: 'cookie2', value: 'abc%3D%3D', httpOnly: true },
    { domain: 'login.taobao.com', name: 'cookie2', value: 'wrong-domain-should-lose' },
    { domain: '.jd.com', name: 'pt_key', value: 'should-not-leak' },
  ]);
  const login = createLoginService({ dir, launcher });
  const { sessionId } = await login.start('taobao');
  const state = await waitSettled(login, 'taobao', sessionId);
  assert.equal(state.status, 'done');
  assert.equal(state.account, '220001');
  assert.equal(launches[0].loginUrl, 'https://login.taobao.com/member/login.jhtml');
  assert.equal(launches[0].profileDir, join(dir, 'browser-profile'));

  const table = await readTable(dir);
  // 按 cookie 名排序；同名取会随请求发往商品页的那条（`.taobao.com` 优先于 `login.taobao.com`）。
  assert.equal(table.taobao, 'cookie2=abc%3D%3D; unb=220001');
  assert.equal(table.jd, existing.jd);
  assert.equal(table.pdd, existing.pdd);

  // 与读取端完全兼容：loadCookies 能直接读到这次写入的值。
  const loaded = loadCookies({ TRYON_COOKIE_FILE: join(dir, 'cookies.json') }, dir);
  assert.equal(loaded.taobao, table.taobao);
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('只有访客 cookie（cookie2 没有 unb）不算登录成功', async () => {
  const dir = await tempDir();
  // 淘宝未登录时也会下发 cookie2，判据必须只认 unb，否则会把访客 cookie 当成登录态写进去。
  const { launcher } = makeLauncher([
    { domain: '.taobao.com', name: 'cookie2', value: 'visitor' },
    { domain: '.taobao.com', name: '_tb_token_', value: 'guest' },
  ]);
  const login = createLoginService({ dir, launcher, env: { LOGIN_TIMEOUT_MS: '300' } });
  const { sessionId } = await login.start('taobao');
  const state = await waitSettled(login, 'taobao', sessionId);
  assert.equal(state.status, 'expired');
  // 没写成登录态：文件不该出现 taobao 字段。
  const table = await readFile(join(dir, 'cookies.json'), 'utf8').catch(() => '{}');
  assert.equal(JSON.parse(table).taobao, undefined);
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('cancel：会话结束、浏览器关闭、之后 status 返回 expired', async () => {  const dir = await tempDir();
  const closed = [];
  const { launcher } = makeLauncher([], { onClose: (entry) => closed.push(entry.platform) });
  const login = createLoginService({ dir, launcher, env: { LOGIN_TIMEOUT_MS: '5000' } });
  const { sessionId } = await login.start('jd');
  await login.cancel('jd', sessionId);
  assert.deepEqual(closed, ['jd']);
  assert.equal((await login.status('jd', sessionId)).status, 'expired');
  // 幂等：重复取消不抛错。
  await login.cancel('jd', sessionId);
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});

test('launcher 抛错：转成 503，且不留下占位会话', async () => {
  const dir = await tempDir();
  const login = createLoginService({
    dir,
    launcher: async () => {
      throw new Error('chrome 起不来');
    },
  });
  await assert.rejects(() => login.start('taobao'), { status: 503, code: 'LOGIN_UNAVAILABLE' });
  // 失败不能卡住下一次尝试。
  const { launcher } = makeLauncher([{ domain: '.taobao.com', name: 'unb', value: '220001' }]);
  const retry = createLoginService({ dir, launcher });
  const { sessionId } = await retry.start('taobao');
  assert.equal((await waitSettled(retry, 'taobao', sessionId)).status, 'done');
  await retry.dispose();
  await login.dispose();
  await rm(dir, { recursive: true, force: true });
});
