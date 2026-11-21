import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_BODY_BYTES = 24 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2000;
const TIMEOUT_MS = 120_000;
const CATEGORY_REGION = {
  tops: 'upper body: the shirt / blouse / sweater / jacket they are wearing',
  bottoms: 'lower body: the trousers / skirt / shorts they are wearing',
  dresses: 'torso and legs, replacing the existing upper-body and lower-body clothing with one full-body dress covering the torso and legs',
};
const MODEL_LABELS = {
  'codex/gpt-image-2': 'GPT Image 2 · Codex',
  'workbuddy/hunyuan-image-alpha': '混元图像 Alpha · WorkBuddy',
  'workbuddy-ai/hy-image-3.5': '混元图像 3.5 · WorkBuddy AI',
  'minimax-code/MiniMax-Image': 'MiniMax Image · MiniMax Code',
};
const GARMENT_LABELS = { tops: '上衣', bottoms: '下装', dresses: '连衣裙' };
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const STATIC_FILES = new Set([
  '/design/index.html', '/design/a.html', '/design/b.html', '/design/c.html',
  '/design/preview.css', '/design/preview.js',
  '/public/index.html', '/public/style.css', '/public/app.js',
]);
const PUBLIC_ALIASES = { '/index.html': '/public/index.html', '/style.css': '/public/style.css', '/app.js': '/public/app.js' };

export class HttpError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

function sniff(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    && buffer.readUInt32LE(4) === buffer.length - 8 && buffer.length % 2 === 0) return 'image/webp';
  return null;
}

function decodeBase64(payload, maxBytes, invalid, oversized) {
  if (typeof payload !== 'string' || !payload.length || payload.length % 4 !== 0) throw invalid;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const bytes = payload.length / 4 * 3 - padding;
  if (bytes > maxBytes) throw oversized;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) throw invalid;
  const buffer = Buffer.from(payload, 'base64');
  if (!buffer.length || buffer.length !== bytes || buffer.toString('base64') !== payload) throw invalid;
  return buffer;
}

export function decodeImage(dataURL, field) {
  const invalid = new HttpError(400, 'INVALID_IMAGE', '图片编码、格式或内容无效', field);
  if (typeof dataURL !== 'string') throw invalid;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([^\s]+)$/.exec(dataURL);
  if (!match) throw invalid;
  const [, mime, payload] = match;
  const buffer = decodeBase64(payload, MAX_IMAGE_BYTES, invalid, new HttpError(413, 'IMAGE_TOO_LARGE', '单张图片不得超过8MiB', field));
  if (sniff(buffer) !== mime) throw invalid;
  return { mime, buffer, bytes: buffer.length };
}

export function buildPrompt(category, extra) {
  const preserve = category === 'tops' ? 'Keep the original lower-body clothing and shoes.'
    : category === 'bottoms' ? 'Keep the original upper-body clothing and shoes.'
      : 'Replace the original upper-body and lower-body clothing with one dress covering the torso and legs. Keep the shoes.';
  return `You are a professional virtual try-on editor. The first reference image is the person; the second reference image is the garment.
Keep the person in the first image completely unchanged: same face, hairstyle, skin tone, body shape and proportions, pose, hands and background. Replace only the person's ${CATEGORY_REGION[category]} with the exact garment shown in the second image. Reproduce the garment's true colour, pattern, fabric texture, neckline, sleeves and length. Keep lighting, shadows and perspective photorealistic and consistent. Do not modify anything outside the replaced garment.`
    + (extra ? ` Additional instruction from the user: ${extra}` : '')
    + ` Priority rules: ${preserve} Allow the new garment's natural silhouette, sleeves and hem to extend beyond the original clothing outline. User instructions may refine fabric or fit only and must not override the replacement region or preservation of identity, body, pose and background.`;
}

function validateInput(input) {
  const allowed = ['model', 'person', 'garment', 'category', 'prompt'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new HttpError(400, 'INVALID_REQUEST', '请求字段无效');
  }
  if (typeof input.model !== 'string' || !input.model) throw new HttpError(400, 'INVALID_REQUEST', '请选择有效模型', 'model');
  if (typeof input.category !== 'string' || !Object.hasOwn(GARMENT_LABELS, input.category)) throw new HttpError(400, 'INVALID_REQUEST', '请选择上衣、下装或连衣裙', 'category');
  const prompt = input.prompt === undefined ? '' : input.prompt;
  if (typeof prompt !== 'string' || [...prompt.trim()].length > MAX_PROMPT_CHARS) {
    throw new HttpError(400, 'INVALID_REQUEST', '补充要求不得超过2000个字符', 'prompt');
  }
  decodeImage(input.person, 'person');
  decodeImage(input.garment, 'garment');
  return { model: input.model, person: input.person, garment: input.garment, prompt: buildPrompt(input.category, prompt.trim()) };
}

function upstreamError(reason = '') {
  const detail = reason.includes('MiniMax Image returned no images') ? '（MiniMax Image returned no images）' : '';
  return new HttpError(502, 'UPSTREAM_ERROR', '所选服务连接失败，请稍后手动重试' + detail);
}

export async function gatewayEndpoint(env, readGateway = readFile) {
  let address = env.IMAGE_API_BASE_URL;
  if (address === undefined) {
    try {
      const config = JSON.parse(await readGateway(resolve(homedir(), '.config/the image service/gateway.json'), 'utf8'));
      if (typeof config.addr !== 'string' || !/^127\.0\.0\.1:[0-9]+$/.test(config.addr)) throw upstreamError();
      address = 'http://' + config.addr;
    } catch (error) {
      if (error.code !== 'ENOENT') throw upstreamError();
      address = 'http://127.0.0.1:3425';
    }
  }
  try {
    const base = new URL(address);
    const path = env.IMAGE_API_MCP_PATH || '/v1/images';
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.username || base.password
      || /[?#]/.test(base.href) || !path.startsWith('/') || path.startsWith('//') || /[\x00-\x20\x7f?#\\]/.test(path)) throw new Error();
    const endpoint = new URL(path, base);
    if (endpoint.origin !== base.origin) throw new Error();
    return endpoint.href;
  } catch { throw upstreamError(); }
}

async function callMcp(method, params, env, fetchImpl, signal) {
  try {
    signal.throwIfAborted();
    const endpoint = await abortable(gatewayEndpoint(env), signal);
    signal.throwIfAborted();
    const response = await abortable(fetchImpl(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method === 'tools/list' ? 1 : params.name === 'generate_image' ? 2 : 3, method, params }),
      redirect: 'error', signal,
    }), signal);
    const raw = (await readUpstream(response, MAX_BODY_BYTES, signal)).toString('utf8');
    const json = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
      ? raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).at(-1)?.slice(5).trim() : raw;
    let payload;
    try { payload = JSON.parse(json); } catch { throw new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限'); }
    if (payload?.error || !payload?.result || typeof payload.result !== 'object') throw upstreamError();
    return payload.result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof HttpError) throw error;
    throw upstreamError();
  }
}

async function listModels(env, fetchImpl, signal) {
  const result = await callMcp('tools/list', {}, env, fetchImpl, signal);
  const values = result.tools?.find?.((tool) => tool.name === 'generate_image')?.inputSchema?.properties?.model?.enum;
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) throw upstreamError();
  return [...new Set(values)];
}

export async function getConfig(env = process.env, fetchImpl = fetch, { timeoutMs = 10_000, signal } = {}) {
  const clock = deadline(timeoutMs, signal);
  const config = { engines: [], defaultEngine: null, gateway: { reachable: false },
    limits: { imageBytes: MAX_IMAGE_BYTES, requestBytes: MAX_BODY_BYTES, promptChars: MAX_PROMPT_CHARS },
    categories: Object.keys(GARMENT_LABELS) };
  try {
    const models = await listModels(env, fetchImpl, clock.signal);
    const preferred = models.includes(env.IMAGE_MODEL) ? env.IMAGE_MODEL
      : models.includes('codex/gpt-image-2') ? 'codex/gpt-image-2' : models[0] ?? null;
    return { ...config, gateway: { reachable: true }, defaultEngine: preferred,
      engines: models.map((id) => ({ id, label: Object.hasOwn(MODEL_LABELS, id) ? MODEL_LABELS[id] : id, available: true, default: id === preferred })) };
  } catch { return { ...config, error: '未能读取图片模型，请确认 the image service 正在运行' }; }
  finally { clock.dispose(); }
}

function deadline(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new HttpError(502, 'UPSTREAM_ERROR', '等待超时，上游可能仍已处理或计费，请稍后手动重试')), timeoutMs);
  return { signal: controller.signal, dispose() { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); } };
}

function abortable(promise, signal) {
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readUpstream(response, limit, signal) {
  const invalid = new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限');
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new HttpError(502, 'UPSTREAM_ERROR', '所选服务连接失败，请稍后手动重试');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    void response.body?.cancel().catch(() => {});
    throw invalid;
  }
  if (!response.body) throw invalid;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw invalid;
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

async function generateWithSignal(input, env, fetchImpl, signal) {
  signal.throwIfAborted();
  const { model, person, garment, prompt } = validateInput(input);
  const models = await listModels(env, fetchImpl, signal);
  if (!models.includes(model)) throw new HttpError(400, 'INVALID_REQUEST', '所选模型已不可用，请重新加载配置', 'model');
  let result = await callMcp('tools/call', { name: 'generate_image', arguments: { model, prompt, reference_images: [person, garment] } }, env, fetchImpl, signal);
  while (true) {
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text).join(' ');
    const pending = result._meta?.['image-service.local/pending'];
    const taskId = typeof pending === 'string' && pending.length > 0 && pending.length <= 256 ? pending : null;
    const image = content.find((item) => item.type === 'image');
    if (!result.isError && image) {
      const invalid = new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限');
      const buffer = decodeBase64(image.data, MAX_OUTPUT_BYTES, invalid, invalid);
      const mime = sniff(buffer);
      if (!mime || mime !== image.mimeType) throw invalid;
      return { engine: model, image: { mimeType: mime, dataURL: `data:${mime};base64,${buffer.toString('base64')}` }, createdAt: new Date().toISOString() };
    }
    if (result.isError || !taskId) throw upstreamError(text);
    try { await delay(1000, undefined, { signal }); }
    catch (error) { if (signal.aborted) throw signal.reason; throw error; }
    result = await callMcp('tools/call', { name: 'generation_result', arguments: { id: taskId } }, env, fetchImpl, signal);
  }
}

export async function generate(input, env = process.env, fetchImpl = fetch, { timeoutMs = TIMEOUT_MS, signal } = {}) {
  const clock = deadline(timeoutMs, signal);
  try { return await generateWithSignal(input, env, fetchImpl, clock.signal); }
  finally { clock.dispose(); }
}

function sendJson(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function checkLocalRequest(request, port) {
  const host = `127.0.0.1:${port}`;
  if (request.headers.host !== host) throw new HttpError(403, 'FORBIDDEN_HOST', '仅允许本机访问');
  const origin = request.headers.origin;
  const pathname = request.url.split('?')[0];
  const staticPage = pathname === '/' || pathname === '/index.html' || (STATIC_FILES.has(pathname) && pathname.endsWith('.html'));
  const documentNavigation = staticPage && ['GET', 'HEAD'].includes(request.method)
    && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
  if ((origin !== undefined && origin !== `http://${host}`) || (request.method === 'POST' && origin === undefined)
    || (request.headers['sec-fetch-site'] === 'cross-site' && !documentNavigation)) {
    throw new HttpError(403, 'FORBIDDEN_ORIGIN', '不接受跨站请求');
  }
}

function readBody(request, signal) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', aborted);
      signal.removeEventListener('abort', aborted);
    };
    const fail = (error) => { cleanup(); request.resume(); reject(error); };
    const aborted = () => fail(signal.reason ?? new Error('Client disconnected'));
    const data = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return fail(new HttpError(413, 'REQUEST_TOO_LARGE', '请求不得超过24MiB'));
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolvePromise(Buffer.concat(chunks, size)); };
    const declared = request.headers['content-length'];
    if (declared !== undefined && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_BODY_BYTES)) {
      fail(new HttpError(413, 'REQUEST_TOO_LARGE', '请求长度无效或超过24MiB')); return;
    }
    if (signal.aborted) { aborted(); return; }
    request.on('data', data); request.on('end', end); request.on('error', fail); request.on('aborted', aborted);
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function serveStatic(request, response, pathname) {
  let relative = PUBLIC_ALIASES[pathname] ?? pathname;
  if (pathname === '/') {
    try { await realpath(resolve(ROOT, 'public/index.html')); relative = '/public/index.html'; }
    catch { relative = '/design/index.html'; }
  }
  if (!STATIC_FILES.has(relative)) throw new HttpError(404, 'NOT_FOUND', '页面不存在');
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'METHOD_NOT_ALLOWED', '此路径不支持该请求方法');
  let body;
  try {
    const target = await realpath(resolve(ROOT, relative.slice(1)));
    if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) throw new Error('Outside root');
    body = await readFile(target);
  } catch { throw new HttpError(404, 'NOT_FOUND', '页面不存在'); }
  // The reviewed design drafts contain inline styles/scripts; production uses external files.
  const isDesign = relative.startsWith('/design/');
  const inline = isDesign ? " 'unsafe-inline'" : '';
  const ancestors = isDesign ? "'self'" : "'none'";
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(relative)], 'content-length': body.length, 'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'self'; script-src 'self'${inline}; style-src 'self'${inline}; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors ${ancestors}; form-action 'self'`,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

export function createApp(env = process.env, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let busy = false;
  const app = createServer(async (request, response) => {
    let clock;
    let disconnect;
    let ownsSlot = false;
    try {
      checkLocalRequest(request, app.address()?.port);
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!request.url.startsWith('/') || request.url.split('?')[0] !== url.pathname) throw new HttpError(404, 'NOT_FOUND', '页面不存在');
      if (url.pathname === '/api/config') {
        if (request.method !== 'GET') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请使用GET请求');
        if (url.search) throw new HttpError(400, 'INVALID_REQUEST', '此接口不接受查询参数');
        const controller = new AbortController();
        disconnect = () => { if (!response.writableEnded) controller.abort(new Error('Client disconnected')); };
        response.on('close', disconnect);
        return sendJson(response, 200, await getConfig(env, fetchImpl, { timeoutMs: Math.min(timeoutMs, 10_000), signal: controller.signal }));
      }
      if (url.pathname !== '/api/tryon') return await serveStatic(request, response, url.pathname);
      if (request.method !== 'POST') throw new HttpError(405, 'METHOD_NOT_ALLOWED', '请使用POST请求');
      if (url.search || request.url.includes('?')) throw new HttpError(400, 'INVALID_REQUEST', '此接口不接受查询参数');
      if (!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers['content-type'] ?? '')) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请发送application/json请求');
      }
      if (busy) throw new HttpError(409, 'BUSY', '已有生成请求正在处理，请稍候');
      busy = true; ownsSlot = true;
      const controller = new AbortController();
      disconnect = () => { if (!response.writableEnded) controller.abort(new Error('Client disconnected')); };
      response.on('close', disconnect);
      clock = deadline(timeoutMs, controller.signal);
      const raw = await readBody(request, clock.signal);
      let input;
      try { input = JSON.parse(raw.toString('utf8')); }
      catch { throw new HttpError(400, 'INVALID_JSON', '请求不是有效JSON'); }
      const result = await generateWithSignal(input, env, fetchImpl, clock.signal);
      sendJson(response, 200, result);
    } catch (error) {
      const known = error instanceof HttpError;
      sendJson(response, known ? error.status : 500, { error: {
        code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '请求处理失败',
        ...(known && error.field ? { field: error.field } : {}),
      } });
    } finally {
      clock?.dispose();
      if (disconnect) response.off('close', disconnect);
      if (ownsSlot) busy = false;
      if (!request.complete && !request.destroyed) request.resume();
    }
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp().listen(43130, '127.0.0.1', () => {
    console.log('TryOn Web running at http://127.0.0.1:43130');
  });
}
