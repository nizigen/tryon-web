import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorText, Icon, Modal, toast } from './ui.jsx';
import { Closet, SelectionList } from './wardrobe/Closet.jsx';
import { DeleteDialog, GarmentDialog } from './wardrobe/GarmentDialogs.jsx';
import Stylist from './wardrobe/Stylist.jsx';
import { ACCEPTED_IMAGES, MAX_SELECTION, readImageFile, wardrobePiece } from './wardrobe/garments.js';
import { useWardrobeItems } from './wardrobe/useWardrobe.js';

function SelectionDialog({ items, onRemove, onClose, onStudio, canGo }) {
  const list = useRef(null);
  const continueButton = useRef(null);
  const removed = useRef(false);
  useLayoutEffect(() => {
    if (!removed.current) return;
    removed.current = false;
    (list.current?.querySelector('button') || continueButton.current)?.focus();
  }, [items]);
  return <Modal title="当前搭配" onClose={onClose}>
    <div className="modal__content"><SelectionList listRef={list} items={items} onRemove={id => { removed.current = true; onRemove(id); }} /></div>
    <div className="modal__actions"><button ref={continueButton} type="button" className="btn" onClick={onClose}>继续挑选</button>
      <button type="button" className="btn btn--primary" disabled={!canGo} onClick={onStudio}>去试穿</button></div>
  </Modal>;
}

function useEditor(refresh) {
  const [dialog, setDialog] = useState(null);
  const fileInput = useRef(null);
  const fileRevision = useRef(0);
  useEffect(() => () => { fileRevision.current += 1; }, []);
  async function importFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const request = ++fileRevision.current;
    try {
      const image = await readImageFile(file);
      if (fileRevision.current === request) setDialog({ type: 'upload', image, filename: file.name });
    } catch (error) {
      if (fileRevision.current === request) toast(errorText(error));
    }
  }
  function openDialog(next) { fileRevision.current += 1; setDialog(next); }
  function saved(id, message) { setDialog(null); refresh(id); toast(message); }
  return { dialog, openDialog, importFile, fileInput, saved, close: () => setDialog(null), openUpload: () => fileInput.current?.click() };
}

function WardrobeHead({ editor, uploadButton }) {
  return <section className="page-head wardrobe-head"><div><h1 className="page-title">我的衣橱</h1><p className="page-sub">收藏单品，挑一套带去试穿。</p></div>
    <div className="wardrobe-head__actions"><button type="button" className="btn" onClick={() => editor.openDialog({ type: 'import' })}><Icon name="link" />链接导入</button>
      <button ref={uploadButton} type="button" className="btn btn--primary" onClick={editor.openUpload}><Icon name="plus" />上传单品</button>
      <input ref={editor.fileInput} type="file" accept={ACCEPTED_IMAGES} hidden onChange={editor.importFile} /></div></section>;
}

function Picks({ selected, person, canGo, onRemove, handoff }) {
  return <aside className="wardrobe-aside" aria-labelledby="wardrobe-picks-title">
    <section className="wardrobe-picks"><div className="wardrobe-picks__head"><h2 id="wardrobe-picks-title">当前搭配</h2>
      <span className="wardrobe-picks__count" aria-live="polite">已选 {selected.length} / {MAX_SELECTION} 件</span></div>
      {person.image ? <figure className="wardrobe-person">
        <img className="wardrobe-person__image" alt="当前试穿人物原图" src={person.image} />
        <figcaption className="wardrobe-person__caption"><span>{person.isDefault ? '内置模特' : '我的照片'}</span><span>原图</span></figcaption>
      </figure> : <p className="field__hint">暂无人物照片</p>}
      <SelectionList items={selected} onRemove={onRemove} />
      <button type="button" className="btn btn--primary btn--block" disabled={!canGo} onClick={handoff}>去试穿这一套</button></section></aside>;
}

export default function Wardrobe({ ctx }) {
  const inventory = useWardrobeItems();
  const { person, selectPerson: upload } = ctx.draft;
  const [draft, setDraft] = useState('');
  const [category, setCategory] = useState('');
  const [selection, setSelection] = useState(() => ctx.draft.entries.flatMap(entry => entry.source?.kind === 'wardrobe' ? [entry.source.wardrobeId] : []));
  const editor = useEditor(inventory.refresh);
  const { dialog, openDialog } = editor;
  const selected = selection.map(id => inventory.byId.get(id)).filter(Boolean);
  const selectedIds = selected.map(item => item.id);
  const canGo = Boolean(selected.length && person.image && !inventory.loading && !inventory.error);

  function select(id) {
    if (selectedIds.includes(id)) setSelection(selectedIds.filter(own => own !== id));
    else if (selectedIds.length < MAX_SELECTION) setSelection([...selectedIds, id]);
    else toast(`每套最多 ${MAX_SELECTION} 件，先从当前搭配里移除一件`);
  }
  function openStudio(pieces, photographyMode) {
    if (!person.image) { toast('请先上传一张全身照'); return; }
    ctx.openStudio(pieces, photographyMode ? 'outfit' : 'wardrobe', photographyMode);
  }
  const handoff = () => openStudio(selected.map(wardrobePiece));
  return <>
    <WardrobeHead editor={editor} uploadButton={inventory.uploadButton} />
    <div className="wardrobe-page">
      <section className="closet" ref={inventory.closetRef}>
        <Closet {...inventory} category={category} draft={draft} selectedIds={selectedIds} onSelect={select} onCategory={setCategory} onSearch={() => inventory.search(draft)}
          onDraft={value => { setDraft(value); if (!value.trim() && inventory.query) inventory.search(''); }}
          onUpload={editor.openUpload} onDialog={openDialog} onRetry={() => inventory.refresh(null)} onReset={() => { setDraft(''); setCategory(''); inventory.search(''); }} />
        <Stylist byId={inventory.byId} person={person} onPhoto={upload} model={ctx.model} onStudio={openStudio} />
      </section>
      <Picks selected={selected} person={person} canGo={canGo} handoff={handoff} onRemove={id => { select(id); inventory.closetRef.current?.querySelector(`[data-item-id="${CSS.escape(id)}"] .wardrobe-card__thumb`)?.focus({ preventScroll: true }); }} />
    </div>
    <div className="wardrobe-mobile-actions"><button type="button" className="btn btn--ghost" onClick={() => openDialog({ type: 'selection' })}><Icon name="wardrobe" />
      <span className="field__hint" aria-live="polite">当前搭配 {selected.length} / {MAX_SELECTION} 件</span></button>
      <button type="button" className="btn btn--primary" disabled={!canGo} onClick={handoff}>去试穿</button></div>
    {dialog && <div className="modal-host">{dialog.type === 'selection'
      ? <SelectionDialog items={selected} onRemove={select} onClose={editor.close} onStudio={handoff} canGo={canGo} />
      : dialog.type === 'delete' ? <DeleteDialog item={dialog.item} onClose={editor.close} onSaved={editor.saved} />
        : <GarmentDialog dialog={dialog} key={dialog.type} onClose={editor.close} onSaved={editor.saved} />}</div>}
  </>;
}
