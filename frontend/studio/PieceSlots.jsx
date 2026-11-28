import React, { useLayoutEffect, useRef, useState } from 'react';

import { SLOT_BY_KEY } from '../../public/lib/garment-taxonomy.js';
import { CascadeSelect, Icon } from '../ui.jsx';
import { ACCEPTED_IMAGES, changePiece, fromWardrobe, GROUPS, MAX_PIECES, newPiece, readImage } from './pieces.js';
import { LinkPanel, WardrobePicker } from './Sources.jsx';

const SOURCE_LABEL = { product: '目录商品', import: '链接导入', wardrobe: '衣橱单品', upload: '本地上传' };

function PieceSummary({ piece, summaryRef }) {
  const { source, slot, subtype } = piece;
  const image = source.imageUrl || source.image || (source.wardrobeId && `/api/wardrobe/${encodeURIComponent(source.wardrobeId)}/image`);
  return <summary ref={summaryRef} className="piece" title="展开以更换图片或类目">
    <span className="piece__thumb"><img src={image || undefined} alt="" /></span>
    <span className="piece__meta">
      <span className="piece__name">{source.name || subtype || SLOT_BY_KEY[slot]?.label || '已选单品'}</span>
      <span className="piece__source">{SLOT_BY_KEY[slot]?.label ?? '单品'} / {SOURCE_LABEL[source.kind]}</span>
      <span className="piece__edit-label">更换图片或类目</span>
    </span>
  </summary>;
}

function PieceEditor({ piece, position, primaryPicker, pickerRef, update, openPicker, toggleLink, linkPanel }) {
  const inputRef = useRef(null);
  async function selectPhoto(file) {
    if (!file) return;
    const readToken = Symbol('piece file');
    update({ source: null, error: '', readToken });
    try {
      const image = await readImage(file);
      update({ source: { kind: 'upload', image }, readToken: null }, readToken);
    } catch (failure) { update({ error: failure.message, readToken: null }, readToken); }
  }
  return <div className="piece-editor">
    <div className="inline-field piece-sources">
      <input type="file" ref={inputRef} hidden accept={ACCEPTED_IMAGES} onChange={event => {
        selectPhoto(event.target.files?.[0]);
        event.target.value = '';
      }} />
      <button type="button" ref={pickerRef} className={`btn btn--sm${primaryPicker ? ' btn--primary' : ''}`} aria-label={`从衣橱选择第 ${position} 个单品`} onClick={openPicker}>从衣橱选</button>
      <button type="button" className="btn btn--sm" aria-label={`上传第 ${position} 个单品的图片`} onClick={() => inputRef.current.click()}>上传</button>
      <button type="button" className="btn btn--sm" aria-label={`用商品链接添加第 ${position} 个单品`} aria-expanded={Boolean(linkPanel)} onClick={toggleLink}>商品链接</button>
    </div>
    {linkPanel}
    <CascadeSelect groups={GROUPS} value={piece.slot} subValue={piece.subtype} placeholder="选择大类" subPlaceholder="选择子类"
      ariaLabel={`第 ${position} 个单品`} onChange={(slot, subtype) => update({ slot, subtype })} />
    <div className="field"><label className="field__label" htmlFor={`piece-layer-${position}`}>穿着层级</label>
      <select id={`piece-layer-${position}`} aria-label={`第 ${position} 个单品的穿着层级`} value={piece.layer} onChange={event => update({ layer: event.target.value })}>
        <option value="auto">自动（按类目）</option><option value="inner">内层</option><option value="middle">中层</option><option value="outer">外层</option>
      </select>
    </div>
  </div>;
}

function PieceSlot({ piece, position, primaryPicker, removable, update, remove, linkOpen, setLink }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const slot = useRef(null);
  const summary = useRef(null);
  const picker = useRef(null);
  const focusRequest = useRef(null);
  useLayoutEffect(() => {
    const request = focusRequest.current;
    focusRequest.current = null;
    if (!request || pickerOpen) return;
    if (request.origin && (request.origin.isConnected || document.activeElement !== document.body)) return;
    const next = summary.current ?? picker.current;
    if (next && !next.closest('[hidden], [inert], fieldset:disabled')) next.focus({ preventScroll: true });
  }, [pickerOpen, piece.source]);
  function updateEditor(changes, token) {
    if ('source' in changes) {
      const origin = document.activeElement;
      focusRequest.current = slot.current?.contains(origin) ? { origin } : null;
    }
    update(changes, token);
  }
  function selectSource(changes) {
    focusRequest.current = { origin: null };
    update({ ...changes, readToken: null, error: '' });
    setPickerOpen(false);
    setLink(null);
  }
  const removeButton = <button type="button" className="piece__remove" aria-label={`删除第 ${position} 个单品`} disabled={!removable} onClick={remove}>×</button>;
  const linkPanel = linkOpen && <LinkPanel position={position} onSelect={source => selectSource({ source })} />;
  const editor = <PieceEditor piece={piece} position={position} primaryPicker={primaryPicker} pickerRef={picker} update={updateEditor} openPicker={() => setPickerOpen(true)} linkPanel={linkPanel} toggleLink={() => setLink(linkOpen ? null : piece.id)} />;
  return <div ref={slot} className={`slot${piece.source ? ' is-filled' : ''}`}>
    {piece.source ? <>
      <details className="piece-details piece-details--compact"><PieceSummary piece={piece} summaryRef={summary} />{editor}
        <button type="button" className="btn btn--ghost btn--sm" aria-label={`清除第 ${position} 个单品的图片`} onClick={() => selectSource({ source: null })}>清空图片</button>
      </details>{removeButton}
    </> : <>
      <div className="piece-head"><span className="slot__pill">单品 {position}</span>
        {piece.error && <span className="error-text">{piece.error}</span>}
        <span className="push-end">{removeButton}</span>
      </div>{editor}
    </>}
    {pickerOpen && <WardrobePicker onClose={() => setPickerOpen(false)} onSelect={item => selectSource(fromWardrobe(item))} />}
  </div>;
}

export default function PieceSlots({ entries, setEntries, children }) {
  const [linkId, setLinkId] = useState(null);
  const emptyOutfit = !entries.some(piece => piece.source);
  function add() {
    const piece = newPiece();
    setEntries(previous => previous.length < MAX_PIECES ? [...previous, piece] : previous);
  }
  function remove(id) {
    setEntries(previous => previous.length > 1 ? previous.filter(item => item.id !== id) : previous);
    if (linkId === id) setLinkId(null);
  }
  return <section className="card">
    <div className="card__head"><h2 className="section__title">搭配单品</h2></div>
    <div className="slots">{entries.map((piece, index) => <PieceSlot key={piece.id} piece={piece} position={index + 1} primaryPicker={emptyOutfit && index === 0} removable={entries.length > 1}
      linkOpen={linkId === piece.id} setLink={setLinkId} remove={() => remove(piece.id)} update={(changes, token) => setEntries(previous => changePiece(previous, piece.id, changes, token))} />)}</div>
    <div className="inline-field piece-tools"><button type="button" className="btn btn--sm" aria-label="添加一个单品条目" disabled={entries.length >= MAX_PIECES} onClick={add}><Icon name="plus" />添加单品</button>{children}</div>
  </section>;
}
