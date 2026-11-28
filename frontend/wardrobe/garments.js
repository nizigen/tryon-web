import { SLOT_BY_KEY } from '../../public/lib/garment-taxonomy.js';

export { ACCEPTED_IMAGES, GROUPS as CATEGORY_GROUPS, MAX_PIECES as MAX_SELECTION, readImage as readImageFile } from '../studio/pieces.js';

export function categoryLabel(slot) {
  return SLOT_BY_KEY[slot]?.label || slot || '未分类';
}

export function garmentImage(item) {
  return item.imageUrl || `/api/wardrobe/${encodeURIComponent(item.id)}/image`;
}

export function garmentSummary(item) {
  return [categoryLabel(item.category), item.subtype].filter(Boolean).join(' / ');
}

export function wardrobePiece(item) {
  return {
    slot: item.category,
    subtype: item.subtype || '',
    layer: item.layer ?? 'auto',
    source: { kind: 'wardrobe', wardrobeId: item.id, imageUrl: garmentImage(item), name: item.name || '' },
  };
}

