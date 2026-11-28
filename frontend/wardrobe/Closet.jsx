import React from 'react';
import { SLOT_BY_KEY } from '../../public/lib/garment-taxonomy.js';
import { ActionMenu, Icon } from '../ui.jsx';
import { categoryLabel, garmentImage, garmentSummary } from './garments.js';

function GarmentCard({ item, selected, onSelect, onDialog }) {
  const name = item.name || '未命名单品';
  const actions = [
    { label: '编辑单品', icon: 'edit', run: () => onDialog({ type: 'edit', item }) },
    { label: '删除单品', icon: 'trash', danger: true, run: () => onDialog({ type: 'delete', item }) },
  ];
  return <article className={`wardrobe-card${selected ? ' is-selected' : ''}`} data-item-id={item.id}>
    <button type="button" className="wardrobe-card__thumb" aria-label={`${selected ? '从搭配移除' : '选入搭配'}${name}`} aria-pressed={selected} onClick={() => onSelect(item.id)}>
      <img src={garmentImage(item)} alt={name} />
      {selected && <span className="wardrobe-card__check" aria-hidden="true"><Icon name="check" /></span>}
    </button>
    <div className="wardrobe-card__body">
      <div className="wardrobe-card__text"><h3 className="wardrobe-card__name">{name}</h3><span className="wardrobe-card__cat">{garmentSummary(item)}</span></div>
      <ActionMenu label={`${name}的更多操作`} actions={actions} />
    </div>
  </article>;
}

function EmptyGrid({ empty, error, query, onRetry, onUpload, onDialog, onReset }) {
  if (error) return <div className="wardrobe-empty">
    <p className="wardrobe-empty__title">衣橱读取失败</p><p className="field__hint">{error}</p>
    <button type="button" className="btn btn--sm" onClick={onRetry}>重试</button>
  </div>;
  if (empty) return <div className="wardrobe-empty">
    <p className="wardrobe-empty__title">衣橱还是空的</p>
    <p className="field__hint">上传单品照片，或从商品链接保存一件。</p>
    <div className="wardrobe-empty__actions"><button type="button" className="btn btn--primary" onClick={onUpload}>上传单品</button>
      <button type="button" className="btn" onClick={() => onDialog({ type: 'import' })}>从商品链接导入</button></div>
  </div>;
  return <div className="wardrobe-empty"><p className="wardrobe-empty__title">{query ? `没有找到与「${query}」匹配的单品` : '这个类目下还没有单品'}</p>
    <button type="button" className="btn btn--sm" onClick={onReset}>查看全部</button></div>;
}

export function Closet({ items, matched, loading, error, query, draft, category, selectedIds, onCategory, onSearch, onDraft, onSelect, ...actions }) {
  const categories = [...new Set(items.map(item => item.category))].filter(key => SLOT_BY_KEY[key]);
  const visible = category ? matched.filter(item => item.category === category) : matched;
  const count = query || category ? `找到 ${visible.length} 件` : `${visible.length} 件单品`;
  return <>
    <div className="wardrobe-toolbar">
      <div className="filters" role="group" aria-label="按类目筛选">{['', ...categories].map(key => <button key={key} type="button" className={`filter${key === category ? ' is-active' : ''}`} aria-pressed={key === category} onClick={() => onCategory(key)}>{key ? categoryLabel(key) : '全部'}</button>)}</div>
      <form className="search-field" onSubmit={event => { event.preventDefault(); onSearch(); }}><Icon name="search" />
        <input type="search" value={draft} placeholder="搜索名称或描述" aria-label="搜索衣橱单品" onInput={event => onDraft(event.currentTarget.value)} />
      </form>
      <p className="wardrobe-toolbar__count" role="status">{loading ? '正在读取衣橱…' : error ? '读取失败' : count}</p>
    </div>
    <div className="wardrobe-grid">{loading ? Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton wardrobe-card__skeleton" />)
      : error || !visible.length ? <EmptyGrid empty={!items.length} error={error} query={query} {...actions} />
        : visible.map(item => <GarmentCard key={item.id} item={item} selected={selectedIds.includes(item.id)} onSelect={onSelect} onDialog={actions.onDialog} />)}</div>
  </>;
}

export function SelectionList({ items, onRemove, listRef }) {
  return <div className="selection-list" ref={listRef}>
    {!items.length && <p className="field__hint">点单品图片加入搭配。</p>}
    {items.map(item => <div key={item.id} className="selection-item">
      <img className="selection-item__thumb" src={garmentImage(item)} alt="" />
      <div className="selection-item__text"><span className="selection-item__name">{item.name || '未命名单品'}</span><span className="selection-item__meta">{garmentSummary(item)}</span></div>
      <button type="button" className="icon-button" aria-label={`从搭配移除${item.name || '单品'}`} onClick={() => onRemove(item.id)}><Icon name="close" /></button>
    </div>)}
  </div>;
}
