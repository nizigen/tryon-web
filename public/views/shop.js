import { h, money } from '../lib/dom.js';

const CATEGORY_FILTERS = [
  { id: '', label: '全部' },
  { id: 'tops', label: '上衣' },
  { id: 'bottoms', label: '下装' },
  { id: 'dresses', label: '连衣裙' },
];

export function renderShop(root, ctx) {
  let category = '';
  let keyword = '';

  const grid = h('div', { class: 'grid' });
  const chips = h('div', { class: 'filters', role: 'group', 'aria-label': '商品分类' });
  const search = h('input', {
    type: 'search',
    placeholder: '搜索商品，例如：衬衫、牛仔裤',
    'aria-label': '搜索商品',
    oninput: (event) => {
      keyword = event.target.value.trim();
      paint();
    },
  });

  function paint() {
    for (const chip of chips.children) {
      chip.classList.toggle('is-active', chip.dataset.category === category);
      chip.setAttribute('aria-pressed', chip.dataset.category === category ? 'true' : 'false');
    }
    const visible = ctx.products.filter((product) => {
      const inCategory = !category || product.category === category;
      const text = `${product.name} ${product.subtitle ?? ''} ${(product.tags ?? []).join(' ')}`.toLowerCase();
      return inCategory && (!keyword || text.includes(keyword.toLowerCase()));
    });
    grid.replaceChildren();
    if (visible.length === 0) {
      grid.append(h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '没有找到相关商品' }),
        h('p', { text: '换个关键词，或看看全部商品。' }),
      ]));
      grid.style.gridTemplateColumns = '1fr';
      return;
    }
    grid.style.gridTemplateColumns = '';
    for (const product of visible) grid.append(productCard(product));
  }

  function productCard(product) {
    const image = h('img', {
      src: `/${product.image}`,
      alt: product.name,
      loading: 'lazy',
      decoding: 'async',
      width: 400,
      height: 500,
    });
    return h('article', { class: 'product' }, [
      h('div', { class: 'product__media' }, [
        image,
        h('span', { class: 'product__badge', text: 'AI 生成商品图' }),
      ]),
      h('div', { class: 'product__body' }, [
        h('h3', { class: 'product__name', text: product.name }),
        h('p', { class: 'product__sub', text: product.subtitle ?? '' }),
        h('div', { class: 'product__foot' }, [
          h('span', { class: 'product__price', text: money(product.priceCents) }),
          h('span', { class: 'product__tryon', text: `试穿 ${money(ctx.config.tryOnFromCents)} 起` }),
        ]),
        h('button', {
          type: 'button',
          class: 'btn btn--primary btn--block btn--sm',
          text: '试穿这件',
          onclick: () => ctx.onOpenProduct(product.id),
        }),
      ]),
    ]);
  }

  for (const filter of CATEGORY_FILTERS) {
    const chip = h('button', {
      type: 'button',
      class: 'filter',
      text: filter.label,
      dataset: { category: filter.id },
      'aria-pressed': 'false',
      onclick: () => {
        category = filter.id;
        paint();
      },
    });
    chips.append(chip);
  }

  root.append(
    h('section', { class: 'hero' }, [
      h('h1', { class: 'hero__title', text: '先看上身效果，再决定买哪件' }),
      h('p', { class: 'hero__text', text: '在橱窗里挑一件衣服，上传一张本人照片，几十秒后就能看到穿在自己身上的样子。' }),
      h('div', { class: 'hero__meta' }, [
        h('span', { class: 'tag tag--accent', text: '新用户送 1 次试穿体验' }),
        h('span', { class: 'tag', text: '支持上衣 · 下装 · 连衣裙' }),
        h('span', { class: 'tag', text: '试穿结果为 AI 生成' }),
      ]),
    ]),
    h('div', { class: 'search' }, [search]),
    h('div', { class: 'import-cta' }, [
      h('div', {}, [
        h('p', { class: 'import-cta__title', text: '想试别的衣服？' }),
        h('p', { class: 'import-cta__text', text: '粘贴淘宝、京东、拼多多、抖音商城的商品链接，直接用那件衣服试穿。' }),
      ]),
      h('button', { type: 'button', class: 'btn btn--sm', text: '导入商品链接', onclick: () => ctx.onOpenImport() }),
    ]),
    chips,
    grid,
  );

  paint();
}
