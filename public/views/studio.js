import { api, getSessionId } from '../lib/api.js';
import { showDialog } from '../lib/dialog.js';
import { createCascadeSelect, h, toast } from '../lib/dom.js';
import { SLOTS, SLOT_BY_KEY, defaultSubtype } from '../lib/garment-taxonomy.js';
import { icon } from '../lib/icons.js';
import { loadDefaultPerson } from '../lib/person.js';
import { createLayerSelect } from '../lib/wardrobe-dialogs.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 500;
const MAX_PIECES = 5;
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
  const studioUnsupported = ['idm/idm-vton', 'comfyui/foxbaze-tryon'].includes(ctx.model);
  const state = {
    person: preparedPerson?.image ?? null,
    /** true 表示人物照是内置模特（还没换成自己的），仅用于提示文案。 */
    personIsDefault: Boolean(preparedPerson?.isDefault),
    prompt: '',
    fit: 'regular',
    photographyMode: ctx.pendingPhotographyMode === 'studio' && !studioUnsupported ? 'studio' : 'preserve',
    studioPreset: ctx.config.defaultStudioPreset ?? 'clean-white-seamless',
    posePresets: [],
    poseSelectionTouched: false,
    results: [],
    batchIndex: 0,
    batchTotal: 0,
    batchMode: null,
    batchStudioPreset: null,
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
  ctx.pendingPhotographyMode = null;

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
  const liveStatus = h('p', {
    class: 'visually-hidden',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
  });

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
    const first = { slot: 'top', subtype: '', layer: 'auto', source: null };
    const list = Array.isArray(seed) ? seed : seed ? [seed] : [];
    const pieces = list
      .filter((piece) => piece && SLOT_BY_KEY[piece.slot])
      .slice(0, MAX_PIECES)
      .map((piece) => ({ slot: piece.slot, subtype: piece.subtype || '', layer: piece.layer ?? 'auto', source: piece.source ?? null }));
    return pieces.length ? pieces : [first];
  }

  function piecesFromState() {
    return state.pieces
      .filter((piece) => piece.source)
      .map((piece) => ({
        slot: piece.slot,
        garmentType: piece.subtype || defaultSubtype(piece.slot),
        layer: piece.layer ?? 'auto',
        source: piece.source,
      }));
  }

  function recommendedPoses(pieces = piecesFromState()) {
    const slots = new Set(pieces.map((piece) => piece.slot));
    if (slots.has('outer')) return ['contrapposto', 'hand-behind-head', 'over-shoulder'];
    if (slots.has('dress')) return ['contrapposto', 'duck-sit', 'crouch-chin'];
    return ['contrapposto', 'hand-behind-head', 'over-shoulder'];
  }

  function poseById(id) {
    return (ctx.config.posePresets ?? []).find((pose) => pose.id === id) ?? null;
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
    piece.layer = item.layer ?? 'auto';
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

    const layerSelect = createLayerSelect(piece.layer ?? 'auto');
    layerSelect.id = `piece-layer-${index}`;
    layerSelect.setAttribute('aria-label', `第 ${index + 1} 个单品的穿着层级`);
    layerSelect.addEventListener('change', () => { piece.layer = layerSelect.value; });
    const editor = h('div', { class: 'piece-editor' }, [
      cascade.el,
      h('div', { class: 'field' }, [h('label', { class: 'field__label', for: layerSelect.id, text: '穿着层级' }), layerSelect]),
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
    const batchRunning = state.batchTotal > 0 && state.batchIndex < state.batchTotal;
    const busy = Boolean(state.order && state.order.status === 'pending') || batchRunning;
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
    submitBtn.textContent = busy
      ? (state.batchTotal > 1 ? `正在生成 ${state.batchIndex + 1}/${state.batchTotal}` : '生成中…')
      : state.photographyMode === 'studio' ? '生成 3 个姿势' : '生成试穿图';
    // 按钮旁同步显示转圈与阶段：只在结果区转圈时，首屏看着像「完全不转」。
    submitStatus.hidden = !busy;
    submitSpinner.hidden = !busy;
    submitStatusText.textContent = busy ? (STAGE_TEXT[state.job?.stage] ?? STAGE_TEXT.generating) : '';
    for (const button of photographyButtons.children) {
      button.disabled = busy || (studioUnsupported && button.dataset.photographyMode === 'studio');
    }
    studioPresetSelect.disabled = busy;
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

  function paintResult({ restoreTabFocus = false } = {}) {
    resultBody.replaceChildren();
    const order = state.order;
    if (state.photographyMode === 'studio' && (state.results.length > 0 || state.batchTotal > 0)) {
      const completed = state.results.filter((item) => item.status === 'success');
      const failed = state.results.filter((item) => item.status === 'failed');
      const pending = state.results.filter((item) => item.status === 'pending');
      const cards = state.results.map((item) => {
        const pose = poseById(item.posePreset);
        if (item.status === 'pending') {
          return h('div', { class: 'studio-batch__card' }, [
            h('div', { class: 'stage' }, [h('span', { class: 'spinner' }), h('span', { text: `${pose?.label ?? '姿势'}生成中` })]),
          ]);
        }
        if (item.status === 'failed') {
          return h('div', { class: 'studio-batch__card' }, [
            h('div', { class: 'stage' }, [h('span', { text: `${pose?.label ?? '姿势'}生成失败` })]),
            h('p', { class: 'error-text', text: item.errorMessage ?? '本次不扣费，可单独重试。' }),
          ]);
        }
        if (item.status === 'unknown') {
          return h('div', { class: 'studio-batch__card' }, [
            h('div', { class: 'stage' }, [h('span', { text: `${pose?.label ?? '姿势'}结果未确认` })]),
            h('p', { class: 'error-text', text: item.errorMessage ?? '请到“试穿记录”确认本次订单状态。' }),
          ]);
        }
        const url = `/api/results/${item.resultFile}?k=${encodeURIComponent(item.resultToken ?? '')}`;
        return h('figure', { class: 'studio-batch__card' }, [
          h('div', { class: 'canvas' }, [h('img', { src: url, alt: `${pose?.label ?? '棚拍'}效果` })]),
          h('figcaption', { class: 'studio-batch__caption' }, [
            h('span', { text: pose?.label ?? '棚拍姿势' }),
            h('a', { href: url, download: `无影棚-${pose?.id ?? 'pose'}-AI生成.jpg`, text: '下载' }),
          ]),
        ]);
      });
      resultBody.append(...[
        h('div', { class: 'result__head' }, [
          h('h3', { class: 'result__title', text: '无影棚成片' }),
          h('span', { class: 'result__meta', text: `${completed.length}/${state.batchTotal} 张完成` }),
        ]),
        h('p', { class: 'result__meta', text: '固定纯白无缝背景与柔光，只改变姿势；每张独立扣费，失败独立退款。' }),
        h('div', { class: 'studio-batch' }, cards),
        failed.length > 0 && h('p', { class: 'error-text', text: `${failed.length} 个姿势失败，费用已退回。` }),
        h('p', { class: 'ai-note', text: 'AI 生成效果仅供参考，实物以商品页面描述为准' }),
      ].filter(Boolean));
      liveStatus.textContent = completed.length === state.batchTotal
        ? `无影棚三姿势已完成，共 ${completed.length} 张。`
        : pending.length === 0
          ? `无影棚生成结束，${completed.length} 张完成，${failed.length} 张失败。`
          : `无影棚成片正在生成，已完成 ${completed.length}/${state.batchTotal} 张。`;
      return;
    }
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
        h('p', { class: 'result__meta', text: '生成时间取决于模型与工作流，可能需要数分钟，请保持页面打开。' }),
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
    if (order.status !== 'success') {
      resultBody.append(
        h('div', { class: 'stage' }, [h('span', { text: '结果尚未确认' })]),
        h('p', { class: 'error-text', text: order.errorMessage ?? '请到“试穿记录”确认本次订单状态。' }),
        h('button', { type: 'button', class: 'btn', text: '查看试穿记录', onclick: () => ctx.onNavigate('me') }),
      );
      return;
    }
    const resultUrl = `/api/results/${order.resultFile}?k=${encodeURIComponent(order.resultToken ?? '')}`;
    const tabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': '查看方式' });
    for (const key of ['result', 'original', 'compare']) {
      const tab = h('button', {
        type: 'button',
        class: `segment${state.tab === key ? ' is-active' : ''}`,
        role: 'tab',
        id: `result-tab-${key}`,
        'aria-selected': state.tab === key ? 'true' : 'false',
        'aria-controls': 'result-tabpanel',
        tabindex: state.tab === key ? '0' : '-1',
        text: TAB_LABEL[key],
        onclick: () => {
          state.tab = key;
          paintResult({ restoreTabFocus: true });
          tabs.querySelector(`#result-tab-${key}`)?.focus({ preventScroll: true });
        },
      });
      tab.addEventListener('keydown', (event) => {
        const keys = ['result', 'original', 'compare'];
        const current = keys.indexOf(state.tab);
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? keys.length - 1
            : event.key === 'ArrowRight'
              ? (current + 1) % keys.length
              : event.key === 'ArrowLeft'
                ? (current - 1 + keys.length) % keys.length
                : -1;
        if (next < 0) return;
        event.preventDefault();
        state.tab = keys[next];
        paintResult({ restoreTabFocus: true });
        tabs.querySelector(`#result-tab-${state.tab}`)?.focus({ preventScroll: true });
      });
      tabs.append(tab);
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
    view.id = 'result-tabpanel';
    view.setAttribute('role', 'tabpanel');
    view.setAttribute('aria-labelledby', `result-tab-${state.tab}`);

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
    if (restoreTabFocus) resultBody.querySelector(`#result-tab-${state.tab}`)?.focus({ preventScroll: true });
  }

  function pollJob(jobId, orderId, onSettled) {
    stopPolling();
    let inFlight = false;
    let cancelled = false;
    let settled = false;
    const settle = (order) => {
      if (settled) return;
      settled = true;
      onSettled?.(order);
    };
    const settleUnknown = (errorMessage) => {
      const order = { ...state.order, status: 'unknown', errorMessage };
      settle(order);
      return order;
    };
    async function tick() {
      if (cancelled || inFlight) return;
      // 用户切走页面后 root 会从文档里摘掉：不停下来就会一直轮询到进程退出。
      if (!root.isConnected) {
        stopPolling();
        settleUnknown('页面已离开，请到“试穿记录”确认结果。');
        return;
      }
      inFlight = true;
      // 队列等待和生成超时由后端负责；页面跟随实际终态，避免提前放弃长工作流。
      try {
        const payload = await api(`/api/jobs/${jobId}`);
        if (cancelled || !root.isConnected) {
          stopPolling();
          settleUnknown('页面已离开，请到“试穿记录”确认结果。');
          return;
        }
        state.job = payload;
        if (payload.status === 'success' || payload.status === 'failed') {
          stopPolling();
          const res = await api(`/api/orders/${orderId}`);
          if (cancelled || !root.isConnected) {
            settleUnknown('页面已离开，请到“试穿记录”确认结果。');
            return;
          }
          state.order = res.order;
          if (!ctx.demoMode) await ctx.refreshBalance().catch(() => {});
          paintResult();
          updateSubmit();
          settle(res.order);
        } else {
          updateSubmit();
        }
      } catch {
        stopPolling();
        const errorMessage = '网络中断，结果尚未确认；可稍后在“试穿记录”查看';
        state.job = { status: 'unknown', stage: 'failed' };
        state.order = { ...state.order, status: 'unknown', errorMessage };
        paintResult();
        updateSubmit();
        toast(errorMessage);
        settle(state.order);
      } finally {
        inFlight = false;
      }
    }
    state.poll = setInterval(() => void tick(), 250);
    void tick();
  }

  async function createOrder(person, pieces, options = {}) {
    const body = {
      sessionId: getSessionId(),
      person,
      fit: options.fit ?? state.fit,
      prompt: (options.prompt ?? state.prompt).trim(),
      pieces,
    };
    if (ctx.model) body.model = ctx.model;
    const mode = options.photographyMode ?? state.photographyMode;
    if (mode === 'studio') {
      body.photographyMode = 'studio';
      body.studioPreset = options.studioPreset ?? state.studioPreset;
      body.posePreset = options.posePreset;
    }
    const payload = await api('/api/orders', { method: 'POST', body });
    if (typeof payload.balanceCents === 'number') ctx.onBalanceChanged(payload.balanceCents);
    return payload;
  }

  async function waitForOrder(payload) {
    const orderId = payload.order?.id ?? payload.orderId;
    state.order = { id: orderId, status: 'pending' };
    state.job = { status: 'queued', stage: 'queued' };
    paintResult();
    updateSubmit();
    return new Promise((resolve) => pollJob(payload.jobId, orderId, resolve));
  }

  async function submitStudio(person, pieces, options) {
    const poses = state.posePresets.length === 3
      ? [...state.posePresets]
      : recommendedPoses(pieces);
    state.posePresets = poses;
    state.batchTotal = poses.length;
    state.batchIndex = 0;
    state.batchMode = options.photographyMode;
    state.batchStudioPreset = options.studioPreset;
    state.results = poses.map((posePreset) => ({ posePreset, status: 'pending' }));
    paintResult();
    updateSubmit();
    for (const [index, posePreset] of poses.entries()) {
      if (!root.isConnected || state.batchMode !== options.photographyMode) return;
      state.batchIndex = index;
      state.results[index] = { posePreset, status: 'pending' };
      paintResult();
      updateSubmit();
      try {
        const payload = await createOrder(person, pieces, { ...options, posePreset });
        const order = await waitForOrder(payload);
        if (!root.isConnected) return;
        state.results[index] = {
          ...order,
          posePreset,
          status: order.status === 'success' ? 'success' : order.status === 'failed' ? 'failed' : 'unknown',
        };
      } catch (error) {
        const unknown = !error.status;
        state.results[index] = {
          posePreset,
          status: unknown ? 'unknown' : 'failed',
          errorMessage: unknown ? '网络中断，订单状态未确认；请到“试穿记录”查看。' : error.message,
        };
        toast(`${poseById(posePreset)?.label ?? '姿势'}：${state.results[index].errorMessage}`);
      }
      paintResult();
      updateSubmit();
    }
    state.order = null;
    state.job = null;
    state.batchMode = null;
    state.batchStudioPreset = null;
    state.batchIndex = poses.length;
    paintResult();
    updateSubmit();
    if (window.innerWidth < 620) resultBody.scrollIntoView({ behavior: 'auto', block: 'center' });
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
    const request = {
      person: state.person,
      pieces: pieces.map((piece) => ({ ...piece, source: { ...piece.source } })),
      photographyMode: state.photographyMode,
      studioPreset: state.studioPreset,
      fit: state.fit,
      prompt: state.prompt.trim(),
    };
    try {
      if (request.photographyMode === 'studio') {
        state.results = [];
        state.batchIndex = 0;
        state.batchTotal = 0;
        await submitStudio(request.person, request.pieces, request);
        return;
      }
      const payload = await createOrder(request.person, request.pieces, request);
      const orderId = payload.order?.id ?? payload.orderId;
      state.order = { id: orderId, status: 'pending' };
      state.job = { status: 'queued', stage: 'queued' };
      state.tab = 'result';
      paintResult();
      updateSubmit();
      pollJob(payload.jobId, orderId);
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

  const photographyButtons = h('div', { class: 'segmented', role: 'group', 'aria-label': '摄影模式' });
  for (const mode of [
    { id: 'preserve', label: '普通试穿' },
    { id: 'studio', label: '无影棚成片' },
  ]) {
    photographyButtons.append(h('button', {
      type: 'button',
      class: `segment${mode.id === state.photographyMode ? ' is-active' : ''}`,
      'aria-pressed': mode.id === state.photographyMode ? 'true' : 'false',
      dataset: { photographyMode: mode.id },
      text: mode.label,
      onclick: () => {
        const busy = Boolean(state.order && state.order.status === 'pending') || (state.batchTotal > 0 && state.batchIndex < state.batchTotal);
        if (busy) return;
        state.photographyMode = mode.id;
        state.results = [];
        state.batchTotal = 0;
        state.order = null;
        state.job = null;
        state.results = [];
        state.batchIndex = 0;
        state.batchTotal = 0;
        for (const button of photographyButtons.children) {
          const on = button.dataset.photographyMode === mode.id;
          button.classList.toggle('is-active', on);
          button.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        paintResult();
        updateSubmit();
      },
    }));
  }

  const studioPresetSelect = h('select', { id: 'studio-preset', 'aria-label': '无缝棚背景' });
  for (const preset of ctx.config.studioPresets ?? []) {
    studioPresetSelect.append(h('option', { value: preset.id, text: `${preset.label} · ${preset.hint}` }));
  }
  studioPresetSelect.value = state.studioPreset;
  studioPresetSelect.addEventListener('change', () => {
    if (state.batchTotal > 0 && state.batchIndex < state.batchTotal) {
      studioPresetSelect.value = state.batchStudioPreset ?? state.studioPreset;
      return;
    }
    state.studioPreset = studioPresetSelect.value;
  });
  const studioPresetHint = h('p', { class: 'field__hint' });
  const studioPhotoPanel = h('div', { class: 'studio-photo__presets', hidden: state.photographyMode !== 'studio' }, [
    h('div', { class: 'field' }, [
      h('label', { class: 'field__label', for: 'studio-preset', text: '无缝棚背景' }),
      studioPresetSelect,
      studioPresetHint,
    ]),
    h('div', { class: 'studio-photo__poses' }),
    h('div', { class: 'studio-photo__pose-tools' }, [
      h('p', { class: 'field__hint', text: '三个槽位都可以换成 PoseWear 里的其它姿势；同一套姿势不能重复。' }),
      h('button', {
        type: 'button',
        class: 'btn btn--sm',
        text: '恢复推荐',
        onclick: () => {
          state.poseSelectionTouched = false;
          paintStudioPanel();
        },
      }),
    ]),
    h('p', { class: 'field__hint', text: '三张依次生成并分开保存；背景、机位与光位固定，只改变姿势。每张独立订单，失败独立退款。' }),
  ]);

  function selectPose(index, value) {
    if (!(ctx.config.posePresets ?? []).some((pose) => pose.id === value)) return;
    if (state.posePresets.some((pose, poseIndex) => poseIndex !== index && pose === value)) {
      toast('三个姿势不能重复，请换一个姿势');
      paintStudioPanel();
      return;
    }
    state.posePresets = state.posePresets.map((pose, poseIndex) => poseIndex === index ? value : pose);
    state.poseSelectionTouched = true;
    paintStudioPanel({ focusPoseIndex: index });
  }

  function paintStudioPanel({ focusPoseIndex = -1 } = {}) {
    studioPhotoPanel.hidden = state.photographyMode !== 'studio';
    if (studioPhotoPanel.hidden) return;
    const preset = (ctx.config.studioPresets ?? []).find((item) => item.id === state.studioPreset);
    studioPresetHint.textContent = preset?.hint ?? '';
    const recommended = recommendedPoses();
    const current = state.posePresets;
    const valid = current.length === 3
      && new Set(current).size === 3
      && current.every((id) => poseById(id));
    if (!state.poseSelectionTouched || !valid) state.posePresets = recommended;
    const poses = [...state.posePresets];
    const list = studioPhotoPanel.querySelector('.studio-photo__poses');
    list.replaceChildren(...poses.map((id, index) => {
      const pose = poseById(id);
      const select = h('select', {
        class: 'studio-photo__select',
        'aria-label': `第 ${index + 1} 个姿势`,
        onchange: (event) => selectPose(index, event.currentTarget.value),
      }, (ctx.config.posePresets ?? []).map((option) => h('option', {
        value: option.id,
        text: `${option.label} · ${option.posewearId}`,
        disabled: option.id !== id && poses.includes(option.id),
        selected: option.id === id,
      })));
      return h('div', { class: 'studio-photo__pose' }, [
        h('span', { class: 'studio-photo__index', text: `0${index + 1}` }),
        h('img', { src: pose?.referenceUrl, alt: `${pose?.label ?? id}姿势参考`, loading: 'lazy' }),
        h('span', {}, [
          h('strong', { text: pose?.label ?? id }),
          h('small', { text: pose?.hint ?? '' }),
        ]),
        select,
      ]);
    }));
    if (focusPoseIndex >= 0) {
      list.querySelectorAll('.studio-photo__select')[focusPoseIndex]?.focus({ preventScroll: true });
    }
  }

  addBtn.addEventListener('click', () => {
    if (state.pieces.length >= MAX_PIECES) return;
    state.pieces.push({ slot: '', subtype: '', layer: 'auto', source: null });
    paint();
  });

  promptInput.addEventListener('input', () => {
    state.prompt = promptInput.value;
    promptCounter.textContent = `${[...state.prompt].length}/${MAX_PROMPT_CHARS}`;
  });
  entriesEl.addEventListener('click', () => queueMicrotask(paintStudioPanel));
  photographyButtons.addEventListener('click', () => {
    // 按钮自己的点击处理先更新模式，再重绘姿势推荐。
    queueMicrotask(paintStudioPanel);
  });
  submitBtn.addEventListener('click', () => void submit());

  if (studioUnsupported) {
    for (const button of fitButtons.children) button.disabled = true;
    promptInput.disabled = true;
    if (state.photographyMode === 'studio') state.photographyMode = 'preserve';
  }

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
          liveStatus,
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
          h('div', { class: 'studio-photo' }, [
            h('div', { class: 'field' }, [
              h('span', { class: 'field__label', text: '成片方式' }),
              photographyButtons,
            ]),
            studioPhotoPanel,
          ]),
        ]),
        h('section', { class: 'card' }, [
          studioUnsupported ? h('p', { class: 'field__hint', text: ctx.model === 'idm/idm-vton'
            ? 'IDM-VTON：逐件试穿衣裤裙，保持照片原比例。鞋袜/配饰请选其它图片模型；同部位叠穿可能替换内层。此实验模型不执行版型、补充编辑或无影棚姿势重建。'
            : 'ComfyUI 拼图工作流只接收人物与服装参考图，不执行无影棚姿势重建。' }) : null,
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
  paintStudioPanel();
  paintResult();

  // 内置模特：默认就把人物照填好，用户一进来就能直接点「开始试穿」。
  void loadDefaultPerson().then((dataUrl) => {
    if (!dataUrl || state.person || !root.isConnected) return;
    state.person = dataUrl;
    state.personIsDefault = true;
    paintPerson();
  });
}
