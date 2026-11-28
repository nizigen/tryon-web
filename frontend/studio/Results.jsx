import React, { useLayoutEffect, useRef, useState } from 'react';

import { Icon } from '../ui.jsx';
import { STAGES } from './useShoot.js';

const AI_NOTE = 'AI 生成效果仅供参考，实物以商品页面描述为准';
const TAB_NAMES = { result: '结果', original: '原图', compare: '对比' };
const resultUrl = shot => `/api/results/${encodeURIComponent(shot.resultFile)}?k=${encodeURIComponent(shot.resultToken ?? '')}`;

function OriginalPhoto({ person }) {
  if (!person.image) return <div className="empty"><Icon name="image" /><p className="empty__title">先选一张人物照片</p><p>上传全身照或使用内置模特，再挑几件单品。</p></div>;
  return <figure className="canvas studio-original"><img src={person.image} alt={person.isDefault ? '模特正面全身照' : '上传的试穿人物照片'} />
    <figcaption className="canvas__label">{person.isDefault ? '内置模特' : '你的照片'} · 原图</figcaption></figure>;
}

function Stage({ children, busy = false }) {
  return <div className="stage">{busy && <span className="spinner" />}<span>{children}</span></div>;
}

function BatchShot({ shot, pose, current }) {
  const label = pose?.label ?? '棚拍姿势';
  if (shot.status === 'skipped') return <div className="studio-batch__card"><Stage>{label}未提交</Stage></div>;
  if (shot.status === 'pending') return <div className="studio-batch__card"><Stage busy>{label}{current ? '生成中' : '等待生成'}</Stage></div>;
  if (shot.status !== 'success') return <div className="studio-batch__card"><Stage>{label}{shot.status === 'failed' ? '生成失败' : '结果未确认'}</Stage><p className="error-text">{shot.errorMessage || '请查看试穿记录。'}</p></div>;
  const url = resultUrl(shot);
  return <figure className="studio-batch__card"><div className="canvas"><img src={url} alt={`${label}效果`} /></div>
    <figcaption className="studio-batch__caption"><span>{label}</span><a href={url} download={`无影棚-${shot.posePreset}-AI生成.jpg`}>下载</a></figcaption></figure>;
}

function batchSummary(shots) {
  const count = status => shots.filter(item => item.status === status).length;
  const counts = { done: count('success'), failed: count('failed'), unknown: count('unknown'), total: shots.length };
  const { done, failed, unknown, total } = counts;
  const title = total === 1 ? '单张试拍' : '无影棚连拍';
  const live = done === total ? `${title}已完成，共 ${total} 张。` : [
    `${title}${count('pending') ? '进行中' : '结束'}，${done}/${total} 张完成`,
    failed && `${failed} 张失败`, unknown && `${unknown} 张结果未确认，请查看试穿记录`, count('skipped') && `${count('skipped')} 张未提交`,
  ].filter(Boolean).join('，') + '。';
  return { ...counts, live };
}

function BatchResult({ shoot, config, summary }) {
  const background = config.studioPresets?.find(item => item.id === shoot.background)?.label;
  const title = summary.done ? '无影棚成片' : summary.total === 1 ? '单张试拍' : '无影棚连拍';
  return <>
    <div className="result__head"><h2 className="result__title">{title}</h2><span className="result__meta">{summary.done}/{summary.total} 张完成</span></div>
    <p className="result__meta">{[background, `${shoot.count} 件单品`].filter(Boolean).join(' · ')}</p>
    <div className="studio-batch">{shoot.shots.map((shot, index) => <BatchShot key={shot.posePreset} shot={shot} current={shoot.index === index} pose={config.posePresets?.find(pose => pose.id === shot.posePreset)} />)}</div>
    {summary.failed > 0 && <p className="error-text">{summary.failed} 张生成失败。</p>}
    {summary.unknown > 0 && <a className="btn btn--sm" href="#/me">查看试穿记录（{summary.unknown} 张结果未确认）</a>}
    {summary.done > 0 && <p className="ai-note">{AI_NOTE}</p>}
  </>;
}

function ResultTabs({ selected, onSelect }) {
  const tabs = Object.keys(TAB_NAMES);
  function switchTab(event) {
    const index = tabs.indexOf(selected);
    const destinations = { Home: 0, End: tabs.length - 1, ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    const next = tabs[destinations[event.key]];
    onSelect(next);
    event.currentTarget.querySelector(`#result-tab-${next}`)?.focus({ preventScroll: true });
  }
  return <div className="segmented" role="tablist" aria-label="查看方式" onKeyDown={switchTab}>{tabs.map(tab => <button key={tab}
    type="button" role="tab" id={`result-tab-${tab}`} aria-selected={selected === tab} aria-controls="result-tabpanel" tabIndex={selected === tab ? 0 : -1}
    className={`segment${selected === tab ? ' is-active' : ''}`} onClick={() => onSelect(tab)}>{TAB_NAMES[tab]}</button>)}</div>;
}

function SingleResult({ shot, original, model, count }) {
  const [tab, setTab] = useState('result');
  const url = resultUrl(shot);
  return <>
    <div className="result__head"><h2 className="result__title">试穿结果</h2><span className="result__meta">{[`${count} 件单品`, model].filter(Boolean).join(' · ')}</span></div>
    <ResultTabs selected={tab} onSelect={setTab} />
    <div id="result-tabpanel" role="tabpanel" aria-labelledby={`result-tab-${tab}`} className={tab === 'compare' ? 'compare' : 'canvas'}>
      {tab === 'compare' ? <><figure><img src={original} alt="原图" /><figcaption>原图</figcaption></figure><figure><img src={url} alt="试穿效果" /><figcaption>试穿</figcaption></figure></>
        : <img src={tab === 'original' ? original : url} alt={tab === 'original' ? '原始人物照片' : '搭配试穿效果'} />}
    </div>
    <p className="ai-note">{AI_NOTE}</p><a className="btn btn--block" href={url} download="搭配试穿-AI生成.jpg">下载效果图（含 AI 标识）</a>
  </>;
}

function ordinarySummary(shoot) {
  const [shot] = shoot.shots;
  if (shot.status === 'pending') return { title: STAGES[shoot.stage] ?? STAGES.generating, detail: '正在等待图像模型返回，请保持页面打开。' };
  if (shot.status === 'failed') return { title: '生成失败', detail: shot.errorMessage || '可返回试拍设置调整。' };
  if (shot.status === 'success') return { title: '试穿已完成', detail: '可以查看或下载效果图。' };
  return { title: '结果尚未确认', detail: shot.errorMessage || '请到“试穿记录”确认本次状态。' };
}

function OrdinaryResult({ shoot, summary }) {
  const [shot] = shoot.shots;
  if (shot.status === 'success') return <SingleResult key={shot.id} shot={shot} original={shoot.original} model={shoot.model} count={shoot.count} />;
  const pending = shot.status === 'pending';
  return <><Stage busy={pending}>{summary.title}</Stage><p className={pending ? 'result__meta' : 'error-text'}>{summary.detail}</p>
    {!pending && shot.status !== 'failed' && <a className="btn" href="#/me">查看试穿记录</a>}</>;
}

export default function Results({ person, shoot, config, showOutput }) {
  const body = useRef(null);
  const hasResults = showOutput && shoot.shots.length > 0;
  const summary = !hasResults ? null : shoot.batch ? batchSummary(shoot.shots) : ordinarySummary(shoot);
  const announcement = summary?.live ?? (summary ? `${summary.title}。${summary.detail}` : '');
  useLayoutEffect(() => {
    if (!hasResults) return;
    if (!shoot.batch && shoot.busy) body.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (shoot.batch && !shoot.busy && window.innerWidth <= 850) body.current?.scrollIntoView({ behavior: 'auto', block: 'center' });
  }, [hasResults, shoot.batch, shoot.busy]);
  return <div id="studio-step-result" className="studio__preview"><section className="card" aria-label={hasResults ? '本次试拍' : '试穿人物照片'}>
    <div className="result" ref={body}>{!hasResults ? <OriginalPhoto person={person} /> : shoot.batch
      ? <BatchResult shoot={shoot} config={config} summary={summary} /> : <OrdinaryResult shoot={shoot} summary={summary} />}</div>
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
  </section></div>;
}
