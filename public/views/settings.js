import { api } from '../lib/api.js';
import { createCapsuleSelect, errorText, h, toast } from '../lib/dom.js';

const SOURCE_LABEL = { taobao: '淘宝', jd: '京东', pdd: '拼多多', douyin: '抖音' };
const LOGIN_PLATFORMS = ['taobao', 'jd', 'pdd'];

/**
 * 设置页：模型统一在这里选择（工作台/试穿页不再出现模型选择），
 * 同时展示网关连通状态、各来源 cookie 是否配置（只显示布尔值），以及演示模式说明。
 */
export function renderSettings(root, ctx) {
  const body = h('div', { class: 'settings' });
  const loginStates = {};

  root.append(
    h('section', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '设置' }),
      h('p', { class: 'page-sub', text: '图像模型只在这里统一选择；工作台与试穿页不再单独切换模型。' }),
    ]),
    body,
  );

  paint();
  if (!ctx.settings) void refresh();

  async function refresh() {
    try {
      ctx.settings = await api('/api/settings');
      // 走 ctx.applyDemoMode：它同时改 body 的 is-demo、徽标与余额框，
      // 只写 ctx.demoMode 会在 /api/config 失败时留下「设置说开着、界面还显示价格」。
      if (typeof ctx.settings.demoMode === 'boolean') ctx.applyDemoMode?.(ctx.settings.demoMode);
    } catch {
      const config = ctx.config || {};
      ctx.settings = Array.isArray(config.models) && config.models.length
        ? {
          model: ctx.model || config.defaultModel || '',
          models: config.models,
          demoMode: Boolean(config.demoMode),
          sources: null,
          gateway: config.gateway || {},
          fallback: true,
        }
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
        h('p', { text: '本地网关未响应或设置接口尚未就绪，请稍后重试。' }),
        h('button', { type: 'button', class: 'btn btn--sm', text: '重新加载', onclick: () => void refresh() }),
      ]));
      return;
    }
    if (settings.fallback) {
      body.append(h('div', { class: 'card' }, [
        h('p', { class: 'field__hint', text: '设置接口暂未就绪，以下为当前运行配置（只读）。后端恢复后刷新本页即可正常读取与切换。' }),
      ]));
    }
    body.append(modelCard(settings), gatewayCard(settings), cookiesCard(settings), demoCard(settings));
  }

  function modelCard(settings) {
    const models = Array.isArray(settings.models) ? settings.models : [];
    const options = models.map((model) => ({ value: model.id, label: model.label || model.id }));
    const capsule = createCapsuleSelect({
      options,
      value: settings.model ?? '',
      placeholder: '选择图像模型',
      ariaLabel: '图像模型',
      onChange: (value) => void saveModel(value),
    });
    if (options.length === 0) capsule.setDisabled(true);
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '图像模型' }),
      h('div', { class: 'field' }, [
        h('span', { class: 'field__label', text: '当前模型' }),
        capsule.el,
        h('p', { class: 'field__hint', text: '切换后立即生效（PATCH /api/settings），下一次试穿使用新模型。' }),
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
      h('h2', { class: 'section__title', text: '图像网关' }),
      h('div', { class: 'kv' }, [
        h('span', { class: 'kv__label', text: '连通状态' }),
        h('span', { class: `status-pill ${reachable ? 'is-on' : 'is-off'}`, text: reachable ? '已连通' : '未连接' }),
      ]),
      reachable ? null : h('p', { class: 'field__hint', text: '网关未连接时无法生成试穿结果，请检查本地服务配置。' }),
    ]);
  }

  function cookiesCard(settings) {
    const sources = settings.sources;
    const known = sources != null;
    const rows = Object.keys(SOURCE_LABEL).map((key) => cookiesRow(key, known, known ? Boolean(sources[key]) : false));
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '来源登录状态' }),
      ...rows,
      h('p', { class: 'field__hint', text: '仅显示是否已配置，不会展示任何 cookie 内容；抖音无需登录。' }),
    ]);
  }

  function cookiesRow(key, known, on) {
    const pill = h('span', {
      class: `status-pill ${on ? 'is-on' : 'is-off'}`,
      text: known ? (on ? '已配置' : '未配置') : '未知',
    });
    const cells = [h('span', { class: 'login-row__label', text: SOURCE_LABEL[key] }), pill];
    if (LOGIN_PLATFORMS.includes(key)) {
      const statusEl = h('span', { class: 'login-row__status' });
      const btn = h('button', { type: 'button', class: 'btn btn--sm', text: '扫码登录' });
      btn.addEventListener('click', () => void startLogin(key, btn, statusEl, pill));
      const st = loginStates[key];
      if (st?.status === 'waiting') {
        btn.disabled = true;
        btn.textContent = '等待扫码…';
        statusEl.textContent = '等待扫码…';
      } else if (st?.status === 'done') {
        btn.disabled = true;
        btn.textContent = '已完成';
        statusEl.textContent = '已写入 cookie';
      } else if (st?.status === 'failed' || st?.status === 'expired') {
        statusEl.textContent = st.text || '';
      }
      cells.push(h('div', { class: 'login-row__action' }, [btn, statusEl]));
    } else {
      cells.push(h('span', { class: 'field__hint login-row__hint', text: '无需登录' }));
    }
    return h('div', { class: 'login-row' }, cells);
  }

  async function startLogin(platform, button, statusEl, pill) {
    const st = loginStates[platform] || (loginStates[platform] = {});
    if (st.status === 'waiting') return;
    button.disabled = true;
    button.textContent = '启动中…';
    statusEl.textContent = '正在启动登录…';
    try {
      const payload = await api(`/api/login/${platform}`, { method: 'POST' });
      st.sessionId = payload.sessionId;
      st.status = 'waiting';
      st.text = '等待扫码…';
      button.textContent = '等待扫码…';
      statusEl.textContent = '等待扫码…';
      toast(`请在弹出的 Chrome 里扫码登录${SOURCE_LABEL[platform]}`);
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
      if (!button.isConnected) {
        clearInterval(st.timer);
        st.timer = null;
        return;
      }
      ticks += 1;
      if (ticks > 240) {
        clearInterval(st.timer);
        st.timer = null;
        st.status = 'expired';
        st.text = '登录超时，请重新发起；若一直无响应，请检查本机 Chrome 是否可用。';
        button.disabled = false;
        button.textContent = '扫码登录';
        statusEl.textContent = st.text;
        return;
      }
      try {
        const payload = await api(`/api/login/${platform}/status?sessionId=${encodeURIComponent(st.sessionId ?? '')}`);
        const status = payload.status;
        if (status === 'waiting') {
          statusEl.textContent = '等待扫码…';
        } else if (status === 'done') {
          clearInterval(st.timer);
          st.timer = null;
          st.status = 'done';
          st.text = '已写入 cookie';
          button.disabled = true;
          button.textContent = '已完成';
          statusEl.textContent = payload.account ? `已写入 cookie（${payload.account}）` : '已写入 cookie';
          pill.classList.add('is-on');
          pill.classList.remove('is-off');
          pill.textContent = '已配置';
          toast(`${SOURCE_LABEL[platform]}登录成功，已写入 cookie`);
          void refreshData();
        } else if (status === 'failed') {
          clearInterval(st.timer);
          st.timer = null;
          st.status = 'failed';
          st.text = '登录失败，请重新发起扫码。';
          button.disabled = false;
          button.textContent = '扫码登录';
          statusEl.textContent = st.text;
        } else if (status === 'expired') {
          clearInterval(st.timer);
          st.timer = null;
          st.status = 'expired';
          st.text = '登录已超时，请重新扫码。';
          button.disabled = false;
          button.textContent = '扫码登录';
          statusEl.textContent = st.text;
        }
      } catch (error) {
        clearInterval(st.timer);
        st.timer = null;
        st.status = 'failed';
        st.text = errorText(error);
        button.disabled = false;
        button.textContent = '扫码登录';
        statusEl.textContent = st.text;
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
      h('p', { class: 'field__hint', text: on
        ? '演示模式已开启：全站隐藏余额、价格、充值与订单金额，试穿不扣费，适合演示与验收。'
        : '演示模式由服务端环境变量控制；关闭时按正常计费流程运行。' }),
    ]);
  }
}
