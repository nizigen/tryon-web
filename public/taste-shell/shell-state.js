import {
  CATALOG_PRODUCTS,
  DEFAULT_PERSON_URL,
  INITIAL_ORDERS,
  INITIAL_SOURCES,
  INITIAL_WARDROBE,
  LOOKBOOK_PRESETS,
  SHELL_CONFIG,
  SLOT_BY_KEY,
  SLOTS,
  STUDIO_MAKEUP_URL,
  mockParseLink,
} from './mock-data.js';
import { defaultSubtype, slotForCategory } from '../lib/garment-taxonomy.js';
import { findOutfitConflict, MAX_ACCESSORIES } from '../lib/outfit-rules.js';

export const MAX_PIECES = 5;
export const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp';
export const LAYER_LABELS = {
  auto: '自动（按类目）',
  inner: '内层',
  middle: '中层',
  outer: '外层',
};

let uidCounter = 1;
export function nextId(prefix) {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}`;
}

export function createEntry(seed = {}) {
  return {
    id: nextId('entry'),
    slot: 'top',
    subtype: '',
    layer: 'auto',
    source: null,
    error: '',
    ...seed,
  };
}

export function wardrobeItemToEntry(item) {
  const slot = SLOT_BY_KEY[item.category] ? item.category : 'top';
  const def = SLOT_BY_KEY[slot];
  return createEntry({
    slot,
    subtype: def?.subtypes.includes(item.subtype) ? item.subtype : '',
    layer: item.layer || 'auto',
    source: {
      kind: 'wardrobe',
      wardrobeId: item.id,
      imageUrl: item.imageUrl,
      name: item.name,
    },
  });
}

export function productToEntry(product) {
  const slot = product.slot && SLOT_BY_KEY[product.slot] ? product.slot : slotForCategory(product.category);
  const def = SLOT_BY_KEY[slot];
  return createEntry({
    slot,
    subtype: def?.subtypes.includes(product.subtype) ? product.subtype : '',
    layer: 'auto',
    source: {
      kind: 'product',
      productId: product.id,
      imageUrl: product.image,
      name: product.name,
    },
  });
}

export function readImageFile(file) {
  if (!file) return Promise.reject(new Error('请选择图片文件。'));
  if (!ACCEPTED_IMAGES.split(',').includes(file.type)) {
    return Promise.reject(new Error('仅支持 PNG / JPEG / WebP 格式。'));
  }
  if (file.size > 8 * 1024 * 1024) {
    return Promise.reject(new Error('图片体积不能超过 8MB。'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

export function selectedPiecesFromEntries(entries) {
  return entries
    .filter((entry) => entry.source)
    .map((entry) => ({
      slot: entry.slot || 'top',
      garmentType: entry.subtype || defaultSubtype(entry.slot || 'top'),
      layer: entry.layer || 'auto',
      source: entry.source,
    }));
}

export function recommendedPosesFor(pieces) {
  const slots = new Set(pieces.map((piece) => piece.slot));
  if (!slots.has('outer') && slots.has('dress')) {
    return ['contrapposto', 'duck-sit', 'crouch-chin'];
  }
  return ['contrapposto', 'hand-behind-head', 'over-shoulder'];
}

export function validateStudioDraft(person, entries) {
  if (!person.image) return '请先选择试穿人物照片';
  const badIndex = entries.findIndex((entry) => entry.error);
  if (badIndex !== -1) return `请重新选择第 ${badIndex + 1} 件单品图片`;
  const pieces = selectedPiecesFromEntries(entries);
  if (!pieces.length) return '至少选入 1 件单品才能试拍';
  const conflict = findOutfitConflict(pieces);
  if (conflict?.kind === 'layer') {
    const filledIdx = entries.flatMap((entry, idx) => (entry.source ? [idx + 1] : []));
    const layerText = LAYER_LABELS[conflict.layer] || conflict.layer;
    return `第 ${filledIdx[conflict.firstIndex]} 件与第 ${filledIdx[conflict.secondIndex]} 件同在${layerText}，请调整穿着层级或移除一件`;
  }
  if (conflict?.kind === 'accessory-limit') {
    return `配饰最多 ${MAX_ACCESSORIES} 件，请移除多余配饰`;
  }
  if (conflict?.kind === 'dress') {
    return '连衣裙不能与上衣或下装同时试穿，请先移除其中一边';
  }
  return '';
}

export function buildStylistSuggestion(wardrobe, requestText) {
  const query = String(requestText || '').trim().toLowerCase();
  const scoreItem = (item) => {
    const haystack = [item.name, item.subtype, ...(item.tags || [])].join(' ').toLowerCase();
    let score = 0;
    if (query) {
      for (const token of query.split(/[\s,，。、]+/).filter(Boolean)) {
        if (haystack.includes(token)) score += 4;
      }
      if (/面试|正式|通勤|上班|职场/.test(query) && /通勤|面试|衬衫|百褶|西装/.test(haystack)) score += 5;
      if (/约会|晚宴|裙|浪漫|法式/.test(query) && /缎面|吊带|碎花|连衣裙|法式/.test(haystack)) score += 5;
      if (/秋冬|温暖|温柔|针织|日常/.test(query) && /针织|毛衣|牛仔|日常|温柔/.test(haystack)) score += 5;
    }
    return score;
  };

  const ranked = [...wardrobe].sort((a, b) => scoreItem(b) - scoreItem(a));
  const preferDress = /连衣裙|晚宴|约会|裙子|法式/.test(query);
  const dress = ranked.find((item) => item.category === 'dress');
  const top = ranked.find((item) => item.category === 'top');
  const bottom = ranked.find((item) => item.category === 'bottom');
  const outer = ranked.find((item) => item.category === 'outer');

  const slots = {};
  const missing = [];
  let reason = '';

  if (preferDress && dress) {
    slots.dress = [dress];
    if (outer) slots.outer = [outer];
    reason = `结合「${requestText.trim()}」，以「${dress.name}」为主体，保留清晰轮廓与克制垂坠感。`;
  } else if (top && bottom) {
    slots.top = [top];
    slots.bottom = [bottom];
    if (outer) slots.outer = [outer];
    reason = `结合「${requestText.trim()}」，用「${top.name}」搭「${bottom.name}」，上下层次比例协调，适合直接进无影棚试拍。`;
  } else if (dress) {
    slots.dress = [dress];
    reason = `当前衣橱以连衣裙最为完整，优先推荐「${dress.name}」整套试穿。`;
  } else if (ranked.length) {
    const first = ranked[0];
    slots[first.category] = [first];
    if (first.category === 'top') missing.push('bottom');
    if (first.category === 'bottom') missing.push('top');
    reason = `已挑出最贴近需求的「${first.name}」，补充下装或外套后整体更完整。`;
  }

  if (!wardrobe.some((item) => item.category === 'shoes')) missing.push('shoes');
  return { slots, reason, missing: [...new Set(missing)], request: requestText.trim() };
}

export function createInitialState() {
  const defaultEntries = [
    wardrobeItemToEntry(INITIAL_WARDROBE[0]),
    wardrobeItemToEntry(INITIAL_WARDROBE[3]),
  ];
  return {
    route: { name: 'home', productId: '' },
    mobileNavOpen: false,
    composer: {
      top: INITIAL_WARDROBE[1].id,
      bottom: INITIAL_WARDROBE[3].id,
      dress: '',
      hosiery: '',
    },
    wardrobe: INITIAL_WARDROBE.map((item) => ({ ...item, tags: [...item.tags] })),
    wardrobeSelection: [INITIAL_WARDROBE[0].id, INITIAL_WARDROBE[3].id],
    wardrobeQuery: '',
    wardrobeCategory: '',
    wardrobeDialog: null,
    wardrobeMenuId: null,
    stylist: {
      request: '明天去美术馆看展，想要温柔又利落的通勤针织搭配',
      busy: false,
      suggestion: null,
      shootBusy: false,
      shootResult: null,
    },
    catalogQuery: '',
    catalogCategory: '',
    studio: {
      step: 'person',
      person: {
        image: DEFAULT_PERSON_URL,
        isDefault: true,
        error: '',
      },
      entries: defaultEntries,
      mode: 'studio',
      background: SHELL_CONFIG.defaultStudioPreset,
      customPoses: null,
      fit: 'regular',
      prompt: '',
      openLinkEntryId: null,
      pickerEntryId: null,
      resultTab: 'result',
      shoot: {
        busy: false,
        batch: false,
        background: SHELL_CONFIG.defaultStudioPreset,
        model: SHELL_CONFIG.defaultModel,
        count: 0,
        index: 0,
        stage: 'idle',
        original: DEFAULT_PERSON_URL,
        shots: [],
      },
    },
    orders: INITIAL_ORDERS.map((order) => ({ ...order, slots: [...order.slots] })),
    selectedOrderId: INITIAL_ORDERS[0].id,
    recordsFilter: 'all',
    settings: {
      model: SHELL_CONFIG.defaultModel,
      sources: { ...INITIAL_SOURCES },
      loginState: {},
      gatewayReachable: true,
    },
    toastMessage: '',
    lookbooks: LOOKBOOK_PRESETS,
    products: CATALOG_PRODUCTS,
    config: SHELL_CONFIG,
    slots: SLOTS,
    slotByKey: SLOT_BY_KEY,
    parseLink: mockParseLink,
    fallbackStudioImage: STUDIO_MAKEUP_URL,
  };
}
