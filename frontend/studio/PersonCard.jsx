import React, { useEffect, useRef, useState } from 'react';

import { BASE_FACE_URL, DEFAULT_PERSON_URL, loadDefaultPerson, STUDIO_MAKEUP_URL, TURNAROUND_URL } from '../../public/lib/person.js';
import { ACCEPTED_IMAGES, readImage } from './pieces.js';

const EMPTY = { image: null, isDefault: false, error: '' };

export function ShootReferences() {
  return <details className="studio__advanced shoot-references"><summary>本次棚拍的人物参考</summary>
    <div className="inline-field">{[[DEFAULT_PERSON_URL, '正面全身照'], [TURNAROUND_URL, '全身三视图'], [STUDIO_MAKEUP_URL, '棚拍定妆照']].map(([href, label]) =>
      <a key={label} className="btn btn--sm" href={href} target="_blank" rel="noopener">{label}</a>)}</div></details>;
}

export function usePerson(enabled = true) {
  const [person, setPerson] = useState(EMPTY);
  const latestSelection = useRef(0);
  useEffect(() => {
    let active = true;
    if (enabled && !latestSelection.current && !person.image) loadDefaultPerson().then(image => {
      if (active && !latestSelection.current) setPerson(image ? { image, isDefault: true, error: '' } : { ...EMPTY, error: '未能读取内置人物，请重试或上传照片。' });
    });
    return () => { active = false; };
  }, [enabled]);

  async function select(file) {
    if (!file) return;
    const selection = ++latestSelection.current;
    setPerson(EMPTY);
    try {
      const image = await readImage(file);
      if (latestSelection.current === selection) setPerson({ image, isDefault: false, error: '' });
    } catch (error) {
      if (latestSelection.current === selection) setPerson({ ...EMPTY, error: error.message });
    }
  }
  async function restore() {
    const selection = ++latestSelection.current;
    setPerson(EMPTY);
    const image = await loadDefaultPerson();
    if (selection === latestSelection.current) setPerson(image ? { image, isDefault: true, error: '' } : { ...EMPTY, error: '未能读取内置人物，请重试或上传照片。' });
  }
  return [person, select, restore];
}

function References({ visible, studio }) {
  return <details className="field__hint piece-details" hidden={!visible}>
    <summary>查看模特参考资料</summary>
    <div className="field">
      <div className="inline-field">
        <a className="btn btn--sm" href={TURNAROUND_URL} target="_blank" rel="noopener">全身三视图</a>
        {studio && <a className="btn btn--sm" href={BASE_FACE_URL} target="_blank" rel="noopener">对照妆前原片（v3r3）</a>}
      </div>
      <p>比例校样（不参与生成）</p>
      <div className="inline-field">
        <a className="btn btn--sm btn--ghost" href="/model/posewear-01/fit-proof.jpg" target="_blank" rel="noopener">查看对照图</a>
        <a className="btn btn--sm btn--ghost" href="/model/posewear-01/posewear-01.glb" download="posewear-01.glb">下载 GLB</a>
      </div>
    </div>
  </details>;
}

export default function PersonCard({ person, onSelect, onRestore, mode }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const { image, isDefault, error } = person;
  const studioPortrait = Boolean(image && isDefault && mode === 'studio');
  let hint = '只换衣服，保留原图的妆容和表情。';
  if (mode === 'studio') hint = (isDefault ? '正面全身照参考身材比例和长黑发的长度，同人定妆照参考五官、自然披下的黑长直、脸侧轮廓和妆面。' : '按你上传的照片保留五官和身材，不套用内置模特。') + 'PoseWear 只提供姿势骨架。';
  function drop(event) {
    event.preventDefault();
    setDragging(false);
    onSelect(event.dataTransfer.files?.[0]);
  }
  return <section className="card">
    <div className="card__head"><h2 className="section__title">试穿人物</h2></div>
    <div className={`dropzone${image ? ' has-image' : ''}${dragging ? ' is-dragging' : ''}`}
      onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
      <img className="dropzone__preview" src={image || undefined} hidden={!image} alt="人物照片预览" />
      <div className="dropzone__meta">
        <p className="dropzone__title">{isDefault ? '内置模特' : image ? '你的照片' : '选择正面全身照'}</p>
        <div className="dropzone__actions"><button type="button" className="btn btn--sm" onClick={() => input.current?.click()}>{isDefault ? '换成我的照片' : image ? '更换照片' : '上传全身照'}</button>
          {!isDefault && <button type="button" className="btn btn--sm btn--ghost" onClick={onRestore}>使用内置模特</button>}</div>
        <p className="field__hint" aria-live="polite" hidden={!image}>{image && hint}</p>
        {studioPortrait && <div className="field__hint"><a className="inline-field" href={STUDIO_MAKEUP_URL} target="_blank" rel="noopener">
          <img src={STUDIO_MAKEUP_URL} width={72} height={108} alt="棚拍使用的模特五官、自然披下的黑长直、脸侧轮廓和妆面参考" /><span>棚拍定妆照 · 查看大图</span>
        </a></div>}
        <p className="field__hint">PNG / JPEG / WebP，不超过 8MB</p>
        <References key={isDefault ? 'builtin' : 'upload'} visible={Boolean(image && isDefault)} studio={studioPortrait} />
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
      <input type="file" accept={ACCEPTED_IMAGES} hidden ref={input} onChange={event => {
        onSelect(event.target.files?.[0]);
        event.target.value = '';
      }} />
    </div>
  </section>;
}
