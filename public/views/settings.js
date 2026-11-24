import { api } from '../lib/api.js';
import { createCapsuleSelect, errorText, h, toast } from '../lib/dom.js';

const SOURCE_LABEL = { taobao: '淘宝', jd: '京东', pdd: '拼多多', douyin: '抖音' };
const LOGIN_PLATFORMS = ['taobao', 'jd', 'pdd'];

/** 设置页：模型、图片服务、商品来源与演示模式；不展示内部接口与凭据内容。 */
export function renderSettings(root, ctx) {
  const body = h('div', { class: 'settings' });
  const loginStates = {};

  root.append(
    h('section', { class: 'page-head', 'aria-live': 'polite' }, [
      h('h1', { class: 'page-title', text: '设置' }),
      h('p', { class: 'page-sub', text: '选择生成用的图像模型，管理商品来源的连接状态。' }),
    ]),
    body,
  );

  paint();
  if (!ctx.settings) void refresh();

  async function refresh() {
    try {
      ctx.settings = await api('/api/settings');
      if (typeof ctx.settings.demoMode === 'boolean') ctx.applyDemoMode?.(ctx.settings.demoMode);
    } catch {
      const config = ctx.config || {};
      ctx.settings = Array.isArray(config.models) && config.models.length
        ? { model: ctx.model || config.defaultModel || '', models: config.models, demoMode: Boolean(config.demoMode), sources: null, gateway: config.gateway || {}, fallback: true }
        : null;
    }
    paint();
  }

  function paint() {
    body.replaceChildren();
    const settings = ctx.settings;
    if (!settings) {
      body.append(h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '设置暂时读取不到' }),
        h('p', { text: '图片服务未响应或设置接口尚未就绪，请稍后重试。' }),
        h('button', { type: 'button', class: 'btn btn--sm', text: '重新加载', onclick: () => void refresh() }),
      ]));
      return;
    }
    body.append(modelCard(settings), gatewayCard(settings), cookiesCard(settings), demoCard(settings));
  }

  function modelCard(settings) {
    const models = Array.isArray(settings.models) ? settings.models : [];
    const capsule = createCapsuleSelect({
      options: models.map((model) => ({ value: model.id, label: model.label || model.id })),
      value: settings.model ?? '',
      placeholder: '选择图像模型',
      ariaLabel: '图像模型',
      onChange: (value) => void saveModel(value),
    });
    if (models.length === 0) capsule.setDisabled(true);
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '图像模型' }),
      h('div', { class: 'field' }, [
        h('span', { class: 'field__label', text: '用于下一次试穿' }),
        capsule.el,
        h('p', { class: 'field__hint', text: '切换后立即生效；工作台不会重复出现模型选择。' }),
      ]),
    ]);
  }

  async function saveModel(model) {
    try {
      await api('/api/settings', { method: 'PATCH', body: { model } });
      ctx.settings.model = model;
      ctx.model = model;
      toast('模型已切换');
    } catch (error) {
      toast(error.message);
      paint();
    }
  }

  function gatewayCard(settings) {
    const reachable = settings.gateway?.reachable !== false;
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '图片服务' }),
      h('div', { class: 'kv' }, [
        h('span', { class: 'kv__label', text: '连通状态' }),
        h('span', { class: `status-pill ${reachable ? 'is-on' : 'is-off'}`, text: reachable ? '已连通' : '未连接' }),
      ]),
      reachable ? null : h('p', { class: 'field__hint', text: '图片服务未连接时无法生成试穿结果，请检查环境配置。' }),
    ]);
  }

  function cookiesCard(settings) {
    const sources = settings.sources;
    const known = sources != null;
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '商品来源' }),
      ...Object.keys(SOURCE_LABEL).map((key) => cookiesRow(key, known, known ? Boolean(sources[key]) : false)),
      h('p', { class: 'field__hint', text: '只显示是否已登录，不展示账号或凭据内容；抖音商城无需登录。' }),
    ]);
  }

  function cookiesRow(key, known, on) {
    const pill = h('span', { class: `status-pill ${on ? 'is-on' : 'is-off'}`, text: known ? (on ? '已配置' : '未配置') : '未知' });
    const cells = [h('span', { class: 'login-row__label', text: SOURCE_LABEL[key] }), pill];
    if (!LOGIN_PLATFORMS.includes(key)) {
      cells.push(h('span', { class: 'field__hint login-row__hint', text: '无需登录' }));
      return h('div', { class: 'login-row' }, cells);
    }
    const statusEl = h('span', { class: 'login-row__status', 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn btn--sm', text: '扫码登录' });
    btn.addEventListener('click', () => void startLogin(key, btn, statusEl, pill));
    const st = loginStates[key];
    if (st?.status === 'waiting') { btn.disabled = true; btn.textContent = '等待扫码…'; statusEl.textContent = '等待扫码…'; }
    else if (st?.status === 'done') { btn.disabled = true; btn.textContent = '已完成'; statusEl.textContent = '已登录'; }
    else if (st?.status === 'failed' || st?.status === 'expired') statusEl.textContent = st.text || '';
    cells.push(h('div', { class: 'login-row__action' }, [btn, statusEl]));
    return h('div', { class: 'login-row' }, cells);
  }

  async function startLogin(platform, button, statusEl, pill) {
    const st = loginStates[platform] || (loginStates[platform] = {});
    if (st.status === 'waiting') return;
    button.disabled = true;
    button.textContent = '启动中…';
    statusEl.textContent = '正在准备扫码…';
    try {
      const payload = await api(`/api/login/${platform}`, { method: 'POST' });
      st.sessionId = payload.sessionId;
      st.status = 'waiting';
      button.textContent = '等待扫码…';
      statusEl.textContent = '等待扫码…';
      toast(`请在打开的浏览器中扫码登录${SOURCE_LABEL[platform]}`);
      pollLogin(platform, button, statusEl, pill);
    } catch (error) {
      st.status = 'failed';
      st.text = errorText(error);
      button.disabled = false;
      button.textContent = '扫码登录';
      statusEl.textContent = st.text;
      toast(st.text);
    }
  }

  function pollLogin(platform, button, statusEl, pill) {
    const st = loginStates[platform];
    if (st.timer) clearInterval(st.timer);
    let ticks = 0;
    st.timer = setInterval(async () => {
      if (!button.isConnected) { clearInterval(st.timer); st.timer = null; return; }
      ticks += 1;
      if (ticks > 240) {
        clearInterval(st.timer); st.timer = null; st.status = 'expired';
        st.text = '登录超时，请重新发起；若一直无响应，请检查本机浏览器是否可用。';
        button.disabled = false; button.textContent = '扫码登录'; statusEl.textContent = st.text;
        return;
      }
      try {
        const payload = await api(`/api/login/${platform}/status?sessionId=${encodeURIComponent(st.sessionId ?? '')}`);
        if (payload.status === 'waiting') statusEl.textContent = '等待扫码…';
        else if (payload.status === 'done') {
          clearInterval(st.timer); st.timer = null; st.status = 'done';
          button.disabled = true; button.textContent = '已完成';
          statusEl.textContent = payload.account ? `已登录（${payload.account}）` : '已登录';
          pill.classList.add('is-on'); pill.classList.remove('is-off'); pill.textContent = '已配置';
          toast(`${SOURCE_LABEL[platform]}登录成功`);
          void refreshData();
        } else if (payload.status === 'failed' || payload.status === 'expired') {
          clearInterval(st.timer); st.timer = null; st.status = payload.status;
          st.text = payload.status === 'failed' ? '登录失败，请重新扫码。' : '登录已超时，请重新扫码。';
          button.disabled = false; button.textContent = '扫码登录'; statusEl.textContent = st.text;
        }
      } catch (error) {
        clearInterval(st.timer); st.timer = null; st.status = 'failed'; st.text = errorText(error);
        button.disabled = false; button.textContent = '扫码登录'; statusEl.textContent = st.text;
      }
    }, 1500);
  }

  async function refreshData() {
    try {
      ctx.settings = await api('/api/settings');
      if (typeof ctx.settings.demoMode === 'boolean') ctx.applyDemoMode?.(ctx.settings.demoMode);
    } catch {
      /* 静默刷新失败不打断当前页 */
    }
  }

  function demoCard(settings) {
    const on = settings.demoMode === true;
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '演示模式' }),
      h('div', { class: 'kv' }, [
        h('span', { class: 'kv__label', text: '当前状态' }),
        h('span', { class: `status-pill ${on ? 'is-on' : 'is-off'}`, text: on ? '已开启' : '未开启' }),
      ]),
      h('p', { class: 'field__hint', text: on ? '演示模式已开启：隐藏余额、价格与充值入口，试穿不扣费。' : '演示模式由服务端环境配置控制；关闭时按正常计费流程运行。' }),
    ]);
  }
}
