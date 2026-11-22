/**
 * 商品链接取图：把淘宝 / 京东 / 拼多多 / 抖音商城的商品页解析成可直接试穿的商品图。
 *
 * 这几家的商品数据都不在静态 HTML 里：淘宝与拼多多把商品数据内嵌在页面的 window 上、
 * 京东由适配器从页面数据里取、抖音商城分享链接的跳转地址里带 goods_detail。
 * 因此解析借道本机 OpenCLI（复用用户已登录的浏览器会话），服务端只做
 * 「调用 → 归一 → 白名单下载」，不代客户端请求任意 URL。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { HttpError } from './errors.mjs';
import { MAX_IMAGE_BYTES, sniff } from './validate.mjs';

const execFileAsync = promisify(execFile);
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UA_M =
  'Mozilla/5.0 (Linux; Android 16; 24117RK2CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const MAX_CLI_BYTES = 32 * 1024 * 1024;
const OPENCLI_ENTRY = ['node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js'];
const SESSION = 'tryon-source';
const MAX_IMAGES = 40;
/** 未加载完的 img 会给出 2×2 占位图（67 字节），真实商品图远大于此。 */
const MIN_IMAGE_BYTES = 4096;
/** 短链跳转页只用来抓商品 ID，正文限 256KiB。 */
const MAX_SHORTLINK_BYTES = 256 * 1024;
/** 解析串行执行，排队上限防止密集点击把共享浏览器会话占死。 */
const MAX_PENDING = 4;

const PLATFORMS = [
  {
    id: 'taobao',
    label: '淘宝 / 天猫',
    referer: 'https://item.taobao.com/',
    hosts: ['item.taobao.com', 'detail.tmall.com', 'chaoshi.detail.tmall.com', 'world.taobao.com'],
    shortHosts: ['m.tb.cn', 'e.tb.cn'],
    imageHosts: ['alicdn.com'],
  },
  {
    id: 'jd',
    label: '京东',
    referer: 'https://item.jd.com/',
    hosts: ['item.jd.com', 'item.m.jd.com', 'item.jd.hk'],
    imageHosts: ['360buyimg.com'],
  },
  {
    id: 'pdd',
    label: '拼多多',
    referer: 'https://mobile.yangkeduo.com/',
    hosts: ['mobile.yangkeduo.com', 'yangkeduo.com', 'www.pinduoduo.com', 'p.pinduoduo.com'],
    shortHosts: ['p.pinduoduo.com'],
    imageHosts: ['pddpic.com'],
  },
  {
    // 抖音商城的 H5 详情页对浏览器一律风控（「请使用抖音APP扫码」），
    // 但分享链接跳转目标里的 goods_detail 参数自带主图，不用登录也不用浏览器。
    id: 'douyin',
    label: '抖音商城',
    referer: 'https://haohuo.jinritemai.com/',
    hosts: ['haohuo.jinritemai.com'],
    shortHosts: ['v.douyin.com'],
    imageHosts: ['ecombdimg.com'],
  },
];

/**
 * 淘宝详情页把商品数据内嵌在 `window.__ICE_APP_CONTEXT__.loaderData.home.data.res`：
 * `res.item.images` 是主图，`res.skuBase.props[].values[].image` 是每个规格值的图片。
 * 这比抓 DOM 稳：规格图是懒加载的，DOM 里未进视口的 `img.src` 是 2×2 占位图
 * （`...-2-tps-2-2.png`），只有滚动过去才会换成真图。内嵌数据一次拿全，与滚动无关。
 */
export const TAOBAO_JS = `(() => {
  const out = [];
  const push = (u, group) => { if (u && !out.some(o => o.url === u)) out.push({ url: u, group }); };
  const isTiny = (u) => {
    const m = /-(\\d{1,4})-(\\d{1,4})\\.(?:png|jpe?g|webp)(?:[?#]|$)/i.exec(u);
    return Boolean(m) && (Number(m[1]) < 200 || Number(m[2]) < 200);
  };
  const res = window.__ICE_APP_CONTEXT__ && window.__ICE_APP_CONTEXT__.loaderData
    && window.__ICE_APP_CONTEXT__.loaderData.home && window.__ICE_APP_CONTEXT__.loaderData.home.data
    && window.__ICE_APP_CONTEXT__.loaderData.home.data.res;
  let title = '';
  if (res) {
    title = String((res.item && res.item.title) || '').slice(0, 120);
    ((res.item && res.item.images) || []).forEach((u) => { if (!isTiny(u)) push(u, 'main'); });
    const props = (res.skuBase && res.skuBase.props) || [];
    props.forEach((prop) => {
      (prop.values || []).forEach((value) => { if (!isTiny(value.image)) push(value.image, 'sku'); });
    });
  }
  if (out.length === 0) {
    // 页面结构变化时的兜底：内嵌数据没拿到就退回 DOM。
    document.querySelectorAll('img').forEach((img) => {
      const cls = String(img.className || '');
      const src = img.currentSrc || img.src || '';
      if (!/alicdn\\.com/.test(src)) return;
      if (/shopIconImg--|creditLevelIconImg--|mainIcon--|actionImg--|logo--/.test(cls)) return;
      if (isTiny(src)) return;
      if (/mainPic--/.test(cls)) push(src, 'main');
      else if (/thumbnailPic--/.test(cls)) push(src, 'thumb');
      else if (/valueItemImg--/.test(cls)) push(src, 'sku');
    });
  }
  if (!title) {
    const titleEl = document.querySelector('[class*="mainTitle--"]');
    title = titleEl ? titleEl.textContent.trim().slice(0, 120) : document.title.slice(0, 120);
  }
  return JSON.stringify({ title, images: out });
})()`;

const PDD_JS = `(() => {
  const g = window.rawData && window.rawData.store && window.rawData.store.initDataObj && window.rawData.store.initDataObj.goods;
  if (!g) return JSON.stringify({ title: document.title.slice(0, 120), images: [] });
  const pick = (x) => (typeof x === 'string' ? x : (x && (x.url || x.imgUrl)) || '');
  const out = [];
  const push = (u, group) => { const url = String(u || ''); if (url && !out.some(o => o.url === url)) out.push({ url, group }); };
  (g.topGallery || []).forEach((x) => push(pick(x), 'main'));
  (g.detailGallery || []).forEach((x) => push(pick(x), 'detail'));
  (g.skus || []).forEach((s) => push(s && s.thumbUrl, 'sku'));
  return JSON.stringify({ title: String(g.goodsName || '').slice(0, 120), images: out });
})()`;

function platformFor(url) {
  const host = url.hostname.toLowerCase();
  return PLATFORMS.find((platform) => platform.hosts.includes(host)) ?? null;
}

/** 分享短链的域名 → 平台，用于跟随跳转前就知道该按哪家解析。 */
function platformForShort(url) {
  const host = url.hostname.toLowerCase();
  return PLATFORMS.find((platform) => (platform.shortHosts ?? []).includes(host)) ?? null;
}

function imageHostAllowed(url, platform) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return platform.imageHosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * 流式读取并按上限累计：`arrayBuffer()` 会先把整个响应读进内存，
 * 上游不给 content-length 时照样能被大响应撑爆，所以超限要立即断开。
 */
async function readLimited(response, limit, failure) {
  if (!response.body) throw failure;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw failure;
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** 商品页的图片地址带尺寸/格式后缀，剥掉才是原图。 */
export function originalImageUrl(raw, platformId) {
  if (typeof raw !== 'string' || !raw) return '';
  // 页面里也出现过协议相对地址（`//img.alicdn.com/...`），不补协议会被 new URL 判非法。
  const source = raw.startsWith('//') ? `https:${raw}` : raw;
  if (platformId === 'taobao') {
    const match = /^(https?:\/\/[^?]+?\.(?:jpg|jpeg|png|webp))/i.exec(source);
    return match ? match[1] : source;
  }
  if (platformId === 'jd') {
    return source.replace(/\.(?:avif|webp)$/i, '').replace(/\/s\d+x\d+_jfs\//, '/jfs/');
  }
  return source.split('?')[0];
}

/**
 * 上游给的图片列表可能是字符串、对象或根本不是数组（抖音的 `goods_detail` 由请求方构造，
 * 可以随便传）。这里统一收成 `[{url, group}]`，非字符串项直接丢掉，避免 TypeError 变成 500。
 */
function toImageList(value, group) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item)
    .map((url) => ({ url, group }));
}

/**
 * 手机分享出来的短链（`m.tb.cn/h.xxx`、`e.tb.cn/h.xxx`、`p.pinduoduo.com/xxx`、`v.douyin.com/xxx`）
 * 本身不带商品 ID，要跟随跳转才能拿到详情页。跳转后的正文里也直接带着商品 ID，
 * 所以先看 Location，再从 HTML 里兜底找 itemId / goods_id / haohuo 详情地址。
 */
async function resolveShortLink(url, fetchImpl, signal) {
  const response = await fetchImpl(url.href, {
    signal,
    redirect: 'manual',
    headers: { 'user-agent': UA_M, accept: 'text/html,application/xhtml+xml' },
  }).catch(() => null);
  if (!response) throw new HttpError(502, 'IMAGE_FETCH_FAILED', '短链解析失败，请重新复制分享链接');

  const location = response.headers.get('location');
  if (location) {
    // 手动重定向不会自动消费 body，不 cancel 会一直占着连接。
    void response.body?.cancel().catch(() => {});
    return new URL(location, url).href;
  }

  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new HttpError(502, 'IMAGE_FETCH_FAILED', '短链解析失败，请重新复制分享链接');
  }
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_SHORTLINK_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new HttpError(400, 'INVALID_URL', '这个分享链接里没有商品，请打开商品页再复制链接', 'url');
  }
  const body = (await readLimited(response, MAX_SHORTLINK_BYTES, new HttpError(400, 'INVALID_URL', '这个分享链接里没有商品，请打开商品页再复制链接', 'url'))).toString('utf8');
  const detail = /https?:\/\/(?:item|detail)\.(?:taobao|tmall)\.com\/[^"'\s<>]*[?&]id=(\d+)/.exec(body);
  if (detail) return `https://item.taobao.com/item.htm?id=${detail[1]}`;
  const goods = /goods_id=(\d{6,})/.exec(body);
  if (goods) return `https://mobile.yangkeduo.com/goods.html?goods_id=${goods[1]}`;
  const douyin = /https?:\/\/haohuo\.jinritemai\.com\/[^"'\s<>]+/.exec(body);
  if (douyin) return douyin[0];
  throw new HttpError(400, 'INVALID_URL', '这个分享链接里没有商品，请打开商品页再复制链接', 'url');
}

/**
 * 分享文案里常混着前后缀（「【淘宝】… https://e.tb.cn/xxx CZ321 「标题」」），
 * 先把 http(s) 链接抠出来，再判断是详情页还是短链。
 */
export function extractLink(input) {
  const text = String(input ?? '');
  const match = /https?:\/\/[^\s"'<>「」]+/.exec(text);
  if (!match) throw new HttpError(400, 'INVALID_URL', '请粘贴完整的商品链接', 'url');
  return match[0];
}

async function resolveInput(input, fetchImpl, signal) {
  let url;
  try {
    url = new URL(extractLink(input));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'INVALID_URL', '请粘贴完整的商品链接', 'url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'INVALID_URL', '只支持 http/https 商品链接', 'url');
  }
  // 拼多多的分享链接也可能是详情页形态（`goods.html?ps=xxx`），跳一次才拿到 goods_id。
  const pddShare = platformFor(url)?.id === 'pdd' && !url.searchParams.get('goods_id') && url.searchParams.get('ps');
  if (platformForShort(url) || pddShare) {
    const resolved = new URL(await resolveShortLink(url, fetchImpl, signal));
    const platform = platformFor(resolved);
    if (!platform) {
      throw new HttpError(400, 'UNSUPPORTED_PLATFORM', '这个分享链接指向的页面暂不支持', 'url');
    }
    return { url: resolved, platform };
  }
  return parseInput(url.href);
}

function parseInput(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new HttpError(400, 'INVALID_URL', '请粘贴完整的商品链接', 'url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpError(400, 'INVALID_URL', '只支持 http/https 商品链接', 'url');
  }
  const platform = platformFor(url);
  if (!platform) {
    throw new HttpError(400, 'UNSUPPORTED_PLATFORM', '目前只支持淘宝 / 天猫、京东、拼多多、抖音商城的商品链接', 'url');
  }
  return { url, platform };
}

function taobaoId(url) {
  const match = /[?&]id=(\d+)/.exec(url.search);
  if (!match) throw new HttpError(400, 'INVALID_URL', '这个链接里没有商品 ID，请用商品详情页的链接', 'url');
  return match[1];
}

function jdSku(url) {
  const match = /^\/(\d+)\.html$/.exec(url.pathname);
  if (!match) throw new HttpError(400, 'INVALID_URL', '这个链接里没有商品 SKU，请用商品详情页的链接', 'url');
  return match[1];
}

function pddGoodsId(url) {
  const match = /[?&]goods_id=(\d+)/.exec(url.search);
  if (!match) throw new HttpError(400, 'INVALID_URL', '这个链接里没有商品 ID，请用商品详情页的链接', 'url');
  return match[1];
}

/** OpenCLI 装在 PATH 上任意目录的 node_modules 里，不写死本机路径。 */
export function locateOpenCli(env = process.env, exists = existsSync) {
  if (env.OPENCLI_ENTRY) return exists(env.OPENCLI_ENTRY) ? env.OPENCLI_ENTRY : null;
  const dirs = String(env.PATH ?? env.Path ?? '').split(env.OS === 'Windows_NT' ? ';' : ':');
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = join(dir, ...OPENCLI_ENTRY);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * 找一个真正的 node 可执行文件。
 * 宿主可能以 Electron 形式启动本服务（process.execPath 是宿主 exe），
 * 而 PATH 上的 `node` 在 Windows 下往往是 .cmd 包装脚本、execFile 跑不了，
 * 所以优先取 opencli 安装目录同级的 node.exe，再退回 PATH 里的真实二进制。
 */
export function locateNode(entry, env = process.env, exists = existsSync) {
  if (env.OPENCLI_NODE) return exists(env.OPENCLI_NODE) ? env.OPENCLI_NODE : null;
  const names = env.OS === 'Windows_NT' || process.platform === 'win32' ? ['node.exe'] : ['node'];
  const roots = [];
  if (entry) {
    // <root>/node_modules/@jackwener/opencli/dist/src/main.js → <root>
    roots.push(join(entry, '..', '..', '..', '..', '..', '..'));
  }
  for (const dir of String(env.PATH ?? env.Path ?? '').split(env.OS === 'Windows_NT' ? ';' : ':')) {
    if (dir) roots.push(dir);
  }
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function createRunner(entry, nodeBin) {
  return async function runCli(args, timeout, signal) {
    try {
      const { stdout } = await execFileAsync(nodeBin, [entry, ...args], {
        timeout,
        maxBuffer: MAX_CLI_BYTES,
        windowsHide: true,
        signal,
      });
      return JSON.parse(stdout);
    } catch (error) {
      // error.message 里带着 node 与 opencli 的绝对路径，还夹着页面片段，只写日志不回给前端。
      console.error('[source] opencli failed:', String(error.message).slice(0, 300));
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', '读取商品页失败，请确认 OpenCLI 已登录后重试');
    }
  };
}

/** settle 等待也要能被客户端断开打断，否则排队任务会白跑满 8 秒。 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 商品数据随首屏一起内嵌到页面里，所以打开后读一次就够；
 * 只有读不到图时才等一会儿重试一次（页面慢或结构变化）。
 */
async function extractTaobao(runCli, id, settleMs, signal) {
  await runCli(['browser', '--session', SESSION, 'open', `https://item.taobao.com/item.htm?id=${id}`], 60_000, signal);
  const read = async () => {
    const result = await runCli(['browser', '--session', SESSION, 'eval', TAOBAO_JS], 60_000, signal);
    return JSON.parse(result.data);
  };
  const first = await read();
  if (first.images?.length || settleMs <= 0) return first;
  await delay(settleMs, signal);
  return read();
}

async function extractPdd(runCli, id, settleMs, signal) {
  await runCli(['browser', '--session', SESSION, 'open', `https://mobile.yangkeduo.com/goods1.html?goods_id=${id}`], 60_000, signal);
  await delay(settleMs, signal);
  const result = await runCli(['browser', '--session', SESSION, 'eval', PDD_JS], 60_000, signal);
  return JSON.parse(result.data);
}

async function extractJd(runCli, sku, signal) {
  const result = await runCli(['jd', 'item', sku, '-f', 'json'], 90_000, signal);
  const data = Array.isArray(result.data) ? result.data[0] : null;
  if (!data) throw new HttpError(503, 'SOURCE_UNAVAILABLE', '京东没有返回商品数据，可能未登录或商品已下架');
  const images = [
    ...toImageList(data.mainImages, 'main'),
    ...toImageList(data.detailImages, 'detail'),
  ];
  return { title: String(data.title ?? '').slice(0, 120), images };
}

/**
 * 抖音商城的分享链接跳转后，`goods_detail` 参数就是 URL 编码的商品 JSON，
 * 里面带标题、价格与主图直链。H5 详情页本身对浏览器全量风控，所以只取这个参数。
 */
function extractDouyin(url) {
  const raw = url.searchParams.get('goods_detail');
  if (!raw) {
    throw new HttpError(400, 'INVALID_URL', '这个抖音分享链接里没有商品信息，请重新复制', 'url');
  }
  let detail;
  try {
    detail = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'INVALID_URL', '这个抖音分享链接里没有商品信息，请重新复制', 'url');
  }
  const images = toImageList(detail?.img?.url_list, 'main');
  return { title: String(detail?.title ?? '').slice(0, 120), images };
}

/**
 * 解析商品链接。同一时刻只跑一个解析：OpenCLI 共用一个浏览器会话，并发会互相踩。
 * @param {object} [options]
 * @param {(args: string[], timeout: number) => Promise<any>} [options.runCli] 测试注入，替代真实 OpenCLI
 */
export function createSourceService({ env = process.env, fetchImpl = fetch, runCli: injected, settleMs = 8000, ttlMs = 30 * 60 * 1000, max = 20 } = {}) {
  const entry = injected ? null : locateOpenCli(env);
  const nodeBin = injected ? null : locateNode(entry, env);
  const runCli = injected ?? (entry && nodeBin ? createRunner(entry, nodeBin) : null);
  const sources = new Map();
  let queue = Promise.resolve();
  let pending = 0;

  function sweep() {
    const now = Date.now();
    for (const [id, source] of sources) if (now - source.createdAt > ttlMs) sources.delete(id);
    // 先淘汰再插入，容量上限才真的成立；上限至少留 1 条，否则 while 永不成立会死循环。
    while (sources.size >= Math.max(1, max)) sources.delete(sources.keys().next().value);
  }

  async function extract(url, platform, signal) {
    if (!runCli) {
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', '没有找到 OpenCLI，无法读取商品页；请安装并登录 OpenCLI 后重试');
    }
    if (platform.id === 'taobao') return extractTaobao(runCli, taobaoId(url), settleMs, signal);
    if (platform.id === 'jd') return extractJd(runCli, jdSku(url), signal);
    if (platform.id === 'douyin') return extractDouyin(url);
    return extractPdd(runCli, pddGoodsId(url), settleMs, signal);
  }

  async function create(input, signal) {
    const { url, platform } = await resolveInput(input, fetchImpl, signal);
    // 解析串行，但排队不能无限堆：客户端密集点击会一直占着共享浏览器会话。
    if (pending >= MAX_PENDING) {
      throw new HttpError(429, 'TOO_MANY_REQUESTS', '正在解析其它商品链接，请稍后再试');
    }
    pending += 1;
    const job = queue.then(async () => {
      signal?.throwIfAborted();
      const raw = await extract(url, platform, signal);
      const images = [];
      // 上游结构可能缺 images 或不是数组，一律按「没解析到图」处理，不能抛 TypeError。
      const candidates = Array.isArray(raw?.images) ? raw.images : [];
      for (const candidate of candidates) {
        const original = originalImageUrl(candidate?.url, platform.id);
        let parsed;
        try {
          parsed = new URL(original);
        } catch {
          continue;
        }
        if (!imageHostAllowed(parsed, platform)) continue;
        if (images.some((item) => item.url === original)) continue;
        images.push({ url: original, group: candidate.group });
        if (images.length >= MAX_IMAGES) break;
      }
      if (images.length === 0) {
        throw new HttpError(422, 'NO_IMAGES', '没有从这个商品页解析到图片，可能未登录或页面结构已变');
      }
      sweep();
      const source = {
        id: randomUUID(),
        platform: platform.id,
        platformLabel: platform.label,
        title: String(raw?.title || '未命名商品').slice(0, 120),
        images,
        createdAt: Date.now(),
      };
      sources.set(source.id, source);
      return source;
    });
    queue = job.catch(() => {});
    return job.finally(() => {
      pending -= 1;
    });
  }

  function get(sourceId) {
    const source = sources.get(sourceId);
    if (!source) throw new HttpError(404, 'SOURCE_EXPIRED', '商品链接已过期，请重新导入');
    if (Date.now() - source.createdAt > ttlMs) {
      sources.delete(sourceId);
      throw new HttpError(404, 'SOURCE_EXPIRED', '商品链接已过期，请重新导入');
    }
    // 重新插入把这条挪到末尾：淘汰时从头删，最近用过的就不会被挤掉。
    sources.delete(sourceId);
    sources.set(sourceId, source);
    return source;
  }

  function pick(sourceId, index) {
    const source = get(sourceId);
    const image = source.images[Number(index)];
    if (!image) throw new HttpError(404, 'IMAGE_NOT_FOUND', '这张商品图不存在');
    return { source, image };
  }

  async function download(sourceId, index, signal) {
    const { source, image } = pick(sourceId, index);
    const platform = PLATFORMS.find((item) => item.id === source.platform);
    // 纵深防御：入库时已过滤一次，这里再验，避免以后新增代码路径绕过白名单。
    if (!imageHostAllowed(new URL(image.url), platform)) {
      throw new HttpError(502, 'IMAGE_FETCH_FAILED', '商品图地址不在允许范围内');
    }
    const response = await fetchImpl(image.url, {
      signal,
      redirect: 'error',
      headers: { 'user-agent': UA, referer: platform.referer, accept: 'image/avif,image/webp,image/*,*/*' },
    }).catch(() => null);
    if (!response?.ok) {
      void response?.body?.cancel().catch(() => {});
      throw new HttpError(502, 'IMAGE_FETCH_FAILED', '商品图下载失败，请重新导入');
    }
    const tooLarge = new HttpError(413, 'IMAGE_TOO_LARGE', '商品图超过 8MiB');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_IMAGE_BYTES) {
      void response.body?.cancel().catch(() => {});
      throw tooLarge;
    }
    const buffer = await readLimited(response, MAX_IMAGE_BYTES, tooLarge);
    const mime = sniff(buffer);
    if (!mime) throw new HttpError(502, 'IMAGE_FETCH_FAILED', '商品图格式不支持');
    if (buffer.length < MIN_IMAGE_BYTES) {
      throw new HttpError(502, 'IMAGE_FETCH_FAILED', '这张是占位图，请换一张商品图');
    }
    return { mime, buffer };
  }

  /** 试穿请求用：把商品图变成与上传路径同一套校验后的 data URL。 */
  async function dataUrl(sourceId, index, signal) {
    const { mime, buffer } = await download(sourceId, index, signal);
    return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, source: get(sourceId) };
  }

  return { create, get, pick, download, dataUrl, locateOpenCli: () => entry, locateNode: () => nodeBin };
}
