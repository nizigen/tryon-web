import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../../public/lib/api.js';
import { SLOT_BY_KEY } from '../../public/lib/garment-taxonomy.js';
import { CascadeSelect, errorText, Icon, Modal } from '../ui.jsx';
import { CATEGORY_GROUPS, garmentImage } from './garments.js';

function GarmentFields({ fields, setFields, nameRef, importing }) {
  const nameId = useId();
  const layerId = useId();
  function update(changes) { setFields(current => ({ ...current, ...changes })); }
  return <>
    <div className="field"><label className="field__label" htmlFor={nameId}>单品名称</label>
      <input id={nameId} ref={nameRef} type="text" maxLength={40} placeholder="给这件单品起个名字" value={fields.name} onInput={event => update({ name: event.currentTarget.value })} /></div>
    <div className="field"><span className="field__label">类目与子类</span>
      <CascadeSelect groups={CATEGORY_GROUPS} value={fields.category} subValue={fields.subtype} ariaLabel={importing ? '导入单品类目' : '单品类目'} subPlaceholder="选择子类" onChange={(category, subtype) => update({ category, subtype })} /></div>
    <div className="field"><label className="field__label" htmlFor={layerId}>穿着层级</label>
      <select id={layerId} value={fields.layer} onChange={event => update({ layer: event.currentTarget.value })}>
        <option value="auto">自动（按类目）</option><option value="inner">内层</option><option value="middle">中层</option><option value="outer">外层</option>
      </select></div>
  </>;
}

function ImportSources({ onPick, disabled, source, selected, onParsed, reportError, error, inputRef }) {
  const [url, setUrl] = useState('');
  const [parsing, setParsing] = useState(false);
  const generation = useRef(0);
  const fieldId = useId();
  useEffect(() => () => { generation.current += 1; }, []);

  async function parse() {
    if (!url.trim() || parsing || disabled) return;
    const request = ++generation.current;
    onParsed(null);
    reportError('');
    setParsing(true);
    try {
      const response = await api('/api/sources', { method: 'POST', body: { url: url.trim() } });
      if (generation.current !== request) return;
      if (!response.source?.images?.length) throw new Error('没有解析到商品图，请换一个链接重试');
      onParsed(response.source);
    } catch (failure) {
      if (generation.current === request) reportError(errorText(failure));
    } finally {
      if (generation.current === request) setParsing(false);
    }
  }

  return <>
    <p className="field__hint">支持淘宝 / 天猫、京东、拼多多与抖音商城的单个商品链接。博主主页和整个橱窗暂不支持。</p>
    <div className="field"><label className="field__label" htmlFor={fieldId}>商品链接</label>
      <textarea id={fieldId} ref={inputRef} rows={3} value={url} disabled={parsing || disabled} placeholder="粘贴单个商品的链接或整段分享文案" onInput={event => { setUrl(event.currentTarget.value); onParsed(null); reportError(''); }} /></div>
    <button type="button" className="btn" onClick={parse} disabled={!url.trim() || parsing || disabled}>{parsing ? '解析中…' : '解析商品图'}</button>
    <p className="error-text" role="alert" hidden={!error}>{error}</p>
    <div className="import" aria-live="polite">
      {parsing && <p className="field__hint">正在读取商品图片，请稍候…</p>}
      {source && <><div className="import__head"><span className="tag">{source.platformLabel || source.platform}</span>
        <p className="import__title">{source.title || '商品图片'}</p><p className="field__hint">共 {source.images.length} 张，选择一张加入衣橱</p></div>
        <div className="import__grid">{source.images.map(image => <button key={image.index} type="button" className={`import__thumb${selected === image.index ? ' is-active' : ''}`} aria-pressed={selected === image.index} aria-label={`选择第 ${image.index + 1} 张图`} onClick={() => onPick(image.index)}>
          <img src={`/api/sources/${encodeURIComponent(source.id)}/${image.index}`} alt={`商品图片 ${image.index + 1}`} />
          {selected === image.index && <span className="thumb__check"><Icon name="check" /></span>}
        </button>)}</div></>}
    </div>
  </>;
}

function initialFields({ item, filename }) {
  return {
    name: item?.name ?? String(filename || '').replace(/\.[^.]+$/, '').slice(0, 40),
    category: SLOT_BY_KEY[item?.category] ? item.category : 'top',
    subtype: item?.subtype || '',
    layer: item?.layer ?? 'auto',
  };
}

function useDialogFocus(initialFocus) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    initialFocus.current?.focus();
    return () => { alive.current = false; };
  }, [initialFocus]);
  return alive;
}

export function GarmentDialog({ dialog, onClose, onSaved }) {
  const { type, item, image } = dialog;
  const editing = type === 'edit';
  const importing = type === 'import';
  const [fields, setFields] = useState(() => initialFields(dialog));
  const [source, setSource] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  const urlRef = useRef(null);
  const alive = useDialogFocus(importing ? urlRef : nameRef);

  function parsed(nextSource) {
    setSource(nextSource);
    setSelected(nextSource?.images[0]?.index ?? null);
    setFields(current => ({ ...current, name: String(nextSource?.title || '').slice(0, 40) }));
  }

  async function save() {
    if (saving || (importing && selected === null)) return;
    const name = fields.name.trim();
    if (!name) { setError('请填写单品名称'); nameRef.current?.focus(); return; }
    setSaving(true);
    setError('');
    const media = editing ? {} : importing ? { sourceId: source.id, sourceIndex: selected } : { tags: [], description: '', image, source: 'upload' };
    try {
      const path = editing ? `/api/wardrobe/${encodeURIComponent(item.id)}` : '/api/wardrobe';
      const saved = await api(path, { method: editing ? 'PATCH' : 'POST', body: { ...fields, name, ...media } });
      if (alive.current) onSaved(saved.item?.id ?? item?.id, editing ? '单品已保存' : '已加入衣橱');
    } catch (failure) {
      if (alive.current) { setError(errorText(failure)); setSaving(false); }
    }
  }

  const label = editing ? '编辑单品' : importing ? '从商品链接添加' : '加入衣橱';
  return <Modal title={label} busy={saving} onClose={onClose}>
    <div className="modal__content">
      {importing ? <ImportSources inputRef={urlRef} disabled={saving} source={source} selected={selected} onPick={setSelected} onParsed={parsed} error={error} reportError={setError} />
        : <div className="modal__preview"><img src={image || garmentImage(item)} alt={item?.name || '待上传单品'} /></div>}
      {(!importing || source) && <div className="modal__details"><GarmentFields fields={fields} setFields={setFields} nameRef={nameRef} importing={importing} /></div>}
      {!importing && <p className="error-text" role="alert" hidden={!error}>{error}</p>}
    </div>
    <div className="modal__actions">
      <button type="button" className="btn" disabled={saving} onClick={onClose}>{importing ? '关闭' : '取消'}</button>
      <button type="button" className="btn btn--primary" disabled={saving || (importing && selected === null)} onClick={save}>
        {saving ? (editing ? '保存中…' : '加入中…') : (editing ? '保存修改' : '加入衣橱')}</button>
    </div>
  </Modal>;
}

export function DeleteDialog({ item, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef(null);
  const alive = useDialogFocus(cancelRef);
  async function confirm() {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      await api(`/api/wardrobe/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (alive.current) onSaved(item.id, '已从衣橱删除');
    } catch (failure) {
      if (alive.current) { setError(errorText(failure)); setSaving(false); }
    }
  }
  return <Modal title="删除这件单品？" ariaLabel="删除单品确认" busy={saving} onClose={onClose}>
    <div className="modal__content"><p>「{item.name || '未命名单品'}」将从衣橱移除，已有试穿记录不受影响。</p>
      <p className="field__hint">删除后需要重新上传或导入，才能再次使用这件单品。</p>
      <p className="error-text" role="alert" hidden={!error}>{error}</p></div>
    <div className="modal__actions"><button ref={cancelRef} type="button" className="btn" disabled={saving} onClick={onClose}>保留单品</button>
      <button type="button" className="btn btn--danger" disabled={saving} onClick={confirm}>{saving ? '删除中…' : '删除单品'}</button></div>
  </Modal>;
}
