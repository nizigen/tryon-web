import { HttpError, upstreamError } from './errors.mjs';
import { decodeBase64, decodeImage, MAX_BODY_BYTES, MAX_OUTPUT_BYTES, sniff } from './validate.mjs';

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MODEL = 'codex/gpt-image-2.5';
const DEFAULT_BASE_URL = 'http://127.0.0.1:3425/v1';

/**
 * 取一个 OpenAI 兼容服务的根地址（含 /v1 这类版本前缀）。
 * prefix 用来让对话类接口单独指向另一个服务；没配就复用图片服务的配置。
 */
export function apiBaseUrl(env, prefix = 'IMAGE') {
  const raw = env[`${prefix}_API_BASE_URL`] || env.IMAGE_API_BASE_URL || DEFAULT_BASE_URL;
  let base;
  try {
    base = new URL(String(raw).trim());
  } catch {
    throw upstreamError();
  }
  if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw upstreamError();
  }
  return base.href.replace(/\/+$/, '');
}

export function apiKey(env, prefix = 'IMAGE') {
  const key = env[`${prefix}_API_KEY`] || env.IMAGE_API_KEY || '';
  return String(key).trim();
}

function authHeaders(env, prefix = 'IMAGE') {
  const key = apiKey(env, prefix);
  return key ? { authorization: `Bearer ${key}` } : {};
}

function abortable(promise, signal) {
  // 没传 signal 时也要把 promise 挂上处理：否则这个 promise 的拒绝没人接，会变成 unhandledRejection。
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** 只读错误响应体的前若干字节，避免上游返回巨体时把内存吃掉。 */
async function readText(response, limit) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      const value = Buffer.from(chunk);
      const room = limit - size;
      if (room <= 0) break;
      chunks.push(value.subarray(0, room));
      size += Math.min(value.byteLength, room);
    }
  } catch {
    // 读不到就算了，下面按已有内容给原因
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readUpstream(response, limit, signal) {
  const invalid = new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限');
  if (!response.ok) {
    // 把上游自己的错误原因带给用户：是网络不通、额度用尽还是模型不支持，只有它能说清。
    const detail = await readText(response, 8 * 1024);
    throw upstreamError(detail);
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
  } finally {
    reader.releaseLock();
  }
}

async function postJson(url, payload, env, fetchImpl, signal, prefix = 'IMAGE') {
  const response = await abortable(fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...authHeaders(env, prefix) },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal,
  }), signal);
  const raw = (await readUpstream(response, MAX_BODY_BYTES, signal)).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限');
  }
}

async function postEdits(url, payload, images, env, fetchImpl, signal) {
  const form = new FormData();
  form.append('model', payload.model);
  form.append('prompt', payload.prompt);
  if (payload.size) form.append('size', payload.size);
  if (payload.quality) form.append('quality', payload.quality);
  form.append('n', '1');
  form.append('response_format', 'b64_json');
  const field = images.length === 1 ? 'image' : 'image[]';
  images.forEach((dataURL, index) => {
    const { mime, buffer } = decodeImage(dataURL, `referenceImages[${index}]`);
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    form.append(field, new Blob([buffer], { type: mime }), `reference-${index + 1}.${ext}`);
  });
  const response = await abortable(fetchImpl(url, {
    method: 'POST',
    headers: { accept: 'application/json', ...authHeaders(env) },
    body: form,
    redirect: 'error',
    signal,
  }), signal);
  const raw = (await readUpstream(response, MAX_BODY_BYTES, signal)).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限');
  }
}

/**
 * 可选的图片模型：显式配置优先；否则取服务目录里声明能出图的模型，并补上默认模型
 * （不少兼容服务不会在 /models 里标注多模态，默认模型因此可能不在目录里）。
 */
export async function listModels(env, fetchImpl, signal) {
  const explicit = String(env.IMAGE_MODELS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit.length) return [...new Set(explicit)];

  const fallback = String(env.IMAGE_MODEL ?? '').trim() || DEFAULT_MODEL;
  let ids = [];
  try {
    const response = await abortable(fetchImpl(`${apiBaseUrl(env)}/models`, {
      method: 'GET',
      headers: { accept: 'application/json', ...authHeaders(env) },
      redirect: 'error',
      signal,
    }), signal);
    const payload = JSON.parse((await readUpstream(response, MAX_BODY_BYTES, signal)).toString('utf8'));
    const entries = Array.isArray(payload?.data) ? payload.data : [];
    ids = entries
      .filter((entry) => {
        const output = entry?.modalities?.output ?? entry?.output_modalities;
        return Array.isArray(output) ? output.includes('image') : false;
      })
      .map((entry) => entry?.id)
      .filter((id) => typeof id === 'string' && id);
  } catch (error) {
    // 有些兼容服务根本没有 /models，或者目录暂时不可用。这时用 IMAGE_MODEL 兜底，
    // 而不是让整个功能失效——真正的可达性由生成请求自己说话。
    if (signal?.aborted) throw signal.reason;
    return [fallback];
  }
  return [...new Set([...ids, fallback])];
}

export function deadline(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new HttpError(502, 'UPSTREAM_ERROR', '等待超时，上游可能仍已处理或计费，请稍后手动重试')), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    },
  };
}

function firstImage(payload, baseUrl = '') {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const entry = data[0];
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.b64_json === 'string' && entry.b64_json) {
    return { base64: entry.b64_json, mimeType: typeof entry.mime_type === 'string' ? entry.mime_type : '' };
  }
  if (typeof entry.url === 'string' && entry.url) {
    return { url: entry.url, mimeType: typeof entry.mime_type === 'string' ? entry.mime_type : '' };
  }
  return null;
}

/**
 * 服务没有按 b64_json 返回、只给了下载链接时，去把它取回来。
 * 只允许与接口同源的地址：那个链接由上游给出，放开任意 URL 等于把服务端变成取信通道（SSRF）。
 */
async function fetchImageUrl(url, baseUrl, env, fetchImpl, signal) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回的图片地址不合法');
  }
  const origin = baseUrl ? new URL(baseUrl).origin : '';
  if (!origin || target.origin !== origin) {
    throw new HttpError(502, 'UPSTREAM_FORMAT', '所选服务只给了第三方下载链接，出于安全考虑不代取，请换一个支持 b64_json 内联返回的模型或服务');
  }
  const response = await abortable(fetchImpl(target.href, {
    method: 'GET',
    headers: { accept: 'image/*', ...authHeaders(env) },
    redirect: 'error',
    signal,
  }), signal);
  return readUpstream(response, MAX_OUTPUT_BYTES, signal);
}

/**
 * 生成或编辑一张图。有参考图走 /images/edits（multipart），否则走 /images/generations。
 * @returns {Promise<{mimeType: string, buffer: Buffer}>}
 */
export async function generateImage({ model, prompt, referenceImages, quality, size }, env, fetchImpl, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const clock = deadline(timeoutMs, signal);
  try {
    const models = await listModels(env, fetchImpl, clock.signal);
    if (!models.includes(model)) throw new HttpError(400, 'MODEL_UNAVAILABLE', '所选模型已不可用，请重新加载配置', 'model');
    const images = (Array.isArray(referenceImages) ? referenceImages : []).filter((value) => typeof value === 'string' && value);
    const payload = { model, prompt, n: 1, response_format: 'b64_json' };
    if (size) payload.size = size;
    if (quality) payload.quality = quality;
    const base = apiBaseUrl(env);
    const result = images.length
      ? await postEdits(`${base}/images/edits`, payload, images, env, fetchImpl, clock.signal)
      : await postJson(`${base}/images/generations`, payload, env, fetchImpl, clock.signal);
    const found = firstImage(result);
    if (!found) throw upstreamError(typeof result?.error?.message === 'string' ? result.error.message : '');
    const invalid = new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限');
    const buffer = found.base64
      ? decodeBase64(found.base64, MAX_OUTPUT_BYTES, invalid, invalid)
      : await fetchImageUrl(found.url, base, env, fetchImpl, clock.signal);
    const mime = sniff(buffer);
    if (!mime || (found.mimeType && mime !== found.mimeType)) throw invalid;
    return { mimeType: mime, buffer };
  } catch (error) {
    if (clock.signal.aborted) throw clock.signal.reason;
    if (error instanceof HttpError) throw error;
    throw upstreamError();
  } finally {
    clock.dispose();
  }
}
