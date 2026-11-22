import { api, getSessionId } from '../lib/api.js';
import { createCapsuleSelect, h, toast } from '../lib/dom.js';
import { SLOTS, SLOT_BY_KEY, defaultSubtype } from '../lib/garment-taxonomy.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 500;
const MAX_PIECES = 5;

const STAGE_TEXT = {
  queued: '排队中，马上轮到你',
  generating: '正在生成，请稍候',
  finalizing: '正在收尾，结果马上出来',
  success: '生成完成',
  failed: '生成失败',
};

const TAB_LABEL = { result: '结果', original: '原图', compare: '对比' };

/**
 * 搭配工作台：人物照 + 七个穿搭格子 + 开始试穿 + 结果区。
 * 路由 #/studio 直接进入；#/tryon/:id 通过 preset 预填单件后复用同一套界面。
 */
export function renderStudio(root, ctx, preset) {
  const state = {
    person: null,
    prompt: '',
    fit: 'regular',
    tab: 'result',
    order: null,
    job: null,
    poll: null,
    slots: createSlots(preset),
  };

  const slotsEl = h('div', { class: 'slots' });
  const hintEl = h('p', { class: 'studio__hint', hidden: true });
  const countEl = h('span', { class: 'studio__count' });
  const submitBtn = h('button', { type: 'button', class: 'btn btn--primary btn--lg', text: '开始试穿' });
  const demoNote = h('span', { class: 'field__hint', text: '演示模式 · 本次试穿不扣费' });
  const resultBody = h('div', { class: 'result' });

  const uploadPreview = h('img', { class: 'dropzone__preview', alt: '人物照片预览', hidden: true });
  const uploadError = h('p', { class: 'error-text', hidden: true });
  const personInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });

  const promptInput = h('textarea', { rows: 3, maxlength: String(MAX_PROMPT_CHARS), placeholder: '可选：补充面料、版型或风格要求' });
  const promptCounter = h('div', { class: 'counter', text: `0/${MAX_PROMPT_CHARS}` });

  function createSlots(seed) {
    const slots = {};
    for (const def of SLOTS) slots[def.key] = def.multi ? { items: [{ subtype: '', source: null }] } : { subtype: '', source: null };
    if (seed) applySeed(slots, seed);
    return slots;
  }

  function applySeed(slots, seed) {
    const def = SLOT_BY_KEY[seed.slot];
    if (!def) return;
    const subtype = seed.subtype || defaultSubtype(seed.slot);
    if (def.multi) slots[seed.slot].items = [{ subtype, source: seed.source }];
    else Object.assign(slots[seed.slot], { subtype, source: seed.source });
  }

  function dressActive() {
    return Boolean(state.slots.dress.source || state.slots.dress.subtype);
  }

  function piecesFromState() {
    const out = [];
    for (const def of SLOTS) {
      const st = state.slots[def.key];
      const items = def.multi ? st.items : [st];
      for (const item of items) {
        if (!item.source) continue;
        out.push({ slot: def.key, garmentType: item.subtype || defaultSubtype(def.key), source: item.source });
      }
    }
    return out;
  }

  function readImage(file, onOk) {
    uploadError.hidden = true;
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast('只支持 PNG / JPEG / WebP 图片');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('图片不能超过 8MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onOk(reader.result);
    reader.onerror = () => toast('读取图片失败，请重试');
    reader.readAsDataURL(file);
  }

  function sourceLabel(source) {
    if (!source) return '';
    if (source.kind === 'product') return '目录商品';
    if (source.kind === 'import') return '链接导入';
    return '本地上传';
  }

  function pieceElement(def, item, onChange) {
    const box = h('div', { class: 'slot__body' });

    const subtype = createCapsuleSelect({
      options: def.subtypes,
      value: item.subtype,
      placeholder: '选择子类',
      ariaLabel: `${def.label}子类`,
      onChange: (value) => {
        item.subtype = value;
        onChange();
      },
    });
    box.append(subtype.el);

    if (item.source) {
      const thumb = h('div', { class: 'piece__thumb' }, [
        h('img', { src: item.source.imageUrl || item.source.image || '', alt: '' }),
      ]);
      const remove = h('button', {
        type: 'button',
        class: 'piece__remove',
        'aria-label': `移除${def.label}单品`,
        text: '×',
        onclick: () => {
          item.source = null;
          onChange();
        },
      });
      box.append(h('div', { class: 'piece' }, [
        thumb,
        h('div', { class: 'piece__meta' }, [
          h('span', { class: 'piece__name', text: item.subtype || def.label }),
          h('span', { class: 'piece__source', text: sourceLabel(item.source) }),
        ]),
        remove,
      ]));
    } else {
      const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
      fileInput.addEventListener('change', () => readImage(fileInput.files?.[0], (dataUrl) => {
        item.source = { kind: 'upload', image: dataUrl };
        if (!item.subtype) item.subtype = defaultSubtype(def.key);
        onChange();
      }));
      box.append(
        h('button', {
          type: 'button',
          class: 'piece-empty',
          onclick: () => fileInput.click(),
        }, ['＋ 上传单品图']),
        fileInput,
      );
    }
    return box;
  }

  function buildSlot(def) {
    const st = state.slots[def.key];
    const disabled = def.key !== 'dress' && dressActive() && (def.key === 'top' || def.key === 'bottom');
    const cell = h('div', { class: `slot${disabled ? ' is-disabled' : ''}` });
    if (disabled) cell.setAttribute('aria-disabled', 'true');

    const head = h('div', { class: 'slot__head' }, [
      h('span', { class: 'slot__pill', text: def.label }),
      def.multi ? h('span', { class: 'slot__badge', text: def.hint }) : null,
    ]);
    cell.append(head);

    if (def.multi) {
      for (const item of st.items) cell.append(pieceElement(def, item, paint));
      if (st.items.length < def.max) {
        cell.append(h('button', {
          type: 'button',
          class: 'slot__add',
          text: '＋ 添加配饰',
          onclick: () => {
            st.items.push({ subtype: '', source: null });
            paint();
          },
        }));
      }
    } else {
      cell.append(pieceElement(def, st, paint));
    }
    if (st.source || (def.multi && st.items.some((item) => item.source))) cell.classList.add('is-filled');
    return cell;
  }

  function paintGrid() {
    if (dressActive()) {
      state.slots.top.source = null;
      state.slots.bottom.source = null;
    }
    slotsEl.replaceChildren(...SLOTS.map(buildSlot));
    const dress = dressActive();
    hintEl.hidden = !dress;
    hintEl.textContent = dress ? '已选择连衣裙：上衣与下装已自动禁用（二者互斥）。' : '';
  }

  function updateSubmit() {
    const pieces = piecesFromState();
    const busy = Boolean(state.order && state.order.status === 'pending');
    if (pieces.length > MAX_PIECES) {
      countEl.textContent = `已选 ${pieces.length} 件，超过上限 ${MAX_PIECES} 件`;
      countEl.classList.add('is-over');
    } else {
      countEl.textContent = `已选 ${pieces.length} 件单品（最多 ${MAX_PIECES} 件）`;
      countEl.classList.remove('is-over');
    }
    submitBtn.disabled = busy || !state.person || pieces.length === 0 || pieces.length > MAX_PIECES;
    submitBtn.textContent = busy ? '生成中…' : '开始试穿';
    demoNote.hidden = !ctx.demoMode;
  }

  function paint() {
    paintGrid();
    updateSubmit();
  }

  function paintPerson() {
    if (state.person) {
      uploadPreview.src = state.person;
      uploadPreview.hidden = false;
    } else {
      uploadPreview.hidden = true;
    }
    updateSubmit();
  }

  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  function paintResult() {
    resultBody.replaceChildren();
    const order = state.order;
    if (!order) {
      resultBody.append(h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '还没有试穿结果' }),
        h('p', { text: '上传全身照、挑好单品，点「开始试穿」。' }),
      ]));
      return;
    }
    if (order.status === 'pending') {
      resultBody.append(
        h('div', { class: 'stage' }, [
          h('span', { class: 'spinner' }),
          h('span', { text: STAGE_TEXT[state.job?.stage] ?? STAGE_TEXT.generating }),
        ]),
        h('p', { class: 'result__meta', text: '生成通常需要 20–60 秒，请不要关闭页面。' }),
      );
      return;
    }
    if (order.status === 'failed') {
      resultBody.append(
        h('div', { class: 'stage' }, [h('span', { text: '生成失败' })]),
        h('p', { class: 'error-text', text: order.errorMessage ?? '生成失败，本次不扣费。' }),
        h('button', { type: 'button', class: 'btn', text: '再试一次', onclick: () => void submit() }),
      );
      return;
    }
    const resultUrl = `/api/results/${order.resultFile}?k=${encodeURIComponent(order.resultToken ?? '')}`;
    const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': '查看方式' });
    for (const key of ['result', 'original', 'compare']) {
      tabs.append(h('button', {
        type: 'button',
        class: `segment${state.tab === key ? ' is-active' : ''}`,
        role: 'tab',
        'aria-selected': state.tab === key ? 'true' : 'false',
        text: TAB_LABEL[key],
        onclick: () => {
          state.tab = key;
          paintResult();
        },
      }));
    }

    let view;
    if (state.tab === 'original' && state.person) {
      view = h('div', { class: 'canvas' }, [h('img', { src: state.person, alt: '原始人物照片' })]);
    } else if (state.tab === 'compare' && state.person) {
      view = h('div', { class: 'compare' }, [
        h('figure', {}, [h('img', { src: state.person, alt: '原图' }), h('figcaption', { text: '原图' })]),
        h('figure', {}, [h('img', { src: resultUrl, alt: '试穿效果' }), h('figcaption', { text: '试穿' })]),
      ]);
    } else {
      view = h('div', { class: 'canvas' }, [h('img', { src: resultUrl, alt: '搭配试穿效果', loading: 'lazy' })]);
    }

    resultBody.append(
      h('div', { class: 'result__head' }, [
        h('h3', { class: 'result__title', text: '试穿结果' }),
        h('span', { class: 'result__meta', text: ctx.model ?? '' }),
      ]),
      tabs,
      view,
      h('p', { class: 'ai-note', text: 'AI 生成效果仅供参考，实物以商品页面描述为准' }),
      h('a', {
        class: 'btn btn--block',
        href: resultUrl,
        download: '搭配试穿-AI生成.jpg',
        text: '下载效果图（含 AI 标识）',
      }),
    );
  }

  function pollJob(jobId) {
    stopPolling();
    state.poll = setInterval(async () => {
      try {
        const payload = await api(`/api/jobs/${jobId}`);
        state.job = payload;
        if (payload.status === 'success' || payload.status === 'failed') {
          stopPolling();
          const res = await api(`/api/orders/${state.order.id}`);
          state.order = res.order;
          if (!ctx.demoMode) await ctx.refreshBalance();
          paintResult();
          updateSubmit();
        }
      } catch {
        stopPolling();
        state.job = { status: 'failed', stage: 'failed' };
        state.order = { ...state.order, status: 'failed', errorMessage: '网络中断，未能确认结果；可稍后在“订单与说明”查看。' };
        paintResult();
        updateSubmit();
        toast('网络不稳定，结果可能仍在生成，可稍后在“订单与说明”查看');
      }
    }, 1500);
  }

  async function submit() {
    const pieces = piecesFromState();
    if (!state.person) {
      toast('请先上传一张全身照');
      return;
    }
    if (pieces.length === 0) {
      toast('至少选择一件单品');
      return;
    }
    if (pieces.length > MAX_PIECES) {
      toast(`最多 ${MAX_PIECES} 件单品`);
      return;
    }
    submitBtn.disabled = true;
    try {
      const body = {
        sessionId: getSessionId(),
        person: state.person,
        fit: state.fit,
        prompt: state.prompt.trim(),
        pieces,
      };
      if (ctx.model) body.model = ctx.model;
      const payload = await api('/api/orders', { method: 'POST', body });
      const orderId = payload.order?.id ?? payload.orderId;
      state.order = { id: orderId, status: 'pending' };
      state.job = { status: 'queued', stage: 'queued' };
      if (typeof payload.balanceCents === 'number') ctx.onBalanceChanged(payload.balanceCents);
      state.tab = 'result';
      paintResult();
      updateSubmit();
      pollJob(payload.jobId);
      resultBody.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      toast(error.message);
      updateSubmit();
    }
  }

  // ---- 事件绑定 ----
  personInput.addEventListener('change', () => readImage(personInput.files?.[0], (dataUrl) => {
    state.person = dataUrl;
    paintPerson();
  }));

  const dropzone = h('div', { class: 'dropzone' }, [
    uploadPreview,
    h('p', { class: 'dropzone__title', text: '上传一张全身照，正面站立、背景干净效果最好' }),
    h('div', { class: 'dropzone__actions' }, [
      h('button', { type: 'button', class: 'btn btn--sm', text: '拍照 / 相册', onclick: () => personInput.click() }),
    ]),
    h('p', { class: 'field__hint', text: 'PNG / JPEG / WebP，不超过 8MB；照片只用于本次生成。' }),
    uploadError,
    personInput,
  ]);
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
    readImage(event.dataTransfer?.files?.[0], (dataUrl) => {
      state.person = dataUrl;
      paintPerson();
    });
  });

  const fitButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': '版型' });
  for (const fit of ctx.config.fits ?? []) {
    fitButtons.append(h('button', {
      type: 'button',
      class: `segment${fit.id === state.fit ? ' is-active' : ''}`,
      'aria-pressed': fit.id === state.fit ? 'true' : 'false',
      dataset: { fit: fit.id },
      text: fit.label,
      onclick: () => {
        state.fit = fit.id;
        for (const btn of fitButtons.children) {
          const on = btn.dataset.fit === fit.id;
          btn.classList.toggle('is-active', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
      },
    }));
  }

  promptInput.addEventListener('input', () => {
    state.prompt = promptInput.value;
    promptCounter.textContent = `${[...state.prompt].length}/${MAX_PROMPT_CHARS}`;
  });
  submitBtn.addEventListener('click', () => void submit());

  root.append(
    h('section', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '搭配工作台' }),
      h('p', { class: 'page-sub', text: '上传人物照，从七个格子里挑单品组合成一套，再一键试穿。' }),
    ]),
    h('div', { class: 'studio' }, [
      h('div', { class: 'studio__top' }, [
        h('section', { class: 'card' }, [
          h('h2', { class: 'section__title', text: '人物照片' }),
          dropzone,
        ]),
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'section__title' }, ['穿搭格子', h('span', { class: 'section__hint', text: '每个格子：品类 · 子类 · 单品图' })]),
        hintEl,
        h('div', { class: 'spacer-sm' }),
        slotsEl,
      ]),
      h('section', { class: 'card studio__options' }, [
        h('div', { class: 'field' }, [
          h('span', { class: 'field__label', text: '版型' }),
          fitButtons,
        ]),
        h('div', { class: 'field' }, [
          h('label', { class: 'field__label', for: 'studio-prompt', text: '补充要求' }),
          promptInput,
          promptCounter,
        ]),
      ]),
      h('section', { class: 'card' }, [
        h('div', { class: 'studio__submit' }, [
          countEl,
          demoNote,
          h('span', { class: 'push-end' }, [submitBtn]),
        ]),
      ]),
      h('section', { class: 'card' }, [
        h('h2', { class: 'section__title', text: '试穿结果' }),
        resultBody,
      ]),
    ]),
  );
  promptInput.id = 'studio-prompt';

  paintPerson();
  paint();
  paintResult();
}
