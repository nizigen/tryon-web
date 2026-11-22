import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HttpError } from './errors.mjs';
import { PACKS, TRIAL_CREDITS } from './pricing.mjs';

/** 新用户体验额度：一次标准档试穿（与默认模型档位对齐）。 */
const WELCOME_CENTS = TRIAL_CREDITS * 690;

export function createStore({ dir, catalogFile, logger = console }) {
  let state = { sessions: [], orders: [], payments: [], settings: { model: null } };
  let catalog = [];
  let writeChain = Promise.resolve();

  const RETENTION = { orders: 200, payments: 100, sessions: 500 };

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

  function persist() {
    const payload = JSON.stringify(state, null, 2);
    writeChain = writeChain.then(async () => {
      const target = join(dir, 'state.json');
      const temporary = `${target}.tmp`;
      await writeFile(temporary, payload, 'utf8');
      await rename(temporary, target);
    }).catch((error) => {
      logger.error(`state persist failed: ${error.message}`);
    });
    return writeChain;
  }

  function trim() {
    if (state.orders.length > RETENTION.orders) state.orders = state.orders.slice(-RETENTION.orders);
    if (state.payments.length > RETENTION.payments) state.payments = state.payments.slice(-RETENTION.payments);
    if (state.sessions.length > RETENTION.sessions) state.sessions = state.sessions.slice(-RETENTION.sessions);
  }

  function findSession(id) {
    return state.sessions.find((session) => session.id === id) ?? null;
  }

  function requireSession(id) {
    const session = findSession(id);
    if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', '会话不存在或已失效');
    return session;
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

    async getOrCreateSession(deviceId) {
      const existing = state.sessions.find((session) => session.deviceId === deviceId);
      if (existing) {
        existing.lastSeenAt = new Date().toISOString();
        await persist();
        return existing;
      }
      const session = {
        id: randomUUID(),
        deviceId,
        balanceCents: WELCOME_CENTS,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      state.sessions.push(session);
      await persist();
      return session;
    },

    getSession(id) {
      return findSession(id);
    },

    getSettings() {
      return { model: state.settings.model };
    },

    async updateSettings(patch = {}) {
      if (Object.prototype.hasOwnProperty.call(patch, 'model')) {
        state.settings.model = typeof patch.model === 'string' && patch.model.trim() ? patch.model.trim() : null;
      }
      await persist();
      return { model: state.settings.model };
    },

    async addBalance(sessionId, amountCents) {
      const session = requireSession(sessionId);
      session.balanceCents += amountCents;
      await persist();
      return session;
    },

    async createOrder(order) {
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
      };
      state.orders.push(record);
      trim();
      await persist();
      return record;
    },

    async updateOrder(id, patch) {
      const order = state.orders.find((item) => item.id === id);
      if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', '订单不存在');
      Object.assign(order, patch);
      await persist();
      return order;
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

    async createPayment({ sessionId, packId }) {
      const pack = PACKS.find((item) => item.id === packId);
      if (!pack) throw new HttpError(400, 'INVALID_REQUEST', '充值套餐不存在', 'packId');
      requireSession(sessionId);
      const payment = {
        id: randomUUID(),
        sessionId,
        packId,
        amountCents: pack.amountCents,
        status: 'pending',
        createdAt: new Date().toISOString(),
        paidAt: null,
      };
      state.payments.push(payment);
      await persist();
      return payment;
    },

    getPayment(id) {
      return state.payments.find((payment) => payment.id === id) ?? null;
    },

    async payPayment(id, sessionId) {
      const payment = state.payments.find((item) => item.id === id && item.sessionId === sessionId);
      if (!payment) throw new HttpError(404, 'PAYMENT_NOT_FOUND', '充值单不存在');
      if (payment.status === 'paid') return payment;
      payment.status = 'paid';
      payment.paidAt = new Date().toISOString();
      const session = requireSession(sessionId);
      session.balanceCents += payment.amountCents;
      await persist();
      return payment;
    },
  };
}
