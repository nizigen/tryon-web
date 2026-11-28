import { useLayoutEffect, useState } from 'react';

import { SLOT_BY_KEY, slotForCategory } from '../public/lib/garment-taxonomy.js';
import Studio from './Studio.jsx';

const fallbackCategories = [{ id: 'tops', label: '上衣' }, { id: 'bottoms', label: '下装' }, { id: 'dresses', label: '连衣裙' }];

export function Catalog({ ctx }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const categories = ctx.config.categories?.length ? ctx.config.categories : fallbackCategories;
  const needle = query.trim().toLowerCase();
  const products = ctx.products.filter(item => (!category || item.category === category) &&
    [item.name, item.subtitle, ...(item.tags ?? [])].join(' ').toLowerCase().includes(needle));
  return <>
    <section className="page-head"><h1 className="page-title">橱窗</h1><p className="page-sub">挑一件喜欢的单品，上传真人照即可看上身效果。</p></section>
    <div className="shop-toolbar"><input type="search" className="search" placeholder="搜索商品名称或标签" aria-label="搜索商品" value={query} onChange={event => setQuery(event.target.value)} />
      <div className="filters" role="group" aria-label="分类筛选">{[{ id: '', label: '全部' }, ...categories].map(item =>
        <button type="button" key={item.id} data-category={item.id} className={`filter${category === item.id ? ' is-active' : ''}`} aria-pressed={category === item.id}
          onClick={() => setCategory(item.id)}>{item.label}</button>)}</div></div>
    <button type="button" className="import-cta" onClick={() => ctx.onNavigate('wardrobe')}>
      <span className="import-cta__text"><strong className="import-cta__title">从商品链接添加单品</strong><span className="import-cta__text">在「我的衣橱」中粘贴淘宝 / 京东 / 拼多多 / 抖音的单个商品链接。</span></span><span className="tag">去衣橱</span>
    </button>
    <div className="grid">{products.length ? products.map(product =>
      <button type="button" key={product.id} className="product" aria-label={`${product.name}，试穿`} onClick={() => ctx.onNavigate(`tryon/${product.id}`)}>
        <div className="product__media"><img src={`/${product.image}`} alt={product.name} /></div>
        <div className="product__body"><span className="product__name">{product.name}</span><span className="product__sub">{product.subtitle}</span>
          <div className="product__foot"><span className="tag-row">{(product.tags ?? []).slice(0, 2).map(tag => <span className="tag" key={tag}>{tag}</span>)}</span></div>
        </div></button>) : <div className="empty grid__empty"><p className="empty__title">没有符合条件的商品</p><p>换个关键词或切换分类，也可以直接导入商品链接。</p></div>}</div>
  </>;
}

function productPiece(product, config) {
  const type = config.garmentTypes?.[product.category]?.find(item => item.id === product.garmentType);
  const slot = product.category === 'tops' && type?.layer === 'outer' ? 'outer' : slotForCategory(product.category);
  const names = (type?.label ?? '').split('/').filter(Boolean);
  const subtype = SLOT_BY_KEY[slot]?.subtypes.find(name => names.some(part => part.includes(name) || name.includes(part))) ?? '';
  return { slot, subtype, source: { kind: 'product', productId: product.id, imageUrl: `/${product.image}`, name: product.name } };
}

export function ProductTryon({ ctx, productId, consumeEntry }) {
  const product = ctx.products.find(item => item.id === productId);
  useLayoutEffect(() => {
    if (product && consumeEntry(product.id)) ctx.draft.takeOutfit(productPiece(product, ctx.config), 'product');
  }, [product, consumeEntry]);
  if (product) return <Studio ctx={ctx} />;
  return <><section className="page-head"><h1 className="page-title">单品试穿</h1></section>
    <div className="empty"><p className="empty__title">没有找到这件商品</p><p>这件商品可能已经下架，去工作台挑别的单品吧。</p>
      <button type="button" className="btn btn--sm" onClick={() => ctx.onNavigate('studio')}>回到工作台</button>
    </div></>;
}
