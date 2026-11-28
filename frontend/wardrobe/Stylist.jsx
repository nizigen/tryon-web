import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../public/lib/api.js';
import { SLOT_BY_KEY } from '../../public/lib/garment-taxonomy.js';
import { errorText, Icon, toast } from '../ui.jsx';
import { ACCEPTED_IMAGES, categoryLabel, garmentImage, wardrobePiece } from './garments.js';
import { useStylistOrder } from './useStylistOrder.js';

function Suggestion({ suggestion, groups }) {
  if (!suggestion) return <p className="field__hint">还没有搭配建议，写下今天的场合或感觉，再点「帮我选」。</p>;
  const missing = (suggestion.missing || []).filter(key => SLOT_BY_KEY[key]);
  return <>
    {groups.length ? <div className="stylist__slots">{groups.map(({ slot, items }) => {
      const names = items.map(item => item.name || '未命名单品').join('、');
      return <div className="stylist__slot" key={slot}>
        <div className="stylist__slot-thumb"><img src={garmentImage(items[0])} alt={names} /></div>
        <div className="stylist__slot-text"><span className="stylist__slot-cat">{categoryLabel(slot)}</span><span className="stylist__slot-name">{names}</span></div>
      </div>;
    })}</div> : <p className="field__hint">衣橱里暂时没有能组成一套的单品，先上传或导入几件吧。</p>}
    {suggestion.reason && <p className="stylist__reason">{suggestion.reason}</p>}
    {missing.length > 0 && <p className="stylist__missing">衣橱里还缺：{missing.map(categoryLabel).join('、')}，可先补充再生成。</p>}
  </>;
}

function Result({ order }) {
  if (order.busy) return <><div className="stage"><span className="spinner" /><span>{order.text}</span></div>
    <p className="result__meta">正在等待图像模型返回，请保持页面打开。</p></>;
  const result = order.result;
  if (result?.status !== 'success' || !result.resultFile) return null;
  const url = `/api/results/${encodeURIComponent(result.resultFile)}?k=${encodeURIComponent(result.resultToken || '')}`;
  return <><div className="stylist__result-img"><img src={url} alt="搭配试穿效果" /></div>
    <p className="ai-note">AI 生成效果仅供参考，实物以商品页面描述为准</p>
    <a className="btn btn--block" href={url} download="今日穿搭-AI生成.jpg">下载效果图（含 AI 标识）</a></>;
}

function StylistPerson({ person, onPhoto }) {
  const input = useRef(null);
  return <div className="stylist__person"><img className="stylist__person-preview" alt="全身照预览" src={person.image || undefined} hidden={!person.image} />
    <div><p className="stylist__person-note" hidden={!person.image}>{person.isDefault ? '内置模特' : '你的照片'}</p>
      {person.error && <p className="error-text" role="alert">{person.error}</p>}
      <button type="button" className="btn btn--sm" onClick={() => input.current?.click()}>{person.isDefault ? '换成我的照片' : person.image ? '更换全身照' : '上传全身照'}</button></div>
    <input ref={input} type="file" hidden accept={ACCEPTED_IMAGES} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; onPhoto(file); }} /></div>;
}

export default function Stylist({ byId, person, onPhoto, model, onStudio }) {
  const [request, setRequest] = useState('');
  const [suggestion, setSuggestion] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const alive = useRef(true);
  const requestRef = useRef(null);
  const statusRef = useRef(null);
  const order = useStylistOrder();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (order.busy) statusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [order.busy]);
  const groups = Object.entries(suggestion?.slots || {}).map(([slot, value]) => ({
    slot, items: [].concat(value || []).map(item => byId.get(item.id)).filter(item => item?.category === slot),
  })).filter(group => group.items.length);
  const pieces = groups.flatMap(group => group.items.map(wardrobePiece));

  async function suggest(event) {
    event.preventDefault();
    if (suggesting || order.busy) return;
    const text = request.trim();
    if (!text) { toast('用一句话说说今天想穿什么'); requestRef.current?.focus(); return; }
    setSuggesting(true);
    try {
      const response = await api('/api/outfit/suggest', { method: 'POST', body: { request: text } });
      if (!alive.current) return;
      setSuggestion(response.suggestion || null);
      order.clear();
    } catch (error) {
      if (alive.current) toast(errorText(error));
    } finally {
      if (alive.current) setSuggesting(false);
    }
  }

  return <section className="card stylist">
    <div className="card__head"><div className="card__heading"><h2 className="section__title">今日穿搭</h2>
      <p className="section__hint">说说场合或感觉，让 AI 从衣橱里帮你搭一套。</p></div><span className="tag"><Icon name="sparkle" />AI 选搭</span></div>
    <form className="inline-field" onSubmit={suggest}>
      <input ref={requestRef} type="text" maxLength={200} placeholder="例如：明天面试，想穿得正式一点又不显老" aria-label="今日穿搭需求" value={request} onInput={event => setRequest(event.currentTarget.value)} />
      <button type="submit" className="btn" disabled={suggesting || order.busy}>{suggesting ? '帮你挑…' : '帮我选'}</button></form>
    <div className="stylist__result"><Suggestion suggestion={suggestion} groups={groups} /></div>
    <div className="stylist__order">
      <StylistPerson person={person} onPhoto={onPhoto} />
      <span className="push-end">
        <button type="button" className="btn btn--primary" disabled={order.busy || suggesting || !person.image || !pieces.length} onClick={() => order.generate({ model, person, pieces })}>{order.busy ? '生成中…' : '生成试穿图'}</button>
        <button type="button" className="btn" disabled={order.busy || suggesting || !person.image || !pieces.length} onClick={() => onStudio(pieces, 'studio')}>去无影棚拍 3 张</button>
      </span>
    </div>
    <p ref={statusRef} className="stylist__status" role="status" hidden={!order.text}><span className="spinner" hidden={!order.busy} />{order.text}</p>
    <div className="stylist__result-img-wrap"><Result order={order} /></div>
  </section>;
}
