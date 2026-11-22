import { h } from '../lib/dom.js';
import { SLOT_BY_KEY, slotForCategory } from '../lib/garment-taxonomy.js';
import { renderStudio } from './studio.js';

/**
 * 旧链接 #/tryon/:id 适配器：把目录商品转成工作台的预填单品（单件），
 * 复用同一套七格界面与提交流程，保证旧链接继续可用。
 */
export function renderTryon(root, ctx, productId) {
  const product = ctx.products.find((item) => item.id === productId);
  if (!product) {
    root.append(
      h('section', { class: 'page-head' }, [
        h('h1', { class: 'page-title', text: '单品试穿' }),
      ]),
      h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '没有找到这件商品' }),
        h('p', { text: '商品可能已下架，去橱窗看看其它单品吧。' }),
        h('button', { type: 'button', class: 'btn btn--sm', text: '回到橱窗', onclick: () => ctx.onNavigate('shop') }),
      ]),
    );
    return;
  }

  renderStudio(root, ctx, {
    slot: slotFor(product, ctx),
    subtype: subtypeFor(product, ctx),
    source: { kind: 'product', productId: product.id, imageUrl: `/${product.image}`, name: product.name },
  });
}

/** 上衣里 layer=outer（夹克/大衣）归到外套格，其余按分类映射。 */
function slotFor(product, ctx) {
  if (product.category === 'tops') {
    const types = ctx.config.garmentTypes?.tops ?? [];
    const type = types.find((item) => item.id === product.garmentType);
    if (type?.layer === 'outer') return 'outer';
  }
  return slotForCategory(product.category);
}

/** 后端 garmentType 是英文 id，映射到前端子类中文名；匹配不到则留空由用户选择。 */
function subtypeFor(product, ctx) {
  const types = ctx.config.garmentTypes?.[product.category] ?? [];
  const type = types.find((item) => item.id === product.garmentType);
  if (!type) return '';
  const slot = SLOT_BY_KEY[slotFor(product, ctx)];
  const parts = String(type.label).split('/').filter(Boolean);
  const hit = (slot?.subtypes ?? []).find((name) => parts.some((part) => part.includes(name) || name.includes(part)));
  return hit ?? '';
}
