import { api, getSessionId } from '../lib/api.js';
import { h, money, timeLabel } from '../lib/dom.js';
import { SLOT_BY_KEY } from '../lib/garment-taxonomy.js';
import { icon } from '../lib/icons.js';

const STATUS = {
  pending: { label: '生成中', cls: '' },
  queued: { label: '排队中', cls: '' },
  success: { label: '已完成', cls: 'status--success' },
  failed: { label: '失败', cls: 'status--failed' },
};

/** 试穿记录：订单历史、单笔详情与说明；演示模式不显示金额。 */
export function renderMe(root, ctx) {
  const state = { orders: null, detail: null, loading: false };
  const detailEl = h('div', { class: 'records-detail' });
  const listEl = h('div', { class: 'list' });
  const refreshBtn = h('button', { type: 'button', class: 'btn btn--sm', text: '刷新' });

  root.append(
    h('section', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', { class: 'page-title', text: '试穿记录' }),
        h('p', { class: 'page-sub', text: '回看每一次试穿的状态、搭配与生成结果。' }),
      ]),
      h('div', { class: 'page-actions' }, [refreshBtn]),
    ]),
    h('div', { class: 'records-layout' }, [
      h('div', {}, [detailEl, h('section', { class: 'card' }, [h('div', { class: 'card__head' }, [h('h2', { class: 'section__title', text: '最近的试穿' }), h('span', { class: 'tag', text: '24 小时后结果失效' })]), listEl])]),
      noteCard(ctx),
    ]),
  );

  refreshBtn.addEventListener('click', () => void loadOrders());
  void loadOrders();

  async function loadOrders() {
    if (!getSessionId()) {
      state.orders = [];
      paintList();
      return;
    }
    state.loading = true;
    refreshBtn.disabled = true;
    refreshBtn.textContent = '刷新中…';
    paintList();
    try {
      const payload = await api('/api/orders');
      state.orders = payload.orders ?? [];
    } catch {
      state.orders = null;
    } finally {
      state.loading = false;
      refreshBtn.disabled = false;
      refreshBtn.textContent = '刷新';
      paintList();
    }
  }

  function paintList() {
    listEl.replaceChildren();
    if (state.orders === null && !state.loading) {
      listEl.append(h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '记录读取失败' }),
        h('p', { text: '请检查网络后刷新；已生成的图片仍会保留到过期时间。' }),
      ]));
      return;
    }
    if (state.orders === null || state.loading) {
      listEl.append(h('div', { class: 'empty' }, [h('span', { class: 'spinner' }), h('p', { text: '正在读取试穿记录…' })]));
      return;
    }
    if (state.orders.length === 0) {
      listEl.append(h('div', { class: 'empty' }, [
        icon('orders'),
        h('p', { class: 'empty__title', text: '还没有试穿记录' }),
        h('p', { text: '去工作台搭一套，完成第一次试穿。' }),
        h('button', { type: 'button', class: 'btn btn--primary btn--sm', text: '去搭一套', onclick: () => ctx.onNavigate('studio') }),
      ]));
      return;
    }
    for (const order of state.orders) listEl.append(orderRow(order));
  }

  function orderRow(order) {
    const status = STATUS[order.status] ?? { label: order.status ?? '未知', cls: '' };
    const slotNames = (order.slots ?? []).map((slot) => SLOT_BY_KEY[slot]?.label ?? slot).join(' · ');
    return h('button', { type: 'button', class: 'list-row', onclick: () => void openDetail(order.id) }, [
      h('span', { class: 'list-row__main' }, [
        h('span', { class: 'list-row__title', text: order.productName || '搭配试穿' }),
        h('span', { class: 'list-row__meta', text: slotNames || '组合搭配' }),
      ]),
      h('span', { class: 'list-row__side' }, [
        h('span', { class: `status ${status.cls}`.trim(), text: status.label }),
        h('span', { class: 'list-row__time', text: timeLabel(order.createdAt) }),
        ctx.demoMode ? null : h('span', { class: 'price-inline', text: money(order.priceCents) }),
      ]),
    ]);
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
    const status = STATUS[order.status] ?? { label: order.status ?? '未知', cls: '' };
    const slotNames = (order.slots ?? []).map((slot) => SLOT_BY_KEY[slot]?.label ?? slot).join(' · ');
    const body = h('div', { class: 'result' });
    if (order.status === 'success' && order.resultFile) {
      const url = `/api/results/${order.resultFile}?k=${encodeURIComponent(order.resultToken ?? '')}`;
      body.append(
        h('div', { class: 'canvas' }, [h('img', { src: url, alt: '试穿结果' }), h('span', { class: 'canvas__label', text: 'AI 生成 · 试穿结果' })]),
        h('p', { class: 'ai-note', text: 'AI 生成效果仅供参考，实物以商品页面描述为准' }),
        h('a', { class: 'btn btn--block', href: url, download: '搭配试穿-AI生成.jpg', text: '下载效果图（含 AI 标识）' }),
      );
    } else if (order.status === 'failed') {
      body.append(h('p', { class: 'error-text', text: order.errorMessage ?? '本次生成失败，未扣费。' }), h('button', { type: 'button', class: 'btn', text: '再试一次', onclick: () => ctx.onNavigate('studio') }));
    } else {
      body.append(h('div', { class: 'stage' }, [h('span', { class: 'spinner' }), h('span', { text: '正在生成，请稍后在列表中刷新查看。' })]));
    }
    detailEl.append(h('section', { class: 'card' }, [
      h('div', { class: 'result__head' }, [
        h('h2', { class: 'section__title', text: order.productName || '搭配试穿' }),
        h('span', { class: `status ${status.cls}`.trim(), text: status.label }),
      ]),
      h('p', { class: 'field__hint', text: [slotNames || '组合搭配', timeLabel(order.createdAt)].join(' · ') }),
      body,
    ]));
  }

  function noteCard(ctx) {
    return h('aside', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '关于试穿结果' }),
      h('ul', { class: 'notes' }, [
        h('li', { text: '人像照片只用于本次生成，不写入订单记录，不长期保存。' }),
        h('li', { text: '结果图标注「AI 生成」，24 小时后失效，请及时下载。' }),
        h('li', { text: ctx.demoMode ? '演示模式不扣费，可放心体验完整流程。' : '下单冻结，成功实扣，失败或超时全额退回；金额以订单为准。' }),
      ]),
    ]);
  }
}
