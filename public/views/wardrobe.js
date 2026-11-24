import { api, deviceId, getSessionId, setSessionId } from '../lib/api.js';
import { showDialog } from '../lib/dialog.js';
import { closeAllMenus, createActionMenu, errorText, h, toast } from '../lib/dom.js';
import { SLOT_BY_KEY } from '../lib/garment-taxonomy.js';
import { icon } from '../lib/icons.js';
import { loadDefaultPerson } from '../lib/person.js';
import { createWardrobeDialogs } from '../lib/wardrobe-dialogs.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PIECES = 5;
const POLL_INTERVAL = 1500;
const POLL_MAX_TICKS = 160; // 约 4 分钟

const STAGE_TEXT = {
  queued: '排队中，马上轮到你',
  generating: '正在生成，请稍候',
  finalizing: '正在收尾，结果马上出来',
  success: '生成完成',
  failed: '生成失败',
};

function slotLabel(key) {
  return SLOT_BY_KEY[key]?.label || key;
}

function thumbSrc(item) {
  if (item?.imageUrl) return item.imageUrl;
  return `/api/wardrobe/${encodeURIComponent(item?.id ?? '')}/image`;
}

/**
 * 我的衣橱：真实条目网格 + 当前搭配 + 搜索 + 上传/编辑/删除/链接导入 + 今日穿搭。
 * 当前搭配只保存真实条目 ID，显示与提交都从 state.items 派生，避免复制一份单品真相。
 */
export function renderWardrobe(root, ctx) {
  const state = {
    items: [],
    loading: true,
    error: '',
    view: 'all',
    searchQuery: '',
    searchResults: [],
    category: '',
    selection: [],
    suggestion: null,
    stylistBusy: false,
    person: null,
    personIsDefault: false,
    order: null,
    job: null,
    poll: null,
    pollTicks: 0,
  };

  const fileInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true });
  const searchInput = h('input', { type: 'search', placeholder: '搜索名称或描述，例如：白衬衫', 'aria-label': '搜索衣橱单品' });
  const gridEl = h('div', { class: 'wardrobe-grid' });
  const filtersEl = h('div', { class: 'filters', role: 'group', 'aria-label': '按类目筛选' });
  const countEl = h('p', { class: 'wardrobe-toolbar__count', role: 'status' });
  const selectionEl = h('div', { class: 'selection-list' });
  const selectionCount = h('span', { class: 'field__hint', 'aria-live': 'polite' });
  const mobileSelectionCount = h('span', { class: 'field__hint', 'aria-live': 'polite' });
  const mobileGoStudio = h('button', { type: 'button', class: 'btn btn--primary', text: '去试穿', disabled: true });
  const mobileSelectionList = h('div', { class: 'selection-list' });
  const personPreview = h('img', { class: 'wardrobe-person__image', alt: '当前试穿人物原图', hidden: true });
  const goStudio = h('button', { type: 'button', class: 'btn btn--primary btn--block', text: '去试穿这一套', disabled: true });
  const modalHost = h('div', { class: 'modal-host', hidden: true });
  const { openUploadModal, openEditModal, openImportModal, removeItem } = createWardrobeDialogs({ host: modalHost, onSaved: loadItems });

  // ---- 今日穿搭 ----
  const requestInput = h('input', { type: 'text', maxlength: '200', placeholder: '例如：明天面试，想穿得正式一点又不显老', 'aria-label': '今日穿搭需求' });
  const suggestBtn = h('button', { type: 'button', class: 'btn', text: '帮我选' });
  const suggestionEl = h('div', { class: 'stylist__result' });
  const personInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true });
  const stylistPersonPreview = h('img', { class: 'stylist__person-preview', alt: '全身照预览', hidden: true });
  const personBtn = h('button', { type: 'button', class: 'btn btn--sm', text: '上传全身照' });
  const personNote = h('p', { class: 'stylist__person-note', hidden: true });
  const orderBtn = h('button', { type: 'button', class: 'btn btn--primary', text: '生成试穿图' });
  const orderSpinner = h('span', { class: 'spinner', hidden: true });
  const orderStatusText = h('span');
  const orderStatus = h('p', { class: 'stylist__status', hidden: true }, [orderSpinner, orderStatusText]);
  const resultEl = h('div', { class: 'stylist__result-img-wrap' });

  // ---- 数据 ----
  async function loadItems({ focusId } = {}) {
    if (!root.isConnected) return;
    state.loading = true;
    state.error = '';
    paintGrid();
    try {
      const payload = await api('/api/wardrobe');
      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.selection = state.selection.filter((id) => state.items.some((item) => item.id === id));
      if (state.view === 'search' && state.searchQuery) {
        const search = await api('/api/wardrobe/search', { method: 'POST', body: { query: state.searchQuery } });
        state.searchResults = Array.isArray(search.results) ? search.results : [];
      }
    } catch (error) {
      state.error = errorText(error);
      state.items = [];
    } finally {
      state.loading = false;
      paintGrid();
      paintSelection();
      if (focusId && root.isConnected) {
        const card = [...gridEl.querySelectorAll('[data-item-id]')].find((node) => node.dataset.itemId === focusId);
        const target = card?.querySelector('[aria-haspopup="menu"]') ?? gridEl.querySelector('[aria-haspopup="menu"]') ?? root.querySelector('.wardrobe-head__actions .btn--primary');
        target?.focus({ preventScroll: true });
      }
    }
  }

  function categoryText(item) {
    return SLOT_BY_KEY[item.category]?.label || item.category || '未分类';
  }

  function visibleItems() {
    const list = state.view === 'search'
      ? state.searchResults.map((entry) => itemById(entry.item.id)).filter(Boolean)
      : state.items;
    return state.category ? list.filter((item) => item.category === state.category) : list;
  }

  function itemById(id) {
    return state.items.find((item) => item.id === id) ?? null;
  }

  // ---- 当前搭配 ----
  function toggleSelection(id) {
    if (state.selection.includes(id)) {
      state.selection = state.selection.filter((value) => value !== id);
    } else if (state.selection.length >= MAX_PIECES) {
      toast(`每套最多 ${MAX_PIECES} 件，先从当前搭配里移除一件`);
      return;
    } else {
      state.selection = [...state.selection, id];
    }
    paintGrid();
    paintSelection();
    const card = [...gridEl.querySelectorAll('[data-item-id]')].find((node) => node.dataset.itemId === id);
    if (!document.querySelector('dialog[open]')) card?.querySelector('.wardrobe-card__thumb')?.focus({ preventScroll: true });
  }

  function piecesFromSelection() {
    return state.selection
      .map((id) => itemById(id))
      .filter(Boolean)
      .map((item) => ({ slot: item.category, subtype: item.subtype || '', source: { kind: 'wardrobe', wardrobeId: item.id, imageUrl: thumbSrc(item), name: item.name || '' } }));
  }

  function paintSelection() {
    selectionCount.textContent = `已选 ${state.selection.length} / ${MAX_PIECES} 件`;
    mobileSelectionCount.textContent = `当前搭配 ${state.selection.length} / ${MAX_PIECES} 件`;
    paintSelectionList(selectionEl);
    if (mobileSelectionList.isConnected) {
      paintSelectionList(mobileSelectionList);
      const handoff = mobileSelectionList.closest('dialog')?.querySelector('.modal__actions .btn--primary');
      if (handoff) handoff.disabled = piecesFromSelection().length === 0;
    }
    goStudio.disabled = mobileGoStudio.disabled = piecesFromSelection().length === 0;
  }

  function paintSelectionList(list) {
    list.replaceChildren();
    if (state.selection.length === 0) {
      list.append(h('p', { class: 'field__hint', text: '点单品图片加入这一套，最多五件。' }));
    }
    for (const id of state.selection) {
      const item = itemById(id);
      if (!item) continue;
      const remove = h('button', { type: 'button', class: 'icon-button', 'aria-label': `从搭配移除${item.name || '单品'}`, onclick: () => { toggleSelection(id); if (list === mobileSelectionList) mobileSelectionList.querySelector('button')?.focus(); } }, [icon('close')]);
      list.append(h('div', { class: 'selection-item' }, [
        h('img', { class: 'selection-item__thumb', src: thumbSrc(item), alt: '' }),
        h('div', { class: 'selection-item__text' }, [
          h('span', { class: 'selection-item__name', text: item.name || '未命名单品' }),
          h('span', { class: 'selection-item__meta', text: [categoryText(item), item.subtype].filter(Boolean).join(' / ') }),
        ]),
        remove,
      ]));
    }
  }

  function openSelection() {
    let dismiss;
    const close = h('button', { type: 'button', class: 'btn', text: '继续挑选', onclick: () => dismiss() });
    const handoff = h('button', { type: 'button', class: 'btn btn--primary', text: '去试穿', disabled: piecesFromSelection().length === 0, onclick: () => { dismiss(); goToStudio(); } });
    const panel = h('section', { class: 'modal' }, [
      h('div', { class: 'modal__head' }, [h('h2', { class: 'modal__title', text: '当前搭配' })]),
      h('div', { class: 'modal__content' }, [mobileSelectionList]),
      h('div', { class: 'modal__actions' }, [close, handoff]),
    ]);
    paintSelectionList(mobileSelectionList);
    dismiss = showDialog(modalHost, panel, { label: '当前搭配' });
  }

  function goToStudio() {
    if (!piecesFromSelection().length) return;
    ctx.pendingPieces = piecesFromSelection();
    ctx.pendingPerson = { image: state.person, isDefault: state.personIsDefault };
    ctx.onNavigate('studio');
  }

  // ---- 网格 ----
  function renderCard(item) {
    const selected = state.selection.includes(item.id);
    const choose = h('button', {
      type: 'button',
      class: 'wardrobe-card__thumb',
      'aria-label': `${selected ? '从搭配移除' : '选入搭配'}${item.name || '单品'}`,
      'aria-pressed': String(selected),
      onclick: () => toggleSelection(item.id),
    }, [
      h('img', { src: thumbSrc(item), alt: item.name || '衣橱单品' }),
      selected ? h('span', { class: 'wardrobe-card__check', 'aria-hidden': 'true' }, [icon('check')]) : null,
    ]);
    return h('article', { class: `wardrobe-card${selected ? ' is-selected' : ''}`, dataset: { itemId: item.id } }, [
      choose,
      h('div', { class: 'wardrobe-card__body' }, [
        h('div', { class: 'wardrobe-card__text' }, [
          h('h3', { class: 'wardrobe-card__name', text: item.name || '未命名单品' }),
          h('span', { class: 'wardrobe-card__cat', text: [categoryText(item), item.subtype].filter(Boolean).join(' / ') }),
        ]),
        createActionMenu(`${item.name || '单品'}的更多操作`, [
          { label: '编辑单品', icon: 'edit', run: () => openEditModal(item) },
          { label: '删除单品', icon: 'trash', danger: true, run: () => removeItem(item) },
        ]),
      ]),
    ]);
  }

  function paintFilters() {
    const present = [...new Set(state.items.map((item) => item.category))];
    const options = [{ key: '', label: '全部' }, ...present.filter((key) => SLOT_BY_KEY[key]).map((key) => ({ key, label: slotLabel(key) }))];
    filtersEl.replaceChildren(...options.map((option) => h('button', {
      type: 'button',
      class: `filter${state.category === option.key ? ' is-active' : ''}`,
      'aria-pressed': String(state.category === option.key),
      text: option.label,
      onclick: () => {
        state.category = option.key;
        paintGrid();
        const button = [...filtersEl.querySelectorAll('button')].find((node) => node.textContent === option.label);
        button?.focus({ preventScroll: true });
      },
    })));
  }

  function paintGrid() {
    closeAllMenus();
    paintFilters();
    const list = visibleItems();
    countEl.textContent = state.loading
      ? '正在读取衣橱…'
      : state.view === 'search'
        ? `「${state.searchQuery}」找到 ${list.length} 件`
        : state.category
          ? `${slotLabel(state.category)} ${list.length} 件`
          : `共 ${list.length} 件单品`;
    if (state.loading) {
      gridEl.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'skeleton wardrobe-card__skeleton' })));
      return;
    }
    if (state.error && state.items.length === 0) {
      gridEl.replaceChildren(h('div', { class: 'wardrobe-empty' }, [
        h('p', { class: 'wardrobe-empty__title', text: '衣橱读取失败' }),
        h('p', { class: 'field__hint', text: state.error }),
        h('button', { type: 'button', class: 'btn btn--sm', text: '重试', onclick: () => void loadItems() }),
      ]));
      return;
    }
    if (state.items.length === 0) {
      gridEl.replaceChildren(h('div', { class: 'wardrobe-empty' }, [
        h('span', { class: 'wardrobe-empty__icon' }, [icon('wardrobe')]),
        h('p', { class: 'wardrobe-empty__title', text: '衣橱还是空的' }),
        h('p', { class: 'field__hint', text: '上传自己的单品图，或从商品链接导入一件，之后搭配和试穿都会更快。' }),
        h('div', { class: 'wardrobe-empty__actions' }, [
          h('button', { type: 'button', class: 'btn btn--primary', text: '上传单品', onclick: () => fileInput.click() }),
          h('button', { type: 'button', class: 'btn', text: '从商品链接导入', onclick: () => openImportModal() }),
        ]),
      ]));
      return;
    }
    if (list.length === 0) {
      gridEl.replaceChildren(h('div', { class: 'wardrobe-empty' }, [
        h('p', { class: 'wardrobe-empty__title', text: state.view === 'search' ? `没有找到与「${state.searchQuery}」匹配的单品` : '这个类目下还没有单品' }),
        h('button', { type: 'button', class: 'btn btn--sm', text: '查看全部', onclick: () => { state.view = 'all'; state.category = ''; state.searchQuery = ''; searchInput.value = ''; paintGrid(); } }),
      ]));
      return;
    }
    gridEl.replaceChildren(...list.map(renderCard));
  }

  // ---- 搜索 ----
  async function runSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      state.view = 'all';
      state.searchQuery = '';
      state.searchResults = [];
      paintGrid();
      return;
    }
    searchInput.disabled = true;
    try {
      const payload = await api('/api/wardrobe/search', { method: 'POST', body: { query } });
      state.searchResults = Array.isArray(payload.results) ? payload.results : [];
      state.searchQuery = query;
      state.view = 'search';
      if (state.searchResults.length === 0) toast('没有找到匹配的单品');
    } catch (error) {
      toast(errorText(error));
    } finally {
      searchInput.disabled = false;
      paintGrid();
    }
  }

  // ---- 上传 ----
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast('只支持 PNG / JPEG / WebP 图片');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('图片不能超过 8MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => openUploadModal(String(reader.result), file.name);
    reader.onerror = () => toast('读取图片失败，请重试');
    reader.readAsDataURL(file);
  });

  // ---- 今日穿搭 ----
  function piecesFromSuggestion() {
    const slots = state.suggestion?.slots || {};
    const pieces = [];
    for (const [key, value] of Object.entries(slots)) {
      const list = Array.isArray(value) ? value : value ? [value] : [];
      for (const item of list) {
        if (item?.id) pieces.push({ slot: key, subtype: item.subtype || '', source: { kind: 'wardrobe', wardrobeId: item.id } });
      }
    }
    return pieces;
  }

  function renderSlot(key, items) {
    const first = items[0];
    const names = items.map((item) => item.name || '未命名单品').join('、');
    return h('div', { class: 'stylist__slot' }, [
      h('div', { class: 'stylist__slot-thumb' }, [h('img', { src: thumbSrc(first), alt: names || slotLabel(key) })]),
      h('div', { class: 'stylist__slot-text' }, [
        h('span', { class: 'stylist__slot-cat', text: slotLabel(key) }),
        h('span', { class: 'stylist__slot-name', text: names }),
      ]),
    ]);
  }

  function paintSuggestion() {
    suggestionEl.replaceChildren();
    const suggestion = state.suggestion;
    if (!suggestion) {
      suggestionEl.append(h('p', { class: 'field__hint', text: '还没有搭配建议，写下今天的场合或感觉，再点「帮我选」。' }));
      updateOrderButton();
      return;
    }
    const slots = suggestion.slots || {};
    const entries = Object.keys(slots).filter((key) => {
      const value = slots[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    if (entries.length === 0) {
      suggestionEl.append(h('p', { class: 'field__hint', text: '衣橱里暂时没有能组成一套的单品，先上传或导入几件吧。' }));
    } else {
      suggestionEl.append(h('div', { class: 'stylist__slots' }, entries.map((key) => renderSlot(key, Array.isArray(slots[key]) ? slots[key] : [slots[key]]))));
    }
    if (suggestion.reason) suggestionEl.append(h('p', { class: 'stylist__reason', text: suggestion.reason }));
    const missing = Array.isArray(suggestion.missing) ? suggestion.missing.filter((key) => SLOT_BY_KEY[key]) : [];
    if (missing.length) suggestionEl.append(h('p', { class: 'stylist__missing', text: `衣橱里还缺：${missing.map(slotLabel).join('、')}，可先补充再生成。` }));
    updateOrderButton();
  }

  async function suggest() {
    const request = requestInput.value.trim();
    if (!request) {
      toast('用一句话说说今天想穿什么');
      requestInput.focus();
      return;
    }
    if (suggestBtn.disabled) return;
    suggestBtn.disabled = true;
    suggestBtn.textContent = '帮你挑…';
    try {
      const payload = await api('/api/outfit/suggest', { method: 'POST', body: { request } });
      state.suggestion = payload.suggestion ?? null;
      state.order = null;
      state.job = null;
      setStatus('');
      resultEl.replaceChildren();
      paintSuggestion();
    } catch (error) {
      toast(errorText(error));
    } finally {
      suggestBtn.disabled = false;
      suggestBtn.textContent = '帮我选';
    }
  }

  /** 状态行：文案与转圈一起设置，避免「按钮禁用但页面一动不动」。 */
  function setStatus(text, spinning = false) {
    orderStatus.hidden = !text;
    orderStatusText.textContent = text ?? '';
    orderSpinner.hidden = !spinning;
  }

  function updateOrderButton() {
    const pending = state.stylistBusy || state.order?.status === 'pending';
    orderBtn.disabled = pending || piecesFromSuggestion().length === 0;
    orderBtn.textContent = pending ? '生成中…' : '生成试穿图';
  }

  function paintPerson() {
    const show = Boolean(state.person);
    for (const [image, note] of [[personPreview, null], [stylistPersonPreview, personNote]]) {
      image.hidden = !show;
      if (show) image.src = state.person;
      if (note) {
        note.hidden = !show;
        note.textContent = state.personIsDefault ? '内置模特' : '你的照片';
      }
    }
    personBtn.textContent = state.personIsDefault ? '换成我的照片' : show ? '更换全身照' : '上传全身照';
    updateOrderButton();
  }

  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  function paintResult() {
    resultEl.replaceChildren();
    const order = state.order;
    if (order?.status === 'pending') {
      resultEl.append(
        h('div', { class: 'stage' }, [h('span', { class: 'spinner' }), h('span', { text: STAGE_TEXT[state.job?.stage] ?? STAGE_TEXT.generating })]),
        h('p', { class: 'result__meta', text: '生成通常需要 20–60 秒，请不要关闭页面。' }),
      );
      return;
    }
    if (!order || order.status !== 'success' || !order.resultFile) return;
    const url = `/api/results/${order.resultFile}?k=${encodeURIComponent(order.resultToken ?? '')}`;
    resultEl.append(
      h('div', { class: 'stylist__result-img' }, [h('img', { src: url, alt: '搭配试穿效果' })]),
      h('p', { class: 'ai-note', text: 'AI 生成效果仅供参考，实物以商品页面描述为准' }),
      h('a', { class: 'btn btn--block', href: url, download: '今日穿搭-AI生成.jpg', text: '下载效果图（含 AI 标识）' }),
    );
  }

  function pollJob(jobId) {
    stopPolling();
    state.pollTicks = 0;
    state.poll = setInterval(async () => {
      if (!root.isConnected) {
        stopPolling();
        return;
      }
      state.pollTicks += 1;
      if (state.pollTicks > POLL_MAX_TICKS) {
        stopPolling();
        state.stylistBusy = false;
        setStatus('生成超时，请稍后在「试穿记录」查看结果。');
        updateOrderButton();
        return;
      }
      try {
        const payload = await api(`/api/jobs/${jobId}`);
        state.job = payload;
        if (payload.status === 'success' || payload.status === 'failed') {
          stopPolling();
          const res = await api(`/api/orders/${state.order.id}`);
          state.order = res.order;
          state.stylistBusy = false;
          if (payload.status === 'failed') setStatus(state.order?.errorMessage || '生成失败，本次不扣费。');
          else {
            setStatus('');
            paintResult();
          }
          if (!ctx.demoMode && ctx.refreshBalance) await ctx.refreshBalance();
          updateOrderButton();
        } else {
          setStatus(STAGE_TEXT[payload.stage] || STAGE_TEXT.generating, true);
          paintResult();
        }
      } catch {
        stopPolling();
        state.stylistBusy = false;
        setStatus('网络中断，未能确认结果，可稍后在「试穿记录」查看。');
        updateOrderButton();
      }
    }, POLL_INTERVAL);
  }

  async function generateTryon() {
    if (state.stylistBusy) return;
    const pieces = piecesFromSuggestion();
    if (pieces.length === 0) {
      toast('先让「帮我选」给出一套搭配');
      return;
    }
    if (!state.person) {
      const fallback = await loadDefaultPerson();
      if (fallback) {
        state.person = fallback;
        state.personIsDefault = true;
        paintPerson();
      }
    }
    if (!state.person) {
      toast('请先上传一张全身照，试穿需要真人照片');
      personInput.click();
      return;
    }
    state.stylistBusy = true;
    updateOrderButton();
    setStatus('正在提交订单…', true);
    try {
      let sessionId = getSessionId();
      if (!sessionId) {
        const session = await api('/api/session', { method: 'POST', body: { deviceId: deviceId() } });
        sessionId = session.sessionId;
        if (sessionId) setSessionId(sessionId);
      }
      let model = ctx.model;
      if (!model) {
        try {
          const config = await api('/api/config');
          model = config.defaultModel || config.models?.[0]?.id || null;
        } catch {
          /* 拿不到默认模型就不带 model，交给后端默认 */
        }
      }
      const body = { sessionId, person: state.person, fit: 'regular', prompt: '', pieces };
      if (model) body.model = model;
      const payload = await api('/api/orders', { method: 'POST', body });
      const orderId = payload.order?.id ?? payload.orderId;
      state.order = { id: orderId, status: 'pending' };
      state.job = { status: 'queued', stage: 'queued' };
      resultEl.replaceChildren();
      if (typeof payload.balanceCents === 'number' && ctx.onBalanceChanged) ctx.onBalanceChanged(payload.balanceCents);
      setStatus(STAGE_TEXT.queued, true);
      updateOrderButton();
      paintResult();
      orderStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
      pollJob(payload.jobId);
    } catch (error) {
      state.stylistBusy = false;
      setStatus(errorText(error));
      updateOrderButton();
      toast(errorText(error));
    }
  }

  // ---- 事件 ----
  searchInput.addEventListener('input', () => {
    if (!searchInput.value.trim() && state.view === 'search') {
      state.view = 'all';
      state.searchQuery = '';
      state.searchResults = [];
      paintGrid();
    }
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void runSearch();
  });
  suggestBtn.addEventListener('click', () => void suggest());
  requestInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void suggest();
  });
  orderBtn.addEventListener('click', () => void generateTryon());
  personBtn.addEventListener('click', () => personInput.click());
  personInput.addEventListener('change', () => {
    const file = personInput.files?.[0];
    personInput.value = '';
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      toast('只支持 PNG / JPEG / WebP 图片');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast('图片不能超过 8MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.person = String(reader.result);
      state.personIsDefault = false;
      paintPerson();
    };
    reader.onerror = () => toast('读取图片失败，请重试');
    reader.readAsDataURL(file);
  });
  goStudio.addEventListener('click', goToStudio);
  mobileGoStudio.addEventListener('click', goToStudio);

  // ---- 组装 ----
  root.append(
    h('section', { class: 'page-head' }, [
      h('div', {}, [h('h1', { class: 'page-title', text: '我的衣橱' }), h('p', { class: 'page-sub', text: '把常穿的单品收进来，挑一套就能看到上身效果。' })]),
      h('div', { class: 'wardrobe-head__actions' }, [
        h('button', { type: 'button', class: 'btn', onclick: () => openImportModal() }, [icon('link'), '链接导入']),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => fileInput.click() }, [icon('plus'), '上传单品']),
        fileInput,
      ]),
    ]),
    h('div', { class: 'wardrobe-page' }, [
      h('section', { class: 'closet' }, [
        h('div', { class: 'wardrobe-toolbar' }, [
          h('div', { class: 'wardrobe-toolbar__main' }, [filtersEl, h('div', { class: 'search-field' }, [icon('search'), searchInput])]),
          countEl,
        ]),
        gridEl,
        h('section', { class: 'card stylist' }, [
          h('div', { class: 'card__head' }, [
            h('div', { class: 'card__heading' }, [h('h2', { class: 'section__title', text: '今日穿搭' }), h('p', { class: 'section__hint', text: '说说场合或感觉，让 AI 从衣橱里帮你搭一套。' })]),
            h('span', { class: 'tag' }, [icon('sparkle'), 'AI 选搭']),
          ]),
          h('div', { class: 'inline-field' }, [requestInput, suggestBtn]),
          suggestionEl,
          h('div', { class: 'stylist__order' }, [
            h('div', { class: 'stylist__person' }, [stylistPersonPreview, h('div', {}, [personNote, personBtn]), personInput]),
            h('span', { class: 'push-end' }, [orderBtn]),
          ]),
          orderStatus,
          resultEl,
        ]),
      ]),
      h('aside', { class: 'wardrobe-aside' }, [
        h('section', { class: 'panel wardrobe-person' }, [
          personPreview,
          h('span', { class: 'canvas__label', text: '人物原图' }),
          h('p', { class: 'field__hint', text: '人物原图仅供当前搭配参考；生成结果后可对比查看。' }),
        ]),
        h('section', { class: 'panel wardrobe-picks' }, [
          h('div', { class: 'card__head' }, [h('h2', { class: 'section__title', text: '当前搭配' }), selectionCount]),
          selectionEl,
          goStudio,
          h('p', { class: 'field__hint', text: '选好的单品会直接带进工作台，仍需确认版型与生成。' }),
        ]),
      ]),
    ]),
    h('div', { class: 'wardrobe-mobile-actions' }, [
      h('button', { type: 'button', class: 'btn btn--ghost', onclick: openSelection }, [icon('wardrobe'), mobileSelectionCount]),
      mobileGoStudio,
    ]),
    modalHost,
  );

  paintGrid();
  paintSelection();
  paintSuggestion();
  paintPerson();
  void loadItems();
  void loadDefaultPerson().then((dataUrl) => {
    if (!dataUrl || state.person || !root.isConnected) return;
    state.person = dataUrl;
    state.personIsDefault = true;
    paintPerson();
  });
}
