import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.mjs';
import { WORKFLOW_ID, workflowGraph } from '../src/comfy-workflow.mjs';
import { IDM_ID } from '../src/idm.mjs';
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
      prompt,
      reference_images: referenceImages,
      size: target.endsWith('/images/edits') ? options.body.get('size') : JSON.parse(options.body).size,
    });
    return jsonResponse({ created: 1, data: [{ b64_json: PNG, mime_type: 'image/png' }] });
  };
}

function makeWorkflowFetch({ fail = false, record = { uploads: [], prompts: [], paths: [] } } = {}) {
  const imageFetch = makeFetch();
  const graph = workflowGraph({ images: ['person.png', 'garment.png'] });
  const info = {};
  for (const node of Object.values(graph)) {
    info[node.class_type] ??= { input: { required: {} } };
    for (const [key, value] of Object.entries(node.inputs)) {
      info[node.class_type].input.required[key] = [Array.isArray(value) ? 'IMAGE' : typeof value === 'string' ? 'STRING' : typeof value === 'boolean' ? 'BOOLEAN' : 'FLOAT'];
    }
  }
  return async (url, options) => {
    const target = new URL(url);
    if (target.origin !== 'http://comfy.test') return imageFetch(url, options);
    record.paths.push(target.pathname);
    if (target.pathname === '/object_info') return jsonResponse(info);
    if (target.pathname === '/upload/image') {
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('type'), 'input');
      assert.equal(options.body.get('overwrite'), 'false');
      record.uploads.push(await toDataURL(options.body.get('image')));
      return jsonResponse({ name: `upload-${record.uploads.length}.png`, subfolder: '', type: 'input' });
    }
    if (target.pathname === '/prompt') {
      assert.equal(options.method, 'POST');
      record.prompts.push(JSON.parse(options.body).prompt);
      return jsonResponse({ prompt_id: 'workflow-test' });
    }
    if (target.pathname === '/history/workflow-test') {
      return jsonResponse({ 'workflow-test': fail
        ? { status: { status_str: 'error', completed: false } }
        : { status: { status_str: 'success', completed: true }, outputs: { output: { images: [{ filename: 'generated.png', subfolder: '', type: 'output' }] } } } });
    }
    if (target.pathname === '/view') {
      assert.equal(target.searchParams.get('filename'), 'generated.png');
      assert.equal(target.searchParams.get('type'), 'output');
      return new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png' } });
    }
    assert.fail(`Unexpected ComfyUI endpoint: ${target.pathname}`);
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
    assert.deepEqual(response.payload.models.map(({ id }) => id), [...MODELS, WORKFLOW_ID]);
    assert.equal(response.payload.defaultModel, 'codex/gpt-image-2.5');
    assert.equal(response.payload.defaultTier, 'standard');
    assert.equal(response.payload.tryOnFromCents, 190);
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

test('GET /api/products 返回橱窗商品', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/products');
    assert.equal(response.status, 200);
    assert.equal(response.payload.products.length, 1);
    assert.equal(response.payload.products[0].id, 'shirt-floral');
  });
});

test('POST /api/session 建立会话并发放体验额度', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    assert.ok(session.sessionId);
    assert.ok(session.balanceCents > 0);
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

test('余额不足时拒绝下单并给出差额', async () => {
  await withServer({}, async ({ call, store }) => {
    const session = await createSession(call);
    await store.addBalance(session.sessionId, -session.balanceCents);
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    assert.equal(response.status, 402);
    assert.equal(response.payload.error.code, 'INSUFFICIENT_BALANCE');
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

test('下单后任务成功、扣费并可取回结果', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const before = session.balanceCents;
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2.5', tier: 'standard', person: PERSON }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.priceCents, 690);
    assert.equal(created.payload.balanceCents, before - 690);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    const order = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(order.payload.order.status, 'success');
    assert.equal(order.payload.order.hasResult, true);
    assert.equal(order.payload.order.prompt, undefined, '订单详情不应回传提示词');
    const balance = await call(`/api/session/${session.sessionId}`);
    assert.equal(balance.payload.balanceCents, before - 690);
  });
});

test('生成失败时订单失败且额度退回', async () => {
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
    assert.equal(balance.payload.balanceCents, before, '失败必须全额退回');
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

test('充值确认后余额增加', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const payment = await call('/api/payments', { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, packId: 'light' }) });
    assert.equal(payment.status, 201);
    assert.equal(payment.payload.status, 'pending');
    const confirmed = await call(`/api/payments/${payment.payload.paymentId}/confirm`, { method: 'POST', body: JSON.stringify({ sessionId: session.sessionId }) });
    assert.equal(confirmed.payload.status, 'paid');
    assert.equal(confirmed.payload.balanceCents, session.balanceCents + 990);
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
  await withServer({}, async ({ call }) => {
    const page = await call('/');
    assert.equal(page.status, 200);
    assert.match(page.payload, /穿搭试穿间|搭配试穿间/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    for (const path of ['/app.js', '/views/wardrobe.js', '/style.css']) {
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

test('重启后 pending 订单被对账为失败并退回余额', async () => {  const dir = await mkdtemp(join(tmpdir(), 'tryon-restart-'));
  try {
    const catalogFile = join(dir, 'catalog.json');
    await writeFile(catalogFile, JSON.stringify({ products: [] }), 'utf8');
    const store = createStore({ dir, catalogFile });
    await store.ready();
    const session = await store.getOrCreateSession('device-restart');
    const before = session.balanceCents;
    await store.addBalance(session.id, -690);
    await store.createOrder({ sessionId: session.id, productName: '红底白色小花短袖衬衫', priceCents: 690, status: 'pending' });
    const tryon = createTryonService({ store, env: {}, fetchImpl: async () => jsonResponse({}), resultsDir: join(dir, 'results') });
    const reconciled = await tryon.reconcileInterruptedOrders();
    assert.equal(reconciled, 1);
    const after = store.getSession(session.id).balanceCents;
    assert.equal(after, before, '中断订单必须全额退回');
    assert.equal(store.listOrders(session.id)[0].status, 'failed');
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
    assert.equal(created.payload.priceCents, 690);
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
    assert.match(record[0].prompt, /one hand resting behind the head/i);
    assert.equal(record[0].reference_images.length, 4, '人物 + 外套 + 下装 + PoseWear 姿势图');
    assert.match(record[0].reference_images[3], /^data:image\/png;base64,/, '姿势图固定放在参考图末尾');
    const detail = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(detail.payload.order.photographyMode, 'studio');
    assert.equal(detail.payload.order.posePreset, 'hand-behind-head');
  });
});

test('旧订单详情与列表都把缺失的棚拍字段归一化', async () => {
  await withServer({}, async ({ call, store }) => {
    const session = await createSession(call);
    const order = await store.createOrder({
      sessionId: session.sessionId,
      productName: '旧版试穿',
      model: 'codex/gpt-image-2.5',
      tier: 'standard',
      slots: ['top'],
      pieces: [{ slot: 'top', layer: 'auto', garmentType: '衬衫', name: '旧衬衫' }],
      priceCents: 690,
    });
    const detail = await call(`/api/orders/${order.id}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(detail.payload.order.photographyMode, 'preserve');
    assert.equal(detail.payload.order.studioPreset, null);
    assert.equal(detail.payload.order.posePreset, null);
    const list = await call('/api/orders', { headers: { 'x-session-id': session.sessionId } });
    assert.equal(list.payload.orders[0].photographyMode, 'preserve');
    assert.equal(list.payload.orders[0].studioPreset, null);
    assert.equal(list.payload.orders[0].posePreset, null);
  });
});

test('未知棚拍模板或姿势在扣费和建单前拒绝', async () => {
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
    await store.addBalance(session.sessionId, -session.balanceCents);
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
    assert.deepEqual(initial.payload.models.map(({ id }) => id), [...MODELS, WORKFLOW_ID]);
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

test('下单中途失败会撤任务、订单置失败并全额退款', async () => {
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
    assert.equal(store.getSession(session.sessionId).balanceCents, before, '失败必须全额退回');
    const orders = store.listOrders(session.sessionId);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].status, 'failed');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(record.length, 0, '撤掉的任务不得再调用上游');
  });
});

test('工作流未配置时仍可选择模型，状态接口明确返回未就绪', async () => {
  await withServer({}, async ({ call }) => {
    const status = await call('/api/workflows/status');
    assert.equal(status.status, 200);
    assert.equal(status.payload.configured, false);
    assert.equal(status.payload.ready, false);
    const patched = await call('/api/settings', { method: 'PATCH', body: JSON.stringify({ model: WORKFLOW_ID }) });
    assert.equal(patched.status, 200);
    const settings = await call('/api/settings');
    assert.equal(settings.payload.model, WORKFLOW_ID);
    const workflow = settings.payload.models.find(({ id }) => id === WORKFLOW_ID);
    assert.equal(workflow.tiers[0].id, 'workflow');
    assert.equal(workflow.tiers[0].priceCents, 0);
  });
});

test('工作流没地址时在占位扣费建单之前返回 503', async () => {
  await withServer({}, async ({ call, store, tryon }) => {
    const session = await createSession(call);
    let reservations = 0;
    let balanceChanges = 0;
    const reserve = tryon.reserve;
    const addBalance = store.addBalance;
    tryon.reserve = (...args) => { reservations += 1; return reserve(...args); };
    store.addBalance = (...args) => { balanceChanges += 1; return addBalance(...args); };
    try {
      const response = await call('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: WORKFLOW_ID, tier: 'workflow', person: PERSON }),
      });
      assert.equal(response.status, 503);
      assert.equal(response.payload.error.code, 'WORKFLOW_UNAVAILABLE');
      assert.equal(reservations, 0);
      assert.equal(balanceChanges, 0);
      assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
      assert.deepEqual(store.listOrders(session.sessionId), []);
      assert.deepEqual(tryon.jobsForSession(session.sessionId), []);
    } finally {
      tryon.reserve = reserve;
      store.addBalance = addBalance;
    }
  });
});

test('工作流超过三件服装返回 400 WORKFLOW_PIECES', async () => {
  await withServer({}, async ({ call, store, tryon }) => {
    const session = await createSession(call);
    const pieces = ['top', 'outer', 'bottom', 'shoes'].map((slot) => ({ slot, garmentType: slot, source: { kind: 'upload', image: PERSON } }));
    const response = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, model: WORKFLOW_ID, tier: 'workflow', person: PERSON, pieces }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'WORKFLOW_PIECES');
    assert.equal(response.payload.error.field, 'pieces');
    assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
    assert.deepEqual(store.listOrders(session.sessionId), []);
    assert.deepEqual(tryon.jobsForSession(session.sessionId), []);
  });
});

test('工作流订单经上传、提交、历史和结果接口成功，零扣费且层级与图序一致', async () => {
  const record = { uploads: [], prompts: [], paths: [] };
  const image = (tag) => `data:image/png;base64,${Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from(tag)]).toString('base64')}`;
  const top = image('top');
  const outer = image('outer');
  const bottom = image('bottom');
  await withServer({ env: { COMFYUI_BASE_URL: 'http://comfy.test' }, fetchImpl: makeWorkflowFetch({ record }) }, async ({ call, store, dir, base }) => {
    const status = await call('/api/workflows/status');
    assert.equal(status.status, 200);
    assert.equal(status.payload.configured, true);
    assert.equal(status.payload.ready, true);
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.sessionId, model: WORKFLOW_ID, tier: 'workflow', person: PERSON,
        pieces: [
          { slot: 'top', layer: 'outer', garmentType: '衬衫', source: { kind: 'upload', image: top } },
          { slot: 'bottom', layer: 'middle', garmentType: '百褶裙', source: { kind: 'upload', image: bottom } },
          { slot: 'outer', layer: 'inner', garmentType: '夹克', source: { kind: 'upload', image: outer } },
        ],
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.payload.priceCents, 0);
    assert.equal(created.payload.balanceCents, session.balanceCents);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
    assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
    assert.deepEqual(record.uploads, [PERSON, outer, bottom, top]);
    assert.equal(record.prompts.length, 1);
    const graph = record.prompts[0];
    assert.equal(graph.person.inputs.image, 'upload-1.png');
    for (let index = 1; index <= 3; index += 1) assert.equal(graph[`garment_${index}`].inputs.image, `upload-${index + 1}.png`);
    const expectedPieces = [['outer', 'inner'], ['bottom', 'middle'], ['top', 'outer']];
    const persisted = store.getOrder(created.payload.orderId);
    assert.deepEqual(persisted.pieces.map(({ slot, layer }) => [slot, layer]), expectedPieces);
    for (const [index, [slot, layer]] of expectedPieces.entries()) {
      assert.ok(persisted.prompt.includes(`reference image ${index + 2} (${slot}:`));
      assert.ok(graph.positive.inputs.prompt.includes(`garment ${index + 1} in the bottom row (numbered from the left) (${slot}:`));
      assert.match(graph.positive.inputs.prompt, new RegExp(`${slot}:.*${layer} layer`));
    }
    const detail = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(detail.payload.order.hasResult, true);
    assert.deepEqual(detail.payload.order.pieces.map(({ slot, layer }) => [slot, layer]), expectedPieces);
    const result = await fetch(`${base}/api/results/${detail.payload.order.resultFile}?k=${detail.payload.order.resultToken}`);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.from(PNG, 'base64'));
    const raw = await readFile(join(dir, 'state.json'), 'utf8');
    assert.doesNotMatch(raw, /base64|"person"|"dataUrl"|"referenceImages"/);
    const diskOrder = JSON.parse(raw).orders.find(({ id }) => id === created.payload.orderId);
    assert.deepEqual(diskOrder.pieces.map(({ slot, layer }) => [slot, layer]), expectedPieces);
    assert.equal(record.paths.filter((path) => path === '/upload/image').length, 4);
    assert.ok(record.paths.includes('/prompt'));
    assert.ok(record.paths.includes('/history/workflow-test'));
    assert.ok(record.paths.includes('/view'));
  });
});

function makeIdmFetch({ record = [], ready = true, failStage = 0 } = {}) {
  const imageFetch = makeFetch();
  return async (url, options) => {
    const target = new URL(url);
    if (target.origin !== 'http://idm.test') return imageFetch(url, options);
    if (target.pathname === '/health') return jsonResponse({ ok: true, pipeline: ready, engine: 'idm-vton' });
    assert.equal(target.pathname, '/tryon');
    const body = JSON.parse(options.body);
    record.push(body);
    if (record.length === failStage) return new Response('private server detail', { status: 500 });
    return jsonResponse({ image: PNG, seconds: 1 });
  };
}

test('IDM 目录与设置持久化使用原接口，健康检查不出图且不回服务地址', async () => {
  const record = [];
  await withServer({ env: { IDM_BASE_URL: 'http://idm.test' }, fetchImpl: makeIdmFetch({ record }) }, async ({ call, store }) => {
    const config = await call('/api/config');
    const model = config.payload.models.find(({ id }) => id === IDM_ID);
    assert.ok(model);
    assert.equal(model.tiers[0].id, 'idm');
    assert.equal(model.tiers[0].priceCents, 0);
    assert.equal(model.tiers[0].size, '768x1024');
    const status = await call('/api/workflows/idm/status');
    assert.equal(status.status, 200);
    assert.equal(status.payload.ready, true);
    assert.doesNotMatch(JSON.stringify(status.payload), /idm.test|baseUrl|token/);
    assert.equal(record.length, 0);
    const patched = await call('/api/settings', { method: 'PATCH', body: JSON.stringify({ model: IDM_ID }) });
    assert.equal(patched.status, 200);
    assert.equal(store.getSettings().model, IDM_ID);
    assert.equal((await call('/api/settings')).payload.model, IDM_ID);
  });
});

test('IDM 未配置时只读状态明确未就绪，目录不宣称已连接', async () => {
  await withServer({}, async ({ call }) => {
    const status = await call('/api/workflows/idm/status');
    assert.equal(status.status, 200);
    assert.equal(status.payload.configured, false);
    assert.equal(status.payload.ready, false);
    assert.equal((await call('/api/config')).payload.models.some(({ id }) => id === IDM_ID), false);
  });
});

test('IDM 订单链传递有序单品元数据及纯base64，保存原长提示词与真实结果票据', async () => {
  const record = [];
  const tagged = tag => `data:image/png;base64,${Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.from(tag)]).toString('base64')}`;
  const shirt = tagged('shirt');
  const jeans = tagged('jeans');
  await withServer({ env: { IDM_BASE_URL: 'http://idm.test' }, fetchImpl: makeIdmFetch({ record }) }, async ({ call, store, base, dir }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', { method: 'POST', body: JSON.stringify({
      sessionId: session.sessionId, model: IDM_ID, tier: 'idm', person: PERSON, prompt: '保持自然光线',
      pieces: [
        { slot: 'bottom', layer: 'middle', garmentType: 'jeans', source: { kind: 'upload', image: jeans } },
        { slot: 'top', layer: 'inner', garmentType: 'shirt', source: { kind: 'upload', image: shirt } },
      ],
    }) });
    assert.equal(created.status, 201);
    assert.equal(created.payload.priceCents, 0);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success', JSON.stringify(job.error));
    assert.equal(record.length, 2);
    assert.deepEqual(record.map(item => item.category), ['upper_body', 'lower_body']);
    assert.equal(record[0].person, PNG);
    assert.equal(record[0].garment, shirt.split(',')[1]);
    assert.equal(record[1].person, PNG);
    assert.equal(record[1].garment, jeans.split(',')[1]);
    assert.match(record[0].description, /shirt/);
    const order = store.getOrder(created.payload.orderId);
    assert.deepEqual(order.pieces.map(({ slot, layer }) => [slot, layer]), [['top', 'inner'], ['bottom', 'middle']]);
    assert.match(order.prompt, /reference image 2 \(top:/);
    assert.match(order.prompt, /保持自然光线/);
    assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
    const detail = await call(`/api/orders/${order.id}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(detail.payload.order.hasResult, true);
    const result = await fetch(`${base}/api/results/${detail.payload.order.resultFile}?k=${detail.payload.order.resultToken}`);
    assert.equal(result.status, 200);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), Buffer.from(PNG, 'base64'));
    assert.doesNotMatch(await readFile(join(dir, 'state.json'), 'utf8'), /base64|referenceImages|dataUrl/);
  });
});

test('IDM 鞋类或健康失败在占位与建单前结束，不扣费不上传', async () => {
  for (const [ready, slots, code] of [[true, ['top', 'shoes'], 'IDM_SLOT'], [false, ['top'], 'WORKFLOW_UNAVAILABLE']]) {
    const record = [];
    await withServer({ env: { IDM_BASE_URL: 'http://idm.test' }, fetchImpl: makeIdmFetch({ ready, record }) }, async ({ call, store, tryon }) => {
      const session = await createSession(call);
      const result = await call('/api/orders', { method: 'POST', body: JSON.stringify({
        sessionId: session.sessionId, model: IDM_ID, person: PERSON,
        pieces: slots.map(slot => ({ slot, garmentType: slot, source: { kind: 'upload', image: PERSON } })),
      }) });
      assert.equal(result.payload.error.code, code);
      assert.deepEqual(store.listOrders(session.sessionId), []);
      assert.deepEqual(tryon.jobsForSession(session.sessionId), []);
      assert.equal(record.length, 0);
      assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
    });
  }
});

test('IDM 与 ComfyUI 拼图工作流都不接受无法执行的无影棚模式', async () => {
  const record = [];
  for (const model of [IDM_ID, WORKFLOW_ID]) {
    const env = model === IDM_ID ? { IDM_BASE_URL: 'http://idm.test' } : { COMFYUI_BASE_URL: 'http://comfy.test' };
    const fetchImpl = model === IDM_ID ? makeIdmFetch({ record }) : makeWorkflowFetch();
    await withServer({ env, fetchImpl }, async ({ call, store, tryon }) => {
      const session = await createSession(call);
      const result = await call('/api/orders', { method: 'POST', body: JSON.stringify({
        sessionId: session.sessionId,
        model,
        person: PERSON,
        photographyMode: 'studio',
        studioPreset: 'clean-white-seamless',
        posePreset: 'contrapposto',
        pieces: [{ slot: 'top', garmentType: '衬衫', source: { kind: 'upload', image: PERSON } }],
      }) });
      assert.equal(result.status, 400);
      assert.equal(result.payload.error.code, 'MODEL_MODE_UNSUPPORTED');
      assert.equal(result.payload.error.field, 'photographyMode');
      assert.deepEqual(store.listOrders(session.sessionId), []);
      assert.deepEqual(tryon.jobsForSession(session.sessionId), []);
      assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
    });
  }
  assert.equal(record.length, 0);
});

test('IDM 第二阶段失败使整单失败，不把第一阶段半成品存为完成', async () => {
  const record = [];
  await withServer({ env: { IDM_BASE_URL: 'http://idm.test' }, fetchImpl: makeIdmFetch({ failStage: 2, record }) }, async ({ call, store }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', { method: 'POST', body: JSON.stringify({
      sessionId: session.sessionId, model: IDM_ID, person: PERSON,
      pieces: ['top', 'bottom'].map(slot => ({ slot, garmentType: slot, source: { kind: 'upload', image: PERSON } })),
    }) });
    assert.equal(created.status, 201);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'WORKFLOW_FAILED');
    const order = store.getOrder(created.payload.orderId);
    assert.equal(order.status, 'failed');
    assert.ok(!order.resultFile);
    assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
    assert.equal(record.length, 2);
  });
});

test('工作流上游执行错误使任务订单失败，不扣费也不伪造结果', async () => {
  const record = { uploads: [], prompts: [], paths: [] };
  await withServer({ env: { COMFYUI_BASE_URL: 'http://comfy.test' }, fetchImpl: makeWorkflowFetch({ fail: true, record }) }, async ({ call, store }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: WORKFLOW_ID, tier: 'workflow', person: PERSON }),
    });
    assert.equal(created.status, 201);
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'failed');
    assert.equal(job.error.code, 'WORKFLOW_FAILED');
    assert.equal(store.getSession(session.sessionId).balanceCents, session.balanceCents);
    const detail = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': session.sessionId } });
    assert.equal(detail.payload.order.status, 'failed');
    assert.equal(detail.payload.order.errorCode, 'WORKFLOW_FAILED');
    assert.equal(detail.payload.order.hasResult, false);
    assert.equal(detail.payload.order.resultToken, null);
    assert.equal(record.paths.includes('/view'), false);
  });
});
