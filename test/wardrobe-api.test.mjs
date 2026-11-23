import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.mjs';
import { createSourceService } from '../src/source.mjs';
import { createStore } from '../src/store.mjs';
import { createTryonService } from '../src/tryon.mjs';
import { createWardrobe } from '../src/wardrobe.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(8192)]);
const IMAGE = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
const MODELS = ['codex/gpt-image-2.5', 'minimax-code/MiniMax-Image'];

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

function makeFetch() {
  return async (url) => {
    const target = String(url);
    if (target.endsWith('/models')) {
      return jsonResponse({ data: MODELS.map((id) => ({ id, modalities: { output: ['image'] } })) });
    }
    return jsonResponse({ created: 1, data: [{ b64_json: PNG, mime_type: 'image/png' }] });
  };
}

async function withServer(options, run) {
  const dir = await mkdtemp(join(tmpdir(), 'tryon-wardrobe-'));
  const catalogFile = join(dir, 'catalog.json');
  await writeFile(catalogFile, JSON.stringify({ products: [] }), 'utf8');
  const fetchImpl = makeFetch();
  const env = { IMAGE_API_BASE_URL: 'http://127.0.0.1:3425/v1' };
  const store = createStore({ dir, catalogFile });
  await store.ready();
  const tryon = createTryonService({ store, env, fetchImpl, resultsDir: join(dir, 'results') });
  const sources = createSourceService({ runCli: async () => ({ ok: true, data: '{}' }), fetchImpl: async () => new Response(PNG_BYTES), settleMs: 0 });
  const wardrobe = createWardrobe({ dir, env, fetchImpl, sources, captioner: async () => '' });
  const app = createApp({
    env,
    fetchImpl,
    store,
    tryon,
    sources,
    wardrobe,
    stylist: options.stylist ?? { suggest: async () => ({ slots: {}, reason: '', missing: [] }) },
    login: options.login ?? {
      start: async (platform) => ({ sessionId: `sess-${platform}` }),
      status: async (platform, sessionId) => ({ platform, sessionId, status: 'pending' }),
      cancel: async () => {},
      dispose: async () => {},
    },
    resultsDir: join(dir, 'results'),
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (path, init = {}) => {
    const headers = { ...init.headers };
    if (init.body) headers['content-type'] = 'application/json';
    if (['POST', 'PATCH', 'DELETE'].includes(init.method) && !headers.origin) headers.origin = base;
    const response = await fetch(`${base}${path}`, { ...init, headers });
    const buffer = Buffer.from(await response.arrayBuffer());
    let payload = null;
    try {
      payload = JSON.parse(buffer.toString('utf8'));
    } catch {
      payload = buffer;
    }
    return { status: response.status, payload, headers: response.headers };
  };
  try {
    await run({ call, base, wardrobe });
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

test('衣橱：空列表、上传、取图、搜索、删除', async () => {
  await withServer({}, async ({ call }) => {
    const empty = await call('/api/wardrobe');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.payload.items, []);

    const created = await call('/api/wardrobe', {
      method: 'POST',
      body: JSON.stringify({ name: '米色针织开衫', category: 'top', subtype: 'knit', tags: ['针织'], image: IMAGE, source: 'upload' }),
    });
    assert.equal(created.status, 201);
    const item = created.payload.item;
    assert.equal(item.name, '米色针织开衫');
    assert.equal(item.imageUrl, `/api/wardrobe/${item.id}/image`);

    const list = await call('/api/wardrobe');
    assert.equal(list.payload.items.length, 1);

    const image = await call(`/api/wardrobe/${item.id}/image`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');

    const search = await call('/api/wardrobe/search', { method: 'POST', body: JSON.stringify({ query: '针织' }) });
    assert.equal(search.status, 200);
    assert.equal(search.payload.results.length, 1);
    assert.ok(search.payload.results[0].score > 0);

    const removed = await call(`/api/wardrobe/${item.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);

    const gone = await call(`/api/wardrobe/${item.id}/image`);
    assert.equal(gone.status, 404);
    assert.equal(gone.payload.error.code, 'WARDROBE_NOT_FOUND');
  });
});

test('衣橱：PATCH 修改名称和类目', async () => {
  await withServer({}, async ({ call }) => {
    const created = await call('/api/wardrobe', {
      method: 'POST',
      body: JSON.stringify({ name: '米色针织开衫', category: 'top', subtype: 'knit', tags: ['针织'], image: IMAGE }),
    });
    const id = created.payload.item.id;

    const patched = await call(`/api/wardrobe/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: '焦糖色开衫', category: 'outer', subtype: '开衫' }),
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.payload.item.name, '焦糖色开衫');
    assert.equal(patched.payload.item.category, 'outer');
    assert.equal(patched.payload.item.subtype, '开衫');
    assert.deepEqual(patched.payload.item.tags, ['针织'], '未传字段应保留');

    const list = await call('/api/wardrobe');
    assert.equal(list.payload.items[0].name, '焦糖色开衫');

    const missing = await call('/api/wardrobe/not-exist', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) });
    assert.equal(missing.status, 404);
    assert.equal(missing.payload.error.code, 'WARDROBE_NOT_FOUND');

    const badCategory = await call(`/api/wardrobe/${id}`, { method: 'PATCH', body: JSON.stringify({ category: 'hat' }) });
    assert.equal(badCategory.status, 400);
    assert.equal(badCategory.payload.error.code, 'INVALID_REQUEST');
  });
});

test('衣橱：上传非法图片被拒', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/wardrobe', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', category: 'top', image: 'data:image/png;base64,AAAA' }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'INVALID_IMAGE');
  });
});

test('POST /api/outfit/suggest 返回搭配并规范化字段', async () => {
  await withServer({
    stylist: {
      suggest: async () => ({
        slots: { top: { id: 'a', name: '上衣', category: 'top', imageFile: 'a.png' }, accessory: [{ id: 'b', name: '项链', category: 'accessory' }] },
        reason: '天气转凉',
        missing: [],
      }),
    },
  }, async ({ call }) => {
    const response = await call('/api/outfit/suggest', { method: 'POST', body: JSON.stringify({ request: '今天约会' }) });
    assert.equal(response.status, 200);
    assert.equal(response.payload.suggestion.reason, '天气转凉');
    assert.equal(response.payload.suggestion.slots.top.imageUrl, '/api/wardrobe/a/image');
    assert.equal(response.payload.suggestion.slots.accessory.length, 1);
  });
});

test('扫码登录：start 返回 sessionId，status 可查询', async () => {
  await withServer({}, async ({ call }) => {
    const started = await call('/api/login/taobao', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(started.status, 202);
    assert.equal(started.payload.sessionId, 'sess-taobao');

    const status = await call('/api/login/taobao/status?sessionId=sess-taobao');
    assert.equal(status.status, 200);
    assert.equal(status.payload.status, 'pending');

    const noId = await call('/api/login/taobao/status');
    assert.equal(noId.status, 400);
  });
});

test('衣橱单品可直接下单试穿', async () => {
  await withServer({}, async ({ call }) => {
    const created = await call('/api/wardrobe', {
      method: 'POST',
      body: JSON.stringify({ name: '米色针织开衫', category: 'top', image: IMAGE }),
    });
    const wardrobeId = created.payload.item.id;

    const session = await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'device-wardrobe' }) });
    const order = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.payload.sessionId,
        person: IMAGE,
        fit: 'regular',
        prompt: '',
        tier: 'standard',
        pieces: [{ slot: 'top', source: { kind: 'wardrobe', wardrobeId } }],
      }),
    });
    assert.equal(order.status, 201);
    assert.deepEqual(order.payload.order.slots, ['top']);
    assert.equal(order.payload.order.priceCents, 690);
  });
});

test('衣橱单品的类目和格子对不上时拒绝下单', async () => {
  await withServer({}, async ({ call }) => {
    const created = await call('/api/wardrobe', {
      method: 'POST',
      body: JSON.stringify({ name: '黑色直筒牛仔裤', category: 'bottom', image: IMAGE }),
    });
    const wardrobeId = created.payload.item.id;

    const session = await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'device-mismatch' }) });
    const order = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.payload.sessionId,
        person: IMAGE,
        fit: 'regular',
        prompt: '',
        pieces: [{ slot: 'top', source: { kind: 'wardrobe', wardrobeId } }],
      }),
    });
    // 下装塞进上衣格：生成出来的衣服会张冠李戴，必须在占位前就挡住。
    assert.equal(order.status, 400);
    assert.equal(order.payload.error.code, 'PIECE_SLOT_MISMATCH');
  });
});

test('衣橱单品不存在时下单返回 404', async () => {
  await withServer({}, async ({ call }) => {
    const session = await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'device-wardrobe-2' }) });
    const order = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.payload.sessionId,
        person: IMAGE,
        fit: 'regular',
        prompt: '',
        pieces: [{ slot: 'top', source: { kind: 'wardrobe', wardrobeId: 'not-exist' } }],
      }),
    });
    assert.equal(order.status, 404);
    assert.equal(order.payload.error.code, 'WARDROBE_NOT_FOUND');
  });
});
