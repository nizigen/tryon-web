import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createStore } from '../src/store.mjs';

async function makeStore(savedState) {
  const dir = await mkdtemp(join(tmpdir(), 'tryon-store-'));
  const catalogFile = join(dir, 'catalog.json');
  if (savedState) await writeFile(join(dir, 'state.json'), JSON.stringify(savedState));
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
  assert.equal(first.balanceCents, 0);
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

test('并发结算同一笔历史冻结订单只退款一次', async () => {
  const { store, dir } = await makeStore({ sessions: [{ id: 'funded', balanceCents: 70 }], orders: [{ id: 'legacy', sessionId: 'funded', priceCents: 190, status: 'pending' }] });
  const error = { errorCode: 'INTERRUPTED', errorMessage: '中断' };
  await Promise.all([store.failOrder('legacy', error), store.failOrder('legacy', error)]);
  assert.equal(store.getSession('funded').balanceCents, 260);
  assert.equal(store.getOrder('legacy').status, 'failed');
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

test('存量充值记录在新会话和新订单写入后仍可从磁盘读取', async () => {
  const payment = { id: 'historic', sessionId: 'existing', amountCents: 990, status: 'paid' };
  const { store, dir } = await makeStore({ sessions: [{ id: 'existing', deviceId: 'device-d', balanceCents: 990 }], payments: [payment] });
  const session = await store.getOrCreateSession('device-d');
  assert.equal(session.balanceCents, 990);
  const order = await store.createOrder({ sessionId: session.id, priceCents: 190 });
  assert.equal(order.priceCents, 0);
  const reopened = createStore({ dir, catalogFile: join(dir, 'catalog.json') });
  await reopened.ready();
  assert.deepEqual(reopened.getPayment('historic'), payment);
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

test('状态写入失败不会对外报告建单成功，故障消失后可重试', async () => {
  const { store, dir } = await makeStore();
  const session = await store.getOrCreateSession('write-failure');
  const blocked = join(dir, 'state.json.tmp');
  await mkdir(blocked);
  try {
    await assert.rejects(store.createOrder({ sessionId: session.id }));
    assert.equal(store.listOrders(session.id).length, 0);
    await rm(blocked, { recursive: true });
    const order = await store.createOrder({ sessionId: session.id });
    assert.equal(order.priceCents, 0);
    assert.deepEqual(store.listOrders(session.id).map(({ id }) => id), [order.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
