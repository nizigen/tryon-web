import assert from 'node:assert/strict';
import test from 'node:test';

import { generateImage, listModels } from '../src/imageapi.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG, 'base64');
const BASE = 'http://127.0.0.1:3425/v1';
const env = { IMAGE_API_BASE_URL: BASE, IMAGE_MODELS: 'fake/model' };

function imageResponse(buffer = PNG_BYTES, type = 'image/png') {
  return new Response(buffer, { headers: { 'content-type': type } });
}

test('服务只回 url 且与接口同源时，把它取回来当结果', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/images/generations')) {
      return Response.json({ created: 1, data: [{ url: `${BASE}/files/a.png`, mime_type: 'image/png' }] });
    }
    return imageResponse();
  };
  const result = await generateImage({ model: 'fake/model', prompt: 'x' }, env, fetchImpl);
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(result.buffer, PNG_BYTES);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], `${BASE}/files/a.png`);
});

test('服务只回第三方 url 时拒绝代取，避免把服务端变成取信通道', async () => {
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/images/generations')) {
      return Response.json({ data: [{ url: 'https://evil.example/a.png' }] });
    }
    throw new Error('不该请求第三方地址');
  };
  await assert.rejects(
    generateImage({ model: 'fake/model', prompt: 'x' }, env, fetchImpl),
    (error) => error.code === 'UPSTREAM_FORMAT' && /第三方下载链接/.test(error.message),
  );
});

test('上游报错时把它的原因带进错误文案', async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify({ error: { message: 'Credits exhausted, see codebuddy.ai/profile/usage' } }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  );
  await assert.rejects(
    generateImage({ model: 'fake/model', prompt: 'x' }, env, fetchImpl),
    (error) => error.code === 'UPSTREAM_ERROR' && /Credits exhausted/.test(error.message),
  );
});

test('模型目录不可达时退回 IMAGE_MODEL，不让整个功能失效', async () => {
  const fetchImpl = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  const models = await listModels({ IMAGE_API_BASE_URL: BASE, IMAGE_MODEL: 'mine/model' }, fetchImpl);
  assert.deepEqual(models, ['mine/model']);
});
