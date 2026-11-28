import { useEffect, useRef, useState } from 'react';

import { api, getSessionId } from '../public/lib/api.js';
import { timeLabel } from '../public/lib/dom.js';
import { SLOT_BY_KEY } from '../public/lib/garment-taxonomy.js';
import { Icon } from './ui.jsx';

const statuses = { pending: '生成中', queued: '排队中', success: '已完成', failed: '失败', expired: '已失效' };

function Status({ order }) {
  return <span className={`status status--${order.status}`}>{statuses[order.status] ?? order.status ?? '未知'}</span>;
}

function slotNames(order) {
  return (order.slots ?? []).map(slot => SLOT_BY_KEY[slot]?.label ?? slot).join(' · ') || '组合搭配';
}

function Detail({ order, onRetry }) {
  const url = order.resultFile && `/api/results/${encodeURIComponent(order.resultFile)}?k=${encodeURIComponent(order.resultToken ?? '')}`;
  return <section className="card">
    <div className="result__head"><h2 className="section__title">{order.productName || '搭配试穿'}</h2><Status order={order} /></div>
    <p className="field__hint">{slotNames(order)} · {timeLabel(order.createdAt)}</p>
    <div className="result">{order.status === 'expired' ? <p className="field__hint">结果图已失效。</p> : order.status === 'success' ? (url ? <>
      <div className="canvas"><img src={url} alt="试穿结果" /><span className="canvas__label">AI 生成 · 试穿结果</span></div>
      <p className="ai-note">AI 生成效果仅供参考，实物以商品页面描述为准</p>
      <a className="btn btn--block" href={url} download="搭配试穿-AI生成.jpg">下载效果图（含 AI 标识）</a>
    </> : <p className="field__hint">结果图已失效。</p>) : order.status === 'failed' ? <>
      <p className="error-text">{order.errorMessage || '本次生成失败。'}</p><button type="button" className="btn" onClick={onRetry}>再试一次</button>
    </> : <div className="stage"><span className="spinner" /><span>正在生成，请稍后在列表中刷新查看。</span></div>}</div>
  </section>;
}

function useOrders(revision, selected) {
  const [list, setList] = useState({ loading: true });
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    const request = new AbortController();
    setList({ loading: true });
    const load = getSessionId() ? api('/api/orders', { signal: request.signal }) : Promise.resolve({ orders: [] });
    load.then(response => setList({ orders: response.orders ?? [] })).catch(() => {
      if (!request.signal.aborted) setList({ error: '记录读取失败' });
    });
    return () => request.abort();
  }, [revision]);
  useEffect(() => {
    if (!selected) return;
    const request = new AbortController();
    setDetail(null);
    api(`/api/orders/${encodeURIComponent(selected)}`, { signal: request.signal }).then(response => setDetail({ order: response.order })).catch(() => {
      if (!request.signal.aborted) setDetail({ error: '试穿详情读取失败，请刷新后重试。' });
    });
    return () => request.abort();
  }, [selected, revision]);
  return { list, detail };
}

export default function Records({ ctx }) {
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const { list, detail } = useOrders(revision, selected);
  const top = useRef(null);
  const onStudio = () => ctx.onNavigate('studio');
  useEffect(() => { if (detail) top.current?.scrollIntoView({ block: 'start' }); }, [detail]);
  return <><section className="page-head"><div><h1 className="page-title">试穿记录</h1><p className="page-sub">查看试穿进度，打开或下载已完成的成片。</p></div>
    <div className="page-actions"><button type="button" className="btn btn--sm" disabled={list.loading} onClick={() => setRevision(value => value + 1)}>{list.loading ? '刷新中…' : '刷新'}</button></div></section>
    <div className="records-layout"><div><div className="records-detail" ref={top}>
      {detail?.error && <p className="error-text" role="alert">{detail.error}</p>}{detail?.order && <Detail order={detail.order} onRetry={onStudio} />}</div>
      <section className="card records-list"><div className="card__head"><h2 className="section__title">最近的试穿</h2><span className="records-expiry">结果图保留 24 小时</span></div>
        <div className="list">{list.loading && <div className="empty"><span className="spinner" /><p>正在读取试穿记录…</p></div>}
          {list.error && <div className="empty"><p className="empty__title">{list.error}</p><p>请检查网络后刷新。</p></div>}
          {list.orders?.length === 0 && <div className="empty"><Icon name="orders" /><p className="empty__title">还没有试穿记录</p>
            <button type="button" className="btn btn--primary btn--sm" onClick={onStudio}>去搭一套</button></div>}
          {list.orders?.map(order => <button type="button" key={order.id} className="list-row" onClick={() => setSelected(order.id)}>
            <span className="list-row__main"><span className="list-row__title">{order.productName || '搭配试穿'}</span><span className="list-row__meta">{slotNames(order)}</span></span>
            <span className="list-row__side"><Status order={order} /><span className="list-row__time">{timeLabel(order.createdAt)}</span></span></button>)}
        </div></section></div><aside className="card records-aside"><h2 className="section__title">关于试穿结果</h2><ul className="notes">
          <li>人像照片只用于本次生成。</li><li>结果图标有「AI 生成」，请及时下载需要保留的成片。</li></ul></aside></div></>;
}
