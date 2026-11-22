import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HttpError } from './errors.mjs';
import { generateImage, listModels, deadline } from './the image service.mjs';
import { buildTryonPrompt, CATEGORIES, FITS, GARMENT_TYPES, isCategory, isGarmentType, sanitizeText } from './prompt.mjs';
import { priceCatalog, resolveTier } from './pricing.mjs';
import { assertString, decodeImage, MAX_BODY_BYTES, MAX_IMAGE_BYTES, MAX_PROMPT_CHARS, sniff } from './validate.mjs';

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
    || (request.method === 'POST' && origin === undefined && !env.PUBLIC_ORIGIN)
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
    'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300',
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
  sendJson(response, 200, {
    ...priceCatalog(models),
    gateway: { reachable: gatewayReachable },
    categories: CATEGORIES,
    garmentTypes: GARMENT_TYPES,
    fits: FITS,
    limits: { imageBytes: MAX_IMAGE_BYTES, requestBytes: MAX_BODY_BYTES, promptChars: MAX_PROMPT_CHARS },
  });
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
  sendJson(response, 200, { sessionId: session.id, balanceCents: session.balanceCents, packs: priceCatalog([]).packs });
}

async function handleSessionRead(context) {
  const { response, store, sessionId } = context;
  const session = store.getSession(sessionId);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', '会话不存在或已失效');
  sendJson(response, 200, { sessionId: session.id, balanceCents: session.balanceCents, packs: priceCatalog([]).packs });
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

async function handleOrderCreate(context) {
  const { response, request, store, tryon, sources, env, fetchImpl, clock } = context;
  const input = await readJsonBody(request, clock.signal);
  const sessionId = assertString(input?.sessionId, 'sessionId', { max: 64 });
  const session = store.getSession(sessionId);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', '会话不存在或已失效');
  const { product, category, garmentType, extra, sourceName } = resolveOrderInput(context, input);
  const model = assertString(input?.model, 'model', { max: 120 });
  const models = await listModels(env, fetchImpl, clock.signal);
  if (!models.includes(model)) throw new HttpError(400, 'MODEL_UNAVAILABLE', '所选模型已不可用，请重新加载配置', 'model');
  const tier = resolveTier(model, input?.tier);
  decodeImage(input?.person, 'person');
  // 服装图三种来源：目录商品、外部链接导入的商品图、直传。都收敛成已校验的 data URL。
  let garment;
  if (product) {
    garment = await catalogImageDataUrl(product);
  } else if (input?.sourceId !== undefined) {
    const sourceId = assertString(input.sourceId, 'sourceId', { max: 64 });
    const sourceIndex = input.sourceIndex ?? 0;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0) {
      throw new HttpError(400, 'INVALID_REQUEST', '商品图序号不合法', 'sourceIndex');
    }
    garment = (await sources.dataUrl(sourceId, sourceIndex, clock.signal)).dataUrl;
  } else {
    decodeImage(input?.garment, 'garment');
    garment = input.garment;
  }
  // 先占位再扣费：占位失败不扣钱；扣费后任何异常都全额退回。
  tryon.reserve(sessionId);
  if (session.balanceCents < tier.priceCents) {
    tryon.release(sessionId);
    throw new HttpError(402, 'INSUFFICIENT_BALANCE', `余额不足，还差 ${tier.priceCents - session.balanceCents} 分`, 'balance');
  }
  const garmentLabel = product ? `${product.name}（${product.subtitle ?? ''}）` : sourceName;
  const prompt = buildTryonPrompt({
    category,
    garmentType,
    garmentName: garmentLabel,
    fit: input?.fit ?? 'regular',
    extra,
  });
  try {
    await store.addBalance(sessionId, -tier.priceCents);
    const order = await store.createOrder({
      sessionId,
      productId: product?.id ?? null,
      productName: product?.name ?? (sourceName || '自定义试穿'),
      model,
      tier: tier.tier,
      quality: tier.quality,
      size: tier.size,
      category,
      garmentType,
      prompt,
      priceCents: tier.priceCents,
      costCents: tier.costCents,
    });
    // 人像与服装图只留在任务内存里，不写入订单记录，避免落盘。
    const job = tryon.enqueue({
      orderId: order.id,
      sessionId,
      payload: { model, prompt, person: input.person, garment, quality: tier.quality, size: tier.size },
    });
    await store.updateOrder(order.id, { jobId: job.id });
    sendJson(response, 201, {
      orderId: order.id,
      jobId: job.id,
      priceCents: tier.priceCents,
      balanceCents: store.getSession(sessionId).balanceCents,
    });
  } catch (error) {
    tryon.release(sessionId);
    await store.addBalance(sessionId, tier.priceCents);
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

async function handlePaymentCreate(context) {
  const { response, request, store, clock, allowSimulation } = context;
  if (!allowSimulation) throw new HttpError(403, 'PAYMENT_DISABLED', '真实支付未接入，充值通道已关闭');
  const input = await readJsonBody(request, clock.signal);
  const sessionId = assertString(input?.sessionId, 'sessionId', { max: 64 });
  const payment = await store.createPayment({ sessionId, packId: input?.packId });
  sendJson(response, 201, {
    paymentId: payment.id,
    amountCents: payment.amountCents,
    status: payment.status,
    channels: [],
    notice: '真实支付通道未接入，此处为本地模拟充值',
  });
}

async function handlePaymentConfirm(context) {
  const { response, request, store, clock, paymentId, allowSimulation } = context;
  if (!allowSimulation) throw new HttpError(403, 'PAYMENT_DISABLED', '真实支付未接入，充值通道已关闭');
  const input = await readJsonBody(request, clock.signal);
  const sessionId = assertString(input?.sessionId, 'sessionId', { max: 64 });
  const payment = await store.payPayment(paymentId, sessionId);
  sendJson(response, 200, {
    paymentId: payment.id,
    status: payment.status,
    balanceCents: store.getSession(sessionId).balanceCents,
  });
}

async function handleTryon(context) {
  const { response, request, env, fetchImpl, clock, allowSimulation } = context;
  if (!allowSimulation) throw new HttpError(403, 'RAW_TRYON_DISABLED', '直连生成接口已关闭，请使用下单流程');
  const input = await readJsonBody(request, clock.signal);
  const model = assertString(input?.model, 'model', { max: 120 });
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

const ROUTES = [
  { method: 'GET', pattern: /^\/api\/config$/, handler: handleConfig },
  { method: 'GET', pattern: /^\/api\/products$/, handler: handleProducts },
  { method: 'GET', pattern: /^\/api\/products\/(?<productId>[^/]+)$/, handler: handleProduct },
  { method: 'POST', pattern: /^\/api\/session$/, handler: handleSessionCreate },
  { method: 'GET', pattern: /^\/api\/session\/(?<sessionId>[^/]+)$/, handler: handleSessionRead },
  { method: 'POST', pattern: /^\/api\/orders$/, handler: handleOrderCreate },
  { method: 'GET', pattern: /^\/api\/orders$/, handler: handleOrderList },
  { method: 'GET', pattern: /^\/api\/orders\/(?<orderId>[^/]+)$/, handler: handleOrderRead },
  { method: 'GET', pattern: /^\/api\/jobs\/(?<jobId>[^/]+)$/, handler: handleJob },
  { method: 'POST', pattern: /^\/api\/payments$/, handler: handlePaymentCreate },
  { method: 'POST', pattern: /^\/api\/payments\/(?<paymentId>[^/]+)\/confirm$/, handler: handlePaymentConfirm },
  { method: 'POST', pattern: /^\/api\/sources$/, handler: handleSourceCreate },
  { method: 'GET', pattern: /^\/api\/sources\/(?<sourceId>[^/]+)\/(?<index>\d+)$/, handler: handleSourceImage },
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

export function createApp({ env = process.env, fetchImpl = fetch, store, tryon, sources, timeoutMs = 120_000, resultsDir = RESULTS_DIR }) {
  // 本机默认开放模拟充值与直连生成；一旦配置对外来源（部署形态）默认关闭，必须显式开启。
  const allowSimulation = env.ENABLE_SIMULATED_PAYMENTS === '1' || !env.PUBLIC_ORIGIN;
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
        if (pathname.startsWith('/api/')) throw new HttpError(405, 'METHOD_NOT_ALLOWED', '此接口不支持该请求方法');
        return await serveStatic(request, response, pathname);
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
        clock,
        timeoutMs,
        allowSimulation,
        resultsDir,
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
