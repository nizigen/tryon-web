/**
 * 商品链接取图：把淘宝 / 京东 / 拼多多 / 抖音商城的商品页解析成可直接试穿的商品图。
 *
 * 这几家的商品数据都不在静态 HTML 里。解析分两种通道：
 * - 直连：抖音视频/图文帖只凭 ttwid 就能读分享页（完全免费、免登录、不碰浏览器）；
 *   淘宝/抖音商城的深层数据需要登录态 cookie，从本机 cookie 文件读取后直接请求。
 * - OpenCLI 兜底：没有 cookie 或直连失败时，复用本机已登录的浏览器会话。
 * 服务端只做「解析 → 归一 → 白名单下载」，不代客户端请求任意 URL。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';

import { HttpError } from './errors.mjs';
import { MAX_IMAGE_BYTES, sniff } from './validate.mjs';
import { loadCookies } from './cookies.mjs';

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
    // 抖音两种链接都收：商品分享（v.douyin.com → haohuo 详情）与视频/图文帖（v.douyin.com → douyin.com/video|note）。
    // 商品封面走 goods_detail（免登录）；视频/图文帖走 iesdouyin 分享页 + ttwid（免登录）。
    // 更深一层（商品多图、视频原片）需要登录态 cookie，见 extractDouyinProduct / DOUYIN_DETAIL。
    id: 'douyin',
    label: '抖音',
    referer: 'https://www.douyin.com/',
    hosts: ['haohuo.jinritemai.com', 'www.douyin.com', 'www.iesdouyin.com', 'm.douyin.com'],
    shortHosts: ['v.douyin.com'],
    imageHosts: ['ecombdimg.com', 'douyinpic.com', 'byteimg.com', 'snssdk.com'],
    ua: UA_M,
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
  const douyinVideo = /https?:\/\/(?:www\.)?douyin\.com\/(?:video|note)\/\d+/.exec(body);
  if (douyinVideo) return douyinVideo[0];
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

/** 抖音分享页只用 ttwid（一次注册、长期复用），不需要账号登录。 */
const DOUYIN_REGISTER = 'https://ttwid.bytedance.com/ttwid/union/register/';
const DOUYIN_REGISTER_BODY = JSON.stringify({
  region: 'cn', aid: 1768, needFid: false, service: 'www.ixigua.com',
  migrate_info: { ticket: '', source: 'node' }, cbUrlProtocol: 'https', union: true,
});
let ttwidCache = { value: '', at: 0 };

function cookieFromSetCookie(headers, name) {
  const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const line of lines) {
    const m = new RegExp(`(?:^|[,\\s])${name}=([^;,\\s]+)`).exec(line);
    if (m) return m[1];
  }
  return '';
}

async function douyinTtwid(fetchImpl, signal) {
  // 12 小时内复用，避免每次解析都注册一次。
  if (ttwidCache.value && Date.now() - ttwidCache.at < 12 * 60 * 60 * 1000) return ttwidCache.value;
  const response = await fetchImpl(DOUYIN_REGISTER, {
    method: 'POST', signal, headers: { 'content-type': 'application/json', 'user-agent': UA_M }, body: DOUYIN_REGISTER_BODY,
  }).catch(() => null);
  if (!response) throw new HttpError(502, 'IMAGE_FETCH_FAILED', '抖音解析初始化失败，请稍后重试');
  const ttwid = cookieFromSetCookie(response.headers, 'ttwid');
  void response.body?.cancel?.().catch(() => {});
  if (!ttwid) throw new HttpError(502, 'IMAGE_FETCH_FAILED', '抖音解析初始化失败（没有拿到访问凭据）');
  ttwidCache = { value: ttwid, at: Date.now() };
  return ttwid;
}

function awemeIdFromUrl(url) {
  const match = /(?:video|note|share\/video|share\/note)\/(\d{6,})/.exec(url.pathname + url.search) ??
    /[?&](?:modal_id|aweme_id|item_ids)=(\d{6,})/.exec(url.search);
  return match ? match[1] : '';
}

/** 从 `window._ROUTER_DATA` 里递归找 item_list（视频与图文的键不完全一样）。 */
function findItemList(node, depth = 0) {
  if (depth > 8 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node.item_list) && node.item_list.length && typeof node.item_list[0] === 'object') return node.item_list;
  for (const value of Object.values(node)) {
    const found = findItemList(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseRouterData(html) {
  const match = /window\._ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  const text = match[1].trim().replace(/;$/, '');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 抖音视频/图文帖：ttwid + iesdouyin 分享页，免登录拿到全部图片（视频则取封面）。 */
async function extractDouyinShare(url, fetchImpl, signal) {
  let finalUrl = url;
  if (url.host === 'v.douyin.com') {
    const response = await fetchImpl(url.href, { signal, redirect: 'manual', headers: { 'user-agent': UA_M } }).catch(() => null);
    if (response) {
      const location = response.headers.get('location');
      void response.body?.cancel?.().catch(() => {});
      if (location) finalUrl = new URL(location, url);
    }
  }
  const awemeId = awemeIdFromUrl(finalUrl) || awemeIdFromUrl(url);
  if (!awemeId) {
    throw new HttpError(400, 'INVALID_URL', '这个抖音链接里没有视频或图文，请重新复制分享链接', 'url');
  }
  const ttwid = await douyinTtwid(fetchImpl, signal);
  const headers = {
    'user-agent': UA_M,
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'zh-CN,zh;q=0.9',
    referer: 'https://www.douyin.com/',
    cookie: `ttwid=${ttwid}`,
  };
  for (const kind of ['video', 'note']) {
    const response = await fetchImpl(`https://www.iesdouyin.com/share/${kind}/${awemeId}/`, { signal, headers, redirect: 'follow' }).catch(() => null);
    if (!response || !response.ok) continue;
    const html = await response.text();
    const data = parseRouterData(html);
    if (!data) continue;
    const item = findItemList(data)?.[0];
    if (!item) continue;
    const images = [];
    const push = (u) => {
      if (typeof u === 'string' && u && !images.some((x) => x.url === u)) images.push({ url: u, group: 'main' });
    };
    if (Array.isArray(item.images) && item.images.length) {
      for (const image of item.images) for (const u of image?.url_list ?? []) push(u);
    } else {
      // 视频没有图集，用封面当唯一商品图。
      for (const u of (item.video?.origin_cover?.url_list ?? item.video?.cover?.url_list ?? []).slice(0, 1)) push(u);
    }
    // 只保留白名单域名（douyinpic/byteimg/ecombdimg/snssdk），避免把任意地址当图片去抓。
    const douyinPlatform = PLATFORMS.find((p) => p.id === 'douyin');
    const allowed = images.filter((image) => {
      try {
        return imageHostAllowed(new URL(image.url), douyinPlatform);
      } catch {
        return false;
      }
    });
    if (allowed.length) {
      // 抖音图片 CDN（douyinpic/byteimg）的直链基本是一次性的：同一地址第二次请求就 403。
      // 所以在解析时就把字节取回来缓存，后续试穿直接用缓存，不再回源。
      const prefetched = [];
      let totalBytes = 0;
      for (const image of allowed.slice(0, 9)) {
        if (/ecombdimg\.com/.test(image.url)) {
          prefetched.push(image);
          continue;
        }
        const res = await fetchImpl(image.url, { signal, headers: { 'user-agent': UA_M, referer: 'https://www.douyin.com/' } }).catch(() => null);
        const type = String(res?.headers?.get('content-type') ?? '');
        if (!res?.ok || !type.startsWith('image/')) {
          void res?.body?.cancel?.().catch(() => {});
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length < MIN_IMAGE_BYTES || buffer.length > MAX_IMAGE_BYTES) continue;
        totalBytes += buffer.length;
        if (totalBytes > 24 * 1024 * 1024) break;
        prefetched.push({ url: image.url, group: image.group, buffer });
      }
      if (!prefetched.length) {
        throw new HttpError(422, 'NO_IMAGES', '抖音视频/图文帖的图片受抖音 CDN 保护（服务器直连被拒），暂时只能解析抖音商城的商品链接；请粘贴商品分享链接');
      }
      return { title: String(item.desc ?? '').slice(0, 120), images: prefetched };
    }
  }
  throw new HttpError(422, 'NO_IMAGES', '没有从这个抖音链接解析到图片，可能是不支持的链接类型');
}

/** 递归收集对象里所有形如淘宝图片的 URL（对接口结构变化免疫）。 */
function deepCollectImages(node, allowed, out, depth = 0) {
  if (depth > 12 || node == null) return;
  if (typeof node === 'string') {
    if (allowed(node) && !out.includes(node)) out.push(node);
    return;
  }
  if (typeof node !== 'object') return;
  for (const value of Object.values(node)) deepCollectImages(value, allowed, out, depth + 1);
}

function deepFindString(node, key, depth = 0) {
  if (depth > 10 || !node || typeof node !== 'object') return '';
  if (typeof node[key] === 'string' && node[key]) return node[key];
  for (const value of Object.values(node)) {
    const found = deepFindString(value, key, depth + 1);
    if (found) return found;
  }
  return '';
}

const MTOP_APPKEY = '12574478';
function cookieValue(cookie, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie);
  return m ? m[1] : '';
}

/** 把响应里的 Set-Cookie 并进 cookie 头（_m_h5_tk / _m_h5_tk_enc 是 mtop 自己下发的）。 */
function mergeSetCookies(jar, headers) {
  const map = new Map();
  for (const part of jar.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf('=');
    if (i > 0) map.set(trimmed.slice(0, i), trimmed.slice(i + 1));
  }
  const lines = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const line of lines) {
    const first = line.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) map.set(first.slice(0, i).trim(), first.slice(i + 1));
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 淘宝直连：用登录态 cookie 走 mtop 详情接口（JSON），不再需要浏览器。
 * mtop 签名 = md5(token + '&' + t + '&' + appKey + '&' + data)，token 取 _m_h5_tk 下划线前段。
 * 浏览器导出的 cookie 里通常没有 _m_h5_tk（那是 h5api.m.taobao.com 首次请求才下发的），
 * 所以先用空 token 探一次握手，把下发的 _m_h5_tk/_m_h5_tk_enc 并进 cookie 再签名重发。
 */
async function taobaoDirect(cookie, id, fetchImpl, signal) {
  const data = JSON.stringify({ itemId: id });
  let jar = cookie;
  const invoke = async (token) => {
    const t = Date.now();
    const sign = createHash('md5').update(`${token}&${t}&${MTOP_APPKEY}&${data}`).digest('hex');
    const url =
      'https://h5api.m.taobao.com/h5/mtop.taobao.pcdetail.data.get/1.0/' +
      `?jsv=2.7.2&appKey=${MTOP_APPKEY}&t=${t}&sign=${sign}` +
      `&api=mtop.taobao.pcdetail.data.get&v=1.0&type=json&dataType=json&data=${encodeURIComponent(data)}`;
    const response = await fetchImpl(url, {
      signal,
      headers: { 'user-agent': UA, accept: 'application/json', referer: `https://item.taobao.com/item.htm?id=${id}`, cookie: jar },
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { response, json };
  };

  let token = cookieValue(jar, '_m_h5_tk').split('_')[0];
  if (!token) {
    const probe = await invoke('');
    jar = mergeSetCookies(jar, probe.response.headers);
    token = cookieValue(jar, '_m_h5_tk').split('_')[0];
    if (!token) {
      throw new HttpError(502, 'IMAGE_FETCH_FAILED', '淘宝没有下发访问令牌，cookie 可能已失效，请重新从浏览器复制');
    }
  }
  let result = await invoke(token);
  const ret = Array.isArray(result.json?.ret) ? result.json.ret.join(';') : '';
  if (/令牌过期|令牌为空|TOKEN_EXOIRED|TOKEN_EXPIRED|TOKEN_EMPTY/i.test(ret)) {
    jar = mergeSetCookies(jar, result.response.headers);
    const rotated = cookieValue(jar, '_m_h5_tk').split('_')[0];
    if (rotated) result = await invoke(rotated);
  }
  if (!result.json) throw new HttpError(502, 'IMAGE_FETCH_FAILED', '淘宝接口返回了非 JSON 内容，可能 cookie 已失效');
  const retText = Array.isArray(result.json.ret) ? String(result.json.ret[0] ?? '') : '';
  if (!retText.startsWith('SUCCESS')) {
    throw new HttpError(502, 'IMAGE_FETCH_FAILED', `淘宝接口没有返回商品数据（${retText.slice(0, 60) || '未知错误'}）`);
  }
  const payload = result.json.data ?? {};
  const urls = [];
  const isTaoImage = (value) =>
    /^https?:\/\/[^"'\s]*alicdn\.com\/[^"'\s]*\.(?:jpg|jpeg|png|webp)(?:[?#].*)?$/i.test(value) &&
    !/-\d{1,3}-\d{1,3}\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(value);
  deepCollectImages(payload, isTaoImage, urls);
  const images = urls.map((u) => ({ url: u, group: 'main' }));
  if (!images.length) return { title: '', images: [] };
  const title = deepFindString(payload, 'title') || deepFindString(payload, 'subtitle');
  return { title: String(title).slice(0, 120), images };
}

/**
 * 解析商品链接。同一时刻只跑一个解析：OpenCLI 共用一个浏览器会话，并发会互相踩。
 * @param {object} [options]
 * @param {(args: string[], timeout: number) => Promise<any>} [options.runCli] 测试注入，替代真实 OpenCLI
 */
export function createSourceService({ env = process.env, fetchImpl = fetch, runCli: injected, cookies, settleMs = 8000, ttlMs = 30 * 60 * 1000, max = 20 } = {}) {
  const entry = injected ? null : locateOpenCli(env);
  const nodeBin = injected ? null : locateNode(entry, env);
  const runCli = injected ?? (entry && nodeBin ? createRunner(entry, nodeBin) : null);
  // 测试注入 runCli 时按「测试模式」看待，不读本机真实 cookie，保证测试可重复。
  const cookieJar = cookies ?? (injected !== undefined ? {} : loadCookies(env));
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
    const cookie = cookieJar[platform.id] ?? '';
    if (platform.id === 'douyin') {
      // 商品分享页（haohuo）走 goods_detail；视频/图文帖走 ttwid 分享页。两者都免登录。
      if (url.host === 'haohuo.jinritemai.com') return extractDouyin(url);
      return extractDouyinShare(url, fetchImpl, signal);
    }
    if (platform.id === 'taobao') {
      const id = taobaoId(url);
      if (cookie) {
        try {
          const direct = await taobaoDirect(cookie, id, fetchImpl, signal);
          if (direct.images.length) return direct;
        } catch (error) {
          if (!runCli) throw error;
        }
      }
      if (!runCli) {
        throw new HttpError(503, 'SOURCE_UNAVAILABLE', '没有淘宝登录 cookie，也没有 OpenCLI；请粘贴淘宝 cookie 后重试');
      }
      return extractTaobao(runCli, id, settleMs, signal);
    }
    if (!runCli) {
      throw new HttpError(503, 'SOURCE_UNAVAILABLE', '没有找到 OpenCLI，无法读取商品页；请安装并登录 OpenCLI 后重试');
    }
    if (platform.id === 'jd') return extractJd(runCli, jdSku(url), signal);
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
        images.push({ url: original, group: candidate.group, buffer: candidate.buffer });
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
    // 抖音图片直链是一次性的（第二次请求 403），解析时已把字节取回缓存，直接用缓存。
    if (image.buffer) {
      const cached = sniff(image.buffer);
      if (!cached) throw new HttpError(502, 'IMAGE_FETCH_FAILED', '商品图格式不支持');
      return { mime: cached, buffer: image.buffer };
    }
    const response = await fetchImpl(image.url, {
      signal,
      redirect: 'error',
      headers: {
        // 抖音的图片 CDN 认手机 UA（与分享页取图保持一致），其它平台用桌面 UA。
        'user-agent': platform.ua ?? UA,
        referer: platform.referer,
        accept: 'image/avif,image/webp,image/*,*/*',
      },
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
