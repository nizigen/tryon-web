/**
 * 扫码登录：起一个专用 Chrome 实例打开平台登录页，用户扫码后从 CDP 抓全量 cookie。
 *
 * 为什么不用无头浏览器：扫码必须看得见二维码。为什么不复用日常 Chrome：
 * 日常实例已经占着调试端口，而且会把用户自己的登录态混进服务端 cookie 表；
 * 这里用独立的 `--user-data-dir=<dir>/browser-profile`，用完连进程一起结束。
 *
 * 抓取用 `Network.getAllCookies` 而不是 document.cookie：淘宝的 cookie2、京东的 pt_key
 * 都是 HttpOnly，页面脚本读不到，CDP 这条能拿到。
 *
 * 测试注入点：`launcher` 替换「启动 Chrome + 读 cookie」这一层，
 * 返回 `{ cookies(): Promise<Array<{domain,name,value}>>, close(): Promise<void> }`。
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';

import { HttpError } from './errors.mjs';

const DEFAULT_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
/** 契约：轮询 1.5s、默认 300s 超时（LOGIN_TIMEOUT_MS 可覆盖）。 */
const POLL_MS = 1500;
const DEFAULT_TIMEOUT_MS = 300_000;
/** 启动 Chrome 到调试端口可用最多等 10s。 */
const DEBUGGER_WAIT_MS = 10_000;
/** 单条 CDP 调用的超时：页面卡死时不能让轮询永久挂住。 */
const CDP_TIMEOUT_MS = 15_000;
const LAUNCH_FAILED = '启动扫码登录失败，请重试';

/**
 * 登录页与鉴权判据（契约第 3 节）。
 * `isAuth` 判 cookie 名；`domains` 决定哪些域名的 cookie 才写进 cookie 头。
 */
const PLATFORMS = {
  taobao: {
    label: '淘宝',
    loginUrl: 'https://login.taobao.com/member/login.jhtml',
    domains: ['taobao.com', 'tmall.com'],
    // 只认 unb（登录用户编号）。cookie2 在未登录的访客页也会下发，
    // 拿它当判据会在用户还没扫码时就把访客 cookie 写进 cookie 表。
    isAuth: (name) => name === 'unb',
    accountNames: ['_nk_', 'unb'],
  },
  jd: {
    label: '京东',
    loginUrl: 'https://passport.jd.com/new/login.aspx',
    domains: ['jd.com', 'jd.hk'],
    isAuth: (name) => name === 'pt_key' || name === 'thor',
    accountNames: ['pt_pin', 'pin'],
  },
  pdd: {
    label: '拼多多',
    loginUrl: 'https://mobile.yangkeduo.com/login.html',
    domains: ['yangkeduo.com', 'pinduoduo.com'],
    isAuth: (name) => name === 'PASS_ID' || name === 'PDDAccessToken',
    accountNames: ['pdd_user_id'],
  },
};

function platformSpec(platform) {
  const spec = PLATFORMS[String(platform)];
  if (!spec) throw new HttpError(400, 'UNSUPPORTED_PLATFORM', '目前只支持淘宝、京东、拼多多的扫码登录');
  return spec;
}

function timeoutFrom(env) {
  const raw = Number(env.LOGIN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** cookie 的 domain 形如 `.taobao.com` / `login.taobao.com`，按后缀归属平台。 */
function hostMatches(domain, suffixes) {
  const host = String(domain ?? '').replace(/^\./, '').toLowerCase();
  if (!host) return false;
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function decodeValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 同名 cookie 出现在多个域名上时（`.taobao.com` 与 `login.taobao.com` 都有 cookie2），
 * 优先保留域 cookie 里更靠上的那个：`.taobao.com` 会随请求发往 item.taobao.com，
 * 而 login.taobao.com 的 host-only cookie 不会，选错就白登录了。
 * 平台域列表的顺序优先（淘宝的 taobao.com 排在 tmall.com 前），再比域的宽度。
 * 返回的排序键越小越优先。
 */
function domainRank(domain, domains = []) {
  const raw = String(domain ?? '');
  const host = raw.replace(/^\./, '').toLowerCase();
  const hostOnly = raw.startsWith('.') ? 0 : 1;
  // 归属哪个平台域：同名 cookie 在 taobao.com 与 tmall.com 各一份时，先认列表里靠前的那个。
  const owner = domains.findIndex((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  return [owner < 0 ? domains.length : owner, hostOnly, host.split('.').length, host.length];
}

function compareRank(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** 拼成 `k=v; k2=v2`：按 cookie 名排序，同名按 domainRank 取最宽的那条。 */
function cookieString(cookies, domains = []) {
  const sorted = [...cookies].sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return compareRank(domainRank(a.domain, domains), domainRank(b.domain, domains));
  });
  const seen = new Set();
  const parts = [];
  for (const cookie of sorted) {
    if (seen.has(cookie.name)) continue;
    seen.add(cookie.name);
    // 值保持 Chrome 里存的原样：cookie2 这类本来就是 URL 编码的，解码反而会让上游认不出。
    parts.push(`${cookie.name}=${cookie.value}`);
  }
  return parts.join('; ');
}

/** 与 loadCookies 同样宽容：坏文件按空表处理，只保留非空字符串值。 */
async function readCookieTable(file) {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [platform, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) out[platform] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** 账号名只用于界面回显，取到就截断，拿不到就算了。 */
function accountFrom(cookies, spec) {
  for (const name of spec.accountNames) {
    const found = cookies.find((cookie) => String(cookie.name) === name && cookie.value);
    if (found) {
      const value = decodeValue(String(found.value));
      if (value) return value.slice(0, 40);
    }
  }
  return '';
}

function sleep(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/** 可被 cancel 提前唤醒的等待，否则取消后还要白等一个轮询间隔。 */
function createWaiters() {
  const waiters = new Set();
  return {
    wait(ms) {
      return new Promise((resolveWait) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolveWait();
        };
        const timer = setTimeout(done, ms);
        waiters.add(done);
      });
    },
    wake() {
      for (const done of [...waiters]) done();
    },
  };
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

/** 轮询 /json/version 直到拿到 browser 级 webSocketDebuggerUrl。 */
async function waitForDebugger(port, until) {
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const info = await response.json();
        if (typeof info?.webSocketDebuggerUrl === 'string' && info.webSocketDebuggerUrl) {
          return info.webSocketDebuggerUrl;
        }
      }
    } catch {
      // 端口还没起来，继续等。
    }
    await sleep(150);
  }
  return null;
}

function openSocket(url) {
  return new Promise((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // 已经关了。
      }
      rejectOpen(new Error('连接 Chrome 调试端口超时'));
    }, DEBUGGER_WAIT_MS);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolveOpen(socket);
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      rejectOpen(new Error('连接 Chrome 调试端口失败'));
    }, { once: true });
  });
}

/** 最小 CDP 客户端：按 id 配对响应，忽略事件（事件没有 id）。 */
function createCdp(socket) {
  let seq = 0;
  const pending = new Map();

  function settle(id, ok, payload) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (ok) entry.resolve(payload);
    else entry.reject(payload);
  }

  socket.addEventListener('message', (event) => {
    let message;
    try {
      const text = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || typeof message.id !== 'number') return;
    if (message.error) settle(message.id, false, new Error(message.error.message || 'CDP 调用失败'));
    else settle(message.id, true, message.result);
  });

  socket.addEventListener('close', () => {
    for (const [id, entry] of [...pending]) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error('CDP 连接已关闭'));
    }
  });

  function send(method, params = {}, sessionId) {
    return new Promise((resolveSend, rejectSend) => {
      const id = ++seq;
      const timer = setTimeout(() => settle(id, false, new Error(`CDP ${method} 超时`)), CDP_TIMEOUT_MS);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
      try {
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (error) {
        settle(id, false, error);
      }
    });
  }

  return { send };
}

/** 认领 Chrome 已经打开的页面；没有就新建一个，之后所有调用都带 sessionId。 */
async function attachPage(cdp, loginUrl) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const pages = Array.isArray(targetInfos) ? targetInfos.filter((info) => info.type === 'page') : [];
  const page = pages.find((info) => info.url === loginUrl) ?? pages[0];
  let targetId = page?.targetId;
  if (!targetId) {
    const created = await cdp.send('Target.createTarget', { url: loginUrl });
    targetId = created.targetId;
  }
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId).catch(() => {});
  // 命令行已经让 Chrome 打开了登录页，只有拿到空白页时才需要导航。
  if (!page || !page.url || page.url.startsWith('about:')) {
    await cdp.send('Page.navigate', { url: loginUrl }, sessionId).catch(() => {});
  }
  await cdp.send('Network.enable', {}, sessionId).catch(() => {});
  return sessionId;
}

/**
 * Windows 没有进程组，`process.kill(-pid)` 不可用，只能 taskkill /T 连渲染进程一起结束；
 * 其它平台 detached 会建新进程组，按负 pid 整组发信号。
 */
function killTree(child) {
  const pid = child.pid;
  if (!pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((done) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.on('error', () => {
        try {
          child.kill();
        } catch {
          // 进程已经退了。
        }
        done();
      });
      killer.on('exit', () => done());
    });
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      child.kill();
    } catch {
      // 进程已经退了。
    }
  }
  return Promise.resolve();
}

/** 先关 CDP 连接再杀进程：反过来会让 close 事件在已死的 socket 上乱跳。 */
async function closeBrowser(socket, child) {
  try {
    socket?.close();
  } catch {
    // 已经关了。
  }
  if (!child || child.exitCode !== null || child.signalCode) return;
  await killTree(child);
}

/** 默认 launcher：真起 Chrome，返回读取 cookie 与关闭浏览器两个能力。 */
async function launchChrome({ loginUrl, profileDir, env, chromePath }) {
  const executable = chromePath || env.CHROME_PATH || DEFAULT_CHROME;
  if (!existsSync(executable)) {
    throw new HttpError(503, 'LOGIN_UNAVAILABLE', '没有找到 Chrome，无法启动扫码登录');
  }
  const port = await freePort();
  await mkdir(profileDir, { recursive: true });
  const child = spawn(executable, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    loginUrl,
  ], { stdio: 'ignore', detached: true });
  // spawn 失败是异步 error 事件，没有监听会变成未捕获异常把进程带崩。
  child.on('error', () => {});
  child.unref();

  let socket = null;
  try {
    const wsUrl = await waitForDebugger(port, Date.now() + DEBUGGER_WAIT_MS);
    if (!wsUrl) throw new HttpError(503, 'LOGIN_UNAVAILABLE', 'Chrome 没有打开调试端口，请重试');
    socket = await openSocket(wsUrl);
    const cdp = createCdp(socket);
    const sessionId = await attachPage(cdp, loginUrl);
    let closed = false;
    return {
      async cookies() {
        const result = await cdp.send('Network.getAllCookies', {}, sessionId);
        return Array.isArray(result?.cookies) ? result.cookies : [];
      },
      async close() {
        if (closed) return;
        closed = true;
        await closeBrowser(socket, child);
      },
    };
  } catch (error) {
    await closeBrowser(socket, child);
    throw error instanceof HttpError ? error : new HttpError(503, 'LOGIN_UNAVAILABLE', LAUNCH_FAILED);
  }
}

export function createLoginService({ env = process.env, dir = 'data', chromePath, launcher } = {}) {
  // 与 src/cookies.mjs 的 cookieFilePath(env, cwd) 指向同一个文件：
  // 那边固定拼 `<cwd>/data/cookies.json`，这里的 dir 就是那个 data 目录。
  const cookieFile = env.TRYON_COOKIE_FILE || join(resolve(dir), 'cookies.json');
  const profileDir = resolve(dir, 'browser-profile');
  const timeoutMs = timeoutFrom(env);
  const launch = launcher ?? ((options) => launchChrome({ ...options, env, chromePath }));
  const sessions = new Map();
  let writeQueue = Promise.resolve();
  let disposed = false;

  /** 读-改-写串行化：两个平台几乎同时成功时不会互相覆盖。 */
  function saveCookies(platform, jar) {
    const job = writeQueue.then(async () => {
      await mkdir(dirname(cookieFile), { recursive: true });
      const table = await readCookieTable(cookieFile);
      const temporary = `${cookieFile}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ ...table, [platform]: jar }, null, 2)}\n`, 'utf8');
      await rename(temporary, cookieFile);
    });
    writeQueue = job.catch(() => {});
    return job;
  }

  async function shutdown(session) {
    session.closed = true;
    session.waiters.wake();
    const browser = session.browser;
    session.browser = null;
    if (browser) await browser.close().catch(() => {});
  }

  async function expire(session) {
    if (session.state === 'waiting') session.state = 'expired';
    await shutdown(session);
  }

  async function fail(session, error) {
    if (session.state === 'waiting') session.state = 'failed';
    console.error('[login] failed:', String(error?.message ?? error).slice(0, 200));
    await shutdown(session);
  }

  async function complete(session, spec, jar, cookies) {
    if (session.closed) return;
    session.account = accountFrom(cookies, spec);
    try {
      await saveCookies(session.platform, jar);
    } catch (error) {
      await fail(session, new HttpError(503, 'LOGIN_UNAVAILABLE', '保存登录状态失败，请检查 data 目录权限'));
      return;
    }
    if (session.closed) return;
    session.state = 'done';
    await shutdown(session);
  }

  /** 读一次 cookie 并判定；返回 true 表示会话已经结束，轮询该停了。 */
  async function checkOnce(session, spec) {
    if (session.closed) return true;
    if (Date.now() >= session.deadline) {
      await expire(session);
      return true;
    }
    // shutdown 会把 browser 置空：轮询与取消撞在一起时不能再解引用。
    const browser = session.browser;
    if (!browser) return true;
    const cookies = await browser.cookies().catch(() => []);
    if (session.closed) return true;
    const relevant = (Array.isArray(cookies) ? cookies : []).filter((cookie) =>
      hostMatches(cookie?.domain, spec.domains));
    if (!relevant.some((cookie) => spec.isAuth(String(cookie.name ?? '')))) return false;
    const jar = cookieString(relevant, spec.domains);
    if (!jar) return false;
    await complete(session, spec, jar, relevant);
    return true;
  }

  async function poll(session, spec) {
    try {
      // 启动后先查一次：用户可能用的就是已经登录过的 profile，不必白等一个轮询间隔。
      if (await checkOnce(session, spec)) return;
      while (!session.closed) {
        await session.waiters.wait(Math.max(1, Math.min(POLL_MS, session.deadline - Date.now())));
        if (await checkOnce(session, spec)) return;
      }
    } catch (error) {
      await fail(session, error);
    }
  }

  async function start(platform) {
    if (disposed) throw new HttpError(503, 'LOGIN_UNAVAILABLE', '服务正在关闭，请稍后重试');
    const spec = platformSpec(platform);
    const active = sessions.get(String(platform));
    if (active && active.state === 'waiting') {
      throw new HttpError(409, 'LOGIN_IN_PROGRESS', `${spec.label}正在等待扫码，请先完成或取消上一次登录`);
    }
    // 终态会话的浏览器可能还开着（超时/失败已关，这里兜住竞态），先收掉再开新的。
    if (active) void shutdown(active);

    const session = {
      id: randomUUID(),
      platform: String(platform),
      state: 'waiting',
      account: '',
      browser: null,
      closed: false,
      deadline: Date.now() + timeoutMs,
      waiters: createWaiters(),
    };
    sessions.set(session.platform, session);

    let browser;
    try {
      browser = await launch({ platform: session.platform, loginUrl: spec.loginUrl, profileDir, chromePath, env });
      if (!browser || typeof browser.cookies !== 'function' || typeof browser.close !== 'function') {
        throw new Error('launcher 返回值缺少 cookies/close');
      }
    } catch (error) {
      if (sessions.get(session.platform) === session) sessions.delete(session.platform);
      throw error instanceof HttpError ? error : new HttpError(503, 'LOGIN_UNAVAILABLE', LAUNCH_FAILED);
    }

    session.browser = browser;
    // 启动期间被 cancel 掉了：直接收尾，不进入轮询。
    if (session.closed) {
      await shutdown(session);
      return { sessionId: session.id };
    }
    void poll(session, spec);
    return { sessionId: session.id };
  }

  async function status(platform, sessionId) {
    platformSpec(platform);
    const session = sessions.get(String(platform));
    if (!session || session.id !== sessionId) return { status: 'expired' };
    if (session.state === 'waiting' && Date.now() >= session.deadline) await expire(session);
    return session.state === 'done' && session.account
      ? { status: 'done', account: session.account }
      : { status: session.state };
  }

  async function cancel(platform, sessionId) {
    platformSpec(platform);
    const session = sessions.get(String(platform));
    // 幂等：会话已经结束或 id 不匹配时什么都不做，路由照样回 204。
    if (!session || session.id !== sessionId) return;
    sessions.delete(String(platform));
    await shutdown(session);
  }

  async function dispose() {
    disposed = true;
    const all = [...sessions.values()];
    sessions.clear();
    await Promise.all(all.map((session) => shutdown(session)));
    await writeQueue.catch(() => {});
  }

  return { start, status, cancel, dispose };
}
