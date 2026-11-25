import { HttpError } from './errors.mjs';
import { deadline, readUpstream } from './imageapi.mjs';
import { decodeBase64, decodeImage, MAX_BODY_BYTES, MAX_IMAGE_BYTES, MAX_OUTPUT_BYTES, sniff } from './validate.mjs';

export const IDM_ID = 'idm/idm-vton';
const SLOT_CATEGORY = new Map([['top', 'upper_body'], ['outer', 'upper_body'], ['bottom', 'lower_body'], ['dress', 'dresses']]);
const unavailable = () => new HttpError(503, 'WORKFLOW_UNAVAILABLE', 'IDM-VTON 服务未就绪，请检查隧道与服务进程');
const invalid = () => new HttpError(502, 'UPSTREAM_FORMAT', 'IDM-VTON 返回格式不兼容或图片超限');

export function idmTimeout(env) {
  const value = Number(env.IDM_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value >= 1000 && value <= 3600000 ? value : 600000;
}

function connection(env) {
  if (!env.IDM_BASE_URL) throw unavailable();
  let base;
  try { base = new URL(String(env.IDM_BASE_URL).trim()); } catch { throw unavailable(); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw unavailable();
  return base.href.replace(/\/+$/, '');
}

function validatePieces(pieces) {
  if (!Array.isArray(pieces) || pieces.length < 1 || pieces.length > 5) {
    throw new HttpError(400, 'INVALID_REQUEST', 'IDM-VTON 支持 1–5 件单品逐件试穿', 'pieces');
  }
  for (const piece of pieces) {
    if (!piece || typeof piece !== 'object' || Array.isArray(piece)) {
      throw new HttpError(400, 'INVALID_REQUEST', '单品格式不正确', 'pieces');
    }
    if (!SLOT_CATEGORY.has(piece.slot)) {
      throw new HttpError(400, 'IDM_SLOT', 'IDM-VTON 支持上衣/外套、下装、连衣裙；鞋袜与配饰请选其它图片模型', 'pieces');
    }
    for (const key of ['name', 'garmentType']) {
      if (piece[key] !== undefined && (typeof piece[key] !== 'string' || piece[key].length > 500)) {
        throw new HttpError(400, 'INVALID_REQUEST', '单品描述格式不正确', 'pieces');
      }
    }
  }
}

function descriptionFor(piece) {
  return piece.name?.trim() || piece.garmentType?.trim() || (piece.slot === 'bottom' ? 'a pair of trousers' : piece.slot === 'dress' ? 'a dress' : 'a top');
}

async function request(base, path, fetchImpl, signal, { body, limit = MAX_BODY_BYTES } = {}) {
  if (signal.aborted) throw signal.reason;
  const encoded = body ? JSON.stringify(body) : undefined;
  if (encoded && Buffer.byteLength(encoded) > MAX_BODY_BYTES) throw new HttpError(413, 'IMAGE_TOO_LARGE', 'IDM-VTON 请求图片超限');
  const response = await fetchImpl(`${base}${path}`, {
    method: body ? 'POST' : 'GET', signal, redirect: 'error',
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(encoded ? { body: encoded } : {}),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 503) throw new HttpError(503, 'WORKFLOW_UNAVAILABLE', 'IDM-VTON 正在处理另一个任务，请稍后重试');
    if (response.status === 400) throw new HttpError(400, 'INVALID_IMAGE', 'IDM-VTON 未能解析图片或人体姿态，请检查参考图');
    if (response.status === 413) throw new HttpError(413, 'IMAGE_TOO_LARGE', '图片超出 IDM-VTON 的大小限制');
    throw new HttpError(502, 'WORKFLOW_FAILED', 'IDM-VTON 推理失败，请检查服务日志');
  }
  const raw = await readUpstream(response, limit, signal);
  try { return JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
}

export async function checkIdm(env, fetchImpl = fetch, signal) {
  if (!env.IDM_BASE_URL) return { configured: false, ready: false, message: '尚未配置 IDM-VTON 服务地址' };
  const clock = deadline(8000, signal);
  try {
    const health = await request(connection(env), '/health', fetchImpl, clock.signal, { limit: 64 * 1024 });
    const ready = health?.ok === true && health?.pipeline === true && health?.engine === 'idm-vton';
    return {
      configured: true, ready,
      message: ready ? 'IDM-VTON 模型已加载；支持衣裤裙逐件试穿，同部位叠穿保留仍属实验' : 'IDM-VTON 模型尚未就绪或服务协议不匹配',
    };
  } catch {
    if (signal?.aborted) throw signal.reason;
    return { configured: true, ready: false, message: 'IDM-VTON 未连接，请核对隧道与服务进程' };
  } finally { clock.dispose(); }
}

export async function preflightIdm(pieces, env, fetchImpl, signal) {
  validatePieces(pieces);
  const status = await checkIdm(env, fetchImpl, signal);
  if (!status.ready) throw new HttpError(503, 'WORKFLOW_UNAVAILABLE', status.message, 'model');
}

// The official pipeline consumes one garment. Preserve the app's layer order and
// feed each actual result to the next call; same-region layer preservation is experimental.
export async function generateIdm({ referenceImages, pieces }, env, fetchImpl = fetch, { timeoutMs = idmTimeout(env), signal } = {}) {
  validatePieces(pieces);
  if (!Array.isArray(referenceImages) || referenceImages.length !== pieces.length + 1) {
    throw new HttpError(400, 'INVALID_REQUEST', '服装数量与参考图不一致', 'pieces');
  }
  const decoded = referenceImages.map((image, index) => decodeImage(image, `referenceImages[${index}]`));
  const base = connection(env);
  const clock = deadline(timeoutMs, signal);
  try {
    let person = decoded[0].buffer;
    let result;
    for (const [index, piece] of pieces.entries()) {
      const payload = await request(base, '/tryon', fetchImpl, clock.signal, { body: {
        person: person.toString('base64'), garment: decoded[index + 1].buffer.toString('base64'),
        category: SLOT_CATEGORY.get(piece.slot), description: descriptionFor(piece), seed: 42,
      } });
      const buffer = decodeBase64(payload?.image, MAX_OUTPUT_BYTES, invalid(), invalid());
      const mimeType = sniff(buffer);
      if (!mimeType || (index < pieces.length - 1 && buffer.length > MAX_IMAGE_BYTES)) throw invalid();
      result = { mimeType, buffer };
      person = buffer;
    }
    return result;
  } catch (error) {
    if (clock.signal.aborted) throw clock.signal.reason;
    if (error instanceof HttpError) throw error;
    throw unavailable();
  } finally { clock.dispose(); }
}
