import { api, getSessionId } from '../lib/api.js';
import { h, money, timeLabel, toast } from '../lib/dom.js';

const STATUS_LABEL = {
  pending: '生成中',
  success: '已完成',
  failed: '已失败',
};

export function renderMe(root, ctx) {
  const walletAmount = h('div', { class: 'wallet__amount', text: money(ctx.balanceCents) });
  const packsRow = h('div', { class: 'packs' });
  const ordersList = h('div', { class: 'list' });
  const confirmButton = h('button', { type: 'button', class: 'btn btn--primary btn--block', text: '充值（本地模拟）', disabled: true });

  let selectedPack = null;

  function paintPacks() {
    packsRow.replaceChildren();
    for (const pack of ctx.config.packs ?? []) {
      const active = selectedPack?.id === pack.id;
      packsRow.append(h('button', {
        type: 'button',
        class: `pack${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        onclick: () => {
          selectedPack = pack;
          paintPacks();
          confirmButton.disabled = false;
          confirmButton.textContent = `充值 ${money(pack.amountCents)}`;
        },
      }, [
        h('div', { class: 'pack__price', text: money(pack.amountCents) }),
        h('div', { class: 'pack__note', text: `${pack.label} · 约 ${pack.approxTries ?? pack.credits} 次最低档` }),
      ]));
    }
  }

  async function loadOrders() {
    ordersList.replaceChildren(h('p', { class: 'result__meta', text: '加载中…' }));
    try {
      const payload = await api('/api/orders');
      ordersList.replaceChildren();
      if (payload.orders.length === 0) {
        ordersList.append(h('div', { class: 'empty' }, [
          h('p', { class: 'empty__title', text: '还没有试穿记录' }),
          h('p', { text: '去橱窗挑一件衣服试试看。' }),
        ]));
        return;
      }
      for (const order of payload.orders) {
        ordersList.append(h('div', { class: 'list-row' }, [
          h('div', { class: 'list-row__main' }, [
            h('p', { class: 'list-row__title', text: order.productName ?? '自定义试穿' }),
            h('p', { class: 'list-row__meta', text: `${order.model} · ${order.tier} · ${money(order.priceCents)} · ${timeLabel(order.createdAt)}` }),
          ]),
          h('span', { class: `status status--${order.status}`, text: STATUS_LABEL[order.status] ?? order.status }),
        ]));
      }
    } catch (error) {
      ordersList.replaceChildren(h('p', { class: 'error-text', text: error.message }));
    }
  }

  confirmButton.addEventListener('click', async () => {
    if (!selectedPack) return;
    confirmButton.disabled = true;
    try {
      const payment = await api('/api/payments', { method: 'POST', body: { sessionId: getSessionId(), packId: selectedPack.id } });
      const confirmed = await api(`/api/payments/${payment.paymentId}/confirm`, { method: 'POST', body: { sessionId: getSessionId() } });
      ctx.balanceCents = confirmed.balanceCents;
      ctx.onBalanceChanged(confirmed.balanceCents);
      walletAmount.textContent = money(confirmed.balanceCents);
      toast('充值成功（本地模拟，未接入真实支付）');
    } catch (error) {
      toast(error.message);
    } finally {
      confirmButton.disabled = !selectedPack;
    }
  });

  root.append(
    h('section', { class: 'section' }, [
      h('h2', { class: 'section__title' }, ['试穿余额', h('span', { class: 'section__hint', text: '按模型档位扣费，失败自动退回' })]),
      h('div', { class: 'card wallet' }, [
        walletAmount,
        h('div', {}, [packsRow]),
        confirmButton,
        h('p', { class: 'field__hint', text: '当前为本地模拟充值；接入抖音小程序虚拟支付后替换此流程。' }),
      ]),
    ]),
    h('section', { class: 'section' }, [
      h('h2', { class: 'section__title' }, ['我的试穿']),
      ordersList,
    ]),
    h('section', { class: 'section' }, [
      h('div', { class: 'card form' }, [
        h('h2', { class: 'section__title', text: '关于试穿效果' }),
        h('p', { class: 'field__hint', text: '试穿图片由 AI 生成，用于参考上身效果，不代表实物完全一致；颜色、面料与版型请以商品页说明为准。' }),
        h('p', { class: 'field__hint', text: '你上传的人物照片只用于本次生成，不会作为素材保存；生成结果默认 24 小时后清理。' }),
      ]),
    ]),
  );

  paintPacks();
  void loadOrders();
}
