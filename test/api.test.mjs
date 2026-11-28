import assert from 'node:assert/strict';
import { hash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.mjs';
import { createSourceService } from '../src/source.mjs';
import { createStore } from '../src/store.mjs';
import { createTryonService } from '../src/tryon.mjs';
import { createWardrobe } from '../src/wardrobe.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PERSON = `data:image/png;base64,${PNG}`;
/** 商品图下载有占位图下限（4KiB），测试图要撑过去。 */
const PNG_BYTES = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(8192)]);
const MODELS = ['codex/gpt-image-2.5', 'minimax-code/MiniMax-Image'];

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

/** 把 multipart 里的一张图还原成 data URL，方便断言「上游收到的到底是什么图」。 */
async function toDataURL(blob) {
  const buffer = Buffer.from(await blob.arrayBuffer());
  return `data:${blob.type};base64,${buffer.toString('base64')}`;
}

/**
 * 假的 OpenAI 兼容图片服务：GET /models 给目录，POST /images/edits 收 multipart，
 * POST /images/generations 收 JSON；两种都回 data[0].b64_json。
 * record 里记 {prompt, reference_images}，参考图还原成 data URL 以保留原有断言。
 */
function makeFetch({ models = MODELS, fail = false, slowMs = 0, record = [] } = {}) {
  return async (url, options) => {
    const target = String(url);
    if (slowMs > 0) await new Promise((resolve) => setTimeout(resolve, slowMs));
    if (target.endsWith('/models')) {
      return jsonResponse({ data: models.map((id) => ({ id, modalities: { output: ['image'] } })) });
    }
    if (fail) return new Response('upstream failed', { status: 500 });

    let prompt = '';
    const referenceImages = [];
    if (target.endsWith('/images/edits')) {
      for (const [key, value] of options.body.entries()) {
        if (key === 'prompt') prompt = String(value);
        else if ((key === 'image' || key === 'image[]') && typeof value !== 'string') {
          referenceImages.push(await toDataURL(value));
        }
      }
    } else if (target.endsWith('/images/generations')) {
      const body = JSON.parse(options.body);
      prompt = String(body.prompt ?? '');
    } else {
      return new Response('not found', { status: 404 });
    }
    record.push({
      model: target.endsWith('/images/edits') ? options.body.get('model') : JSON.parse(options.body).model,
      prompt,
      reference_images: referenceImages,
      size: target.endsWith('/images/edits') ? options.body.get('size') : JSON.parse(options.body).size,
    });
    return jsonResponse({ created: 1, data: [{ b64_json: PNG, mime_type: 'image/png' }] });
  };
}

async function withServer(options = {}, run) {
  const dir = await mkdtemp(join(tmpdir(), 'tryon-api-'));
  const catalogFile = join(dir, 'catalog.json');
  await writeFile(catalogFile, JSON.stringify({
    products: [
      { id: 'shirt-floral', name: '红底白色小花短袖衬衫', subtitle: '棉质府绸', image: 'catalog/shirt-floral.jpg', priceCents: 8900, category: 'tops', garmentType: 'shirt', tags: ['衬衫'] },
    ],
  }), 'utf8');
  const fetchImpl = options.fetchImpl ?? makeFetch({ ...options, record: options.record ?? [] });
  const env = { IMAGE_API_BASE_URL: 'http://127.0.0.1:3425/v1', ...(options.env ?? {}) };
  if (options.savedState) await writeFile(join(dir, 'state.json'), JSON.stringify(options.savedState));
  const store = createStore({ dir, catalogFile });
  await store.ready();
  const tryon = createTryonService({ store, env, fetchImpl, resultsDir: join(dir, 'results') });
  const sources = options.sources ?? createSourceService({
    runCli: options.sourceRunner ?? (async () => ({ ok: true, data: '{"title":"外部商品","images":[]}' })),
    fetchImpl: options.sourceFetch ?? (async () => new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } })),
    settleMs: 0,
  });
  const app = createApp({
    env,
    fetchImpl,
    store,
    tryon,
    sources,
    wardrobe: options.wardrobe ?? createWardrobe({ dir, env, fetchImpl, sources, captioner: async () => '' }),
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
    if (init.method === 'POST' && !headers.origin) headers.origin = base;
    if (init.method === 'PATCH' && !headers.origin) headers.origin = base;
    const response = await fetch(`${base}${path}`, { ...init, headers });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    return { status: response.status, payload, headers: response.headers };
  };
  try {
    await run({ call, base, store, tryon, dir, record: options.record ?? [] });
  } finally {
    for (const order of store.listAllOrders()) {
      if (order.jobId && tryon.getJob(order.jobId)?.status.match(/^(running|queued)$/)) await waitForJob(call, order.jobId);
    }
    await new Promise((resolve) => app.close(resolve));
    // 衣橱/结果的写入队列可能在关闭后仍在落盘，清理失败不应让用例假红。
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function createSession(call) {
  const response = await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'device-test' }) });
  return response.payload;
}

async function waitForJob(call, jobId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await call(`/api/jobs/${jobId}`);
    if (response.payload.status === 'success' || response.payload.status === 'failed') return response.payload;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('job did not finish');
}

test('GET /api/config 返回模型目录、定价、分类与限制', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/config');
    assert.equal(response.status, 200);
    assert.deepEqual(response.payload.models.map(({ id }) => id), MODELS);
    assert.equal(response.payload.defaultModel, 'codex/gpt-image-2.5');
    assert.equal(response.payload.defaultTier, 'standard');
    assert.equal(response.payload.tryOnFromCents, 0);
    assert.deepEqual(response.payload.packs, []);
    assert.equal(response.payload.categories.length, 3);
    assert.equal(response.payload.gateway.reachable, true);
    assert.ok(response.payload.limits.imageBytes > 0);
    assert.ok(response.payload.studioPresets.some(({ id }) => id === 'clean-white-seamless'));
    assert.ok(response.payload.posePresets.some(({ id }) => id === 'over-shoulder'));
    const pose = response.payload.posePresets.find(({ id }) => id === 'over-shoulder');
    assert.equal(pose.posewearId, 'P017');
    assert.equal(pose.referenceUrl, '/posewear/P017.png');
    assert.equal(response.payload.defaultStudioPreset, 'clean-white-seamless');
    assert.ok(response.payload.posePresets.some(({ id }) => id === response.payload.defaultPosePreset));
  });
});

test('本地姿势归档不会进入试穿预设或静态资源', async () => {
  await withServer({}, async ({ call }) => {
    const { status, payload } = await call('/api/config');
    assert.equal(status, 200);
    assert.deepEqual(payload.posePresets.map((pose) => pose.referenceUrl).sort(),
      ['P015.png', 'P017.png', 'P020.png', 'P041.webp', 'P049.webp', 'P063.webp'].map((file) => `/posewear/${file}`));
    for (const path of ['/posewear/library.json', '/posewear/restricted/pair60_P001.png', '/data/posewear-archive/library.json']) {
      assert.equal((await call(path, { method: 'HEAD' })).status, 404);
    }
  });
});

test('内置模特可独立下载带蒙皮和嵌入贴图的 GLB，以及单独的几何校样', async () => {
  await withServer({}, async ({ base }) => {
    const model = await fetch(`${base}/model/posewear-01/posewear-01.glb`);
    assert.equal(model.status, 200);
    assert.equal(model.headers.get('content-type'), 'model/gltf-binary');
    const bytes = Buffer.from(await model.arrayBuffer());
    assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const document = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.ok(document.skins.some((skin) => skin.joints.length > 1));
    assert.ok(document.meshes.length > 1 && document.meshes.every((mesh) => mesh.primitives.every((part) => 'WEIGHTS_0' in part.attributes)));
    assert.ok(document.images.length > 0 && document.images.every((image) => Number.isInteger(image.bufferView) && !image.uri));
    const proof = await fetch(`${base}/model/posewear-01/fit-proof.jpg`, { method: 'HEAD' });
    assert.equal(proof.status, 200);
    assert.equal(proof.headers.get('content-type'), 'image/jpeg');
  });
});

test('GET /api/products 返回橱窗商品', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/products');
    assert.equal(response.status, 200);
    assert.equal(response.payload.products.length, 1);
    assert.equal(response.payload.products[0].id, 'shirt-floral');
  });
});

test('POST /api/session 建立零余额会话并复用设备身份', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    assert.ok(session.sessionId);
    assert.equal(session.balanceCents, 0);
    assert.deepEqual(session.packs, []);
    const again = await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'device-test' }) });
    assert.equal(again.payload.sessionId, session.sessionId);
  });
});

test('下单缺少人物照返回 400', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard' }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.field, 'person');
  });
});

test('存量普通模式零余额会话连续使用高质量档，两笔真实订单都不改余额', async () => {
  const record = [];
  const savedState = { sessions: [{ id: 'existing-user', deviceId: 'device-test', balanceCents: 0 }], settings: { demoMode: false } };
  await withServer({ record, savedState, env: { DEMO_MODE: '0' } }, async ({ call, store, dir }) => {
    const session = await createSession(call);
    assert.equal(session.sessionId, 'existing-user');
    for (let shot = 0; shot < 2; shot += 1) {
      const response = await call('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'premium', person: PERSON, priceCents: 1390 }),
      });
      assert.equal(response.status, 201);
      assert.equal(response.payload.priceCents, 0);
      assert.equal((await waitForJob(call, response.payload.jobId)).status, 'success');
      assert.equal(store.getOrder(response.payload.orderId).quality, 'high');
    }
    const persisted = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    assert.equal(persisted.sessions[0].balanceCents, 0);
    assert.deepEqual(persisted.orders.map(({ priceCents }) => priceCents), [0, 0]);
    assert.equal(record.length, 2);
  });
});

test('未知模型被拒绝', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'not-a-model', tier: 'standard', person: PERSON }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'MODEL_UNAVAILABLE');
  });
});

test('存下来的模型已不在目录里时退回默认模型，而不是每次下单都报不可用', async () => {
  // 换服务地址或模型下线后，state 里存的模型名会变成孤儿；下单页无从修复，必须自动退回。
  await withServer({ models: [MODELS[1]], env: { IMAGE_MODEL: MODELS[1] } }, async ({ call, store }) => {
    await store.updateSettings({ model: MODELS[0] });
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', person: PERSON }),
    });
    assert.equal(created.status, 201);
    const settings = await call('/api/settings');
    assert.equal(settings.payload.model, MODELS[1]);
  });
});

test('停用模型不能设置或生成，旧设置使用可用默认模型且历史结果可读', async () => {
  const retired = ['comfyui/foxbaze-tryon', 'idm/idm-vton'];
  const historical = retired.map((model, index) => ({ id: `history-${index}`, model, sessionId: 'owner', status: 'success', resultFile: `history-${index}.png`, priceCents: 0 }));
  const savedState = { sessions: [{ id: 'owner', deviceId: 'device-test', balanceCents: 0 }], orders: historical, settings: { model: retired[0] } };
  const available = MODELS[1];
  const record = [];
  await withServer({ record, savedState, env: { IMAGE_MODELS: [...retired, available].join(','), IMAGE_MODEL: retired[0] } }, async ({ call, dir, store, base }) => {
    const list = await call('/api/config');
    assert.deepEqual(list.payload.models.map(({ id }) => id), [available]);
    assert.equal((await call('/api/settings')).payload.model, available);
    const { sessionId } = await createSession(call);
    const body = { sessionId, productId: 'shirt-floral', person: PERSON };
    for (const [index, model] of retired.entries()) {
      const tier = ['workflow', 'idm'][index];
      for (const [method, path, input] of [
        ['PATCH', '/api/settings', { model }],
        ['POST', '/api/orders', { ...body, model, tier }],
        ['POST', '/api/orders', { ...body, model, tier, photographyMode: 'studio' }],
        ['POST', '/api/tryon', { person: PERSON, garment: PERSON, category: 'tops', model }],
        ['POST', '/api/tryon', { person: PERSON, garment: PERSON, category: 'tops', model, tier }],
      ]) {
        const response = await call(path, { method, body: JSON.stringify(input) });
        assert.equal(response.status, 400);
        assert.equal(response.payload.error.code, 'MODEL_UNAVAILABLE');
      }
    }
    assert.equal(store.listOrders(sessionId).length, 2);
    assert.deepEqual(record, []);
    await mkdir(join(dir, 'results'), { recursive: true });
    for (const order of historical) {
      await writeFile(join(dir, 'results', order.resultFile), Buffer.from(PNG, 'base64'));
      const detail = (await call(`/api/orders/${order.id}`, { headers: { 'x-session-id': sessionId } })).payload.order;
      assert.equal(detail.model, order.model);
      assert.equal(detail.status, 'success');
      const result = await fetch(`${base}/api/results/${detail.resultFile}?k=${detail.resultToken}`);
      assert.equal(result.status, 200);
      assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.from(PNG, 'base64'));
    }
    const created = await call('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(created.status, 201);
    assert.equal((await waitForJob(call, created.payload.jobId)).status, 'success');
    assert.equal(store.getOrder(created.payload.orderId).model, available);
    assert.deepEqual(record.map(({ model }) => model), [available]);
  });
});

test('未注册 API 路径返回 404，已注册路径的方法错误返回 405 和 Allow', async () => {
  await withServer({}, async ({ call }) => {
    for (const path of ['/api', '/api/unknown', '/api/workflows/status', '/api/workflows/idm/status']) {
      for (const method of ['GET', 'POST']) {
        const response = await call(path, { method });
        assert.equal(response.status, 404);
        assert.equal(response.payload.error.code, 'NOT_FOUND');
        assert.equal(response.headers.get('allow'), null);
      }
    }
    for (const [path, method, allowed] of [
      ['/api/settings', 'PUT', ['GET', 'PATCH']],
      ['/api/products/shirt-floral', 'POST', ['GET']],
    ]) {
      const response = await call(path, { method });
      assert.equal(response.status, 405);
      assert.equal(response.payload.error.code, 'METHOD_NOT_ALLOWED');
      assert.deepEqual(response.headers.get('allow')?.split(/,\s*/).sort(), allowed);
    }
  });
});

test('显式选择停用模型时直接拒绝，不查询网关或连接原试穿服务', async (context) => {
  const upstream = context.mock.fn(async () => jsonResponse({ data: [] }));
  const env = { COMFYUI_BASE_URL: 'http://unused.test', IDM_BASE_URL: 'http://unused.test' };
  await withServer({ env, fetchImpl: upstream }, async ({ call, store, tryon }) => {
    const { sessionId } = await createSession(call);
    for (const model of ['comfyui/foxbaze-tryon', 'idm/idm-vton']) {
      const body = JSON.stringify({ sessionId, productId: 'shirt-floral', model, person: PERSON, garment: PERSON, category: 'tops' });
      for (const [method, path] of [['PATCH', '/api/settings'], ['POST', '/api/orders'], ['POST', '/api/tryon']]) {
        const response = await call(path, { method, body });
        assert.equal(response.payload.error.code, 'MODEL_UNAVAILABLE');
      }
    }
    assert.deepEqual(store.listOrders(sessionId), []);
    assert.deepEqual(tryon.jobsForSession(sessionId), []);
    assert.equal(upstream.mock.callCount(), 0);
  });
});

test('有存量余额的会话生成成功并取回结果，余额原样保留', async () => {
  const savedState = { sessions: [{ id: 'funded', deviceId: 'device-test', balanceCents: 990 }] };
  await withServer({ savedState }, async ({ call }) => {
    const session = await createSession(call);
    const before = session.balanceCents;
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.priceCents, 0);
    assert.equal(created.payload.balanceCents, before);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    const order = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(order.payload.order.status, 'success');
    assert.equal(order.payload.order.hasResult, true);
    assert.equal(order.payload.order.prompt, undefined, '订单详情不应回传提示词');
    const balance = await call(`/api/session/${session.sessionId}`);
    assert.equal(balance.payload.balanceCents, before);
  });
});

test('生成失败时订单失败，余额保持原值', async () => {
  await withServer({ fail: true }, async ({ call }) => {
    const session = await createSession(call);
    const before = session.balanceCents;
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    assert.equal(created.status, 201);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'failed');
    const balance = await call(`/api/session/${session.sessionId}`);
    assert.equal(balance.payload.balanceCents, before);
    const order = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(order.payload.order.status, 'failed');
  });
});

test('有参考图时走 /images/edits，把人物与商品图一起上传', async () => {
  const record = [];
  await withServer({ record }, async ({ call }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    assert.equal(record.length, 1);
    assert.equal(record[0].reference_images.length, 2, '人物 + 商品图 = 2 张参考图');
  });
});

test('同一会话同时只能有一个进行中的试穿任务', async () => {
  await withServer({ slowMs: 400 }, async ({ call }) => {
    const session = await createSession(call);
    const body = JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON });
    const first = await call('/api/orders', { method: 'POST', body });
    assert.equal(first.status, 201);
    const second = await call('/api/orders', { method: 'POST', body });
    assert.equal(second.status, 409);
    await waitForJob(call, first.payload.jobId);
  });
});

test('两个会话交错启动，任务须等自己的订单写好 jobId 才能向上游发送', async () => {
  const record = [];
  await withServer({ record }, async ({ call, store }) => {
    const first = await createSession(call);
    const second = (await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'second-device' }) })).payload;
    const submit = (sessionId) => call('/api/orders', { method: 'POST', body: JSON.stringify({ sessionId, productId: 'shirt-floral', person: PERSON }) });
    const { promise: reached, resolve: reachedFirst } = Promise.withResolvers();
    const { promise: proceed, resolve: releaseFirst } = Promise.withResolvers();
    const update = store.updateOrder;
    store.updateOrder = async (id, patch) => {
      if (patch.jobId && store.getOrder(id).sessionId === first.sessionId) { reachedFirst(); await proceed; }
      return update(id, patch);
    };
    const waiting = submit(first.sessionId);
    await reached;
    try {
      const other = await submit(second.sessionId);
      assert.equal((await waitForJob(call, other.payload.jobId)).status, 'success');
      assert.equal(record.length, 1);
      assert.equal(store.listOrders(first.sessionId)[0].status, 'pending');
    } finally {
      releaseFirst();
      const started = await waiting;
      await waitForJob(call, started.payload.jobId);
    }
    assert.equal(record.length, 2);
  });
});

test('订单只对所属会话可见', async () => {
  await withServer({ slowMs: 300 }, async ({ call }) => {
    const owner = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: owner.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    const other = await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'other-device' }) });
    const list = await call('/api/orders', { headers: { 'x-session-id': other.payload.sessionId } });
    assert.equal(list.payload.orders.length, 0);
    const detail = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': other.payload.sessionId } });
    assert.equal(detail.status, 404);
    await waitForJob(call, created.payload.jobId);
  });
});

test('即使启用历史模拟支付开关也不能新建或确认充值，旧记录原样保存', async () => {
  const payment = { id: 'old-top-up', sessionId: 'old-session', status: 'pending', amountCents: 990 };
  const savedState = { sessions: [{ id: 'old-session', deviceId: 'device-test', balanceCents: 17 }], payments: [payment] };
  await withServer({ savedState, env: { ENABLE_SIMULATED_PAYMENTS: '1' } }, async ({ call, dir }) => {
    const session = await createSession(call);
    for (const path of ['/api/payments', '/api/payments/old-top-up/confirm']) {
      const response = await call(path, { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, packId: 'light' }) });
      assert.equal(response.status, 403);
      assert.equal(response.payload.error.code, 'PAYMENT_DISABLED');
    }
    const persisted = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(persisted.payments, [payment]);
    assert.equal(persisted.sessions[0].balanceCents, 17);
  });
});

test('POST /api/tryon 保持同步兼容并返回图片', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/tryon', {
      method: 'POST',
      body: JSON.stringify({ model: 'codex/gpt-image-2.5', person: PERSON, garment: PERSON, category: 'tops', garmentType: 'tee' }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.engine, 'codex/gpt-image-2.5');
    assert.match(response.payload.image.dataURL, /^data:image\/png;base64,/);
  });
});

test('非法图片内容被拒绝', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/tryon', {
      method: 'POST',
      body: JSON.stringify({ model: 'codex/gpt-image-2.5', person: 'data:image/png;base64,bm90YW5pbWFnZQ==', garment: PERSON, category: 'tops' }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'INVALID_IMAGE');
  });
});

test('静态页面可访问且不暴露目录穿越', async () => {
  const { buildFrontend } = await import('../scripts/build-frontend.mjs');
  await buildFrontend();
  await withServer({}, async ({ call }) => {
    const page = await call('/');
    assert.equal(page.status, 200);
    assert.match(page.payload, /<title>照花(?: · [^<]+)?<\/title>/);
    const favicon = page.payload.match(/<link\b[^>]*rel="icon"[^>]*href="([^"]+)"/)?.[1];
    assert.match(favicon ?? '', /^\/icon\.svg(?:\?[\w=.-]+)?$/);
    const icon = await call(favicon);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
    assert.match(icon.payload, /<title>照花<\/title>/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const entry = page.payload.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/i)?.[1];
    assert.equal(entry, '/dist/app.js');
    for (const path of [entry, '/style.css']) {
      const asset = await call(path);
      assert.equal(asset.status, 200);
      assert.equal(asset.headers.get('cache-control'), 'no-cache', `${path} must revalidate to avoid mixing frontend versions`);
    }
    const image = await call('/catalog/blouse-linen.jpg');
    assert.equal(image.headers.get('cache-control'), 'public, max-age=300');
    const traversal = await call('/../package.json');
    assert.notEqual(traversal.status, 200);
  });
});

test('跨站请求被拒绝', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/session', { method: 'POST', headers: { origin: 'http://evil.example' }, body: JSON.stringify({ deviceId: 'x' }) });
    assert.equal(response.status, 403);
  });
});

test('非法档位被拒绝', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'minimax-code/MiniMax-Image', tier: 'premium', person: PERSON }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.field, 'tier');
  });
});

test('订单落盘不含人像 base64', async () => {
  await withServer({}, async ({ call, dir }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    assert.equal(created.status, 201);
    await waitForJob(call, created.payload.jobId);
    const raw = await readFile(join(dir, 'state.json'), 'utf8');
    assert.doesNotMatch(raw, /base64/, 'state.json 不应包含任何图片 base64');
    assert.doesNotMatch(raw, /"person"/);
  });
});

test('目录商品图以已校验的 data URL 下发给上游', async () => {
  const record = [];
  await withServer({ record }, async ({ call }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    assert.equal(created.status, 201);
    await waitForJob(call, created.payload.jobId);
    assert.equal(record.length, 1);
    const [person, garment] = record[0].reference_images;
    assert.match(person, /^data:image\/png;base64,/);
    assert.match(garment, /^data:image\/jpeg;base64,/, '目录商品图必须转成 data URL');
  });
});

test('结果图需要有效票据，缺票据或票据错误都拒绝', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    await waitForJob(call, created.payload.jobId);
    const order = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    const file = order.payload.order.resultFile;
    assert.ok(order.payload.order.resultToken);
    const ok = await call(`/api/results/${file}?k=${order.payload.order.resultToken}`);
    assert.equal(ok.status, 200);
    const missing = await call(`/api/results/${file}`);
    assert.equal(missing.status, 403);
    const wrong = await call(`/api/results/${file}?k=1.abc`);
    assert.equal(wrong.status, 403);
  });
});

test('两次重启处理混合历史账目，缺失会话单保留待核对金额，其余用户只入账一次', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tryon-restart-'));
  try {
    const catalogFile = join(dir, 'catalog.json');
    await writeFile(catalogFile, JSON.stringify({ products: [] }), 'utf8');
    const paid = { id: 'old-pending', sessionId: 'history', status: 'pending', priceCents: 690 };
    const free = { id: 'free-pending', sessionId: 'history', status: 'pending', priceCents: 0 };
    const complete = { id: 'old-success', sessionId: 'history', status: 'success', priceCents: 290 };
    const orphan = { id: 'missing-session-order', sessionId: 'evicted', status: 'pending', priceCents: 390 };
    await writeFile(join(dir, 'state.json'), JSON.stringify({ sessions: [{ id: 'history', balanceCents: 42 }], orders: [orphan, paid, free, complete] }));
    for (const expected of [3, 0]) {
      const store = createStore({ dir, catalogFile });
      await store.ready();
      const tryon = createTryonService({ store, env: {}, resultsDir: join(dir, 'results') });
      assert.equal(await tryon.reconcileInterruptedOrders(), expected);
      const persisted = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
      assert.deepEqual(persisted.sessions, [{ id: 'history', balanceCents: 732 }]);
      const unresolved = persisted.orders.find(({ id }) => id === orphan.id);
      assert.equal(unresolved.status, 'failed');
      assert.equal(unresolved.sessionId, 'evicted');
      assert.equal(unresolved.priceCents, 390);
      assert.deepEqual(unresolved.refund, { status: 'needs_review', amountCents: 390 });
      assert.doesNotMatch(unresolved.errorMessage, /已退回/);
    }
    const reopened = createStore({ dir, catalogFile });
    await reopened.ready();
    assert.equal(reopened.getSession('history').balanceCents, 732);
    assert.equal(reopened.getOrder('old-pending').status, 'failed');
    assert.match(reopened.getOrder('old-pending').errorMessage, /退回/);
    assert.deepEqual(reopened.getOrder('old-pending').refund, { status: 'credited', amountCents: 690 });
    assert.equal(reopened.getOrder('free-pending').status, 'failed');
    assert.doesNotMatch(reopened.getOrder('free-pending').errorMessage, /费|退回|余额/);
    assert.deepEqual(reopened.getOrder('old-success'), complete);
    assert.equal((await reopened.getOrCreateSession('evicted')).balanceCents, 0);
    assert.equal(reopened.getSession('evicted'), null);
  } finally {
    // 衣橱/结果的写入队列可能在关闭后仍在落盘，清理失败不应让用例假红。
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

const SOURCE_RUNNER = async (args) => {
  if (args[0] === 'browser' && args[3] === 'eval') {
    return {
      ok: true,
      data: JSON.stringify({
        title: '火星JK制服墨石格裙',
        images: [
          { url: 'https://img.alicdn.com/imgextra/i1/1099675835/O1CN01.jpg_760x760q30.jpg_.webp', group: 'main' },
          { url: 'https://img.alicdn.com/imgextra/i1/1099675835/O1CN02.jpg', group: 'sku' },
        ],
      }),
    };
  }
  return { ok: true, data: { url: 'about:blank' } };
};

test('POST /api/sources 解析商品链接并列出图片', async () => {
  await withServer({ sourceRunner: SOURCE_RUNNER }, async ({ call }) => {
    const response = await call('/api/sources', { method: 'POST', body: JSON.stringify({ url: 'https://item.taobao.com/item.htm?id=862667630822' }) });
    assert.equal(response.status, 201);
    assert.equal(response.payload.source.platform, 'taobao');
    assert.equal(response.payload.source.platformLabel, '淘宝 / 天猫');
    assert.equal(response.payload.source.title, '火星JK制服墨石格裙');
    assert.deepEqual(response.payload.source.images.map((image) => image.group), ['main', 'sku']);
    assert.equal(response.payload.source.images[0].url, undefined, '列表不暴露原图直链');
  });
});

test('GET /api/sources/:id/:index 返回已校验的商品图', async () => {
  await withServer({ sourceRunner: SOURCE_RUNNER }, async ({ call }) => {
    const created = await call('/api/sources', { method: 'POST', body: JSON.stringify({ url: 'https://item.taobao.com/item.htm?id=862667630822' }) });
    const id = created.payload.source.id;
    const image = await call(`/api/sources/${id}/0`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('cache-control'), 'no-store');
    const missing = await call(`/api/sources/${id}/9`);
    assert.equal(missing.status, 404);
  });
});

test('用链接导入的商品图下单，上游收到该图的 data URL', async () => {
  const record = [];
  await withServer({ sourceRunner: SOURCE_RUNNER, record }, async ({ call }) => {
    const session = await createSession(call);
    const created = await call('/api/sources', { method: 'POST', body: JSON.stringify({ url: 'https://item.taobao.com/item.htm?id=862667630822' }) });
    const order = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.sessionId,
        sourceId: created.payload.source.id,
        sourceIndex: 0,
        sourceName: '火星JK制服墨石格裙',
        model: 'codex/gpt-image-2.5',
        tier: 'standard',
        category: 'tops',
        garmentType: 'shirt',
        person: PERSON,
      }),
    });
    assert.equal(order.status, 201);
    const job = await waitForJob(call, order.payload.jobId);
    assert.equal(job.status, 'success');
    assert.equal(record.length, 1);
    const [person, garment] = record[0].reference_images;
    assert.match(person, /^data:image\/png;base64,/);
    assert.match(garment, /^data:image\/png;base64,/, '外部商品图必须转成 data URL');
    assert.match(record[0].prompt, /火星JK制服墨石格裙/, '提示词应带外部商品名');
  });
});

test('不支持的链接与未知 sourceId 给出明确错误', async () => {
  await withServer({ sourceRunner: SOURCE_RUNNER }, async ({ call }) => {
    const unsupported = await call('/api/sources', { method: 'POST', body: JSON.stringify({ url: 'https://www.amazon.com/dp/B0001' }) });
    assert.equal(unsupported.status, 400);
    assert.equal(unsupported.payload.error.code, 'UNSUPPORTED_PLATFORM');
    const session = await createSession(call);
    const order = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, sourceId: 'missing', model: 'codex/gpt-image-2.5', tier: 'standard', category: 'tops', garmentType: 'shirt', person: PERSON }),
    });
    assert.equal(order.status, 404);
    assert.equal(order.payload.error.code, 'SOURCE_EXPIRED');
  });
});

test('多件搭配（top+bottom）下单成功且参考图按 top→bottom 排列', async () => {
  const record = [];
  await withServer({ record }, async ({ call }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.sessionId,
        model: 'codex/gpt-image-2.5',
        tier: 'standard',
        person: PERSON,
        pieces: [
          { slot: 'bottom', garmentType: '百褶裙', source: { kind: 'upload', image: PERSON } },
          { slot: 'top', garmentType: '毛衣', source: { kind: 'product', productId: 'shirt-floral' } },
        ],
      }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.payload.order.slots, ['top', 'bottom']);
    assert.equal(created.payload.priceCents, 0);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    assert.equal(record.length, 1);
    assert.equal(record[0].reference_images.length, 3, '人物 + top + bottom = 3 张参考图');
    assert.match(record[0].reference_images[1], /^data:image\/jpeg;base64,/, 'top 来自目录商品图');
    assert.match(record[0].reference_images[2], /^data:image\/png;base64,/, 'bottom 来自上传图');
    assert.match(record[0].prompt, /reference image 2 \(top/);
    assert.match(record[0].prompt, /reference image 3 \(bottom/);
  });
});

test('棚拍模式保存固定背景与姿势，并把重拍方向写入提示词', async () => {
  const record = [];
  await withServer({ record }, async ({ call, store }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.sessionId,
        model: 'codex/gpt-image-2.5',
        tier: 'standard',
        person: PERSON,
        photographyMode: 'studio',
        studioPreset: 'clean-white-seamless',
        posePreset: 'hand-behind-head',
        pieces: [
          { slot: 'outer', garmentType: '风衣', source: { kind: 'upload', image: PERSON } },
          { slot: 'bottom', garmentType: '长裤', source: { kind: 'upload', image: PERSON } },
        ],
      }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    const order = store.getOrder(created.payload.orderId);
    assert.equal(order.photographyMode, 'studio');
    assert.equal(order.studioPreset, 'clean-white-seamless');
    assert.equal(order.posePreset, 'hand-behind-head');
    assert.equal(order.size, '1024x1536');
    assert.equal(record[0].size, '1024x1536');
    assert.match(record[0].prompt, /PHOTOGRAPHY MODE: STUDIO/);
    assert.doesNotMatch(record[0].prompt, /BODY PROPORTIONS|7\.16 heads|y=1360/);
    assert.match(record[0].prompt, /one hand resting behind the head/i);
    assert.equal(record[0].reference_images.length, 4, '人物 + 外套 + 下装 + PoseWear 姿势图');
    assert.match(record[0].reference_images[3], /^data:image\/png;base64,/, '姿势图固定放在参考图末尾');
    const detail = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(detail.payload.order.photographyMode, 'studio');
    assert.equal(detail.payload.order.posePreset, 'hand-behind-head');
  });
});

test('内置棚拍 multipart 按全身、定妆 PNG、有序衣物、指定骨架发送，提示词与图号一致', async () => {
  const record = [];
  const png = await readFile(new URL('../public/model/posewear-01/model-front.png', import.meta.url));
  const person = `data:image/png;base64,${png.toString('base64')}`;
  const shirt = await readFile(new URL('../public/catalog/shirt-floral.jpg', import.meta.url));
  const jeans = await readFile(new URL('../public/catalog/jeans-black.jpg', import.meta.url));
  const uploadedJeans = `data:image/jpeg;base64,${jeans.toString('base64')}`;
  const pose = await readFile(new URL('../public/posewear/P017.png', import.meta.url));
  await withServer({ record }, async ({ call, store }) => {
    const { sessionId } = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST', body: JSON.stringify({ sessionId, person, model: 'codex/gpt-image-2.5',
        photographyMode: 'studio', posePreset: 'over-shoulder', pieces: [
          { slot: 'bottom', source: { kind: 'upload', image: uploadedJeans } },
          { slot: 'top', source: { kind: 'product', productId: 'shirt-floral' } },
        ] }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal((await waitForJob(call, created.payload.jobId)).status, 'success');
    const [{ reference_images: images, prompt }] = record;
    assert.equal(images.length, 5);
    assert.equal(images[0] === person, true);
    assert.match(images[1].slice(0, 30), /^data:image\/png;base64,/);
    const portrait = await readFile(new URL('../public/model/posewear-01/face-studio-makeup.png', import.meta.url));
    assert.equal(hash('sha256', Buffer.from(images[1].split(',')[1], 'base64')), hash('sha256', portrait));
    assert.match(prompt, /facial identity and finished makeup (?:in|from) (?:reference )?image 2/i);
    assert.equal(images[2] === `data:image/jpeg;base64,${shirt.toString('base64')}`, true);
    assert.equal(images[3] === uploadedJeans, true);
    assert.equal(images[4] === `data:image/png;base64,${pose.toString('base64')}`, true);
    assert.match(prompt, /reference image 3 \(top/i);
    assert.match(prompt, /reference image 4 \(bottom/i);
    assert.match(prompt, /reference image 5 supplies only the body pose/i);
    assert.match(prompt, /BODY PROPORTIONS/);
    assert.doesNotMatch(JSON.stringify(store.getOrder(created.payload.orderId)), /base64,/);
  });
});

test('普通试穿与显式自传同一默认图，都不发送内置脸；不能伪报内置人物', async () => {
  const record = [];
  const png = await readFile(new URL('../public/model/posewear-01/model-front.png', import.meta.url));
  const person = `data:image/png;base64,${png.toString('base64')}`;
  await withServer({ record, env: { DEMO_MODE: '1' } }, async ({ call, store }) => {
    const { sessionId } = await createSession(call);
    const order = (overrides) => call('/api/orders', { method: 'POST', body: JSON.stringify({
      sessionId, person, model: 'codex/gpt-image-2.5', pieces: [{ slot: 'top', source: { kind: 'upload', image: PERSON } }], ...overrides,
    }) });
    for (const [photographyMode, personSource, count] of [['preserve', 'builtin', 2], ['studio', 'upload', 3]]) {
      const result = await order({ photographyMode, personSource, faceImage: PERSON, posewearBody: true });
      assert.equal(result.status, 201);
      assert.equal((await waitForJob(call, result.payload.jobId)).status, 'success');
      const sent = record.at(-1);
      assert.equal(sent.reference_images.length, count);
      assert.equal(sent.reference_images[1], PERSON);
      assert.doesNotMatch(sent.prompt, /^BODY PROPORTIONS \(|studio makeup portrait|finished makeup from reference image 2/im);
    }
    const before = store.getSession(sessionId).balanceCents;
    for (const overrides of [{ personSource: 'builtin', person: PERSON }, { personSource: 'unknown' }]) {
      const result = await order({ photographyMode: 'studio', ...overrides });
      assert.equal(result.status, 400);
      assert.equal(result.payload.error.field, 'personSource');
    }
    assert.equal(store.getSession(sessionId).balanceCents, before);
    assert.equal(record.length, 2);
  });
});

test('旧订单详情与列表都把缺失的棚拍字段归一化', async () => {
  const historicOrder = { id: 'legacy', sessionId: 'owner', productName: '旧版试穿', status: 'success', priceCents: 690 };
  const savedState = { sessions: [{ id: 'owner', deviceId: 'device-test', balanceCents: 0 }], orders: [historicOrder] };
  await withServer({ savedState }, async ({ call }) => {
    const session = await createSession(call);
    const detail = await call(`/api/orders/${historicOrder.id}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(detail.payload.order.priceCents, 690);
    assert.equal(detail.payload.order.photographyMode, 'preserve');
    assert.equal(detail.payload.order.studioPreset, null);
    assert.equal(detail.payload.order.posePreset, null);
    const list = await call('/api/orders', { headers: { 'x-session-id': session.sessionId } });
    assert.equal(list.payload.orders[0].priceCents, 690);
    assert.equal(list.payload.orders[0].photographyMode, 'preserve');
    assert.equal(list.payload.orders[0].studioPreset, null);
    assert.equal(list.payload.orders[0].posePreset, null);
  });
});

test('未知棚拍模板或姿势在建单前拒绝', async () => {
  for (const [patch, field] of [
    [{ studioPreset: 'unknown-studio' }, 'studioPreset'],
    [{ posePreset: 'unknown-pose' }, 'posePreset'],
    [{ posePreset: ['editorial-stand'] }, 'posePreset'],
    [{ posePreset: { toString: null } }, 'posePreset'],
  ]) {
    await withServer({}, async ({ call, store }) => {
      const session = await createSession(call);
      const before = session.balanceCents;
      const response = await call('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: session.sessionId,
          model: 'codex/gpt-image-2.5',
          tier: 'standard',
          person: PERSON,
          photographyMode: 'studio',
          ...patch,
          pieces: [{ slot: 'top', garmentType: '针织衫', source: { kind: 'upload', image: PERSON } }],
        }),
      });
      assert.equal(response.status, 400);
      assert.equal(response.payload.error.field, field);
      assert.equal(store.getSession(session.sessionId).balanceCents, before);
      assert.equal(store.listOrders(session.sessionId).length, 0);
    });
  }
});

test('连衣裙与上衣/下装互斥返回 400 INVALID_REQUEST', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.sessionId,
        model: 'codex/gpt-image-2.5',
        tier: 'standard',
        person: PERSON,
        pieces: [
          { slot: 'dress', garmentType: '吊带裙', source: { kind: 'upload', image: PERSON } },
          { slot: 'top', garmentType: '毛衣', source: { kind: 'upload', image: PERSON } },
        ],
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'INVALID_REQUEST');
    assert.equal(response.payload.error.field, 'pieces');
  });
});

test('单品件数超过 5 件返回 400', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const pieces = ['top', 'outer', 'bottom', 'hosiery', 'shoes', 'accessory'].map((slot) => ({
      slot,
      garmentType: 'x',
      source: { kind: 'upload', image: PERSON },
    }));
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON, pieces }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'INVALID_REQUEST');
    assert.equal(response.payload.error.field, 'pieces');
  });
});

test('配饰最多 2 件', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const pieces = ['项链', '耳环', '帽子'].map((garmentType) => ({
      slot: 'accessory',
      garmentType,
      source: { kind: 'upload', image: PERSON },
    }));
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON, pieces }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.field, 'pieces');
  });
});

test('同一格子跨穿着层级可以叠穿，同层重复仍被拒绝', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const stacked = [
      { slot: 'top', garmentType: '衬衫', layer: 'inner', source: { kind: 'upload', image: PERSON } },
      { slot: 'top', garmentType: '毛衣', layer: 'middle', source: { kind: 'upload', image: PERSON } },
      { slot: 'outer', garmentType: '外套', layer: 'outer', source: { kind: 'upload', image: PERSON } },
    ];
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON, pieces: stacked }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.deepEqual(created.payload.order.slots, ['top', 'top', 'outer']);

    const duplicated = [
      { slot: 'top', garmentType: '衬衫', layer: 'inner', source: { kind: 'upload', image: PERSON } },
      { slot: 'top', garmentType: 'T恤', layer: 'inner', source: { kind: 'upload', image: PERSON } },
    ];
    const rejected = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON, pieces: duplicated }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.payload.error.field, 'pieces');
  });
});

test('演示模式下单不扣费、不校验余额，充值返回 PAYMENT_DISABLED', async () => {
  await withServer({ env: { DEMO_MODE: '1' } }, async ({ call, store }) => {
    const config = await call('/api/config');
    assert.equal(config.payload.demoMode, true);
    const session = await createSession(call);
    assert.equal(session.balanceCents, 0);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.priceCents, 0);
    assert.equal(created.payload.balanceCents, 0, '演示模式不扣费');
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    const balance = await call(`/api/session/${session.sessionId}`);
    assert.equal(balance.payload.balanceCents, 0);
    const payment = await call('/api/payments', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, packId: 'light' }) });
    assert.equal(payment.status, 403);
    assert.equal(payment.payload.error.code, 'PAYMENT_DISABLED');
  });
});

test('GET/PATCH /api/settings 读写默认模型，下单未传 model 时使用它', async () => {
  await withServer({}, async ({ call }) => {
    const initial = await call('/api/settings');
    assert.equal(initial.status, 200);
    assert.equal(initial.payload.model, 'codex/gpt-image-2.5');
    assert.deepEqual(initial.payload.models.map(({ id }) => id), MODELS);
    assert.equal(initial.payload.demoMode, false);
    assert.equal(initial.payload.sources.jd, true);
    assert.equal(initial.payload.sources.douyin, true);
    assert.equal(typeof initial.payload.sources.taobao, 'boolean');
    assert.equal(initial.payload.gateway.reachable, true);

    const patched = await call('/api/settings', { method: 'PATCH', body: JSON.stringify({ model: 'minimax-code/MiniMax-Image' }) });
    assert.equal(patched.status, 200);
    assert.equal(patched.payload.model, 'minimax-code/MiniMax-Image');
    const after = await call('/api/settings');
    assert.equal(after.payload.model, 'minimax-code/MiniMax-Image');

    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', tier: 'fast', person: PERSON }),
    });
    assert.equal(created.status, 201);
    const order = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(order.payload.order.model, 'minimax-code/MiniMax-Image');
  });
});

test('PATCH /api/settings 拒绝网关没有列出的模型', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/settings', { method: 'PATCH', body: JSON.stringify({ model: 'nobody/not-a-model' }) });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'MODEL_UNAVAILABLE');
    assert.equal(response.payload.error.field, 'model');
    const after = await call('/api/settings');
    assert.equal(after.payload.model, 'codex/gpt-image-2.5', '非法请求不能改动设置');
  });
});

test('GET /api/settings 不返回 cookie 内容，只返回是否配置', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/settings');
    const text = JSON.stringify(response.payload);
    assert.equal(/PASS_ID|PDDAccessToken|_tb_token_|sessionid/i.test(text), false, '设置接口不能回传 cookie 值');
    for (const value of Object.values(response.payload.sources)) assert.equal(typeof value, 'boolean');
  });
});

test('演示模式下直连生成接口也关闭，避免绕过下单消耗额度', async () => {
  const record = [];
  await withServer({ env: { DEMO_MODE: '1' }, record }, async ({ call }) => {
    const response = await call('/api/tryon', {
      method: 'POST',
      body: JSON.stringify({ model: 'codex/gpt-image-2.5', tier: 'standard', category: 'tops', garmentType: 'shirt', person: PERSON, garment: PERSON }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.payload.error.code, 'RAW_TRYON_DISABLED');
    assert.equal(record.length, 0, '演示模式不得向上游发起生成');
  });
});

test('多件搭配可以用链接导入的商品图作为其中一件', async () => {
  const record = [];
  await withServer({ sourceRunner: SOURCE_RUNNER, record }, async ({ call }) => {
    const session = await createSession(call);
    const source = await call('/api/sources', { method: 'POST', body: JSON.stringify({ url: 'https://item.taobao.com/item.htm?id=862667630822' }) });
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.sessionId,
        model: 'codex/gpt-image-2.5',
        tier: 'standard',
        person: PERSON,
        pieces: [
          { slot: 'top', garmentType: '衬衫', source: { kind: 'import', sourceId: source.payload.source.id, sourceIndex: 0, name: '火星JK制服墨石格裙' } },
          { slot: 'bottom', garmentType: '百褶裙', source: { kind: 'product', productId: 'shirt-floral' } },
        ],
      }),
    });
    assert.equal(created.status, 201);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    assert.equal(record[0].reference_images.length, 3);
    assert.match(record[0].prompt, /火星JK制服墨石格裙/);
  });
});

test('单品的商品不存在、格子未知、来源未知、图片非法都返回 400/404', async () => {
  await withServer({ sourceRunner: SOURCE_RUNNER }, async ({ call }) => {
    const session = await createSession(call);
    const base = { sessionId: session.sessionId, model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON };
    const cases = [
      { pieces: [{ slot: 'top', garmentType: '衬衫', source: { kind: 'product', productId: 'no-such-product' } }], status: 404, code: 'PRODUCT_NOT_FOUND' },
      { pieces: [{ slot: 'hat', garmentType: '帽子', source: { kind: 'upload', image: PERSON } }], status: 400, code: 'INVALID_REQUEST' },
      { pieces: [{ slot: 'top', garmentType: '衬衫', source: { kind: 'telepathy' } }], status: 400, code: 'INVALID_REQUEST' },
      { pieces: [{ slot: 'top', garmentType: '衬衫', source: { kind: 'upload', image: 'data:image/png;base64,bm90LWFuLWltYWdl' } }], status: 400, code: 'INVALID_IMAGE' },
    ];
    for (const item of cases) {
      const response = await call('/api/orders', { method: 'POST', body: JSON.stringify({ ...base, pieces: item.pieces }) });
      assert.equal(response.status, item.status, JSON.stringify(item.pieces));
      assert.equal(response.payload.error.code, item.code);
    }
  });
});

test('两件配饰与正好 5 件单品是允许的上限', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const five = [
      { slot: 'top', garmentType: '衬衫', source: { kind: 'upload', image: PERSON } },
      { slot: 'outer', garmentType: '风衣', source: { kind: 'upload', image: PERSON } },
      { slot: 'bottom', garmentType: '百褶裙', source: { kind: 'upload', image: PERSON } },
      { slot: 'accessory', garmentType: '项链', source: { kind: 'upload', image: PERSON } },
      { slot: 'accessory', garmentType: '耳环', source: { kind: 'upload', image: PERSON } },
    ];
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON, pieces: five }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.payload.order.slots, ['top', 'bottom', 'outer', 'accessory', 'accessory']);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
  });
});

test('下单中途失败会撤任务并记录失败，余额保持原值', async () => {
  const record = [];
  await withServer({ record }, async ({ call, store }) => {
    const session = await createSession(call);
    const before = store.getSession(session.sessionId).balanceCents;
    const original = store.updateOrder;
    let calls = 0;
    // 只让「写回 jobId」这一步失败，回滚用的 updateOrder 必须能正常工作。
    store.updateOrder = async (...args) => {
      calls += 1;
      if (calls === 1) throw new Error('disk full');
      return original.apply(store, args);
    };
    try {
      const response = await call('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
      });
      assert.equal(response.status, 500);
    } finally {
      store.updateOrder = original;
    }
    assert.equal(store.getSession(session.sessionId).balanceCents, before);
    const orders = store.listOrders(session.sessionId);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'failed');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(record.length, 0, '撤掉的任务不得再调用上游');
  });
});
