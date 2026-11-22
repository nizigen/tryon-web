import { api, getSessionId } from '../lib/api.js';
import { h, money, timeLabel } from '../lib/dom.js';
import { SLOT_BY_KEY } from '../lib/garment-taxonomy.js';

const STATUS = {
  pending: { label: '生成中', cls: '' },
  queued: { label: '排队中', cls: '' },
  success: { label: '已完成', cls: 'status--success' },
  failed: { label: '失败', cls: 'status--failed' },
};

/** 「我的」：订单历史（演示模式下不显示任何金额）+ 说明。 */
export function renderMe(root, ctx) {
  const state = { orders: null, detail: null, loading: false };
  const detailEl = h('div');
  const listEl = h('div');

  root.append(
    h('section', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '订单与说明' }),
      h('p', { class: 'page-sub', text: '查看历史试穿订单，了解隐私与演示模式说明。' }),
    ]),
    detailEl,
    h('section', { class: 'card' }, [h('h2', { class: 'section__title', text: '订单历史' }), listEl]),
    noteCard(ctx),
  );

  void loadOrders();

  async function loadOrders() {
    if (!getSessionId()) {
      state.orders = [];
      paintList();
      return;
    }
    state.loading = true;
    paintList();
    try {
      const payload = await api('/api/orders');
      state.orders = payload.orders ?? [];
    } catch {
      state.orders = [];
    } finally {
      state.loading = false;
      paintList();
    }
  }

  function paintList() {
    listEl.replaceChildren();
    if (state.orders === null || state.loading) {
      listEl.append(h('div', { class: 'empty' }, [h('p', { text: '正在加载订单…' })]));
      return;
    }
    if (state.orders.length === 0) {
      listEl.append(h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '还没有试穿订单' }),
        h('p', { text: '去工作台搭配一套，开始第一次试穿。' }),
      ]));
      return;
    }
    for (const order of state.orders) listEl.append(orderRow(order));
  }

  function orderRow(order) {
    const status = STATUS[order.status] ?? { label: order.status ?? '未知', cls: 'is-pending' };
    const slotNames = (order.slots ?? []).map((slot) => SLOT_BY_KEY[slot]?.label ?? slot).join(' · ');
    const row = h('button', {
      type: 'button',
      class: 'list-row',
      onclick: () => void openDetail(order.id),
    }, [
      h('span', { class: 'list-row__main' }, [
        h('span', { class: 'list-row__title', text: order.productName || '搭配试穿' }),
        h('span', { class: 'list-row__meta', text: slotNames || '—' }),
      ]),
      h('span', { class: 'list-row__side' }, [
        h('span', { class: `status ${status.cls}`.trim(), text: status.label }),
        h('span', { class: 'list-row__time', text: timeLabel(order.createdAt) }),
        ctx.demoMode ? null : h('span', { class: 'price-inline', text: money(order.priceCents) }),
      ]),
    ]);
    return row;
  }

  async function openDetail(orderId) {
    try {
      const payload = await api(`/api/orders/${orderId}`);
      state.detail = payload.order;
    } catch {
      state.detail = null;
    }
    paintDetail();
    detailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function paintDetail() {
    detailEl.replaceChildren();
    const order = state.detail;
    if (!order) return;
    const status = STATUS[order.status] ?? { label: order.status ?? '未知', cls: 'is-pending' };
    const slotNames = (order.slots ?? []).map((slot) => SLOT_BY_KEY[slot]?.label ?? slot).join(' · ');
    const body = h('div', { class: 'result' });

    if (order.status === 'success' && order.resultFile) {
      const url = `/api/results/${order.resultFile}?k=${encodeURIComponent(order.resultToken ?? '')}`;
      body.append(
        h('div', { class: 'canvas' }, [h('img', { src: url, alt: '试穿结果' })]),
        h('p', { class: 'ai-note', text: 'AI 生成效果仅供参考，实物以商品页面描述为准' }),
        h('a', { class: 'btn btn--block', href: url, download: '搭配试穿-AI生成.jpg', text: '下载效果图（含 AI 标识）' }),
      );
    } else if (order.status === 'failed') {
      body.append(h('p', { class: 'error-text', text: order.errorMessage ?? '本次生成失败，未扣费。' }));
    } else {
      body.append(h('p', { class: 'field__hint', text: '正在生成，请稍候后在订单历史刷新查看。' }));
    }

    detailEl.append(h('section', { class: 'card' }, [
      h('div', { class: 'result__head' }, [
        h('h2', { class: 'section__title', text: order.productName || '搭配试穿' }),
        h('span', { class: `status ${status.cls}`.trim(), text: status.label }),
      ]),
      h('p', { class: 'field__hint', text: `${slotNames || '—'} · ${timeLabel(order.createdAt)}` }),
      body,
    ]));
  }

  function noteCard(ctx) {
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '说明' }),
      h('ul', { class: 'notes' }, [
        h('li', { text: '人像照片只用于本次生成，不写入订单记录，不长期保存。' }),
        h('li', { text: '结果图标注「AI 生成」，24 小时后失效，请及时下载。' }),
        h('li', { text: '下单冻结 → 成功实扣 → 失败或超时全额退回；' + (ctx.demoMode ? '演示模式下不扣费。' : '具体金额以订单为准。') }),
      ]),
    ]);
  }
}
