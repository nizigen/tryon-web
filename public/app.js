import { api, deviceId, getSessionId, setSessionId } from './lib/api.js';
import { clear, h, money, toast } from './lib/dom.js';
import { renderMe } from './views/me.js';
import { renderShop } from './views/shop.js';
import { renderTryon } from './views/tryon.js';

const root = document.getElementById('main');
const balanceValue = document.getElementById('balance-value');
const balanceChip = document.getElementById('balance-chip');
const gatewayNotice = document.getElementById('gateway-notice');

const ctx = {
  config: { models: [], packs: [], categories: [], fits: [] },
  products: [],
  balanceCents: 0,
  onNavigate,
  onOpenProduct,
  onBalanceChanged,
  async refreshBalance() {
    if (!getSessionId()) return;
    try {
      const session = await api(`/api/session/${getSessionId()}`);
      ctx.balanceCents = session.balanceCents;
      onBalanceChanged(session.balanceCents);
    } catch {
      /* 余额刷新失败不打断当前操作 */
    }
  },
};

function onBalanceChanged(cents) {
  ctx.balanceCents = cents;
  balanceValue.textContent = money(cents);
}

function onOpenProduct(productId) {
  location.hash = `#/tryon/${productId}`;
}

function onNavigate(route) {
  location.hash = route === 'me' ? '#/me' : '#/shop';
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, id] = hash.split('/');
  if (route === 'tryon' && id) return { route: 'tryon', id };
  if (route === 'me') return { route: 'me' };
  return { route: 'shop' };
}

function setActiveTab(route) {
  for (const tab of document.querySelectorAll('.tab')) {
    const active = tab.dataset.route === route;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

function render() {
  const { route, id } = currentRoute();
  setActiveTab(route === 'tryon' ? 'shop' : route);
  clear(root);
  if (route === 'tryon') renderTryon(root, ctx, id);
  else if (route === 'me') renderMe(root, ctx);
  else renderShop(root, ctx);
  root.focus({ preventScroll: true });
}

async function boot() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => onNavigate(tab.dataset.route));
  }
  balanceChip.addEventListener('click', () => onNavigate('me'));
  window.addEventListener('hashchange', render);

  const skeleton = h('div', { class: 'grid' }, Array.from({ length: 4 }, () => h('div', { class: 'skeleton skeleton-card' })));
  root.append(skeleton);

  try {
    ctx.config = await api('/api/config');
    if (!ctx.config.gateway?.reachable) {
      gatewayNotice.hidden = false;
      gatewayNotice.textContent = '图片服务未连接，暂时无法生成试穿结果';
    }
  } catch (error) {
    gatewayNotice.hidden = false;
    gatewayNotice.textContent = `配置加载失败：${error.message}`;
  }

  try {
    const payload = await api('/api/products');
    ctx.products = payload.products;
  } catch (error) {
    toast(error.message);
    ctx.products = [];
  }

  try {
    const session = await api('/api/session', { method: 'POST', body: { deviceId: deviceId() } });
    setSessionId(session.sessionId);
    onBalanceChanged(session.balanceCents);
  } catch (error) {
    toast(error.message);
  }

  render();
}

void boot();
