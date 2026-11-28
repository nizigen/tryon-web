import React from 'react';

import { toast } from '../ui.jsx';

const MODES = [{ id: 'preserve', label: '普通试穿' }, { id: 'studio', label: '无影棚成片' }];

function PoseSelect({ index, poseId, poses, options, busy, onChange }) {
  const pose = options.find(option => option.id === poseId);
  function change(event) {
    const next = event.target.value;
    if (poses.some((id, slot) => slot !== index && id === next)) toast('三个姿势不能重复，请换一个姿势');
    else onChange(poses.map((id, slot) => slot === index ? next : id));
    event.currentTarget.focus({ preventScroll: true });
  }
  return <div className="studio-photo__pose">
    <span className="studio-photo__index">0{index + 1}</span>
    <img src={pose?.referenceUrl} alt={`${pose?.label ?? poseId}姿势参考`} loading="lazy" />
    <span><strong>{pose?.label ?? poseId}</strong><small>{pose?.hint}</small></span>
    <select className="studio-photo__select" aria-label={`第 ${index + 1} 个姿势`} value={poseId} onChange={change} disabled={busy}>
      {options.map(option => <option key={option.id} value={option.id} disabled={option.id !== poseId && poses.includes(option.id)}>{option.label} · {option.posewearId}</option>)}
    </select>
  </div>;
}

export function Photography({ config, mode, setMode, background, setBackground, poses, setPoses, busy }) {
  const backgrounds = config.studioPresets ?? [];
  const options = config.posePresets ?? [];
  return <div className="studio-photo">
    <div className="field"><span className="field__label">成片方式</span>
      <div className="segmented" role="group" aria-label="摄影模式">{MODES.map(item => <button key={item.id} type="button" data-photography-mode={item.id}
        className={`segment${mode === item.id ? ' is-active' : ''}`} aria-pressed={mode === item.id} disabled={busy}
        onClick={() => setMode(item.id)}>{item.label}</button>)}</div>
      {mode === 'preserve' && <p className="field__hint">保留原图的姿势与背景。</p>}
    </div>
    {mode === 'studio' && <div className="studio-photo__presets">
      <div className="field"><label className="field__label" htmlFor="studio-preset">无缝棚背景</label>
        <select id="studio-preset" aria-label="无缝棚背景" value={background} disabled={busy} onChange={event => setBackground(event.target.value)}>
          {backgrounds.map(item => <option key={item.id} value={item.id}>{item.label} · {item.hint}</option>)}
        </select><p className="field__hint">{backgrounds.find(item => item.id === background)?.hint}</p>
      </div>
      <div className="studio-photo__poses">{poses.map((id, index) => <PoseSelect key={index} index={index} poseId={id} poses={poses} options={options} busy={busy} onChange={setPoses} />)}</div>
      <div className="studio-photo__pose-tools"><p className="field__hint">可更换姿势，三个姿势不重复。</p>
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setPoses(null)}>恢复推荐</button>
      </div><p className="field__hint">试拍只生成第一个姿势；连拍依次生成三张，每张单独保存。</p>
    </div>}
  </div>;
}

export function FitOptions({ config, disabled, fit, setFit, prompt, setPrompt }) {
  return <div className="studio-fit">
    <div className="studio__options"><div className="field"><span className="field__label">版型</span>
      <div className="segmented" role="group" aria-label="版型">{(config.fits ?? []).map(item => <button type="button" key={item.id} data-fit={item.id}
        className={`segment${fit === item.id ? ' is-active' : ''}`} aria-pressed={fit === item.id} disabled={disabled} onClick={() => setFit(item.id)}>{item.label}</button>)}</div>
    </div></div>
    <details className="studio__advanced"><summary>补充要求（选填）</summary><div className="field">
      <label className="field__label" htmlFor="studio-prompt">希望保留或调整的细节</label>
      <textarea id="studio-prompt" rows={3} maxLength={500} placeholder="可选：补充面料、版型或风格要求" value={prompt} onInput={event => setPrompt(event.currentTarget.value)} disabled={disabled} />
      <div className="counter">{[...prompt].length}/500</div>
    </div></details>
  </div>;
}
