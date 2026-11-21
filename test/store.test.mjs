import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createStore } from '../src/store.mjs';

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'tryon-store-'));
  const catalogFile = join(dir, 'catalog.json');
  await writeFile(catalogFile, JSON.stringify({
    products: [
      { id: 'shirt-floral', name: '红底白色小花短袖衬衫', image: 'catalog/shirt-floral.jpg', priceCents: 8900, category: 'tops', garmentType: 'shirt' },
      { id: 'jeans-black', name: '黑色高腰直筒牛仔裤', image: 'catalog/jeans-black.jpg', priceCents: 12900, category: 'bottoms', garmentType: 'jeans' },
    ],
  }), 'utf8');
  const store = createStore({ dir, catalogFile });
  await store.ready();
  return { store, dir };
}

test('同一设备重复登录复用同一个会话', async () => {
  const { store, dir } = await makeStore();
  const first = await store.getOrCreateSession('device-a');
  const second = await store.getOrCreateSession('device-a');
  assert.equal(first.id, second.id);
  assert.ok(first.balanceCents > 0, '新会话应有体验额度');
  await rm(dir, { recursive: true, force: true });
});

test('商品可按分类与关键词过滤', async () => {
  const { store, dir } = await makeStore();
  assert.equal(store.listProducts({ category: 'tops' }).length, 1);
  assert.equal(store.listProducts({ q: '牛仔裤' }).length, 1);
  assert.equal(store.listProducts({ q: '不存在' }).length, 0);
  assert.equal(store.findProduct('jeans-black').category, 'bottoms');
  assert.equal(store.findProduct('missing'), null);
  await rm(dir, { recursive: true, force: true });
});

test('下单冻结额度，失败退回后余额复原', async () => {
  const { store, dir } = await makeStore();
  const session = await store.getOrCreateSession('device-b');
  const before = session.balanceCents;
  await store.addBalance(session.id, -190);
  assert.equal(store.getSession(session.id).balanceCents, before - 190);
  await store.addBalance(session.id, 190);
  assert.equal(store.getSession(session.id).balanceCents, before);
  await rm(dir, { recursive: true, force: true });
});

test('订单记录可按会话查询并可更新状态', async () => {
  const { store, dir } = await makeStore();
  const session = await store.getOrCreateSession('device-c');
  const order = await store.createOrder({ sessionId: session.id, productName: '红底白色小花短袖衬衫', priceCents: 190, status: 'pending' });
  assert.equal(store.listOrders(session.id).length, 1);
  await store.updateOrder(order.id, { status: 'success', resultFile: `${order.id}.png` });
  const updated = store.getOrder(order.id);
  assert.equal(updated.status, 'success');
  assert.equal(updated.resultFile, `${order.id}.png`);
  await rm(dir, { recursive: true, force: true });
});

test('充值单确认后余额增加且不可重复入账', async () => {
  const { store, dir } = await makeStore();
  const session = await store.getOrCreateSession('device-d');
  const payment = await store.createPayment({ sessionId: session.id, packId: 'light' });
  const before = store.getSession(session.id).balanceCents;
  await store.payPayment(payment.id, session.id);
  const after = store.getSession(session.id).balanceCents;
  assert.equal(after, before + 990);
  await store.payPayment(payment.id, session.id);
  assert.equal(store.getSession(session.id).balanceCents, after, '重复确认不应重复入账');
  await rm(dir, { recursive: true, force: true });
});

test('状态在重新加载后仍然保留', async () => {
  const { store, dir } = await makeStore();
  const session = await store.getOrCreateSession('device-e');
  await store.createOrder({ sessionId: session.id, productName: '黑色高腰直筒牛仔裤', priceCents: 190, status: 'pending' });
  const reopened = createStore({ dir, catalogFile: join(dir, 'catalog.json') });
  await reopened.ready();
  assert.equal(reopened.listOrders(session.id).length, 1);
  await rm(dir, { recursive: true, force: true });
});
