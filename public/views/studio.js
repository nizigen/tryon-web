import { api, getSessionId } from '../lib/api.js';
import { showDialog } from '../lib/dialog.js';
import { createCascadeSelect, h, toast } from '../lib/dom.js';
import { SLOTS, SLOT_BY_KEY, defaultSubtype } from '../lib/garment-taxonomy.js';
import { icon } from '../lib/icons.js';
import { loadDefaultPerson } from '../lib/person.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 500;
const MAX_PIECES = 5;
/** 1.5s 一轮，160 轮约 4 分钟：比单次生成的最长等待略长，避免提前放弃。 */
const POLL_MAX_TICKS = 160;
/** 服务端 MAX_BODY_BYTES = 24MiB；这里按 dataURL 字符数留 10% 余量做前端预判。 */
const MAX_PAYLOAD_CHARS = Math.floor(24 * 1024 * 1024 * 0.9);

const STAGE_TEXT = {
  queued: '排队中，马上轮到你',
  generating: '正在生成，请稍候',
  finalizing: '正在收尾，结果马上出来',
  success: '生成完成',
  failed: '生成失败',
};

const TAB_LABEL = { result: '结果', original: '原图', compare: '对比' };

/** 一级胶囊的大类目录：七大类各自带上自己的子类，供二级胶囊联动使用。 */
const GROUPS = SLOTS.map((def) => ({
  value: def.key,
  label: def.label,
  options: def.subtypes.map((name) => ({ value: name, label: name })),
}));

/**
 * 搭配工作台：人物照 + 单品条目列表 + 开始试穿 + 结果区。
 * 路由 #/studio 直接进入；#/tryon/:id 与导入页通过 preset 预填一个条目。
 *
 * 条目状态全部存在 state.pieces 里（[{ slot, subtype, source }]），
 * 渲染只是把这份对象投影成 DOM，任何交互都先改对象再重绘，不从 DOM 反推。
 */
export function renderStudio(root, ctx, preset) {
  const preparedPerson = ctx.pendingPerson;
  ctx.pendingPerson = null;
  const state = {
    person: preparedPerson?.image ?? null,
    /** true 表示人物照是内置模特（还没换成自己的），仅用于提示文案。 */
    personIsDefault: Boolean(preparedPerson?.isDefault),
    prompt: '',
    fit: 'regular',
    tab: 'result',
    order: null,
    job: null,
    poll: null,
    pieces: createPieces(preset),
    // 衣橱弹层的临时状态：open 为 false 时弹层节点会被移除。
    picker: { open: false, index: -1, items: [], loading: false, error: '' },
    // 商品链接面板的临时状态，index 指向正在填写的条目。
    link: { index: -1, url: '', loading: false, source: null, error: '' },
  };

  const entriesEl = h('div', { class: 'slots' });
  const hintEl = h('p', { class: 'studio__hint', hidden: true });
  const countEl = h('span', { class: 'studio__count' });
  const pieceCountTag = h('span', { class: 'tag' });
  const submitBtn = h('button', { type: 'button', class: 'btn btn--primary btn--lg btn--block', text: '生成试穿图' });
  const submitSpinner = h('span', { class: 'spinner', hidden: true });
  const submitStatusText = h('span');
  const submitStatus = h('span', { class: 'studio__busy', hidden: true }, [submitSpinner, submitStatusText]);
  const demoNote = h('span', { class: 'field__hint', text: '演示模式 · 本次试穿不扣费' });
  const resultBody = h('div', { class: 'result' });

  const uploadPreview = h('img', { class: 'dropzone__preview', alt: '人物照片预览', hidden: true });
  const uploadError = h('p', { class: 'error-text', hidden: true });
  const personInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  const personBtn = h('button', { type: 'button', class: 'btn btn--sm', text: '拍照 / 相册' });

  const promptInput = h('textarea', { rows: 3, maxlength: String(MAX_PROMPT_CHARS), placeholder: '可选：补充面料、版型或风格要求' });
  const promptCounter = h('div', { class: 'counter', text: `0/${MAX_PROMPT_CHARS}` });

  const addBtn = h('button', {
    type: 'button',
    class: 'btn btn--sm',
    'aria-label': '添加一个单品条目',
  }, [icon('plus'), '添加单品']);

  /** 默认一个「上衣」条目；preset 进来时替换成被预填的那一件。 */
  /** 衣橱多选带进来的整套单品；单人深链接仍按单件 preset 处理。 */
  function createPieces(seed) {
    const first = { slot: 'top', subtype: '', source: null };
    const list = Array.isArray(seed) ? seed : seed ? [seed] : [];
    const pieces = list
      .filter((piece) => piece && SLOT_BY_KEY[piece.slot])
      .slice(0, MAX_PIECES)
      .map((piece) => ({ slot: piece.slot, subtype: piece.subtype || '', source: piece.source ?? null }));
    return pieces.length ? pieces : [first];
  }

  function piecesFromState() {
    return state.pieces
      .filter((piece) => piece.source)
      .map((piece) => ({
        slot: piece.slot,
        garmentType: piece.subtype || defaultSubtype(piece.slot),
        source: piece.source,
      }));
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
    if (source.kind === 'wardrobe') return '衣橱单品';
    return '本地上传';
  }

  /** 衣橱交接只带 wardrobeId，缩略图回落到受控的图片路由。 */
  function sourceImage(source) {
    if (!source) return '';
    if (source.imageUrl) return source.imageUrl;
    if (source.image) return source.image;
    if (source.wardrobeId) return `/api/wardrobe/${encodeURIComponent(source.wardrobeId)}/image`;
    return '';
  }

  /**
   * 选了图却没选大类时，落到第一个还没被占用的格子；
   * 全部占满（配饰可两件）时退回上衣。后端按格子限件，这里先替用户避开冲突。
   */
  function ensureSlot(piece) {
    if (piece.slot) return piece;
    const used = new Set(state.pieces.map((item) => item.slot).filter(Boolean));
    piece.slot = SLOTS.find((def) => !used.has(def.key))?.key ?? 'top';
    return piece;
  }

  // ---------------- 衣橱弹层 ----------------

  const pickerHost = h('div', { class: 'modal-host', hidden: true });
  const pickerBody = h('div', { class: 'modal__content', 'aria-live': 'polite' });
  let dismissPicker = null;

  function closePicker() {
    dismissPicker?.();
  }

  async function openPicker(index) {
    state.picker = { open: true, index, items: [], loading: true, error: '' };
    const closeButton = h('button', { type: 'button', class: 'icon-button', 'aria-label': '关闭衣橱选择', onclick: closePicker }, [icon('close')]);
    const panel = h('section', { class: 'modal picker-panel' }, [
      h('div', { class: 'modal__head' }, [h('h2', { class: 'modal__title', text: '从衣橱选单品' }), closeButton]),
      pickerBody,
    ]);
    root.append(pickerHost);
    renderPicker();
    dismissPicker = showDialog(pickerHost, panel, {
      label: '从衣橱选择单品',
      onClose: () => { state.picker.open = false; dismissPicker = null; pickerHost.remove(); },
    });
    const request = state.picker;
    try {
      const payload = await api('/api/wardrobe');
      if (request !== state.picker || !root.isConnected) return;
      state.picker.items = Array.isArray(payload.items) ? payload.items : [];
    } catch (error) {
      if (request !== state.picker) return;
      state.picker.error = error.message;
    }
    state.picker.loading = false;
    if (state.picker.open) renderPicker();
  }

  function renderPicker() {
    pickerBody.replaceChildren();
    if (state.picker.loading) {
      pickerBody.append(h('p', { class: 'field__hint', text: '正在读取衣橱…' }));
      return;
    }
    if (state.picker.error) {
      pickerBody.append(h('p', { class: 'error-text', text: state.picker.error }), h('button', { type: 'button', class: 'btn', text: '重试', onclick: () => void reloadPicker() }));
      return;
    }
    if (!state.picker.items.length) {
      pickerBody.append(h('div', { class: 'empty' }, [h('p', { class: 'empty__title', text: '衣橱还是空的' }), h('p', { text: '先到「我的衣橱」上传单品或从商品链接导入。' })]));
      return;
    }
    pickerBody.append(h('p', { class: 'field__hint', text: '选择一件单品，图片和类目会一起带入当前条目。' }), h('div', { class: 'picker__grid' }, state.picker.items.map((item) => {
      const label = item.name || '未命名单品';
      return h('button', { type: 'button', class: 'picker__item', 'aria-label': '选择' + label, onclick: () => applyWardrobeItem(item) }, [
        h('img', { src: item.imageUrl, alt: '' }),
        h('span', { class: 'piece__name', text: label }),
        h('span', { class: 'piece__source', text: [SLOT_BY_KEY[item.category]?.label, item.subtype].filter(Boolean).join(' / ') }),
      ]);
    })));
  }

  async function reloadPicker() {
    const index = state.picker.index;
    closePicker();
    await openPicker(index);
  }

  function applyWardrobeItem(item) {
    const index = state.picker.index;
    const piece = state.pieces[index];
    if (!piece) return;
    const def = SLOT_BY_KEY[item.category];
    piece.slot = def ? def.key : 'top';
    piece.subtype = def?.subtypes.includes(item.subtype) ? item.subtype : '';
    piece.source = {
      kind: 'wardrobe',
      wardrobeId: item.id,
      imageUrl: item.imageUrl,
      name: item.name || '',
    };
    closePicker();
    paint();
    entriesEl.children[index]?.querySelector('summary')?.focus({ preventScroll: true });
  }

  // ---------------- 商品链接面板 ----------------

  function toggleLink(index) {
    const same = state.link.index === index;
    state.link = same
      ? { index: -1, url: '', loading: false, source: null, error: '' }
      : { index, url: '', loading: false, source: null, error: '' };
    paint();
  }

  async function parseLink(index) {
    const url = state.link.url;
    if (!url || state.link.loading) return;
    state.link.loading = true;
    state.link.error = '';
    state.link.source = null;
    paint();
    try {
      const payload = await api('/api/sources', { method: 'POST', body: { url } });
      state.link.source = payload.source ?? null;
      if (!state.link.source) state.link.error = '没有解析到商品图，换一个链接试试';
    } catch (error) {
      state.link.error = error.message;
    }
    state.link.loading = false;
    if (state.link.index === index) paint();
  }

  function applyLinkImage(piece, image) {
    const source = state.link.source;
    if (!source) return;
    ensureSlot(piece);
    piece.source = {
      kind: 'import',
      sourceId: source.id,
      sourceIndex: image.index,
      name: source.title || '',
      imageUrl: `/api/sources/${source.id}/${image.index}`,
    };
    state.link = { index: -1, url: '', loading: false, source: null, error: '' };
    paint();
  }

  function buildLinkPanel(index, piece) {
    const box = h('div', { class: 'slot__body' });
    const input = h('input', {
      type: 'text',
      value: state.link.url,
      placeholder: '粘贴淘宝 / 京东 / 拼多多 / 抖音商品链接',
      'aria-label': `第 ${index + 1} 个单品的商品链接`,
    });
    const parseBtn = h('button', {
      type: 'button',
      class: 'btn btn--sm btn--primary',
      text: state.link.loading ? '解析中…' : '解析',
      'aria-label': `解析第 ${index + 1} 个单品的商品链接`,
    });
    parseBtn.disabled = state.link.loading || !state.link.url;

    input.addEventListener('input', () => {
      state.link.url = input.value.trim();
      parseBtn.disabled = state.link.loading || !state.link.url;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !parseBtn.disabled) {
        event.preventDefault();
        void parseLink(index);
      }
    });
    parseBtn.addEventListener('click', () => void parseLink(index));

    box.append(h('div', { class: 'inline-field' }, [input, parseBtn]));
    if (state.link.error) box.append(h('p', { class: 'error-text', text: state.link.error }));
    if (state.link.source) {
      const images = state.link.source.images ?? [];
      if (images.length === 0) {
        box.append(h('p', { class: 'field__hint', text: '这个链接里没有可用的商品图。' }));
      } else {
        const grid = h('div', { class: 'picker__grid' });
        for (const image of images.slice(0, 12)) {
          const button = h('button', {
            type: 'button',
            class: 'picker__item',
            'aria-label': `选择第 ${image.index + 1} 张商品图`,
          }, [
            h('img', { src: `/api/sources/${state.link.source.id}/${image.index}`, alt: `商品图 ${image.index + 1}` }),
          ]);
          button.addEventListener('click', () => applyLinkImage(piece, image));
          grid.append(button);
        }
        box.append(grid);
      }
    }
    return box;
  }

  // ---------------- 条目 ----------------

  function buildPiece(piece, index) {
    const def = SLOT_BY_KEY[piece.slot];
    const card = h('div', { class: `slot${piece.source ? ' is-filled' : ''}` });

    const removeBtn = h('button', {
      type: 'button',
      class: 'piece__remove',
      text: '×',
      'aria-label': `删除第 ${index + 1} 个单品`,
    });
    removeBtn.disabled = state.pieces.length <= 1;
    removeBtn.addEventListener('click', () => {
      if (state.pieces.length <= 1) return;
      state.pieces.splice(index, 1);
      // 删掉靠前的条目会让后面的下标整体前移，链接面板指向的条目要跟着挪，否则会挂到别的单品上。
      if (state.link.index === index) state.link = { index: -1, url: '', loading: false, source: null, error: '' };
      else if (state.link.index > index) state.link.index -= 1;
      paint();
    });

    const hint = h('span', { class: 'field__hint', text: def?.hint ?? '先选大类，再挑单品图' });
    if (piece.source) hint.hidden = true;

    if (!piece.source) {
      card.append(h('div', { class: 'piece-head' }, [
        h('span', { class: 'slot__pill', text: `单品 ${index + 1}` }),
        hint,
        h('span', { class: 'push-end' }, [removeBtn]),
      ]));
    }

    const cascade = createCascadeSelect({
      groups: GROUPS,
      value: piece.slot,
      subValue: piece.subtype,
      placeholder: '选择大类',
      subPlaceholder: '选择子类',
      ariaLabel: `第 ${index + 1} 个单品`,
      onChange: (slot, subtype) => {
        piece.slot = slot;
        piece.subtype = subtype;
        // 只改文案与计数，不重建条目：重建会把刚点过的胶囊换成新节点，键盘焦点会丢。
        const nextDef = SLOT_BY_KEY[slot];
        hint.textContent = nextDef?.hint ?? '先选大类，再挑单品图';
        hint.hidden = Boolean(piece.source);
        card.classList.toggle('is-filled', Boolean(piece.source));
        updateSubmit();
      },
    });

    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    fileInput.addEventListener('change', () => readImage(fileInput.files?.[0], (dataUrl) => {
      ensureSlot(piece);
      piece.source = { kind: 'upload', image: dataUrl };
      paint();
    }));
    // 同一个文件重选一次不会再触发 change，选完就把值清掉。
    fileInput.addEventListener('click', () => {
      fileInput.value = '';
    });

    const editor = h('div', { class: 'piece-editor' }, [
      cascade.el,
      h('div', { class: 'inline-field' }, [
        h('button', {
          type: 'button',
          class: 'btn btn--sm',
          text: '上传',
          'aria-label': `上传第 ${index + 1} 个单品的图片`,
          onclick: () => fileInput.click(),
        }),
        h('button', {
          type: 'button',
          class: 'btn btn--sm',
          text: '从衣橱选',
          'aria-label': `从衣橱选择第 ${index + 1} 个单品`,
          onclick: () => void openPicker(index),
        }),
        h('button', {
          type: 'button',
          class: 'btn btn--sm',
          text: '商品链接',
          'aria-label': `用商品链接添加第 ${index + 1} 个单品`,
          onclick: () => toggleLink(index),
        }),
        fileInput,
      ]),
    ]);

    if (piece.source) {
      const clearBtn = h('button', {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        text: '清空图片',
        'aria-label': `清除第 ${index + 1} 个单品的图片`,
      });
      clearBtn.addEventListener('click', () => {
        piece.source = null;
        paint();
      });
      const details = h('details', { class: 'piece-details piece-details--compact', open: state.link.index === index }, [
        h('summary', { class: 'piece', title: '展开以更换图片或类目' }, [
          h('span', { class: 'piece__thumb' }, [h('img', { src: sourceImage(piece.source), alt: '' })]),
          h('span', { class: 'piece__meta' }, [
            h('span', { class: 'piece__name', text: piece.source.name || piece.subtype || def?.label || '已选单品' }),
            h('span', { class: 'piece__source', text: `${def?.label ?? '单品'} / ${sourceLabel(piece.source)}` }),
            h('span', { class: 'piece__edit-label', text: '更换图片或类目' }),
          ]),
        ]),
        editor,
        clearBtn,
      ]);
      if (state.link.index === index) details.append(buildLinkPanel(index, piece));
      card.append(details, removeBtn);
    } else {
      card.append(editor);
      if (state.link.index === index) card.append(buildLinkPanel(index, piece));
    }

    return card;
  }

  function paintEntries() {
    entriesEl.replaceChildren(...state.pieces.map(buildPiece));
    addBtn.disabled = state.pieces.length >= MAX_PIECES;
    const hasDress = state.pieces.some((piece) => piece.slot === 'dress' && piece.source);
    const hasTopOrBottom = state.pieces.some((piece) => (piece.slot === 'top' || piece.slot === 'bottom') && piece.source);
    hintEl.hidden = !(hasDress && hasTopOrBottom);
    hintEl.textContent = hintEl.hidden ? '' : '连衣裙与上衣 / 下装互斥：提交前请去掉其中一边。';
  }

  /** 估算提交体大小：dataURL 已膨胀 4/3，服务端请求上限是 24MiB。 */
  function payloadBytes(pieces) {
    const dataUrlLength = (value) => (typeof value === 'string' ? value.length : 0);
    let total = dataUrlLength(state.person);
    for (const piece of pieces) {
      const source = piece.source ?? {};
      total += dataUrlLength(source.image);
    }
    return total;
  }

  function updateSubmit() {
    const pieces = piecesFromState();
    pieceCountTag.textContent = `${pieces.length} 件单品`;
    const busy = Boolean(state.order && state.order.status === 'pending');
    if (pieces.length > MAX_PIECES) {
      countEl.textContent = `已选 ${pieces.length} 件，超过上限 ${MAX_PIECES} 件`;
      countEl.classList.add('is-over');
    } else {
      countEl.textContent = `已选 ${pieces.length} 件单品（最多 ${MAX_PIECES} 件）`;
      countEl.classList.remove('is-over');
    }
    // 服务端请求上限 24MiB；上传图各自限 8MiB，五件叠起来会先撞总量限制。
    // 提前在这里挡住，比让用户等一次 413 好。
    const tooHeavy = payloadBytes(pieces) > MAX_PAYLOAD_CHARS;
    if (tooHeavy) {
      countEl.textContent = '这几张图加起来太大了，请换更小的图或减少单品';
      countEl.classList.add('is-over');
    }
    submitBtn.disabled = busy || !state.person || pieces.length === 0 || pieces.length > MAX_PIECES || tooHeavy;
    submitBtn.textContent = busy ? '生成中…' : '生成试穿图';
    // 按钮旁同步显示转圈与阶段：只在结果区转圈时，首屏看着像「完全不转」。
    submitStatus.hidden = !busy;
    submitSpinner.hidden = !busy;
    submitStatusText.textContent = busy ? (STAGE_TEXT[state.job?.stage] ?? STAGE_TEXT.generating) : '';
    demoNote.hidden = !ctx.demoMode;
  }

  function paint() {
    paintEntries();
    updateSubmit();
  }

  function paintPerson() {
    if (state.person) {
      uploadPreview.src = state.person;
      uploadPreview.hidden = false;
      personBtn.textContent = state.personIsDefault ? '换成我的照片' : '更换照片';
    } else {
      uploadPreview.hidden = true;
      personBtn.textContent = '上传全身照';
    }
    dropzone.classList.toggle('has-image', Boolean(state.person));
    dropzone.querySelector('.dropzone__title').textContent = state.personIsDefault
      ? '内置模特'
      : state.person ? '你的照片' : '正面全身照，站姿自然效果更好';
    if (!state.order) paintResult();
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
      if (state.person) {
        resultBody.append(
          h('div', { class: 'canvas' }, [
            h('img', { src: state.person, alt: '当前人物原图，尚未生成试穿结果' }),
            h('span', { class: 'canvas__label', text: state.personIsDefault ? '内置模特 · 原图' : '你的照片 · 原图' }),
          ]),
          h('div', { class: 'preview-actions' }, [
            h('p', { text: '选好单品后，点右侧「生成试穿图」。' }),
            h('a', { class: 'btn btn--sm', href: '#/wardrobe', text: '换几件单品' }),
          ]),
        );
      } else {
        resultBody.append(h('div', { class: 'empty' }, [
          icon('image'),
          h('p', { class: 'empty__title', text: '先选一张人物照片' }),
          h('p', { text: '上传全身照或使用内置模特，再挑几件单品。' }),
        ]));
      }
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
      view = h('div', { class: 'canvas' }, [h('img', { src: resultUrl, alt: '搭配试穿效果' })]);
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
    let ticks = 0;
    state.poll = setInterval(async () => {
      // 用户切走页面后 root 会从文档里摘掉：不停下来就会一直轮询到进程退出。
      if (!root.isConnected) {
        stopPolling();
        return;
      }
      ticks += 1;
      if (ticks > POLL_MAX_TICKS) {
        stopPolling();
        toast('等待超时，结果可能仍在生成，可稍后在“订单与说明”查看');
        return;
      }
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
        } else {
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
      resultBody.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
      toast(error.message);
      updateSubmit();
    }
  }

  // ---- 事件绑定 ----
  personInput.addEventListener('change', () => readImage(personInput.files?.[0], (dataUrl) => {
    state.person = dataUrl;
    state.personIsDefault = false;
    paintPerson();
  }));

  const dropzone = h('div', { class: 'dropzone' }, [
    uploadPreview,
    h('div', { class: 'dropzone__meta' }, [
      h('p', { class: 'dropzone__title', text: '默认使用内置模特；换成自己的正面全身照效果更贴近你' }),
      h('div', { class: 'dropzone__actions' }, [personBtn]),
      h('p', { class: 'field__hint', text: 'PNG / JPEG / WebP，不超过 8MB' }),
      uploadError,
    ]),
    personInput,
  ]);
  personBtn.addEventListener('click', () => personInput.click());
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
      state.personIsDefault = false;
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

  addBtn.addEventListener('click', () => {
    if (state.pieces.length >= MAX_PIECES) return;
    state.pieces.push({ slot: '', subtype: '', source: null });
    paint();
  });

  promptInput.addEventListener('input', () => {
    state.prompt = promptInput.value;
    promptCounter.textContent = `${[...state.prompt].length}/${MAX_PROMPT_CHARS}`;
  });
  submitBtn.addEventListener('click', () => void submit());

  root.append(
    h('section', { class: 'page-head' }, [
      h('div', {}, [
        h('h1', { class: 'page-title', text: '试穿工作台' }),
        h('p', { class: 'page-sub', text: '选好人物与单品，看看这套衣服穿在身上的样子。' }),
      ]),
      h('div', { class: 'page-actions' }, [
        h('button', { type: 'button', class: 'btn', text: '去衣橱挑单品', onclick: () => ctx.onNavigate('wardrobe') }),
      ]),
    ]),
    h('div', { class: 'studio' }, [
      h('div', { class: 'studio__preview' }, [
        h('section', { class: 'card' }, [
          h('div', { class: 'card__head' }, [
            h('h2', { class: 'section__title', text: '试穿效果' }),
            pieceCountTag,
          ]),
          resultBody,
        ]),
      ]),
      h('div', { class: 'studio__controls' }, [
        h('section', { class: 'card' }, [
          h('div', { class: 'card__head' }, [
            h('div', { class: 'card__heading' }, [
              h('h2', { class: 'section__title', text: '试穿人物' }),
            ]),
          ]),
          dropzone,
        ]),
        h('section', { class: 'card' }, [
          h('div', { class: 'card__head' }, [
            h('div', { class: 'card__heading' }, [
              h('h2', { class: 'section__title', text: '这一套怎么穿' }),
            ]),
            h('span', { class: 'push-end' }, [addBtn]),
          ]),
          hintEl,
          entriesEl,
        ]),
        h('section', { class: 'card' }, [
          h('div', { class: 'studio__options' }, [
            h('div', { class: 'field' }, [
              h('span', { class: 'field__label', text: '版型' }),
              fitButtons,
            ]),
          ]),
          h('details', { class: 'studio__advanced' }, [
            h('summary', { text: '补充要求（选填）' }),
            h('div', { class: 'field' }, [h('label', { class: 'field__label', for: 'studio-prompt', text: '希望保留或调整的细节' }), promptInput, promptCounter]),
          ]),
        ]),
        h('section', { class: 'card studio__submit-card' }, [
          h('div', { class: 'studio__submit' }, [
            h('div', { class: 'studio__submit-info' }, [countEl, demoNote]),
            h('span', { class: 'push-end' }, [submitStatus, submitBtn]),
          ]),
        ]),
        h('p', { class: 'studio__legal' }, [icon('shield'), '照片只用于本次生成。AI 效果仅供参考；生成失败全额退回。']),
      ]),
    ]),
  );
  promptInput.id = 'studio-prompt';

  paintPerson();
  paint();
  paintResult();

  // 内置模特：默认就把人物照填好，用户一进来就能直接点「开始试穿」。
  void loadDefaultPerson().then((dataUrl) => {
    if (!dataUrl || state.person || !root.isConnected) return;
    state.person = dataUrl;
    state.personIsDefault = true;
    paintPerson();
  });
}
