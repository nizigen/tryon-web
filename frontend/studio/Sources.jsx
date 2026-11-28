import React, { useEffect, useRef, useState } from 'react';

import { api } from '../../public/lib/api.js';
import { SLOT_BY_KEY } from '../../public/lib/garment-taxonomy.js';
import { Modal } from '../ui.jsx';

export function WardrobePicker({ onClose, onSelect }) {
  const [load, setLoad] = useState(0);
  const [result, setResult] = useState(null);
  useEffect(() => {
    let active = true;
    api('/api/wardrobe').then(({ items }) => {
      if (active) setResult({ items: items ?? [] });
    }, error => { if (active) setResult({ error: error.message }); });
    return () => { active = false; };
  }, [load]);
  return <Modal title="从衣橱选单品" ariaLabel="从衣橱选择单品" closeLabel="关闭衣橱选择" onClose={onClose}>
    <div className="modal__content picker-panel" aria-live="polite">
      {!result && <p className="field__hint">正在读取衣橱…</p>}
      {result?.error && <><p className="error-text">{result.error}</p><button type="button" className="btn" onClick={() => { setResult(null); setLoad(previous => previous + 1); }}>重试</button></>}
      {result?.items?.length === 0 && <div className="empty"><p className="empty__title">衣橱还是空的</p><p>先到「我的衣橱」上传单品或从商品链接导入。</p></div>}
      {result?.items?.length > 0 && <>
        <p className="field__hint">选择一件单品，图片和类目会一起带入当前条目。</p>
        <div className="picker__grid">{result.items.map(item => <button key={item.id} type="button" className="picker__item" aria-label={`选择${item.name || '未命名单品'}`} onClick={() => onSelect(item)}>
          <img src={item.imageUrl} alt="" /><span className="piece__name">{item.name || '未命名单品'}</span>
          <span className="piece__source">{[SLOT_BY_KEY[item.category]?.label, item.subtype].filter(Boolean).join(' / ')}</span>
        </button>)}</div>
      </>}
    </div>
  </Modal>;
}

export function LinkPanel({ position, onSelect }) {
  const [url, setUrl] = useState('');
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  function editUrl(next) {
    request.current?.abort();
    request.current = null;
    setUrl(next);
    setSource(null);
    setError('');
    setLoading(false);
  }
  async function parse(event) {
    event.preventDefault();
    if (!url.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSource(null);
    setError('');
    setLoading(true);
    try {
      const payload = await api('/api/sources', { method: 'POST', body: { url: url.trim() }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!payload.source) throw new Error('没有解析到商品图，换一个链接试试');
      setSource(payload.source);
    } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    finally {
      if (!controller.signal.aborted) { request.current = null; setLoading(false); }
    }
  }
  const imageUrl = index => `/api/sources/${encodeURIComponent(source.id)}/${index}`;
  return <div className="slot__body">
    <form className="inline-field" onSubmit={parse}>
      <input type="text" value={url} onInput={event => editUrl(event.currentTarget.value)} placeholder="粘贴淘宝 / 京东 / 拼多多 / 抖音商品链接" aria-label={`第 ${position} 个单品的商品链接`} />
      <button type="submit" className="btn btn--sm btn--primary" disabled={loading || !url.trim()} aria-label={`解析第 ${position} 个单品的商品链接`}>{loading ? '解析中…' : '解析'}</button>
    </form>
    {error && <p className="error-text">{error}</p>}
    {source && (source.images?.length ? <div className="picker__grid">{source.images.slice(0, 12).map(({ index }) =>
      <button type="button" key={index} className="picker__item" aria-label={`选择第 ${index + 1} 张商品图`} onClick={() => onSelect({ kind: 'import', sourceId: source.id, sourceIndex: index, name: source.title || '', imageUrl: imageUrl(index) })}>
        <img src={imageUrl(index)} alt={`商品图 ${index + 1}`} />
      </button>)}</div> : <p className="field__hint">这个链接里没有可用的商品图。</p>)}
  </div>;
}
