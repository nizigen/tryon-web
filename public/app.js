import { api, deviceId, getSessionId, setSessionId } from './lib/api.js';
import { closeAllDialogs } from './lib/dialog.js';
import { clear, closeAllMenus, h, money, toast } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { renderMe } from './views/me.js';
import { renderShop } from './views/shop.js';
import { renderSettings } from './views/settings.js';
import { renderStudio } from './views/studio.js';
import { renderTryon } from './views/tryon.js';
import { renderWardrobe } from './views/wardrobe.js';

const root = document.getElementById('main');
const balanceValue = document.getElementById('balance-value');
const balanceBox = document.getElementById('balance-box');
const demoBadge = document.getElementById('demo-badge');

const ctx = {
  config: { models: [], packs: [], categories: [], garmentTypes: [], fits: [] },
  settings: null,
  products: [],
  demoMode: false,
  model: null,
  pendingPieces: null,
  pendingPerson: null,
  pendingPhotographyMode: null,
  balanceCents: 0,
  applyDemoMode,
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
  if (balanceValue) balanceValue.textContent = money(cents);
}

function onOpenProduct(productId) {
  location.hash = `#/tryon/${productId}`;
}

function onNavigate(route) {
  location.hash = `#/${route}`;
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, id] = hash.split('/');
  if (route === 'tryon' && id) return { route: 'tryon', id };
  if (['shop', 'studio', 'wardrobe', 'settings', 'me'].includes(route)) return { route };
  return { route: 'studio' };
}

function setActiveNav(route) {
  const active = route === 'tryon' ? 'studio' : route;
  for (const item of document.querySelectorAll('.nav__item')) {
    const on = item.dataset.route === active;
    item.classList.toggle('is-active', on);
    if (on) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

function render() {
  const { route, id } = currentRoute();
  setActiveNav(route);
  closeAllMenus();
  closeAllDialogs();
  clear(root);
  root.dataset.view = route;
  const view = h('div', { class: 'view-content' });
  root.append(view);
  if (route === 'tryon') renderTryon(view, ctx, id);
  else if (route === 'studio') {
    const preset = ctx.pendingPieces;
    ctx.pendingPieces = null;
    renderStudio(view, ctx, preset);
  } else if (route === 'wardrobe') renderWardrobe(view, ctx);
  else if (route === 'settings') renderSettings(view, ctx);
  else if (route === 'me') renderMe(view, ctx);
  else renderShop(view, ctx);
  // 换页必须回到顶部：否则从长页面（如工作台）跳到短页面时，
  // 浏览器会把 scrollY 钳到新页面高度，标题被顶栏压住。
  window.scrollTo(0, 0);
  root.focus({ preventScroll: true });
}

function applyDemoMode(on) {
  ctx.demoMode = on;
  document.body.classList.toggle('is-demo', on);
  if (demoBadge) demoBadge.hidden = !on;
  if (balanceBox) balanceBox.hidden = on;
}

async function loadSettings() {
  try {
    ctx.settings = await api('/api/settings');
  } catch {
    ctx.settings = null;
  }
  ctx.model = ctx.settings?.model ?? ctx.config.defaultModel ?? ctx.config.models[0]?.id ?? null;
  if (ctx.settings && typeof ctx.settings.demoMode === 'boolean') applyDemoMode(ctx.settings.demoMode);
}

function wireNav() {
  const icons = { studio: 'studio', wardrobe: 'wardrobe', settings: 'settings', me: 'orders' };
  for (const item of document.querySelectorAll('.nav__item')) {
    item.prepend(icon(icons[item.dataset.route]));
    item.addEventListener('click', () => onNavigate(item.dataset.route));
  }
}

async function boot() {
  wireNav();
  window.addEventListener('hashchange', render);

  const skeleton = h('div', { class: 'grid' }, Array.from({ length: 4 }, () => h('div', { class: 'skeleton skeleton-card' })));
  root.append(skeleton);

  try {
    ctx.config = await api('/api/config');
    applyDemoMode(Boolean(ctx.config.demoMode));
    if (ctx.config.gateway && ctx.config.gateway.reachable === false) {
      toast('图片服务未连接，暂时无法生成试穿结果');
    }
  } catch (error) {
    toast(`配置加载失败：${error.message}`);
  }

  try {
    const payload = await api('/api/products');
    ctx.products = payload.products ?? [];
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

  await loadSettings();
  render();
}

void boot();
