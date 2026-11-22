import { api } from '../lib/api.js';
import { createCapsuleSelect, h, toast } from '../lib/dom.js';

const SOURCE_LABEL = { taobao: '淘宝', jd: '京东', pdd: '拼多多', douyin: '抖音' };

/**
 * 设置页：模型统一在这里选择（工作台/试穿页不再出现模型选择），
 * 同时展示网关连通状态、各来源 cookie 是否配置（只显示布尔值），以及演示模式说明。
 */
export function renderSettings(root, ctx) {
  const body = h('div', { class: 'settings' });

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
      if (typeof ctx.settings.demoMode === 'boolean') ctx.demoMode = ctx.settings.demoMode;
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
    const rows = Object.keys(SOURCE_LABEL).map((key) => {
      const on = known ? Boolean(sources[key]) : false;
      return h('div', { class: 'kv' }, [
        h('span', { class: 'kv__label', text: SOURCE_LABEL[key] }),
        h('span', { class: `status-pill ${on ? 'is-on' : 'is-off'}`, text: known ? (on ? '已配置' : '未配置') : '未知' }),
      ]);
    });
    return h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '来源登录状态' }),
      ...rows,
      h('p', { class: 'field__hint', text: '仅显示是否已配置，不会展示任何 cookie 内容；京东与抖音免登录。' }),
    ]);
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
