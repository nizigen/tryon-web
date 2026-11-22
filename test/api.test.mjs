import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.mjs';
import { createSourceService } from '../src/source.mjs';
import { createStore } from '../src/store.mjs';
import { createTryonService } from '../src/tryon.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PERSON = `data:image/png;base64,${PNG}`;
/** 商品图下载有占位图下限（4KiB），测试图要撑过去。 */
const PNG_BYTES = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(8192)]);
const MODELS = ['codex/gpt-image-2', 'minimax-code/MiniMax-Image'];

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

function makeFetch({ models = MODELS, pending = false, fail = false, record = [] } = {}) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [{ name: 'generate_image', inputSchema: { properties: { model: { enum: models } } } }] },
      });
    }
    if (request.params?.name === 'generate_image') {
      record.push(request.params.arguments);
      if (fail) {
        return jsonResponse({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [{ type: 'text', text: 'upstream failed' }] } });
      }
      if (pending) {
        return jsonResponse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'still rendering' }], _meta: { 'image-service.local/pending': 'img_test_task' } } });
      }
      return jsonResponse({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'image', mimeType: 'image/png', data: PNG }] } });
    }
    if (request.params?.name === 'generation_result') {
      return jsonResponse({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'image', mimeType: 'image/png', data: PNG }] } });
    }
    return jsonResponse({ jsonrpc: '2.0', id: 9, error: { message: 'unknown' } });
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
  const store = createStore({ dir, catalogFile });
  await store.ready();
  const tryon = createTryonService({ store, env: { IMAGE_API_BASE_URL: 'http://127.0.0.1:3425' }, fetchImpl, resultsDir: join(dir, 'results') });
  const sources = options.sources ?? createSourceService({
    runCli: options.sourceRunner ?? (async () => ({ ok: true, data: '{"title":"外部商品","images":[]}' })),
    fetchImpl: options.sourceFetch ?? (async () => new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } })),
    settleMs: 0,
  });
  const app = createApp({ env: { IMAGE_API_BASE_URL: 'http://127.0.0.1:3425' }, fetchImpl, store, tryon, sources, resultsDir: join(dir, 'results') });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (path, init = {}) => {
    const headers = { ...init.headers };
    if (init.body) headers['content-type'] = 'application/json';
    if (init.method === 'POST' && !headers.origin) headers.origin = base;
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
    await rm(dir, { recursive: true, force: true });
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
    assert.equal(response.payload.models.length, 2);
    assert.equal(response.payload.defaultModel, 'codex/gpt-image-2');
    assert.equal(response.payload.defaultTier, 'standard');
    assert.equal(response.payload.tryOnFromCents, 190);
    assert.equal(response.payload.categories.length, 3);
    assert.equal(response.payload.gateway.reachable, true);
    assert.ok(response.payload.limits.imageBytes > 0);
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
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard' }),
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
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
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

test('下单后任务成功、扣费并可取回结果', async () => {
  await withServer({}, async ({ call }) => {
    const session = await createSession(call);
    const before = session.balanceCents;
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
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
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
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

test('上游 pending 时轮询同一任务而不是重新生成', async () => {
  await withServer({ pending: true }, async ({ call }) => {
    const session = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
    });
    const job = await waitForJob(call, created.payload.jobId);
    assert.equal(job.status, 'success');
  });
});

test('同一会话同时只能有一个进行中的试穿任务', async () => {
  await withServer({ pending: true }, async ({ call }) => {
    const session = await createSession(call);
    const body = JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON });
    const first = await call('/api/orders', { method: 'POST', body });
    assert.equal(first.status, 201);
    const second = await call('/api/orders', { method: 'POST', body });
    assert.equal(second.status, 409);
  });
});

test('订单只对所属会话可见', async () => {
  await withServer({ pending: true }, async ({ call }) => {
    const owner = await createSession(call);
    const created = await call('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: owner.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
    });
    const other = await call('/api/session', { method: 'POST', body: JSON.stringify({ deviceId: 'other-device' }) });
    const list = await call('/api/orders', { headers: { 'x-session-id': other.payload.sessionId } });
    assert.equal(list.payload.orders.length, 0);
    const detail = await call(`/api/orders/${created.payload.orderId}`, { headers: { 'x-session-id': other.payload.sessionId } });
    assert.equal(detail.status, 404);
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
      body: JSON.stringify({ model: 'codex/gpt-image-2', person: PERSON, garment: PERSON, category: 'tops', garmentType: 'tee' }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.payload.engine, 'codex/gpt-image-2');
    assert.match(response.payload.image.dataURL, /^data:image\/png;base64,/);
  });
});

test('非法图片内容被拒绝', async () => {
  await withServer({}, async ({ call }) => {
    const response = await call('/api/tryon', {
      method: 'POST',
      body: JSON.stringify({ model: 'codex/gpt-image-2', person: 'data:image/png;base64,bm90YW5pbWFnZQ==', garment: PERSON, category: 'tops' }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'INVALID_IMAGE');
  });
});

test('静态页面可访问且不暴露目录穿越', async () => {
  await withServer({}, async ({ call }) => {
    const page = await call('/');
    assert.equal(page.status, 200);
    assert.match(page.payload, /穿搭试穿间/);
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
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
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
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
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
      body: JSON.stringify({ sessionId: session.sessionId, productId: 'shirt-floral', model: 'codex/gpt-image-2', tier: 'standard', person: PERSON }),
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
    await rm(dir, { recursive: true, force: true });
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
        model: 'codex/gpt-image-2',
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
      body: JSON.stringify({ sessionId: session.sessionId, sourceId: 'missing', model: 'codex/gpt-image-2', tier: 'standard', category: 'tops', garmentType: 'shirt', person: PERSON }),
    });
    assert.equal(order.status, 404);
    assert.equal(order.payload.error.code, 'SOURCE_EXPIRED');
  });
});
