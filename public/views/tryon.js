import { api, getSessionId } from '../lib/api.js';
import { h, money, toast } from '../lib/dom.js';
import { createHotspots, regionsFor } from '../lib/hotspot.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 500;

const STAGE_TEXT = {
  queued: '排队中，马上轮到你',
  generating: '正在生成，请稍候',
  finalizing: '正在收尾，结果马上出来',
  success: '生成完成',
  failed: '生成失败',
};

export function renderTryon(root, ctx, productId) {
  const product = ctx.products.find((item) => item.id === productId);
  if (!product) {
    root.append(h('div', { class: 'empty' }, [
      h('p', { class: 'empty__title', text: '这件商品已经下架' }),
      h('button', { type: 'button', class: 'btn', text: '回到橱窗', onclick: () => ctx.onNavigate('shop') }),
    ]));
    return;
  }

  const state = {
    model: ctx.config.defaultModel ?? ctx.config.models[0]?.id ?? null,
    tier: ctx.config.defaultTier ?? ctx.config.models[0]?.tiers[0]?.id ?? null,
    fit: 'regular',
    person: null,
    prompt: '',
    order: null,
    job: null,
    poll: null,
  };

  const tierButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': '生成档位' });
  const modelSelect = h('select', { 'aria-label': '生成模型' });
  const fitButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': '版型' });
  const promptInput = h('textarea', { rows: 3, maxlength: String(MAX_PROMPT_CHARS), placeholder: '例如：稍微宽松一点，袖子短一些', 'aria-label': '补充要求' });
  const promptCounter = h('div', { class: 'counter', text: `0/${MAX_PROMPT_CHARS}` });
  const uploadPreview = h('img', { class: 'dropzone__preview', alt: '人物照片预览', hidden: true });
  const uploadError = h('p', { class: 'error-text', hidden: true });
  const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  const resultBody = h('div', { class: 'result' });
  const submitButton = h('button', { type: 'button', class: 'btn btn--primary', text: '开始试穿' });
  const actionPrice = h('span', { class: 'actionbar__amount' });
  const actionNote = h('span', { class: 'actionbar__note' });

  function currentTier() {
    const model = ctx.config.models.find((item) => item.id === state.model);
    return model?.tiers.find((tier) => tier.id === state.tier) ?? model?.tiers[0] ?? null;
  }

  function paintTiers() {
    const model = ctx.config.models.find((item) => item.id === state.model);
    tierButtons.replaceChildren();
    if (!model) return;
    for (const tier of model.tiers) {
      const active = tier.id === currentTier()?.id;
      tierButtons.append(h('button', {
        type: 'button',
        class: `segment${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        onclick: () => {
          state.tier = tier.id;
          paintTiers();
          paintAction();
        },
      }, [
        h('span', { class: 'segment__name' }, [
          h('span', { text: tier.label }),
          h('span', { class: 'segment__price', text: money(tier.priceCents) }),
        ]),
        h('span', { class: 'segment__meta', text: `${tier.quality === 'high' ? '高清' : '标准'}画质 · ${tier.size}` }),
      ]));
    }
  }

  function paintAction() {
    const tier = currentTier();
    actionPrice.textContent = tier ? money(tier.priceCents) : '—';
    actionNote.textContent = tier ? `单次试穿 · 余额 ${money(ctx.balanceCents)}` : '暂无可用模型';
    const busy = Boolean(state.order && state.order.status === 'pending');
    submitButton.disabled = busy || !tier || !state.person;
    submitButton.textContent = busy ? '生成中…' : '开始试穿';
  }

  function paintFits() {
    fitButtons.replaceChildren();
    for (const fit of ctx.config.fits ?? []) {
      const active = fit.id === state.fit;
      fitButtons.append(h('button', {
        type: 'button',
        class: `segment${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        text: fit.label,
        onclick: () => {
          state.fit = fit.id;
          paintFits();
        },
      }));
    }
  }

  async function acceptFile(file) {
    uploadError.hidden = true;
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      uploadError.textContent = '只支持 PNG / JPEG / WebP 图片';
      uploadError.hidden = false;
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      uploadError.textContent = '照片不能超过 8MB，换一张小一点的';
      uploadError.hidden = false;
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.person = reader.result;
      uploadPreview.src = state.person;
      uploadPreview.hidden = false;
      paintAction();
    };
    reader.onerror = () => {
      uploadError.textContent = '读取图片失败，请重试';
      uploadError.hidden = false;
    };
    reader.readAsDataURL(file);
  }

  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  function renderResult() {
    resultBody.replaceChildren();
    const order = state.order;
    if (!order) {
      resultBody.append(h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '还没有试穿结果' }),
        h('p', { text: '上传一张全身照，挑好档位，点“开始试穿”。' }),
      ]));
      return;
    }
    if (order.status === 'pending') {
      resultBody.append(h('div', { class: 'stage' }, [
        h('span', { class: 'spinner' }),
        h('span', { text: STAGE_TEXT[state.job?.stage] ?? STAGE_TEXT.generating }),
      ]));
      resultBody.append(h('p', { class: 'result__meta', text: '生成通常需要 20–60 秒，请不要关闭页面。' }));
      return;
    }
    if (order.status === 'failed') {
      resultBody.append(h('div', { class: 'stage' }, [
        h('span', { text: '生成失败' }),
      ]));
      resultBody.append(h('p', { class: 'error-text', text: order.errorMessage ?? '生成失败，费用已退回余额。' }));
      resultBody.append(h('button', { type: 'button', class: 'btn', text: '再试一次', onclick: () => submit() }));
      return;
    }
    const resultUrl = `/api/results/${order.resultFile}?k=${encodeURIComponent(order.resultToken ?? '')}`;
    const canvas = h('div', { class: 'canvas' }, [
      h('img', { src: resultUrl, alt: `${product.name} 的试穿效果`, loading: 'lazy' }),
    ]);
    resultBody.append(
      h('div', { class: 'result__head' }, [
        h('h3', { class: 'result__title', text: '试穿结果' }),
        h('span', { class: 'result__meta', text: `${ctx.config.models.find((model) => model.id === order.model)?.label ?? order.model} · ${order.tier}` }),
      ]),
      canvas,
      h('p', { class: 'ai-note', text: 'AI 生成效果仅供参考，实物以商品页面描述为准' }),
      h('div', { class: 'hotspot-bar', role: 'group', 'aria-label': '区域预览' }),
      h('div', { class: 'compare' }, [
        h('figure', {}, [h('img', { src: state.person, alt: '原始人物照片' }), h('figcaption', { text: '原图' })]),
        h('figure', {}, [h('img', { src: resultUrl, alt: '试穿效果' }), h('figcaption', { text: '试穿' })]),
      ]),
      h('div', { class: 'actionbar__price' }, [
        h('a', {
          class: 'btn btn--block',
          href: resultUrl,
          download: `${product.name}-试穿效果-AI生成.jpg`,
          text: '下载效果图（含 AI 标识）',
        }),
      ]),
    );
    const bar = resultBody.querySelector('.hotspot-bar');
    const regions = regionsFor(product.category);
    const hotspots = createHotspots(canvas, {
      regions,
      onChange: (regionId) => {
        for (const button of bar.children) button.classList.toggle('is-active', button.dataset.region === regionId);
      },
    });
    hotspots.setGarment(`/${product.image}`, product.name);
    for (const region of regions) {
      bar.append(h('button', {
        type: 'button',
        text: `${region.label}服装`,
        dataset: { region: region.id },
        onclick: () => hotspots.show(region),
      }));
    }
    resultBody.append(h('button', { type: 'button', class: 'btn btn--ghost btn--block', text: '关闭服装叠加', onclick: () => hotspots.hide() }));
  }

  async function pollJob(jobId) {
    stopPolling();
    state.poll = setInterval(async () => {
      try {
        const payload = await api(`/api/jobs/${jobId}`);
        state.job = payload;
        if (payload.status === 'success' || payload.status === 'failed') {
          stopPolling();
          const order = await api(`/api/orders/${state.order.id}`);
          state.order = order.order;
          await ctx.refreshBalance();
          renderResult();
          paintAction();
        }
      } catch {
        stopPolling();
        state.job = { status: 'failed', stage: 'failed' };
        renderResult();
        paintAction();
        toast('网络不稳定，结果可能仍在生成，可稍后在“我的”查看');
      }
    }, 1500);
  }

  /** 刷新页面后接管未完成的订单，继续轮询同一个任务。 */
  async function resumePendingOrder() {
    try {
      const payload = await api('/api/orders');
      const pending = payload.orders.find((order) => order.status === 'pending' && order.jobId);
      if (!pending) return;
      state.order = { ...pending, status: 'pending' };
      state.job = { status: 'queued', stage: 'queued' };
      renderResult();
      paintAction();
      pollJob(pending.jobId);
    } catch {
      /* 恢复失败不阻断手动提交 */
    }
  }

  async function submit() {
    if (!state.person) {
      toast('请先上传一张全身照');
      return;
    }
    const tier = currentTier();
    if (!tier) {
      toast('当前没有可用模型');
      return;
    }
    submitButton.disabled = true;
    try {
      const payload = await api('/api/orders', {
        method: 'POST',
        body: {
          sessionId: getSessionId(),
          productId: product.id,
          model: state.model,
          tier: tier.id,
          category: product.category,
          garmentType: product.garmentType,
          fit: state.fit,
          prompt: state.prompt.trim(),
          person: state.person,
        },
      });
      state.order = { id: payload.orderId, status: 'pending', model: state.model, tier: tier.id };
      state.job = { status: 'queued', stage: 'queued' };
      ctx.balanceCents = payload.balanceCents;
      ctx.onBalanceChanged(payload.balanceCents);
      renderResult();
      paintAction();
      pollJob(payload.jobId);
    } catch (error) {
      toast(error.message);
      submitButton.disabled = false;
    }
  }

  for (const model of ctx.config.models) {
    const cheapest = model.tiers.reduce((min, tier) => (min === null || tier.priceCents < min.priceCents ? tier : min), null);
    modelSelect.append(h('option', { value: model.id, text: `${model.label}（${money(cheapest?.priceCents ?? 0)} 起）` }));
  }
  modelSelect.value = state.model ?? '';
  modelSelect.addEventListener('change', () => {
    state.model = modelSelect.value;
    const model = ctx.config.models.find((item) => item.id === state.model);
    state.tier = model?.tiers[0]?.id ?? null;
    paintTiers();
    paintAction();
  });

  promptInput.addEventListener('input', () => {
    state.prompt = promptInput.value;
    promptCounter.textContent = `${[...state.prompt].length}/${MAX_PROMPT_CHARS}`;
  });

  fileInput.addEventListener('change', () => void acceptFile(fileInput.files?.[0]));

  const dropzone = h('div', { class: 'dropzone' }, [
    uploadPreview,
    h('p', { class: 'dropzone__title', text: '上传一张全身照，站着、正面、背景干净效果最好' }),
    h('div', { class: 'dropzone__actions' }, [
      h('button', { type: 'button', class: 'btn btn--sm', text: '拍照 / 相册', onclick: () => fileInput.click() }),
    ]),
    h('p', { class: 'field__hint', text: 'PNG / JPEG / WebP，不超过 8MB。照片只用于本次生成，不会长期保存。' }),
    uploadError,
    fileInput,
  ]);
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    void acceptFile(event.dataTransfer?.files?.[0]);
  });

  root.append(
    h('div', { class: 'tryon' }, [
      h('div', { class: 'tryon__left' }, [
        h('div', { class: 'card tryon__product' }, [
          h('img', { src: `/${product.image}`, alt: product.name }),
          h('div', {}, [
            h('h2', { text: product.name }),
            h('p', { text: product.subtitle ?? '' }),
            h('div', { class: 'tryon__tags' }, (product.tags ?? []).map((tag) => h('span', { class: 'tag', text: tag }))),
            h('p', { class: 'product__price', text: money(product.priceCents) }),
          ]),
        ]),
        h('div', { class: 'card form' }, [
          h('div', { class: 'field' }, [
            h('label', { class: 'field__label', for: 'model-select' }, ['生成模型']),
            modelSelect,
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'field__label' }, ['档位', h('span', { class: 'field__hint', text: '越贵越清晰' })]),
            tierButtons,
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'field__label' }, ['人物照片']),
            dropzone,
          ]),
          h('div', { class: 'field' }, [
            h('span', { class: 'field__label' }, ['版型']),
            fitButtons,
          ]),
          h('div', { class: 'field' }, [
            h('label', { class: 'field__label', for: 'extra-prompt' }, ['补充要求', h('span', { class: 'field__hint', text: '只能细化面料、版型或风格' })]),
            promptInput,
            promptCounter,
          ]),
        ]),
      ]),
      h('div', { class: 'tryon__right' }, [
        h('div', { class: 'card result' }, [resultBody]),
      ]),
    ]),
    h('div', { class: 'actionbar' }, [
      h('div', { class: 'actionbar__inner' }, [
        h('div', { class: 'actionbar__price' }, [actionPrice, actionNote]),
        submitButton,
      ]),
    ]),
  );

  promptInput.id = 'extra-prompt';
  modelSelect.id = 'model-select';
  submitButton.addEventListener('click', () => void submit());
  paintTiers();
  paintFits();
  paintAction();
  renderResult();
  void resumePendingOrder();
}
