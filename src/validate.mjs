import { HttpError } from './errors.mjs';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_BODY_BYTES = 24 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 500;

export function sniff(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    && buffer.readUInt32LE(4) === buffer.length - 8 && buffer.length % 2 === 0) return 'image/webp';
  return null;
}

export function decodeBase64(payload, maxBytes, invalid, oversized) {
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

export function assertString(value, field, { max = 200, min = 1 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_REQUEST', '请求字段无效', field);
  const trimmed = value.trim();
  if (trimmed.length < min) throw new HttpError(400, 'INVALID_REQUEST', '请求字段无效', field);
  if ([...trimmed].length > max) throw new HttpError(400, 'INVALID_REQUEST', `请求字段过长`, field);
  return trimmed;
}
