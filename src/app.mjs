import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findOutfitConflict, MAX_ACCESSORIES } from '../public/lib/outfit-rules.js';
import { loadCookies } from './cookies.mjs';
import { HttpError } from './errors.mjs';
import { deadline, generateImage, isRetiredImageModel, listModels } from './imageapi.mjs';
import { studioFaceReference } from './model-identity.mjs';
import { buildOutfitPrompt, buildTryonPrompt, CATEGORIES, DEFAULT_POSE_PRESET, DEFAULT_STUDIO_PRESET, FITS, GARMENT_TYPES, garmentTypeLabel, isCategory, isGarmentType, isSlot, normalizeLayer, normalizePosePreset, normalizeStudioPreset, orderPieces, POSE_PRESETS, sanitizeText, SLOTS, slotLabel, STUDIO_PRESETS } from './prompt.mjs';
import { priceCatalog, resolveTier } from './pricing.mjs';
import { assertString, decodeImage, MAX_BODY_BYTES, MAX_IMAGE_BYTES, MAX_PROMPT_CHARS, sniff } from './validate.mjs';

/** 单次搭配件数上限（不含人物照），见 OUTFIT_MODEL.md 第 2 节。 */
const MAX_PIECES = 5;
const MAX_REFERENCE_IMAGES = 16;

function isDemoMode(env) {
  return env.DEMO_MODE === '1';
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const RESULTS_DIR = resolve(ROOT, 'data/results');
const RESULT_SECRET = randomBytes(32);
const RESULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function allowedOrigins(env, port) {
  if (env.PUBLIC_ORIGIN) return [env.PUBLIC_ORIGIN.replace(/\/$/, '')];
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

function checkRequest(request, port, env) {
  const origins = allowedOrigins(env, port);
  const host = request.headers.host;
  const hostAllowed = origins.some((origin) => {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  });
  if (!hostAllowed) throw new HttpError(403, 'FORBIDDEN_HOST', '仅允许本机访问');
  const origin = request.headers.origin;
  const pathname = request.url.split('?')[0];
  const documentNavigation = pathname === '/' || pathname.endsWith('.html');
  const originAllowed = origin === undefined || origins.includes(origin.replace(/\/$/, ''));
  if (!originAllowed
    || (['POST', 'PATCH', 'DELETE'].includes(request.method) && origin === undefined && !env.PUBLIC_ORIGIN)
    || (request.headers['sec-fetch-site'] === 'cross-site' && !documentNavigation)) {
    throw new HttpError(403, 'FORBIDDEN_ORIGIN', '不接受跨站请求');
  }
}

function readBody(request, signal) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
      signal.removeEventListener('abort', onAborted);
    };
    const onError = (error) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const onAborted = () => onError(signal.reason ?? new Error('Client disconnected'));
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        onError(new HttpError(413, 'REQUEST_TOO_LARGE', '请求不得超过24MiB'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolvePromise(Buffer.concat(chunks, size));
    };
    const declared = request.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_BODY_BYTES)) {
      onError(new HttpError(413, 'REQUEST_TOO_LARGE', '请求长度无效或超过24MiB'));
      return;
    }
    if (signal.aborted) {
      onAborted();
      return;
    }
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
    signal.addEventListener('abort', onAborted, { once: true });
  });
}

function requireJson(request) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请发送application/json请求');
  }
}

async function readJsonBody(request, signal) {
  requireJson(request);
  const raw = await readBody(request, signal);
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求不是有效JSON');
  }
}

function sessionIdFrom(request, url) {
  const header = request.headers['x-session-id'];
  if (typeof header === 'string' && header) return header;
  const query = url.searchParams.get('sessionId');
  if (query) return query;
  throw new HttpError(400, 'INVALID_REQUEST', '缺少会话标识');
}

function withinPublic(path) {
  return path.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep);
}

/** 结果图访问票据：文件名不可猜，票据带有效期，避免把会话标识放进 URL。 */
function issueResultToken(file) {
  const expires = Date.now() + RESULT_TOKEN_TTL_MS;
  const signature = createHmac('sha256', RESULT_SECRET).update(`${file}:${expires}`).digest('base64url').slice(0, 32);
  return `${expires}.${signature}`;
}

function verifyResultToken(file, token) {
  if (typeof token !== 'string') return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Date.now()) return false;
  const expected = createHmac('sha256', RESULT_SECRET).update(`${file}:${expires}`).digest('base64url').slice(0, 32);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === '/' ? '/index.html' : pathname;
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', '此路径不支持该请求方法');
  const target = resolve(PUBLIC_DIR, `.${relative}`);
  if (!withinPublic(target)) throw new HttpError(404, 'NOT_FOUND', '页面不存在');
  let body;
  try {
    const real = await realpath(target);
    if (!withinPublic(real)) throw new Error('outside root');
    body = await readFile(real);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', '页面不存在');
  }
  const type = CONTENT_TYPES[extname(target)] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': ['.html', '.js', '.css'].includes(extname(target)) ? 'no-cache' : 'public, max-age=300',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

async function handleConfig(context) {
  const { response, env, fetchImpl, clock } = context;
  let models = [];
  let gatewayReachable = true;
  try {
    models = await listModels(env, fetchImpl, clock.signal);
  } catch {
    gatewayReachable = false;
  }
  const posePresets = POSE_PRESETS.map(({ id, label, hint, posewearId, referenceFile }) => ({
    id,
    label,
    hint,
    posewearId,
    referenceUrl: `/posewear/${referenceFile}`,
  }));
  const defaultPosePreset = posePresets.some(({ id }) => id === DEFAULT_POSE_PRESET)
    ? DEFAULT_POSE_PRESET
    : posePresets[0].id;
  sendJson(response, 200, {
    ...priceCatalog(models),
    demoMode: isDemoMode(env),
    gateway: { reachable: gatewayReachable },
    categories: CATEGORIES,
    slots: SLOTS,
    garmentTypes: GARMENT_TYPES,
    fits: FITS,
    studioPresets: STUDIO_PRESETS.map(({ id, label, hint }) => ({ id, label, hint })),
    posePresets,
    defaultStudioPreset: DEFAULT_STUDIO_PRESET,
    defaultPosePreset,
    limits: { imageBytes: MAX_IMAGE_BYTES, requestBytes: MAX_BODY_BYTES, promptChars: MAX_PROMPT_CHARS, maxPieces: MAX_PIECES },
  });
}

async function handleSettingsRead(context) {
  const { response, env, fetchImpl, clock, store, dataDir } = context;
  let models = [];
  let gatewayReachable = true;
  try {
    models = await listModels(env, fetchImpl, clock.signal);
  } catch {
    gatewayReachable = false;
  }
  const catalog = priceCatalog(models);
  const settings = store.getSettings();
  // 只回「是否配置了 cookie」的布尔值；京东/抖音免登录恒为 true，绝不返回 cookie 内容。
  let cookies = {};
  try {
    cookies = loadCookies(env, dataDir);
  } catch {
    cookies = {};
  }
  sendJson(response, 200, {
    // 存下来的模型可能已经不在当前目录里，这时对外报告真正会用的那个。
    model: settings.model && models.includes(settings.model) ? settings.model : catalog.defaultModel,
    models: catalog.models,
    demoMode: isDemoMode(env),
    sources: {
      taobao: Boolean(cookies.taobao),
      jd: true,
      pdd: Boolean(cookies.pdd),
      douyin: true,
    },
    gateway: { reachable: gatewayReachable },
  });
}

function readModelId(value) {
  const model = assertString(value, 'model', { max: 120 });
  if (isRetiredImageModel(model)) throw new HttpError(400, 'MODEL_UNAVAILABLE', '所选模型已不可用，请重新加载配置', 'model');
  return model;
}

async function handleSettingsUpdate(context) {
  const { response, request, store, clock, env, fetchImpl } = context;
  const input = await readJsonBody(request, clock.signal);
  const model = readModelId(input?.model);
  // 只允许选当前网关真实列出来的模型：写进一个不存在的名字，下一次下单才会 400，太晚了。
  const models = await listModels(env, fetchImpl, clock.signal);
  if (!models.includes(model)) {
    throw new HttpError(400, 'MODEL_UNAVAILABLE', '这个模型当前不可用，请刷新后重选', 'model');
  }
  const settings = await store.updateSettings({ model });
  sendJson(response, 200, { model: settings.model });
}

async function handleProducts(context) {
  const { response, url, store } = context;
  const rawLimit = Number(url.searchParams.get('limit') ?? 60);
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 60;
  const products = store.listProducts({
    category: url.searchParams.get('category') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    limit,
  });
  sendJson(response, 200, { products });
}

async function handleProduct(context) {
  const { response, store, productId } = context;
  const product = store.findProduct(productId);
  if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', '商品不存在或已下架');
  sendJson(response, 200, { product });
}

async function handleSessionCreate(context) {
  const { response, store, clock } = context;
  const input = await readJsonBody(context.request, clock.signal);
  const deviceId = assertString(input?.deviceId, 'deviceId', { max: 128 });
  const session = await store.getOrCreateSession(deviceId);
  sendJson(response, 200, { sessionId: session.id, balanceCents: session.balanceCents, packs: [] });
}

async function handleSessionRead(context) {
  const { response, store, sessionId } = context;
  const session = store.getSession(sessionId);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', '会话不存在或已失效');
  sendJson(response, 200, { sessionId: session.id, balanceCents: session.balanceCents, packs: [] });
}

function resolveOrderInput(context, input) {
  const { store } = context;
  const product = input?.productId ? store.findProduct(input.productId) : null;
  if (input?.productId && !product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', '商品不存在或已下架', 'productId');
  const category = product ? product.category : input?.category;
  if (!isCategory(category)) throw new HttpError(400, 'INVALID_REQUEST', '请选择上衣、下装或连衣裙', 'category');
  const garmentType = product ? product.garmentType : input?.garmentType;
  if (!isGarmentType(category, garmentType)) throw new HttpError(400, 'INVALID_REQUEST', '服装子类与分类不匹配', 'garmentType');
  const extra = input?.prompt === undefined ? '' : input.prompt;
  if (typeof extra !== 'string' || [...extra.trim()].length > MAX_PROMPT_CHARS) {
    throw new HttpError(400, 'INVALID_REQUEST', '补充要求不得超过500个字符', 'prompt');
  }
  // 商品名会进提示词，外部商品标题属于不可信输入：单行化并限长。
  const sourceName = input?.sourceName === undefined ? '' : sanitizeText(input.sourceName, 80);
  return { product, category, garmentType, extra: extra.trim(), sourceName };
}

/** 目录商品图转成已校验的 data URL，与上传路径走同一套校验与下发方式。 */
async function catalogImageDataUrl(product) {
  const path = resolve(PUBLIC_DIR, product.image ?? '');
  if (!withinPublic(path)) throw new HttpError(500, 'CATALOG_INVALID', '商品图配置有误');
  const buffer = await readFile(path).catch(() => null);
  if (!buffer) throw new HttpError(404, 'PRODUCT_NOT_FOUND', '商品图片缺失');
  const mime = sniff(buffer);
  if (!mime) throw new HttpError(500, 'CATALOG_INVALID', '商品图格式不支持');
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(500, 'CATALOG_INVALID', '商品图超过8MiB');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function parseExtra(value) {
  const extra = value === undefined ? '' : value;
  if (typeof extra !== 'string' || [...extra.trim()].length > MAX_PROMPT_CHARS) {
    throw new HttpError(400, 'INVALID_REQUEST', '补充要求不得超过500个字符', 'prompt');
  }
  return extra.trim();
}

/** 影棚参数在取图前定型；普通试穿未传摄影模式时保持旧行为。 */
function parsePhotography(input) {
  const mode = input?.photographyMode ?? 'preserve';
  if (!['preserve', 'studio'].includes(mode)) {
    throw new HttpError(400, 'INVALID_REQUEST', '摄影模式无效', 'photographyMode');
  }
  if (mode !== 'studio') {
    return { photographyMode: 'preserve', studioPreset: null, posePreset: null };
  }
  return {
    photographyMode: 'studio',
    studioPreset: normalizeStudioPreset(input?.studioPreset ?? DEFAULT_STUDIO_PRESET),
    posePreset: normalizePosePreset(input?.posePreset ?? DEFAULT_POSE_PRESET),
  };
}

async function poseReferenceDataUrl(posePreset) {
  const pose = POSE_PRESETS.find((item) => item.id === normalizePosePreset(posePreset));
  const path = resolve(PUBLIC_DIR, 'posewear', pose.referenceFile);
  if (!withinPublic(path)) throw new HttpError(500, 'POSE_REFERENCE_INVALID', '姿势参考图配置有误');
  const buffer = await readFile(path).catch(() => null);
  const mime = buffer ? sniff(buffer) : null;
  if (!buffer || !mime) throw new HttpError(500, 'POSE_REFERENCE_INVALID', '姿势参考图缺失或格式不支持');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function preflightGenerationReferenceCount(model, count) {
  if (count <= MAX_REFERENCE_IMAGES) return;
  throw new HttpError(400, 'REFERENCE_LIMIT', `${model} 最多接收 ${MAX_REFERENCE_IMAGES} 张参考图，请减少单品`, 'pieces');
}

/** 旧单件字段的 category 映射到穿搭格子；上衣里 jacket/coat 属于外套格。 */
function legacySlot(category, garmentType) {
  if (category === 'bottoms') return 'bottom';
  if (category === 'dresses') return 'dress';
  const type = (GARMENT_TYPES.tops ?? []).find((item) => item.id === garmentType);
  return type?.layer === 'outer' ? 'outer' : 'top';
}

/** 旧单件字段取图：目录商品 / 链接导入 / 直传，统一收敛成已校验的 data URL。 */
async function legacyGarment(context, { product }, input) {
  const { sources, clock } = context;
  if (product) return catalogImageDataUrl(product);
  if (input?.sourceId !== undefined) {
    const sourceId = assertString(input.sourceId, 'sourceId', { max: 64 });
    const sourceIndex = input.sourceIndex ?? 0;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0) {
      throw new HttpError(400, 'INVALID_REQUEST', '商品图序号不合法', 'sourceIndex');
    }
    return (await sources.dataUrl(sourceId, sourceIndex, clock.signal)).dataUrl;
  }
  decodeImage(input?.garment, 'garment');
  return input.garment;
}

/**
 * 多件穿搭：校验 slot 白名单、格子×层级叠穿、dress 与 top/bottom 互斥、总件数，
 * 并按 source.kind 取每件的图。所有图必须在建单前取到。
 */
async function resolvePieces(context, rawPieces) {
  const { store, sources, wardrobe, clock } = context;
  if (!Array.isArray(rawPieces) || rawPieces.length === 0) {
    throw new HttpError(400, 'INVALID_REQUEST', '请至少选择一件单品', 'pieces');
  }
  if (rawPieces.length > MAX_PIECES) {
    throw new HttpError(400, 'INVALID_REQUEST', `单次最多搭配 ${MAX_PIECES} 件单品`, 'pieces');
  }
  const resolved = [];
  for (const raw of rawPieces) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HttpError(400, 'INVALID_REQUEST', '单品格式不正确', 'pieces');
    }
    const { slot } = raw;
    if (!isSlot(slot)) throw new HttpError(400, 'INVALID_REQUEST', '未知的穿搭格子', 'pieces');

    let garmentType = raw.garmentType === undefined || raw.garmentType === null
      ? ''
      : assertString(raw.garmentType, 'garmentType', { max: 24 });
    const source = raw.source && typeof raw.source === 'object' ? raw.source : {};
    let dataUrl;
    let layer = normalizeLayer(raw.layer);
    let name = '';
    let product = null;
    if (source.kind === 'product') {
      product = store.findProduct(assertString(source.productId, 'productId', { max: 64 }));
      if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', '商品不存在或已下架', 'productId');
      if (!garmentType && product.garmentType) garmentType = product.garmentType;
      dataUrl = await catalogImageDataUrl(product);
      name = `${product.name}（${product.subtitle ?? ''}）`;
    } else if (source.kind === 'import') {
      const sourceId = assertString(source.sourceId, 'sourceId', { max: 64 });
      const sourceIndex = source.sourceIndex ?? 0;
      if (!Number.isInteger(sourceIndex) || sourceIndex < 0) {
        throw new HttpError(400, 'INVALID_REQUEST', '商品图序号不合法', 'sourceIndex');
      }
      dataUrl = (await sources.dataUrl(sourceId, sourceIndex, clock.signal)).dataUrl;
      name = source.name === undefined ? '' : sanitizeText(source.name, 80);
    } else if (source.kind === 'upload') {
      decodeImage(source.image, 'image');
      dataUrl = source.image;
    } else if (source.kind === 'wardrobe') {
      const wardrobeId = assertString(source.wardrobeId, 'wardrobeId', { max: 64 });
      const image = await wardrobe.readImage(wardrobeId);
      if (!image) throw new HttpError(404, 'WARDROBE_NOT_FOUND', '这件单品不在衣橱里', 'wardrobeId');
      const mime = sniff(image.buffer);
      if (!mime) throw new HttpError(400, 'INVALID_IMAGE', '衣橱里的这张图格式不支持', 'wardrobeId');
      dataUrl = `data:${mime};base64,${image.buffer.toString('base64')}`;
      const stored = await wardrobe.get(wardrobeId);
      // 衣橱条目自带类目：放进不匹配的格子会把裙子当上衣交给模型，生成结果必然错。
      if (stored?.category && stored.category !== slot) {
        throw new HttpError(400, 'PIECE_SLOT_MISMATCH', `这件单品是${slotLabel(stored.category)}，不能放进${slotLabel(slot)}`, 'pieces');
      }
      name = stored?.name ?? '';
      layer = normalizeLayer(raw.layer ?? stored?.layer);
    } else {
      throw new HttpError(400, 'INVALID_REQUEST', '单品来源不合法', 'source');
    }
    resolved.push({ slot, layer, garmentType: garmentType || slotLabel(slot), name, dataUrl, product });
  }
  const conflict = findOutfitConflict(resolved);
  if (conflict?.kind === 'layer') {
    const piece = resolved[conflict.secondIndex];
    throw new HttpError(400, 'INVALID_REQUEST', `同一格子的同一穿着层级最多一件（${slotLabel(piece.slot)}·${piece.layer}）`, 'pieces');
  }
  if (conflict?.kind === 'accessory-limit') {
    throw new HttpError(400, 'INVALID_REQUEST', `配饰最多 ${MAX_ACCESSORIES} 件`, 'pieces');
  }
  if (conflict?.kind === 'dress') {
    throw new HttpError(400, 'INVALID_REQUEST', '连衣裙不能与上衣或下装同时选择', 'pieces');
  }
  return orderPieces(resolved);
}

async function handleOrderCreate(context) {
  const { response, request, store, tryon, env, fetchImpl, clock } = context;
  const input = await readJsonBody(request, clock.signal);
  const sessionId = assertString(input?.sessionId, 'sessionId', { max: 64 });
  const session = store.getSession(sessionId);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', '会话不存在或已失效');
  const requested = input?.model;
  const requestedModel = requested === undefined || requested === null || requested === '' ? null : readModelId(requested);
  const legacy = !Array.isArray(input?.pieces);
  const photography = parsePhotography(input);

  // 旧的单件字段（productId/category/garmentType 或 sourceId/garment）先解析出分类与补充要求。
  let legacyInput = null;
  let extra;
  if (legacy) {
    legacyInput = resolveOrderInput(context, input);
    extra = legacyInput.extra;
  } else {
    extra = parseExtra(input?.prompt);
  }

  const models = await listModels(env, fetchImpl, clock.signal);
  const settings = store.getSettings();
  // 存下来的模型可能已经不在当前目录里（换了服务地址或模型下线）。这时退回默认模型，
  // 而不是让每一次下单都报 MODEL_UNAVAILABLE——用户在下单页无从修复。
  const saved = settings.model && models.includes(settings.model) ? settings.model : null;
  const model = requestedModel ?? saved ?? priceCatalog(models).defaultModel;
  if (!model || !models.includes(model)) {
    throw new HttpError(400, 'MODEL_UNAVAILABLE', '所选模型已不可用，请重新加载配置', 'model');
  }
  const tier = resolveTier(model, input?.tier);
  const personImage = decodeImage(input?.person, 'person');
  const face = await studioFaceReference(personImage, input?.personSource, photography.photographyMode);

  let pieces;
  let product = null;
  let category = null;
  let garmentType = null;
  if (legacy) {
    product = legacyInput.product;
    category = legacyInput.category;
    garmentType = legacyInput.garmentType;
    const dataUrl = await legacyGarment(context, legacyInput, input);
    pieces = [{
      slot: legacySlot(category, garmentType),
      garmentType: garmentTypeLabel(category, garmentType) || garmentType,
      name: product ? `${product.name}（${product.subtitle ?? ''}）` : legacyInput.sourceName,
      dataUrl,
      product,
    }];
  } else {
    pieces = await resolvePieces(context, input.pieces);
  }

  const prompt = buildOutfitPrompt({
    pieces,
    fit: input?.fit ?? 'regular',
    extra,
    photographyMode: photography.photographyMode,
    posewearBody: Boolean(face),
    studioPreset: photography.studioPreset ?? DEFAULT_STUDIO_PRESET,
    posePreset: photography.posePreset ?? DEFAULT_POSE_PRESET,
  });
  const slots = pieces.map((piece) => piece.slot);
  const productName = pieces.length === 1
    ? (product?.name ?? (pieces[0].name || '自定义试穿'))
    : '搭配试穿';
  const poseReference = photography.photographyMode === 'studio'
    ? await poseReferenceDataUrl(photography.posePreset)
    : null;
  const referenceImages = [input.person, ...(face ? [face] : []), ...pieces.map((piece) => piece.dataUrl), ...(poseReference ? [poseReference] : [])];
  preflightGenerationReferenceCount(model, referenceImages.length);
  // 上游按 size 约束输出画幅；无影棚提示词与产品契约固定为 2:3，不能只靠模型自行裁切。
  const outputSize = photography.photographyMode === 'studio' ? '1024x1536' : tier.size;

  tryon.reserve(sessionId);
  let order = null;
  let job = null;
  try {
    order = await store.createOrder({
      sessionId,
      productId: product?.id ?? null,
      productName,
      model,
      tier: tier.tier,
      quality: tier.quality,
      size: outputSize,
      category,
      garmentType,
      slots,
      pieces: pieces.map(({ slot, layer = 'auto', garmentType, name }) => ({ slot, layer, garmentType, name })),
      ...photography,
      prompt,
    });
    // 人像与各件服装图只留在任务内存里，不写入订单记录，避免落盘。
    // start=false：先把 jobId 落库再启动，否则「订单已建但没记 jobId」的窗口里任务已在跑。
    job = tryon.enqueue({
      orderId: order.id,
      sessionId,
      payload: {
        model,
        prompt,
        referenceImages,
        quality: tier.quality,
        size: outputSize,
      },
      start: false,
    });
    await store.updateOrder(order.id, { jobId: job.id });
    tryon.start(job.id);
    sendJson(response, 201, {
      order: { id: order.id, status: order.status, slots, priceCents: order.priceCents },
      orderId: order.id,
      jobId: job.id,
      priceCents: order.priceCents,
      balanceCents: store.getSession(sessionId).balanceCents,
    });
  } catch (error) {
    tryon.release(sessionId);
    if (job) tryon.cancel(job.id, 'ORDER_ABORTED');
    if (order) {
      await store.failOrder(order.id, { errorCode: 'ORDER_ABORTED', errorMessage: '试穿任务未能启动' });
    }
    throw error;
  }
}

async function handleOrderList(context) {
  const { response, store, request, url } = context;
  const sessionId = sessionIdFrom(request, url);
  const orders = store.listOrders(sessionId).map((order) => ({
    id: order.id,
    productName: order.productName,
    model: order.model,
    tier: order.tier,
    category: order.category,
    garmentType: order.garmentType,
    slots: order.slots ?? [],
    photographyMode: order.photographyMode ?? 'preserve',
    studioPreset: order.studioPreset ?? null,
    posePreset: order.posePreset ?? null,
    priceCents: order.priceCents,
    status: order.status,
    jobId: order.jobId,
    createdAt: order.createdAt,
    finishedAt: order.finishedAt,
    errorMessage: order.errorMessage,
  }));
  sendJson(response, 200, { orders });
}

async function handleOrderRead(context) {
  const { response, store, request, url, orderId } = context;
  const sessionId = sessionIdFrom(request, url);
  const order = store.getOrder(orderId);
  if (!order || order.sessionId !== sessionId) throw new HttpError(404, 'ORDER_NOT_FOUND', '订单不存在');
  const { prompt: _prompt, person: _person, garment: _garment, costCents: _costCents, ...rest } = order;
  sendJson(response, 200, {
    order: {
      ...rest,
      photographyMode: order.photographyMode ?? 'preserve',
      studioPreset: order.studioPreset ?? null,
      posePreset: order.posePreset ?? null,
      hasResult: Boolean(order.resultFile),
      resultToken: order.resultFile ? issueResultToken(order.resultFile) : null,
    },
  });
}

async function handleJob(context) {
  const { response, tryon, jobId } = context;
  const job = tryon.getJob(jobId);
  if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', '任务不存在');
  sendJson(response, 200, {
    jobId: job.id,
    orderId: job.orderId,
    status: job.status,
    stage: job.stage,
    error: job.error,
    updatedAt: job.updatedAt,
  });
}

function rejectPayment() {
  throw new HttpError(403, 'PAYMENT_DISABLED', '测试期间试穿免费，充值通道已关闭');
}

async function handleTryon(context) {
  const { response, request, env, fetchImpl, clock, allowRawTryon } = context;
  if (isDemoMode(env) || !allowRawTryon) throw new HttpError(403, 'RAW_TRYON_DISABLED', '直连生成接口已关闭，请使用下单流程');
  const input = await readJsonBody(request, clock.signal);
  const model = readModelId(input?.model);
  const category = input?.category;
  if (!isCategory(category)) throw new HttpError(400, 'INVALID_REQUEST', '请选择上衣、下装或连衣裙', 'category');
  const garmentType = input?.garmentType ?? GARMENT_TYPES[category][0].id;
  if (!isGarmentType(category, garmentType)) throw new HttpError(400, 'INVALID_REQUEST', '服装子类与分类不匹配', 'garmentType');
  const tier = resolveTier(model, input?.tier);
  decodeImage(input?.person, 'person');
  decodeImage(input?.garment, 'garment');
  const extra = input?.prompt === undefined ? '' : input.prompt;
  if (typeof extra !== 'string' || [...extra.trim()].length > MAX_PROMPT_CHARS) {
    throw new HttpError(400, 'INVALID_REQUEST', '补充要求不得超过500个字符', 'prompt');
  }
  const prompt = buildTryonPrompt({ category, garmentType, fit: input?.fit ?? 'regular', extra: extra.trim() });
  const { mimeType, buffer } = await generateImage({
    model,
    prompt,
    referenceImages: [input.person, input.garment],
    quality: tier.quality,
    size: tier.size,
  }, env, fetchImpl, { timeoutMs: context.timeoutMs, signal: clock.signal });
  sendJson(response, 200, {
    engine: model,
    tier: tier.tier,
    image: { mimeType, dataURL: `data:${mimeType};base64,${buffer.toString('base64')}` },
    createdAt: new Date().toISOString(),
  });
}

async function handleSourceCreate(context) {
  const { response, request, sources, clock } = context;
  const input = await readJsonBody(request, clock.signal);
  const source = await sources.create(input?.url, clock.signal);
  sendJson(response, 201, {
    source: {
      id: source.id,
      platform: source.platform,
      platformLabel: source.platformLabel,
      title: source.title,
      images: source.images.map((image, index) => ({ index, group: image.group })),
    },
  });
}

async function handleSourceImage(context) {
  const { response, sources, sourceId, index, clock } = context;
  const { mime, buffer } = await sources.download(sourceId, index, clock.signal);
  response.writeHead(200, {
    'content-type': mime,
    'content-length': buffer.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(buffer);
}

async function handleResult(context) {
  const { response, url, file, resultsDir } = context;
  const token = url.searchParams.get('k') ?? '';
  if (!verifyResultToken(file, token)) throw new HttpError(403, 'RESULT_FORBIDDEN', '结果链接已失效，请重新打开订单');
  const body = await readFile(resolve(resultsDir, file)).catch(() => null);
  if (!body) throw new HttpError(404, 'NOT_FOUND', '结果不存在或已过期');
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

/** 衣橱条目对外的视图：只给 id/名称/类目与图片地址，不暴露落盘路径。 */
function wardrobeItemView(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    subtype: item.subtype ?? '',
    layer: normalizeLayer(item.layer),
    tags: item.tags ?? [],
    description: item.description ?? '',
    source: item.source,
    imageUrl: `/api/wardrobe/${item.id}/image`,
    createdAt: item.createdAt,
  };
}

async function handleWardrobeList(context) {
  const { response, wardrobe } = context;
  const items = await wardrobe.list();
  sendJson(response, 200, { items: items.map(wardrobeItemView) });
}

async function handleWardrobeCreate(context) {
  const { response, request, wardrobe, clock } = context;
  const input = await readJsonBody(request, clock.signal);
  const item = await wardrobe.add(input ?? {});
  sendJson(response, 201, { item: wardrobeItemView(item) });
}

async function handleWardrobeDelete(context) {
  const { response, wardrobe, wardrobeId } = context;
  const ok = await wardrobe.remove(wardrobeId);
  if (!ok) throw new HttpError(404, 'WARDROBE_NOT_FOUND', '这件单品不在衣橱里');
  response.writeHead(204);
  response.end();
}

async function handleWardrobeUpdate(context) {
  const { response, request, wardrobe, wardrobeId, clock } = context;
  const input = await readJsonBody(request, clock.signal);
  const item = await wardrobe.update(wardrobeId, input ?? {});
  if (!item) throw new HttpError(404, 'WARDROBE_NOT_FOUND', '这件单品不在衣橱里');
  sendJson(response, 200, { item: wardrobeItemView(item) });
}

async function handleWardrobeImage(context) {
  const { response, wardrobe, wardrobeId } = context;
  const image = await wardrobe.readImage(wardrobeId);
  if (!image) throw new HttpError(404, 'WARDROBE_NOT_FOUND', '这件单品不在衣橱里');
  response.writeHead(200, {
    'content-type': image.mime,
    'content-length': image.buffer.length,
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
  });
  response.end(image.buffer);
}

async function handleWardrobeSearch(context) {
  const { response, request, wardrobe, clock } = context;
  const input = await readJsonBody(request, clock.signal);
  const query = assertString(input?.query, 'query', { max: 200 });
  const limit = Math.min(Math.max(Number(input?.limit) || 8, 1), 20);
  const results = await wardrobe.search(query, limit);
  sendJson(response, 200, {
    results: results.map((entry) => ({ item: wardrobeItemView(entry.item), score: entry.score })),
  });
}

async function handleOutfitSuggest(context) {
  const { response, request, stylist, clock, demoMode } = context;
  const input = await readJsonBody(request, clock.signal);
  // 每次建议最多等 25s 上游对话调用，且没有会话额度概念：演示模式直接按规则挑，
  // 既不让一个公开演示页把网关打到限流，也不消耗上游额度。
  const suggestion = demoMode
    ? await stylist.suggestByRule(input?.request)
    : await stylist.suggest(input?.request);
  const slots = {};
  for (const [slot, value] of Object.entries(suggestion.slots ?? {})) {
    slots[slot] = Array.isArray(value) ? value.map(wardrobeItemView) : wardrobeItemView(value);
  }
  sendJson(response, 200, { suggestion: { slots, reason: suggestion.reason, missing: suggestion.missing } });
}

async function handleLoginStart(context) {
  const { response, login, platform } = context;
  const session = await login.start(platform);
  sendJson(response, 202, { sessionId: session.sessionId });
}

async function handleLoginStatus(context) {
  const { response, login, platform, url } = context;
  const sessionId = url.searchParams.get('sessionId') ?? '';
  if (!sessionId) throw new HttpError(400, 'INVALID_REQUEST', '缺少 sessionId', 'sessionId');
  sendJson(response, 200, await login.status(platform, sessionId));
}

async function handleLoginCancel(context) {
  const { response, request, login, platform, clock } = context;
  const input = await readJsonBody(request, clock.signal).catch(() => ({}));
  await login.cancel(platform, input?.sessionId);
  response.writeHead(204);
  response.end();
}

const ROUTES = [
  { method: 'GET', pattern: /^\/api\/config$/, handler: handleConfig },
  { method: 'GET', pattern: /^\/api\/settings$/, handler: handleSettingsRead },
  { method: 'PATCH', pattern: /^\/api\/settings$/, handler: handleSettingsUpdate },
  { method: 'GET', pattern: /^\/api\/products$/, handler: handleProducts },
  { method: 'GET', pattern: /^\/api\/products\/(?<productId>[^/]+)$/, handler: handleProduct },
  { method: 'POST', pattern: /^\/api\/session$/, handler: handleSessionCreate },
  { method: 'GET', pattern: /^\/api\/session\/(?<sessionId>[^/]+)$/, handler: handleSessionRead },
  { method: 'POST', pattern: /^\/api\/orders$/, handler: handleOrderCreate },
  { method: 'GET', pattern: /^\/api\/orders$/, handler: handleOrderList },
  { method: 'GET', pattern: /^\/api\/orders\/(?<orderId>[^/]+)$/, handler: handleOrderRead },
  { method: 'GET', pattern: /^\/api\/jobs\/(?<jobId>[^/]+)$/, handler: handleJob },
  { method: 'POST', pattern: /^\/api\/payments(?:\/[^/]+\/confirm)?$/, handler: rejectPayment },
  { method: 'POST', pattern: /^\/api\/sources$/, handler: handleSourceCreate },
  { method: 'GET', pattern: /^\/api\/sources\/(?<sourceId>[^/]+)\/(?<index>\d+)$/, handler: handleSourceImage },
  { method: 'GET', pattern: /^\/api\/wardrobe$/, handler: handleWardrobeList },
  { method: 'POST', pattern: /^\/api\/wardrobe$/, handler: handleWardrobeCreate },
  { method: 'POST', pattern: /^\/api\/wardrobe\/search$/, handler: handleWardrobeSearch },
  { method: 'DELETE', pattern: /^\/api\/wardrobe\/(?<wardrobeId>[^/]+)$/, handler: handleWardrobeDelete },
  { method: 'PATCH', pattern: /^\/api\/wardrobe\/(?<wardrobeId>[^/]+)$/, handler: handleWardrobeUpdate },
  { method: 'GET', pattern: /^\/api\/wardrobe\/(?<wardrobeId>[^/]+)\/image$/, handler: handleWardrobeImage },
  { method: 'POST', pattern: /^\/api\/outfit\/suggest$/, handler: handleOutfitSuggest },
  { method: 'POST', pattern: /^\/api\/login\/(?<platform>taobao|jd|pdd)$/, handler: handleLoginStart },
  { method: 'GET', pattern: /^\/api\/login\/(?<platform>taobao|jd|pdd)\/status$/, handler: handleLoginStatus },
  { method: 'POST', pattern: /^\/api\/login\/(?<platform>taobao|jd|pdd)\/cancel$/, handler: handleLoginCancel },
  { method: 'POST', pattern: /^\/api\/tryon$/, handler: handleTryon },
  { method: 'GET', pattern: /^\/api\/results\/(?<file>[^/]+)$/, handler: handleResult },
];

function matchRoute(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    return { handler: route.handler, ...match.groups };
  }
  return null;
}

export function createApp({ env = process.env, fetchImpl = fetch, store, tryon, sources, wardrobe, login, stylist, timeoutMs = 120_000, resultsDir = RESULTS_DIR, dataDir }) {
  // 数据目录与 server.mjs 传给 store/wardrobe/login 的是同一个：cookie 文件的读写必须落在同一处。
  const resolvedDataDir = dataDir ?? resolve(resultsDir, '..');
  const allowRawTryon = !env.PUBLIC_ORIGIN || env.ENABLE_RAW_TRYON === '1' || env.ENABLE_SIMULATED_PAYMENTS === '1';
  const app = createServer(async (request, response) => {
    let clock;
    let disconnect;
    try {
      checkRequest(request, app.address()?.port, env);
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = url.pathname;
      if (!request.url.startsWith('/') || pathname !== url.pathname) throw new HttpError(404, 'NOT_FOUND', '页面不存在');
      const route = matchRoute(request.method, pathname);
      if (!route) {
        if (pathname !== '/api' && !pathname.startsWith('/api/')) return await serveStatic(request, response, pathname);
        const allowed = ROUTES.filter(({ pattern }) => pattern.test(pathname)).map(({ method }) => method);
        if (!allowed.length) throw new HttpError(404, 'NOT_FOUND', '接口不存在');
        response.setHeader('Allow', allowed.join(', '));
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', '此接口不支持该请求方法');
      }
      const controller = new AbortController();
      disconnect = () => {
        if (!response.writableEnded) controller.abort(new Error('Client disconnected'));
      };
      response.on('close', disconnect);
      clock = deadline(timeoutMs, controller.signal);
      await route.handler({
        request,
        response,
        url,
        env,
        fetchImpl,
        store,
        tryon,
        sources,
        wardrobe,
        login,
        stylist,
        clock,
        timeoutMs,
        allowRawTryon,
        demoMode: isDemoMode(env),
        resultsDir,
        dataDir: resolvedDataDir,
        ...route,
      });
    } catch (error) {
      const known = error instanceof HttpError;
      sendJson(response, known ? error.status : 500, {
        error: {
          code: known ? error.code : 'INTERNAL_ERROR',
          message: known ? error.message : '请求处理失败',
          ...(known && error.field ? { field: error.field } : {}),
        },
      });
    } finally {
      clock?.dispose();
      if (disconnect) response.off('close', disconnect);
      if (!request.complete && !request.destroyed) request.resume();
    }
  });
  return app;
}
