import { api, deviceId, getSessionId, setSessionId } from '../lib/api.js';
import { createCascadeSelect, errorText, h, toast } from '../lib/dom.js';
import { SLOTS, SLOT_BY_KEY } from '../lib/garment-taxonomy.js';

const CASCADE_GROUPS = SLOTS.map((slot) => ({
  value: slot.key,
  label: slot.label,
  options: slot.subtypes.map((subtype) => ({ value: subtype, label: subtype })),
}));
const SLOT_ORDER = SLOTS.map((slot) => slot.key);
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
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
 * 我的衣橱：真实条目网格 + 搜索 + 上传入橱 + 今日穿搭（选搭配并生成试穿图）。
 */
export function renderWardrobe(root, ctx) {
  const state = {
    items: [],
    loading: true,
    error: '',
    view: 'all', // all | search
    searchQuery: '',
    searchResults: [],
    suggestion: null,
    stylistBusy: false,
    person: null,
    order: null,
    job: null,
    poll: null,
    pollTicks: 0,
  };

  // ---- 顶部与网格 ----
  const fileInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true });
  const searchInput = h('input', { type: 'text', class: 'search', placeholder: '搜索衣橱单品，例如：白衬衫', 'aria-label': '搜索衣橱单品' });
  const searchBtn = h('button', { type: 'button', class: 'btn btn--primary', text: '搜索' });
  const searchClear = h('button', { type: 'button', class: 'btn btn--ghost', text: '清除搜索', hidden: true });
  const gridEl = h('div', { class: 'wardrobe-grid' });
  const modalHost = h('div', { class: 'modal-host', hidden: true });

  // ---- 今日穿搭 ----
  const requestInput = h('input', {
    type: 'text',
    class: 'search',
    maxlength: '200',
    placeholder: '例如：明天面试，想穿得正式一点又不显老',
    'aria-label': '今日穿搭需求',
  });
  const suggestBtn = h('button', { type: 'button', class: 'btn btn--primary', text: '帮我选' });
  const suggestionEl = h('div', { class: 'stylist__result' });
  const personInput = h('input', { type: 'file', accept: IMAGE_TYPES.join(','), hidden: true });
  const personPreview = h('img', { class: 'stylist__person-preview', alt: '全身照预览', hidden: true });
  const personBtn = h('button', { type: 'button', class: 'btn btn--sm', text: '上传全身照' });
  const orderBtn = h('button', { type: 'button', class: 'btn btn--primary', text: '生成试穿图' });
  const orderStatus = h('p', { class: 'stylist__status', hidden: true });
  const resultEl = h('div', { class: 'stylist__result-img-wrap' });

  // ---- 数据加载 ----
  async function loadItems() {
    state.loading = true;
    state.error = '';
    paintGrid();
    try {
      const payload = await api('/api/wardrobe');
      state.items = Array.isArray(payload.items) ? payload.items : [];
    } catch (error) {
      state.error = errorText(error);
      state.items = [];
    } finally {
      state.loading = false;
      paintGrid();
    }
  }

  // ---- 网格渲染 ----
  function categoryText(item) {
    return SLOT_BY_KEY[item.category]?.label || item.category || '未分类';
  }

  function renderCard(item) {
    const del = h('button', {
      type: 'button',
      class: 'wardrobe-card__del',
      'aria-label': `删除${item.name || '单品'}`,
      text: '×',
    });
    del.addEventListener('click', () => void removeItem(item, del));
    return h('article', { class: 'wardrobe-card' }, [
      h('div', { class: 'wardrobe-card__thumb' }, [
        h('img', { src: thumbSrc(item), alt: item.name || '衣橱单品' }),
      ]),
      h('div', { class: 'wardrobe-card__body' }, [
        h('span', { class: 'wardrobe-card__name', text: item.name || '未命名单品' }),
        h('span', { class: 'wardrobe-card__cat', text: categoryText(item) }),
      ]),
      del,
    ]);
  }

  function emptyState() {
    return h('div', { class: 'wardrobe-empty' }, [
      h('p', { class: 'wardrobe-empty__title', text: '衣橱还是空的，上传或从商品链接导入一件吧' }),
      h('div', { class: 'wardrobe-empty__actions' }, [
        h('button', { type: 'button', class: 'btn btn--primary', text: '去橱窗逛逛', onclick: () => ctx.onNavigate('shop') }),
        h('button', { type: 'button', class: 'btn', text: '从商品链接导入', onclick: () => ctx.onNavigate('import') }),
      ]),
    ]);
  }

  function paintGrid() {
    const searching = state.view === 'search';
    searchClear.hidden = !searching;
    if (state.loading) {
      gridEl.replaceChildren(h('p', { class: 'field__hint', text: '正在加载衣橱…' }));
      return;
    }
    if (state.error && state.items.length === 0 && !searching) {
      gridEl.replaceChildren(h('div', { class: 'wardrobe-empty' }, [
        h('p', { class: 'wardrobe-empty__title', text: '衣橱读取失败' }),
        h('p', { class: 'field__hint', text: state.error }),
        h('button', { type: 'button', class: 'btn btn--sm', text: '重试', onclick: () => void loadItems() }),
      ]));
      return;
    }
    if (!searching && state.items.length === 0) {
      gridEl.replaceChildren(emptyState());
      return;
    }
    if (searching && state.searchResults.length === 0) {
      gridEl.replaceChildren(h('div', { class: 'wardrobe-empty' }, [
        h('p', { class: 'wardrobe-empty__title', text: `没有找到与「${state.searchQuery}」匹配的单品` }),
        h('button', { type: 'button', class: 'btn btn--sm', text: '查看全部', onclick: clearSearch }),
      ]));
      return;
    }
    const list = searching ? state.searchResults.map((entry) => entry.item) : state.items;
    gridEl.replaceChildren(...list.map(renderCard));
  }

  async function removeItem(item, button) {
    if (!window.confirm(`确定删除「${item.name || '这件单品'}」吗？`)) return;
    button.disabled = true;
    try {
      await api(`/api/wardrobe/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      toast('已删除');
      await loadItems();
    } catch (error) {
      button.disabled = false;
      toast(errorText(error));
    }
  }

  // ---- 搜索 ----
  function clearSearch() {
    state.view = 'all';
    state.searchQuery = '';
    state.searchResults = [];
    searchInput.value = '';
    paintGrid();
  }

  async function runSearch() {
    const query = searchInput.value.trim();
    if (!query) {
      toast('请输入搜索词');
      return;
    }
    searchBtn.disabled = true;
    searchBtn.textContent = '搜索中…';
    try {
      const payload = await api('/api/wardrobe/search', { method: 'POST', body: { query } });
      state.searchResults = Array.isArray(payload.results) ? payload.results : [];
      state.searchQuery = query;
      state.view = 'search';
      if (state.searchResults.length === 0) toast('没有找到匹配的单品');
    } catch (error) {
      toast(errorText(error));
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = '搜索';
      paintGrid();
    }
  }

  // ---- 上传入橱 ----
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

  function openUploadModal(dataUrl, filename) {
    modalHost.replaceChildren();
    modalHost.hidden = false;

    const baseName = String(filename || '').replace(/\.[^.]+$/, '').slice(0, 40);
    const nameInput = h('input', { type: 'text', class: 'search', maxlength: '40', value: baseName, placeholder: '给这件单品起个名字' });
    const cascade = createCascadeSelect({
      groups: CASCADE_GROUPS,
      value: 'top',
      placeholder: '选择大类',
      subPlaceholder: '选择子类',
      ariaLabel: '这件单品的类目',
    });
    const errEl = h('p', { class: 'error-text', hidden: true });
    const submit = h('button', { type: 'button', class: 'btn btn--primary', text: '加入衣橱' });
    const cancel = h('button', { type: 'button', class: 'btn', text: '取消' });

    function close() {
      modalHost.replaceChildren();
      modalHost.hidden = true;
    }

    cancel.addEventListener('click', close);
    submit.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) {
        errEl.textContent = '请填写单品名称';
        errEl.hidden = false;
        nameInput.focus();
        return;
      }
      submit.disabled = true;
      cancel.disabled = true;
      submit.textContent = '上传中…';
      errEl.hidden = true;
      try {
        await api('/api/wardrobe', {
          method: 'POST',
          body: {
            name,
            category: cascade.getValue(),
            subtype: cascade.getSubValue(),
            tags: [],
            description: '',
            image: dataUrl,
            source: 'upload',
          },
        });
        close();
        toast('已加入衣橱');
        await loadItems();
      } catch (error) {
        errEl.textContent = errorText(error);
        errEl.hidden = false;
        submit.disabled = false;
        cancel.disabled = false;
        submit.textContent = '加入衣橱';
      }
    });

    const overlay = h('div', { class: 'modal-overlay' }, [
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '加入衣橱' }, [
        h('h2', { class: 'modal__title', text: '加入衣橱' }),
        h('div', { class: 'modal__preview' }, [h('img', { src: dataUrl, alt: '待上传单品' })]),
        h('div', { class: 'field' }, [
          h('span', { class: 'field__label', text: '单品名称' }),
          nameInput,
        ]),
        h('div', { class: 'field' }, [
          h('span', { class: 'field__label', text: '类目' }),
          cascade.el,
        ]),
        errEl,
        h('div', { class: 'modal__actions' }, [cancel, submit]),
      ]),
    ]);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    modalHost.append(overlay);
    nameInput.focus();
  }

  // ---- 今日穿搭 ----
  function piecesFromSuggestion() {
    const slots = state.suggestion?.slots || {};
    const pieces = [];
    for (const key of SLOT_ORDER) {
      const value = slots[key];
      const list = Array.isArray(value) ? value : value ? [value] : [];
      for (const item of list) {
        if (!item || !item.id) continue;
        pieces.push({ slot: key, source: { kind: 'wardrobe', wardrobeId: item.id } });
      }
    }
    return pieces;
  }

  function renderSlot(key, items) {
    const first = items[0];
    const names = items.map((item) => item.name || '未命名单品').join('、');
    return h('div', { class: 'stylist__slot' }, [
      h('div', { class: 'stylist__slot-thumb' }, [
        h('img', { src: thumbSrc(first), alt: names || slotLabel(key) }),
      ]),
      h('span', { class: 'stylist__slot-cat', text: slotLabel(key) }),
      h('span', { class: 'stylist__slot-name', text: names }),
    ]);
  }

  function paintSuggestion() {
    suggestionEl.replaceChildren();
    const suggestion = state.suggestion;
    if (!suggestion) {
      suggestionEl.append(h('p', { class: 'field__hint', text: '还没有搭配建议，上面输入需求点「帮我选」。' }));
      updateOrderButton();
      return;
    }
    const slots = suggestion.slots || {};
    const entries = SLOT_ORDER.filter((key) => {
      const value = slots[key];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    if (entries.length === 0) {
      suggestionEl.append(h('p', { class: 'field__hint', text: '衣橱里暂时没有能组成一套的单品，先上传或导入几件吧。' }));
    } else {
      suggestionEl.append(h('div', { class: 'stylist__slots' }, entries.map((key) => {
        const value = slots[key];
        return renderSlot(key, Array.isArray(value) ? value : [value]);
      })));
    }
    if (suggestion.reason) {
      suggestionEl.append(h('p', { class: 'stylist__reason', text: suggestion.reason }));
    }
    const missing = Array.isArray(suggestion.missing) ? suggestion.missing.filter((key) => SLOT_BY_KEY[key]) : [];
    if (missing.length) {
      suggestionEl.append(h('p', { class: 'stylist__missing', text: `衣柜里还缺：${missing.map(slotLabel).join('、')}，可先补充再生成。` }));
    }
    updateOrderButton();
  }

  async function suggest() {
    const request = requestInput.value.trim();
    if (!request) {
      toast('用一句话说说你今天想穿什么');
      return;
    }
    suggestBtn.disabled = true;
    suggestBtn.textContent = '帮你挑…';
    try {
      const payload = await api('/api/outfit/suggest', { method: 'POST', body: { request } });
      state.suggestion = payload.suggestion ?? null;
      state.order = null;
      state.job = null;
      orderStatus.hidden = true;
      resultEl.replaceChildren();
      paintSuggestion();
    } catch (error) {
      toast(errorText(error));
    } finally {
      suggestBtn.disabled = false;
      suggestBtn.textContent = '帮我选';
    }
  }

  function updateOrderButton() {
    const pieces = piecesFromSuggestion();
    const pending = state.stylistBusy || state.order?.status === 'pending';
    orderBtn.disabled = pending || pieces.length === 0;
    orderBtn.textContent = pending ? '生成中…' : '生成试穿图';
  }

  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  function paintResult() {
    resultEl.replaceChildren();
    const order = state.order;
    if (!order || order.status !== 'success' || !order.resultFile) return;
    const url = `/api/results/${order.resultFile}?k=${encodeURIComponent(order.resultToken ?? '')}`;
    resultEl.append(
      h('div', { class: 'stylist__result-img' }, [h('img', { src: url, alt: '搭配试穿效果' })]),
      h('p', { class: 'ai-note', text: 'AI 生成效果仅供参考，实物以商品页面描述为准' }),
      h('a', {
        class: 'btn btn--block',
        href: url,
        download: '今日穿搭-AI生成.jpg',
        text: '下载效果图（含 AI 标识）',
      }),
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
        orderStatus.hidden = false;
        orderStatus.textContent = '生成超时，请稍后在「订单与说明」查看结果。';
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
          if (payload.status === 'failed') {
            orderStatus.hidden = false;
            orderStatus.textContent = state.order?.errorMessage || '生成失败，本次不扣费。';
          } else {
            orderStatus.hidden = true;
            paintResult();
          }
          if (!ctx.demoMode && ctx.refreshBalance) await ctx.refreshBalance();
          updateOrderButton();
        } else {
          orderStatus.hidden = false;
          orderStatus.textContent = STAGE_TEXT[payload.stage] || STAGE_TEXT.generating;
        }
      } catch {
        stopPolling();
        state.stylistBusy = false;
        orderStatus.hidden = false;
        orderStatus.textContent = '网络中断，未能确认结果，可稍后在「订单与说明」查看。';
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
      toast('请先上传一张全身照，试穿需要真人照片');
      personInput.click();
      return;
    }
    state.stylistBusy = true;
    updateOrderButton();
    orderStatus.hidden = false;
    orderStatus.textContent = '正在提交订单…';
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
      const body = {
        sessionId,
        person: state.person,
        fit: 'regular',
        prompt: '',
        pieces,
      };
      if (model) body.model = model;
      const payload = await api('/api/orders', { method: 'POST', body });
      const orderId = payload.order?.id ?? payload.orderId;
      state.order = { id: orderId, status: 'pending' };
      state.job = { status: 'queued', stage: 'queued' };
      resultEl.replaceChildren();
      if (typeof payload.balanceCents === 'number' && ctx.onBalanceChanged) ctx.onBalanceChanged(payload.balanceCents);
      orderStatus.hidden = false;
      orderStatus.textContent = STAGE_TEXT.queued;
      updateOrderButton();
      pollJob(payload.jobId);
    } catch (error) {
      state.stylistBusy = false;
      orderStatus.hidden = false;
      orderStatus.textContent = errorText(error);
      updateOrderButton();
      toast(errorText(error));
    }
  }

  // ---- 事件绑定 ----
  searchBtn.addEventListener('click', () => void runSearch());
  searchClear.addEventListener('click', clearSearch);
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
      personPreview.src = state.person;
      personPreview.hidden = false;
      personBtn.textContent = '更换全身照';
      updateOrderButton();
    };
    reader.onerror = () => toast('读取图片失败，请重试');
    reader.readAsDataURL(file);
  });

  // ---- 组装页面 ----
  root.append(
    h('section', { class: 'page-head wardrobe-head' }, [
      h('div', {}, [
        h('h1', { class: 'page-title', text: '我的衣橱' }),
        h('p', { class: 'page-sub', text: '把常穿的单品收进来，搭配与试穿都更快。' }),
      ]),
      h('button', { type: 'button', class: 'btn btn--primary', text: '上传图片', onclick: () => fileInput.click() }),
      fileInput,
    ]),
    h('section', { class: 'card wardrobe-search' }, [
      h('div', { class: 'inline-field' }, [searchInput, searchBtn, searchClear]),
    ]),
    h('section', { class: 'card' }, [
      h('h2', { class: 'section__title', text: '衣橱单品' }),
      gridEl,
    ]),
    h('section', { class: 'card stylist' }, [
      h('h2', { class: 'section__title' }, [
        '今日穿搭',
        h('span', { class: 'section__hint', text: '一句话说需求，从衣橱里帮你搭一套' }),
      ]),
      h('div', { class: 'inline-field' }, [requestInput, suggestBtn]),
      suggestionEl,
      h('div', { class: 'stylist__order' }, [
        h('div', { class: 'stylist__person' }, [personBtn, personPreview, personInput]),
        h('span', { class: 'push-end' }, [orderBtn]),
      ]),
      orderStatus,
      resultEl,
    ]),
    modalHost,
  );

  paintGrid();
  paintSuggestion();
  void loadItems();
}
