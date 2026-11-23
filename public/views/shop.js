import { h, money } from '../lib/dom.js';

const FALLBACK_CATEGORIES = [
  { id: 'tops', label: '上衣' },
  { id: 'bottoms', label: '下装' },
  { id: 'dresses', label: '连衣裙' },
];

/** 橱窗：商品网格 + 关键词搜索 + 分类筛选 + 「导入商品链接」入口。 */
export function renderShop(root, ctx) {
  const state = { q: '', category: '' };
  const grid = h('div', { class: 'grid' });

  const search = h('input', {
    type: 'search',
    class: 'search',
    placeholder: '搜索商品名称或标签',
    'aria-label': '搜索商品',
  });
  search.addEventListener('input', () => {
    state.q = search.value.trim().toLowerCase();
    paintGrid();
  });

  const filters = h('div', { class: 'filters', role: 'group', 'aria-label': '分类筛选' });
  const categoryList = [{ id: '', label: '全部' }, ...(ctx.config.categories?.length ? ctx.config.categories : FALLBACK_CATEGORIES)];
  for (const category of categoryList) {
    const chip = h('button', {
      type: 'button',
      class: `filter${category.id === state.category ? ' is-active' : ''}`,
      text: category.label,
      'aria-pressed': category.id === state.category ? 'true' : 'false',
    });
    chip.addEventListener('click', () => {
      state.category = category.id;
      for (const node of filters.children) {
        const on = node.dataset.category === category.id;
        node.classList.toggle('is-active', on);
        node.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      paintGrid();
    });
    chip.dataset.category = category.id;
    filters.append(chip);
  }

  const importCta = h('button', { type: 'button', class: 'import-cta', onclick: () => ctx.onNavigate('wardrobe') }, [
    h('span', { class: 'import-cta__icon', 'aria-hidden': 'true', text: '🔗' }),
    h('span', { class: 'import-cta__text' }, [
      h('strong', { text: '导入商品链接' }),
      h('span', { text: '在「我的衣橱」里粘贴淘宝 / 京东 / 拼多多 / 抖音商品链接，抓图入橱' }),
    ]),
    h('span', { class: 'import-cta__go', 'aria-hidden': 'true', text: '→' }),
  ]);

  function paintGrid() {
    const products = ctx.products.filter((product) => {
      if (state.category && product.category !== state.category) return false;
      if (!state.q) return true;
      const haystack = [product.name, product.subtitle, ...(product.tags ?? [])].join(' ').toLowerCase();
      return haystack.includes(state.q);
    });
    grid.replaceChildren();
    if (products.length === 0) {
      grid.append(h('div', { class: 'empty grid__empty' }, [
        h('p', { class: 'empty__title', text: '没有符合条件的商品' }),
        h('p', { text: '换个关键词或切换分类，也可以直接导入商品链接。' }),
      ]));
      return;
    }
    for (const product of products) grid.append(productCard(product));
  }

  function productCard(product) {
    return h('button', {
      type: 'button',
      class: 'product',
      'aria-label': `${product.name}，试穿`,
      onclick: () => ctx.onOpenProduct(product.id),
    }, [
      h('div', { class: 'product__media' }, [
        h('img', { src: `/${product.image}`, alt: product.name, loading: 'lazy' }),
      ]),
      h('div', { class: 'product__body' }, [
        h('span', { class: 'product__name', text: product.name }),
        h('span', { class: 'product__sub', text: product.subtitle ?? '' }),
        h('div', { class: 'product__foot' }, [
          h('span', { class: 'tag-row' }, (product.tags ?? []).slice(0, 2).map((tag) => h('span', { class: 'tag', text: tag }))),
          ctx.demoMode ? null : h('span', { class: 'product__price price', text: money(product.priceCents) }),
        ]),
      ]),
    ]);
  }

  root.append(
    h('section', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '橱窗' }),
      h('p', { class: 'page-sub', text: '挑一件喜欢的单品，上传真人照即可看上身效果。' }),
    ]),
    h('div', { class: 'shop-bar' }, [search, filters]),
    importCta,
    grid,
  );
  paintGrid();
}
