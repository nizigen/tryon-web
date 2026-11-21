import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { HttpError, upstreamError } from './errors.mjs';
import { decodeBase64, MAX_BODY_BYTES, MAX_OUTPUT_BYTES, sniff } from './validate.mjs';

export const DEFAULT_TIMEOUT_MS = 120_000;

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
  } catch {
    throw upstreamError();
  }
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
  } finally {
    reader.releaseLock();
  }
}

export async function callMcp(method, params, env, fetchImpl, signal) {
  try {
    signal.throwIfAborted();
    const endpoint = await abortable(gatewayEndpoint(env), signal);
    signal.throwIfAborted();
    const response = await abortable(fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: method === 'tools/list' ? 1 : params.name === 'generate_image' ? 2 : 3, method, params }),
      redirect: 'error',
      signal,
    }), signal);
    const raw = (await readUpstream(response, MAX_BODY_BYTES, signal)).toString('utf8');
    const json = response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')
      ? raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).at(-1)?.slice(5).trim()
      : raw;
    let payload;
    try {
      payload = JSON.parse(json);
    } catch {
      throw new HttpError(502, 'UPSTREAM_FORMAT', '所选服务返回格式不兼容或图片超限');
    }
    if (payload?.error || !payload?.result || typeof payload.result !== 'object') throw upstreamError();
    return payload.result;
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof HttpError) throw error;
    throw upstreamError();
  }
}

export async function listModels(env, fetchImpl, signal) {
  const result = await callMcp('tools/list', {}, env, fetchImpl, signal);
  const values = result.tools?.find?.((tool) => tool.name === 'generate_image')?.inputSchema?.properties?.model?.enum;
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || !value)) throw upstreamError();
  return [...new Set(values)];
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

/**
 * 调用 generate_image；出现 pending 时以 generation_result 查询同一任务。
 * @returns {Promise<{mimeType: string, buffer: Buffer}>}
 */
export async function generateImage({ model, prompt, referenceImages, quality, size }, env, fetchImpl, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const clock = deadline(timeoutMs, signal);
  try {
    const models = await listModels(env, fetchImpl, clock.signal);
    if (!models.includes(model)) throw new HttpError(400, 'MODEL_UNAVAILABLE', '所选模型已不可用，请重新加载配置', 'model');
    const args = { model, prompt, reference_images: referenceImages };
    if (quality) args.quality = quality;
    if (size) args.size = size;
    let result = await callMcp('tools/call', { name: 'generate_image', arguments: args }, env, fetchImpl, clock.signal);
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
        return { mimeType: mime, buffer };
      }
      if (result.isError || !taskId) throw upstreamError(text);
      try {
        await delay(1000, undefined, { signal: clock.signal });
      } catch (error) {
        if (clock.signal.aborted) throw clock.signal.reason;
        throw error;
      }
      result = await callMcp('tools/call', { name: 'generation_result', arguments: { id: taskId } }, env, fetchImpl, clock.signal);
    }
  } finally {
    clock.dispose();
  }
}
