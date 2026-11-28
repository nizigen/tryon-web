import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HttpError } from './errors.mjs';

export function createStore({ dir, catalogFile, logger = console }) {
  let state = { sessions: [], orders: [], payments: [], settings: { model: null } };
  let catalog = [];
  let writeChain = Promise.resolve();

  const RETENTION = { orders: 200, sessions: 500 };

  async function load() {
    await mkdir(dir, { recursive: true });
    const raw = await readFile(join(dir, 'state.json'), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (raw) {
      const parsed = JSON.parse(raw);
      state = {
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        payments: Array.isArray(parsed.payments) ? parsed.payments : [],
        settings: {
          model: parsed.settings && typeof parsed.settings.model === 'string' ? parsed.settings.model : null,
        },
      };
    }
    const catalogRaw = await readFile(catalogFile, 'utf8');
    const parsedCatalog = JSON.parse(catalogRaw);
    catalog = Array.isArray(parsedCatalog.products) ? parsedCatalog.products : [];
  }

  function commit(change) {
    const operation = writeChain.then(async () => {
      const [next, result] = change(state);
      if (next === state) return result;
      const target = join(dir, 'state.json');
      const temporary = `${target}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
      await rename(temporary, target);
      state = next;
      return result;
    });
    writeChain = operation.catch((error) => logger.error(`state update failed: ${error.message}`));
    return operation;
  }

  function retainOrders(orders) {
    return orders.filter((order, index) => index >= orders.length - RETENTION.orders || order.priceCents > 0 || order.status === 'pending');
  }

  function retainSessions(current, orders) {
    if (current.sessions.length <= RETENTION.sessions) return current.sessions;
    const owners = new Set([...current.payments, ...orders].map(({ sessionId }) => sessionId));
    return current.sessions.filter((session, index) => index >= current.sessions.length - RETENTION.sessions || session.balanceCents > 0 || owners.has(session.id));
  }

  return {
    async ready() {
      await load();
    },

    listProducts({ category, q, limit = 60 } = {}) {
      let products = catalog;
      if (category) products = products.filter((product) => product.category === category);
      if (q) {
        const keyword = q.trim().toLowerCase();
        products = products.filter((product) => `${product.name} ${product.subtitle ?? ''} ${(product.tags ?? []).join(' ')}`.toLowerCase().includes(keyword));
      }
      return products.slice(0, limit);
    },

    findProduct(id) {
      return catalog.find((product) => product.id === id) ?? null;
    },

    getOrCreateSession(deviceId) {
      return commit((current) => {
        const existing = current.sessions.find((session) => session.deviceId === deviceId);
        const now = new Date().toISOString();
        const session = { ...(existing ?? { id: randomUUID(), deviceId, balanceCents: 0, createdAt: now }), lastSeenAt: now };
        const sessions = existing
          ? current.sessions.map((item) => item.id === existing.id ? session : item)
          : [...current.sessions, session];
        return [{ ...current, sessions }, session];
      });
    },

    getSession(id) {
      return state.sessions.find((session) => session.id === id) ?? null;
    },

    getSettings() {
      return { model: state.settings.model };
    },

    updateSettings(patch = {}) {
      return commit((current) => {
        if (!Object.hasOwn(patch, 'model')) return [current, { ...current.settings }];
        const settings = { model: typeof patch.model === 'string' && patch.model.trim() ? patch.model.trim() : null };
        return [{ ...current, settings }, { ...settings }];
      });
    },

    createOrder(order) {
      const record = {
        id: randomUUID(),
        status: 'pending',
        createdAt: new Date().toISOString(),
        finishedAt: null,
        resultFile: null,
        jobId: null,
        errorCode: null,
        errorMessage: null,
        ...order,
        priceCents: 0,
      };
      return commit((current) => {
        const orders = retainOrders([...current.orders, record]);
        return [{ ...current, orders, sessions: retainSessions(current, orders) }, record];
      });
    },

    updateOrder(id, patch) {
      return commit((current) => {
        const order = current.orders.find((item) => item.id === id);
        if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', '订单不存在');
        const record = { ...order, ...patch, priceCents: order.priceCents };
        const orders = current.orders.map((item) => item.id === id ? record : item);
        return [{ ...current, orders }, record];
      });
    },

    failOrder(id, { errorCode, errorMessage }) {
      return commit((current) => {
        const order = current.orders.find((item) => item.id === id);
        if (!order || order.status !== 'pending') return [current, order];
        const failed = { ...order, status: 'failed', finishedAt: new Date().toISOString(), errorCode, errorMessage };
        const owner = order.priceCents > 0 && current.sessions.find((item) => item.id === order.sessionId);
        const record = order.priceCents > 0 ? {
          ...failed,
          refund: { status: owner ? 'credited' : 'needs_review', amountCents: order.priceCents },
          errorMessage: `${errorMessage}，${owner ? '费用已退回余额' : '历史会话缺失，退款待核对'}`,
        } : failed;
        const orders = current.orders.map((item) => item.id === id ? record : item);
        if (!owner) return [{ ...current, orders }, record];
        const sessions = current.sessions.map((item) => item.id === owner.id ? { ...item, balanceCents: item.balanceCents + order.priceCents } : item);
        return [{ ...current, orders, sessions }, record];
      });
    },

    listOrders(sessionId) {
      return state.orders.filter((order) => order.sessionId === sessionId).slice().reverse();
    },

    listAllOrders() {
      return state.orders.slice();
    },

    getOrder(id) {
      return state.orders.find((order) => order.id === id) ?? null;
    },

    getPayment(id) {
      return state.payments.find((payment) => payment.id === id) ?? null;
    },
  };
}
