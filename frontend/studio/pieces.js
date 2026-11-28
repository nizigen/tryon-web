import { defaultSubtype, SLOTS, SLOT_BY_KEY } from '../../public/lib/garment-taxonomy.js';
import { findOutfitConflict, MAX_ACCESSORIES } from '../../public/lib/outfit-rules.js';

export const MAX_PIECES = 5;
export const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp';
const MAX_PAYLOAD_CHARS = Math.floor(24 * 1024 * 1024 * 0.9);
const LAYER_LABEL = { inner: '内层', middle: '中层', outer: '外层' };

export const GROUPS = SLOTS.map(({ key, label, subtypes }) => ({ value: key, label, options: subtypes }));

export function newPiece(seed = {}) {
  return { id: crypto.randomUUID(), slot: '', subtype: '', layer: 'auto', source: null, ...seed };
}

export function initialPieces(seed) {
  const list = (Array.isArray(seed) ? seed : [seed]).filter(item => item && SLOT_BY_KEY[item.slot]);
  return list.length ? list.slice(0, MAX_PIECES).map(({ slot, subtype, layer, source }) =>
    newPiece({ slot, subtype: subtype || '', layer: layer || 'auto', source: source ?? null })) : [newPiece({ slot: 'top' })];
}

export function readImage(file) {
  if (!ACCEPTED_IMAGES.split(',').includes(file.type)) return Promise.reject(new Error('只支持 PNG / JPEG / WebP 图片，请重新选择。'));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('图片不能超过 8MB，请重新选择。'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onabort = reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'));
    reader.readAsDataURL(file);
  });
}

export function selectedPieces(entries) {
  return entries.filter(piece => piece.source).map(({ slot, subtype, layer, source }) => ({
    slot, garmentType: subtype || defaultSubtype(slot), layer, source,
  }));
}

export function submitIssue(person, entries, pieces) {
  if (!person.image) return '请先选择人物照片';
  const firstError = entries.findIndex(piece => piece.error);
  if (firstError !== -1) return `请重新选择第 ${firstError + 1} 件单品的图片${entries.length > 1 ? '，或移除该单品' : ''}`;
  if (entries.some(piece => piece.readToken)) return '正在读取单品图片…';
  if (!pieces.length) return '至少选择一件单品';
  const conflict = findOutfitConflict(pieces);
  if (conflict?.kind === 'layer') {
    const positions = entries.flatMap((piece, index) => piece.source ? [index + 1] : []);
    return `第 ${positions[conflict.firstIndex]} 件和第 ${positions[conflict.secondIndex]} 件都在${LAYER_LABEL[conflict.layer]}，请更改穿着层级或移除一件`;
  }
  if (conflict?.kind === 'accessory-limit') return `配饰最多 ${MAX_ACCESSORIES} 件，请移除多余的配饰`;
  if (conflict?.kind === 'dress') return '连衣裙与上衣／下装不能同穿，请移除其中一边';
  const size = pieces.reduce((sum, { source }) => sum + (source.image?.length ?? 0), person.image.length);
  if (size > MAX_PAYLOAD_CHARS) return '这几张图加起来太大了，请换更小的图或减少单品';
  return '';
}

export function changePiece(entries, id, changes, requireToken) {
  return entries.map(piece => {
    if (piece.id !== id || (requireToken && piece.readToken !== requireToken)) return piece;
    if (changes.source && !('slot' in changes) && !piece.slot) {
      const used = new Set(entries.map(item => item.slot));
      const slot = SLOTS.find(item => !used.has(item.key))?.key ?? 'top';
      return { ...piece, ...changes, slot };
    }
    return { ...piece, ...changes };
  });
}

export function fromWardrobe(item) {
  const definition = SLOT_BY_KEY[item.category];
  return {
    slot: definition?.key ?? 'top', subtype: definition?.subtypes.includes(item.subtype) ? item.subtype : '', layer: item.layer ?? 'auto',
    source: { kind: 'wardrobe', wardrobeId: item.id, imageUrl: item.imageUrl, name: item.name || '' },
    readToken: null, error: '',
  };
}

export function recommendedPoses(pieces) {
  const slots = new Set(pieces.map(piece => piece.slot));
  return !slots.has('outer') && slots.has('dress')
    ? ['contrapposto', 'duck-sit', 'crouch-chin']
    : ['contrapposto', 'hand-behind-head', 'over-shoulder'];
}
