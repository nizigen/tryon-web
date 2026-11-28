export const LAYER_ORDER = Object.freeze(['inner', 'middle', 'outer']);
export const MAX_ACCESSORIES = 2;

const DEFAULT_LAYER = {
  top: 'middle', bottom: 'middle', dress: 'middle', hosiery: 'inner', outer: 'outer', shoes: 'outer', accessory: 'outer',
};

export function resolveOutfitLayer({ slot, layer = 'auto' }) {
  return layer === 'auto' ? DEFAULT_LAYER[slot] : layer;
}

export function findOutfitConflict(pieces) {
  const placements = pieces.map(piece => ({ slot: piece.slot, layer: resolveOutfitLayer(piece) }));
  for (const [secondIndex, { slot, layer }] of placements.entries()) {
    if (slot === 'accessory') continue;
    const firstIndex = placements.findIndex((piece, index) => index < secondIndex && piece.slot === slot && piece.layer === layer);
    if (firstIndex !== -1) return { kind: 'layer', firstIndex, secondIndex, layer };
  }
  if (placements.filter(piece => piece.slot === 'accessory').length > MAX_ACCESSORIES) return { kind: 'accessory-limit' };
  const slots = new Set(placements.map(piece => piece.slot));
  if (slots.has('dress') && (slots.has('top') || slots.has('bottom'))) return { kind: 'dress' };
  return null;
}
