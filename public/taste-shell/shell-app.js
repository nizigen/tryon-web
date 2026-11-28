import {
  MAX_PIECES,
  buildStylistSuggestion,
  createEntry,
  createInitialState,
  nextId,
  productToEntry,
  readImageFile,
  recommendedPosesFor,
  selectedPiecesFromEntries,
  validateStudioDraft,
  wardrobeItemToEntry,
} from './shell-state.js';
import { DEFAULT_PERSON_URL, STUDIO_MAKEUP_URL } from './mock-data.js';
import { renderHomeView } from './shell-home.js';
import {
  renderAppShell,
  renderCatalogView,
  renderRecordsView,
  renderSettingsView,
  renderStudioView,
  renderWardrobeView,
} from './shell-workspace.js';

const VALID_ROUTES = new Set(['home', 'studio', 'wardrobe', 'shop', 'me', 'settings', 'tryon']);

function parseRouteFromHash() {
  const raw = (window.location.hash || '#/home').replace(/^#\/?/, '').trim();
  const [name = 'home', rest = ''] = raw.split('/');
  if (name === 'tryon' && rest) {
    return { name: 'tryon', productId: decodeURIComponent(rest) };
  }
  if (VALID_ROUTES.has(name) && name !== 'tryon') {
    return { name, productId: '' };
  }
  return { name: 'home', productId: '' };
}

const state = createInitialState();
let toastTimer = null;

function showToast(message) {
  state.toastMessage = message;
  if (toastTimer) clearTimeout(toastTimer);
  render();
  toastTimer = setTimeout(() => {
    state.toastMessage = '';
    render();
  }, 2800);
}

function navigate(hashRoute) {
  const target = hashRoute.startsWith('#/') ? hashRoute : `#/${hashRoute}`;
  if (window.location.hash === target) {
    syncRoute();
  } else {
    window.location.hash = target;
  }
}

function applyProductToStudio(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) {
    showToast('未找到该商品，已回到试穿工作台');
    return;
  }
  state.studio.entries = [productToEntry(product)];
  state.studio.step = 'pieces';
  state.studio.customPoses = null;
  showToast(`已载入单品：${product.name}`);
}

function syncRoute() {
  const next = parseRouteFromHash();
  state.route = next;
  state.mobileNavOpen = false;
  if (next.name === 'tryon' && next.productId) {
    applyProductToStudio(next.productId);
  }
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function mountMarkup(root, markup) {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  for (const bad of doc.body.querySelectorAll('script, iframe, object, embed')) {
    bad.remove();
  }
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (/^(href|src)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) {
        el.removeAttribute(attr.name);
      }
    }
  }
  root.replaceChildren(...doc.body.childNodes);
}

function render() {
  const root = document.getElementById('shell-root');
  if (!root) return;

  if (state.route.name === 'home') {
    mountMarkup(root, renderHomeView(state));
    return;
  }

  let view = { html: '', modal: '' };
  switch (state.route.name) {
    case 'studio':
    case 'tryon':
      view = renderStudioView(state);
      break;
    case 'wardrobe':
      view = renderWardrobeView(state);
      break;
    case 'shop':
      view = renderCatalogView(state);
      break;
    case 'me':
      view = renderRecordsView(state);
      break;
    case 'settings':
      view = renderSettingsView(state);
      break;
    default:
      view = renderStudioView(state);
      break;
  }

  mountMarkup(root, renderAppShell(state, view.html, view.modal));
}

function updateEntry(entryId, patch) {
  state.studio.entries = state.studio.entries.map((entry) =>
    entry.id === entryId ? { ...entry, ...patch } : entry,
  );
}

function runMockShoot(trial) {
  const pieces = selectedPiecesFromEntries(state.studio.entries);
  const issue = validateStudioDraft(state.studio.person, state.studio.entries);
  if (issue) {
    showToast(issue);
    return;
  }

  const isStudioMode = state.studio.mode === 'studio';
  const activePoses = state.studio.customPoses ?? recommendedPosesFor(pieces);
  const chosenPoseIds = isStudioMode ? (trial ? activePoses.slice(0, 1) : activePoses.slice(0, 3)) : ['preserve'];
  const poseMap = new Map(state.config.posePresets.map((p) => [p.id, p]));

  state.studio.shoot = {
    ...state.studio.shoot,
    busy: true,
    stage: 'generating',
    original: state.studio.person.image || DEFAULT_PERSON_URL,
  };
  render();

  setTimeout(() => {
    const shots = chosenPoseIds.map((poseId, idx) => {
      const preset = poseMap.get(poseId);
      let resultUrl = STUDIO_MAKEUP_URL;
      if (isStudioMode) {
        resultUrl = idx === 0 ? DEFAULT_PERSON_URL : preset?.referenceUrl || STUDIO_MAKEUP_URL;
      }
      return {
        poseId,
        poseLabel: preset ? preset.label : '原图保留',
        resultUrl,
      };
    });

    state.studio.shoot = {
      busy: false,
      batch: shots.length > 1,
      background: state.studio.background,
      model: state.settings.model,
      count: shots.length,
      index: 0,
      stage: 'done',
      original: state.studio.person.image || DEFAULT_PERSON_URL,
      shots,
    };
    state.studio.resultTab = 'result';
    state.studio.step = 'result';

    const names = pieces.map((p) => p.source?.name || p.garmentType).join(' · ');
    const newOrder = {
      id: nextId('ord'),
      productName: names || '组合搭配',
      slots: pieces.map((p) => p.slot),
      status: 'success',
      mode: state.studio.mode,
      poseLabel: shots[0]?.poseLabel || '默认',
      createdAt: new Date().toISOString(),
      resultUrl: shots[0]?.resultUrl || STUDIO_MAKEUP_URL,
      model: state.settings.model,
      note: isStudioMode
        ? `${state.config.studioPresets.find((p) => p.id === state.studio.background)?.label || '无影棚'} · ${shots.length} 姿成片`
        : '普通试穿 · 保留原图自然光线',
    };
    state.orders = [newOrder, ...state.orders];
    state.selectedOrderId = newOrder.id;
    showToast(`试拍完成，共生成 ${shots.length} 张成片`);
  }, 320);
}

function handleActionClick(target) {
  const action = target.dataset.action;
  if (!action) return;

  switch (action) {
    case 'toggle-mobile-nav':
      state.mobileNavOpen = !state.mobileNavOpen;
      render();
      return;

    case 'close-mobile-nav':
      state.mobileNavOpen = false;
      render();
      return;

    case 'compose-set': {
      const slot = target.dataset.slot;
      const itemId = target.dataset.itemId;
      if (!slot || !itemId) return;
      const next = { ...state.composer, [slot]: state.composer?.[slot] === itemId ? '' : itemId };
      if (slot === 'dress' && next.dress) {
        next.top = '';
        next.bottom = '';
      }
      if ((slot === 'top' || slot === 'bottom') && next[slot]) {
        next.dress = '';
      }
      state.composer = next;
      render();
      return;
    }

    case 'compose-clear': {
      state.composer = { top: '', bottom: '', dress: '', hosiery: '' };
      render();
      return;
    }

    case 'compose-to-studio': {
      const byId = new Map(state.wardrobe.map((item) => [item.id, item]));
      const entries = SLOT_ROWS.map((row) => byId.get(state.composer?.[row.slot]))
        .filter(Boolean)
        .map(wardrobeItemToEntry);
      if (!entries.length) return;
      state.studio.entries = entries;
      state.studio.mode = 'studio';
      state.studio.step = 'shoot';
      navigate('studio');
      showToast(`已带入 ${entries.length} 件单品`);
      return;
    }

    case 'studio-step': {
      state.studio.step = target.dataset.step || 'person';
      render();
      return;
    }

    case 'studio-person-preset': {
      const url = target.dataset.url || DEFAULT_PERSON_URL;
      state.studio.person = {
        image: url,
        isDefault: url === DEFAULT_PERSON_URL,
        error: '',
      };
      render();
      return;
    }

    case 'studio-add-entry': {
      if (state.studio.entries.length >= MAX_PIECES) return;
      state.studio.entries = [...state.studio.entries, createEntry({ slot: 'outer' })];
      render();
      return;
    }

    case 'studio-remove-entry': {
      const entryId = target.dataset.entryId;
      if (state.studio.entries.length <= 1) return;
      state.studio.entries = state.studio.entries.filter((e) => e.id !== entryId);
      render();
      return;
    }

    case 'studio-toggle-link': {
      const entryId = target.dataset.entryId;
      state.studio.openLinkEntryId = state.studio.openLinkEntryId === entryId ? null : entryId;
      render();
      return;
    }

    case 'studio-parse-link': {
      const entryId = target.dataset.entryId;
      const entry = state.studio.entries.find((e) => e.id === entryId);
      if (!entry) return;
      const parsed = state.parseLink(entry.linkDraft || 'https://item.taobao.com/demo');
      updateEntry(entryId, { parsedLink: parsed });
      render();
      return;
    }

    case 'studio-pick-link-image': {
      const entryId = target.dataset.entryId;
      updateEntry(entryId, {
        source: {
          kind: 'import',
          imageUrl: target.dataset.url,
          name: target.dataset.name || '链接导入单品',
        },
        error: '',
      });
      state.studio.openLinkEntryId = null;
      showToast('已填入商品主图');
      return;
    }

    case 'studio-open-picker': {
      state.studio.pickerEntryId = target.dataset.entryId;
      render();
      return;
    }

    case 'studio-close-picker': {
      state.studio.pickerEntryId = null;
      render();
      return;
    }

    case 'studio-pick-wardrobe-item': {
      const entryId = target.dataset.entryId;
      const item = state.wardrobe.find((w) => w.id === target.dataset.itemId);
      if (!item) return;
      updateEntry(entryId, {
        slot: item.category,
        subtype: item.subtype,
        layer: item.layer || 'auto',
        source: {
          kind: 'wardrobe',
          wardrobeId: item.id,
          imageUrl: item.imageUrl,
          name: item.name,
        },
        error: '',
      });
      state.studio.pickerEntryId = null;
      showToast(`已选入：${item.name}`);
      return;
    }

    case 'studio-mode': {
      state.studio.mode = target.dataset.mode === 'preserve' ? 'preserve' : 'studio';
      render();
      return;
    }

    case 'studio-background': {
      state.studio.background = target.dataset.bg || state.config.defaultStudioPreset;
      render();
      return;
    }

    case 'studio-fit': {
      state.studio.fit = target.dataset.fit || 'regular';
      render();
      return;
    }

    case 'studio-toggle-pose': {
      const poseId = target.dataset.pose;
      const pieces = selectedPiecesFromEntries(state.studio.entries);
      const current = [...(state.studio.customPoses ?? recommendedPosesFor(pieces))];
      const idx = current.indexOf(poseId);
      if (idx !== -1) {
        if (current.length <= 1) return;
        current.splice(idx, 1);
      } else {
        if (current.length >= 3) current.shift();
        current.push(poseId);
      }
      state.studio.customPoses = current;
      render();
      return;
    }

    case 'studio-reset-poses': {
      state.studio.customPoses = null;
      render();
      return;
    }

    case 'studio-submit': {
      runMockShoot(target.dataset.trial === 'true');
      return;
    }

    case 'studio-result-tab': {
      state.studio.resultTab = target.dataset.tab || 'result';
      render();
      return;
    }

    case 'studio-select-shot': {
      state.studio.shoot.index = Number(target.dataset.index) || 0;
      render();
      return;
    }

    case 'wardrobe-category': {
      state.wardrobeCategory = target.dataset.category || '';
      render();
      return;
    }

    case 'wardrobe-toggle-select': {
      const id = target.dataset.itemId;
      if (state.wardrobeSelection.includes(id)) {
        state.wardrobeSelection = state.wardrobeSelection.filter((x) => x !== id);
      } else if (state.wardrobeSelection.length < MAX_PIECES) {
        state.wardrobeSelection = [...state.wardrobeSelection, id];
      } else {
        showToast(`一套最多选 ${MAX_PIECES} 件单品`);
        return;
      }
      render();
      return;
    }

    case 'wardrobe-send-studio': {
      const byId = new Map(state.wardrobe.map((item) => [item.id, item]));
      const entries = state.wardrobeSelection
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(wardrobeItemToEntry);
      if (!entries.length) return;
      state.studio.entries = entries;
      state.studio.step = 'pieces';
      navigate('studio');
      showToast(`已带入 ${entries.length} 件衣橱单品`);
      return;
    }

    case 'wardrobe-open-create': {
      state.wardrobeDialog = {
        type: 'create',
        form: {
          name: '',
          category: 'top',
          subtype: '衬衫',
          layer: 'auto',
          tags: ['通勤'],
          imageUrl: '/catalog/blouse-linen.jpg',
        },
      };
      render();
      return;
    }

    case 'wardrobe-open-edit': {
      const item = state.wardrobe.find((w) => w.id === target.dataset.itemId);
      if (!item) return;
      state.wardrobeDialog = {
        type: 'edit',
        itemId: item.id,
        form: { ...item, tags: [...(item.tags || [])] },
      };
      render();
      return;
    }

    case 'wardrobe-open-import': {
      state.wardrobeDialog = { type: 'import', url: '', parsed: null };
      render();
      return;
    }

    case 'wardrobe-close-dialog': {
      state.wardrobeDialog = null;
      render();
      return;
    }

    case 'wardrobe-import-parse': {
      if (state.wardrobeDialog?.type !== 'import') return;
      state.wardrobeDialog.parsed = state.parseLink(state.wardrobeDialog.url || 'https://item.taobao.com/demo');
      render();
      return;
    }

    case 'wardrobe-import-add': {
      const url = target.dataset.url;
      const name = target.dataset.name || '链接导入单品';
      const newItem = {
        id: nextId('w'),
        name,
        category: 'top',
        subtype: '衬衫',
        layer: 'auto',
        tags: ['链接导入', '通勤'],
        imageUrl: url,
        source: 'import',
      };
      state.wardrobe = [newItem, ...state.wardrobe];
      state.wardrobeDialog = null;
      showToast(`已收藏进衣橱：${name}`);
      return;
    }

    case 'wardrobe-delete-item': {
      const id = target.dataset.itemId;
      state.wardrobe = state.wardrobe.filter((w) => w.id !== id);
      state.wardrobeSelection = state.wardrobeSelection.filter((x) => x !== id);
      showToast('已从衣橱删除该单品');
      return;
    }

    case 'stylist-send-studio': {
      const suggestion = state.stylist.suggestion;
      if (!suggestion) return;
      const items = Object.values(suggestion.slots).flat();
      if (!items.length) return;
      state.studio.entries = items.map(wardrobeItemToEntry);
      state.studio.mode = target.dataset.mode === 'preserve' ? 'preserve' : 'studio';
      state.studio.step = 'shoot';
      navigate('studio');
      showToast('已将 AI 推荐穿搭带入试穿工作台');
      return;
    }

    case 'stylist-quick-shoot': {
      const suggestion = state.stylist.suggestion;
      if (!suggestion) return;
      const items = Object.values(suggestion.slots).flat();
      if (!items.length) return;
      state.stylist.shootBusy = true;
      render();
      setTimeout(() => {
        const order = {
          id: nextId('ord'),
          productName: items.map((i) => i.name).join(' · '),
          slots: items.map((i) => i.category),
          status: 'success',
          mode: 'preserve',
          poseLabel: '今日穿搭快速预览',
          createdAt: new Date().toISOString(),
          resultUrl: STUDIO_MAKEUP_URL,
          model: state.settings.model,
          note: `AI 今日穿搭快速试穿：${suggestion.request}`,
        };
        state.orders = [order, ...state.orders];
        state.selectedOrderId = order.id;
        state.stylist.shootBusy = false;
        state.stylist.shootResult = order;
        showToast('已生成今日穿搭试穿成片');
      }, 280);
      return;
    }

    case 'catalog-category': {
      state.catalogCategory = target.dataset.category || '';
      render();
      return;
    }

    case 'catalog-tryon': {
      const productId = target.dataset.productId;
      if (!productId) return;
      navigate(`tryon/${encodeURIComponent(productId)}`);
      return;
    }

    case 'records-filter': {
      state.recordsFilter = target.dataset.filter || 'all';
      render();
      return;
    }

    case 'records-select': {
      state.selectedOrderId = target.dataset.orderId;
      render();
      return;
    }

    case 'records-refresh': {
      let promoted = 0;
      state.orders = state.orders.map((order) => {
        if (order.status === 'pending') {
          promoted += 1;
          return {
            ...order,
            status: 'success',
            resultUrl: STUDIO_MAKEUP_URL,
            note: '刷新后已完成生成（本地交互壳子模拟）',
          };
        }
        return order;
      });
      showToast(promoted ? `已更新 ${promoted} 条生成中的记录` : '所有试穿记录已是最新状态');
      return;
    }

    case 'records-retry': {
      state.studio.step = 'shoot';
      navigate('studio');
      return;
    }

    case 'settings-source-login': {
      const platform = target.dataset.platform;
      state.settings.loginState = { ...state.settings.loginState, [platform]: 'scanning' };
      render();
      setTimeout(() => {
        state.settings.sources = { ...state.settings.sources, [platform]: true };
        state.settings.loginState = { ...state.settings.loginState, [platform]: 'done' };
        showToast('扫码登录成功（模拟状态）');
      }, 450);
      return;
    }

    case 'settings-source-logout': {
      const platform = target.dataset.platform;
      state.settings.sources = { ...state.settings.sources, [platform]: false };
      state.settings.loginState = { ...state.settings.loginState, [platform]: 'idle' };
      showToast('已退出该平台登录状态');
      return;
    }

    default:
      return;
  }
}

document.addEventListener('click', (event) => {
  const stop = event.target.closest('[data-stop-propagation="true"]');
  const actionEl = event.target.closest('[data-action]');
  if (actionEl) {
    if (actionEl.classList.contains('modal-backdrop') || actionEl.classList.contains('drawer-backdrop')) {
      if (stop) return;
    }
    if (actionEl.tagName === 'INPUT' || actionEl.tagName === 'SELECT' || actionEl.tagName === 'TEXTAREA') {
      return;
    }
    handleActionClick(actionEl);
  }
});

document.addEventListener('input', (event) => {
  const target = event.target;
  const action = target?.dataset?.action;
  if (!action) return;

  if (action === 'studio-link-input') {
    updateEntry(target.dataset.entryId, { linkDraft: target.value });
  } else if (action === 'studio-prompt') {
    state.studio.prompt = target.value;
  } else if (action === 'wardrobe-search') {
    state.wardrobeQuery = target.value;
    render();
    const nextInput = document.querySelector('[data-action="wardrobe-search"]');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
    }
  } else if (action === 'catalog-search') {
    state.catalogQuery = target.value;
    render();
    const nextInput = document.querySelector('[data-action="catalog-search"]');
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
    }
  } else if (action === 'wardrobe-import-input' && state.wardrobeDialog?.type === 'import') {
    state.wardrobeDialog.url = target.value;
  }
});

document.addEventListener('change', async (event) => {
  const target = event.target;
  const action = target?.dataset?.action;
  if (!action) return;

  if (action === 'studio-person-file') {
    const file = target.files?.[0];
    try {
      const dataUrl = await readImageFile(file);
      state.studio.person = { image: dataUrl, isDefault: false, error: '' };
      showToast('已更新试穿人物照片');
    } catch (err) {
      state.studio.person = { ...state.studio.person, error: err.message };
      render();
    }
  } else if (action === 'studio-entry-file') {
    const file = target.files?.[0];
    const entryId = target.dataset.entryId;
    try {
      const dataUrl = await readImageFile(file);
      updateEntry(entryId, {
        source: { kind: 'upload', imageUrl: dataUrl, name: file.name.replace(/\.[^.]+$/, '') },
        error: '',
      });
      showToast('已载入本地单品图');
    } catch (err) {
      updateEntry(entryId, { error: err.message });
      render();
    }
  } else if (action === 'studio-entry-slot') {
    updateEntry(target.dataset.entryId, { slot: target.value, subtype: '' });
    render();
  } else if (action === 'studio-entry-subtype') {
    updateEntry(target.dataset.entryId, { subtype: target.value });
    render();
  } else if (action === 'studio-entry-layer') {
    updateEntry(target.dataset.entryId, { layer: target.value });
    render();
  } else if (action === 'wardrobe-dialog-file' && state.wardrobeDialog) {
    const file = target.files?.[0];
    try {
      const dataUrl = await readImageFile(file);
      state.wardrobeDialog.form.imageUrl = dataUrl;
      render();
    } catch (err) {
      showToast(err.message);
    }
  } else if (action === 'wardrobe-dialog-category' && state.wardrobeDialog) {
    const nextCat = target.value;
    const def = state.slotByKey[nextCat];
    state.wardrobeDialog.form.category = nextCat;
    state.wardrobeDialog.form.subtype = def?.subtypes[0] || '';
    render();
  } else if (action === 'settings-model') {
    state.settings.model = target.value;
    showToast('已切换试穿图像模型');
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.id === 'stylist-form') {
    event.preventDefault();
    const input = form.elements.request;
    const requestText = String(input?.value || '').trim();
    if (!requestText) {
      showToast('请先输入今天的穿搭需求');
      return;
    }
    state.stylist.request = requestText;
    state.stylist.busy = true;
    state.stylist.shootResult = null;
    render();
    setTimeout(() => {
      state.stylist.busy = false;
      state.stylist.suggestion = buildStylistSuggestion(state.wardrobe, requestText);
      render();
    }, 220);
  } else if (form.id === 'wardrobe-item-form' && state.wardrobeDialog) {
    event.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const category = String(fd.get('category') || 'top');
    const subtype = String(fd.get('subtype') || '');
    const layer = String(fd.get('layer') || 'auto');
    const tags = String(fd.get('tags') || '')
      .split(/[\s,，、]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const imageUrl = state.wardrobeDialog.form.imageUrl || '/catalog/blouse-linen.jpg';

    if (state.wardrobeDialog.type === 'create') {
      const item = { id: nextId('w'), name, category, subtype, layer, tags, imageUrl, source: 'upload' };
      state.wardrobe = [item, ...state.wardrobe];
      state.wardrobeDialog = null;
      showToast(`已添加到衣橱：${name}`);
    } else if (state.wardrobeDialog.type === 'edit') {
      const id = state.wardrobeDialog.itemId;
      state.wardrobe = state.wardrobe.map((w) =>
        w.id === id ? { ...w, name, category, subtype, layer, tags, imageUrl } : w,
      );
      state.wardrobeDialog = null;
      showToast(`已保存修改：${name}`);
    }
  }
});

window.addEventListener('hashchange', syncRoute);
syncRoute();
