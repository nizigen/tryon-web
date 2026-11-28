import assert from 'node:assert/strict';
import test from 'node:test';

import { generateImage, listModels } from '../src/imageapi.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG, 'base64');
const BASE = 'http://127.0.0.1:3425/v1';
const RETIRED_MODELS = ['comfyui/foxbaze-tryon', 'idm/idm-vton'];
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

test('显式和网关目录排除两个停用试穿模型，保留其它提供方图片模型', async (context) => {
  const available = 'vendor/Qwen-Image';
  const models = [...RETIRED_MODELS, ` ${RETIRED_MODELS[0].toUpperCase()} `, available];
  const directory = async () => Response.json({ data: models.map((id) => ({ id, output_modalities: ['image'] })) });
  const offline = context.mock.fn(async () => { throw new Error('offline'); });
  assert.deepEqual(await listModels({ IMAGE_MODELS: models.join(',') }, offline), [available]);
  assert.deepEqual(await listModels({ IMAGE_MODELS: RETIRED_MODELS.join(',') }, offline), []);
  assert.equal(offline.mock.callCount(), 0);
  for (const model of RETIRED_MODELS) {
    assert.deepEqual(await listModels({ IMAGE_MODEL: model }, directory), [available]);
    assert.deepEqual(await listModels({ IMAGE_MODEL: model }, offline), ['codex/gpt-image-2.5']);
  }
});

test('直接调用生成器使用停用模型时不查询目录，也不调用生成服务', async (context) => {
  const upstream = context.mock.fn(async () => Response.json({ data: [] }));
  for (const model of RETIRED_MODELS) {
    await assert.rejects(generateImage({ model, prompt: 'test' }, { IMAGE_API_BASE_URL: BASE }, upstream), {
      status: 400, code: 'MODEL_UNAVAILABLE', field: 'model',
    });
  }
  assert.equal(upstream.mock.callCount(), 0);
});
