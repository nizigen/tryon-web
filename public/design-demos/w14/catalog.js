import { findOutfitConflict } from '/lib/outfit-rules.js';

export const groups = Object.freeze([
  { id: 'top', name: '上衣' },
  { id: 'bottom', name: '下装' },
  { id: 'dress', name: '连衣裙' },
]);

export const garments = Object.freeze([
  { id: 'blouse-linen', slot: 'top', name: '白色亚麻衬衫', tags: '翻领' },
  { id: 'shirt-floral', slot: 'top', name: '红色碎花衬衫', tags: '短袖' },
  { id: 'sweater-knit', slot: 'top', name: '米色麻花毛衣', tags: '针织' },
  { id: 'jeans-black', slot: 'bottom', name: '黑色直筒牛仔裤', tags: '高腰 长裤' },
  { id: 'skirt-pleated', slot: 'bottom', name: '灰色百褶半身裙', tags: '中长' },
  { id: 'dress-slip', slot: 'dress', name: '黑色缎面吊带裙', tags: '连衣裙 中长' },
]);

export const maxPieces = 5;

export function filterGarments(category, query) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return garments.filter(garment => {
    const group = groups.find(group => group.id === garment.slot);
    const text = `${garment.name} ${garment.tags} ${group.name} ${garment.id}`;
    return (category === 'all' || garment.slot === category) && words.every(word => text.includes(word));
  });
}

export function lookProblem(look) {
  const conflict = findOutfitConflict(look);
  if (conflict?.kind === 'dress') return '连衣裙不能和上衣或下装同穿。';
  if (conflict?.kind !== 'layer') return '';
  const group = groups.find(group => group.id === look[conflict.firstIndex].slot);
  return `同一层只能留一件${group.name}，请取消一件。`;
}
