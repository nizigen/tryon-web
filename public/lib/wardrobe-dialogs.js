import { api } from './api.js';
import { showDialog } from './dialog.js';
import { createCascadeSelect, errorText, h, toast } from './dom.js';
import { SLOTS, SLOT_BY_KEY } from './garment-taxonomy.js';
import { icon } from './icons.js';

const GROUPS = SLOTS.map(slot => ({ value: slot.key, label: slot.label, options: slot.subtypes.map(value => ({ value, label: value })) }));
let nextId = 0;

function field(label, input) {
  const id = `wardrobe-field-${++nextId}`;
  input.id = id;
  return h('div', { class: 'field' }, [h('label', { class: 'field__label', for: id, text: label }), input]);
}

function categoryField(cascade) {
  return h('div', { class: 'field' }, [h('span', { class: 'field__label', text: '类目与子类' }), cascade.el]);
}

function title(text, close) {
  return h('div', { class: 'modal__head' }, [
    h('h2', { class: 'modal__title', text }),
    h('button', { type: 'button', class: 'icon-button', 'aria-label': '关闭弹窗', onclick: close }, [icon('close')]),
  ]);
}

export function createWardrobeDialogs({ host, onSaved }) {
  function openItem({ item, dataUrl, filename }) {
    const editing = Boolean(item);
    const nameInput = h('input', { type: 'text', maxlength: '40', value: editing ? item.name : String(filename || '').replace(/\.[^.]+$/, '').slice(0, 40), placeholder: '给这件单品起个名字' });
    const cascade = createCascadeSelect({ groups: GROUPS, value: SLOT_BY_KEY[item?.category] ? item.category : 'top', subValue: item?.subtype || '', ariaLabel: '单品类目', subPlaceholder: '选择子类' });
    const error = h('p', { class: 'error-text', role: 'alert', hidden: true });
    const save = h('button', { type: 'button', class: 'btn btn--primary', text: editing ? '保存修改' : '加入衣橱' });
    const cancel = h('button', { type: 'button', class: 'btn', text: '取消' });
    let busy = false;
    let dismiss;
    const close = () => { if (!busy) dismiss(); };
    const panel = h('section', { class: 'modal' }, [
      title(editing ? '编辑单品' : '加入衣橱', close),
      h('div', { class: 'modal__content' }, [
        h('div', { class: 'modal__preview' }, [h('img', { src: dataUrl || item?.imageUrl || `/api/wardrobe/${encodeURIComponent(item?.id || '')}/image`, alt: item?.name || '待上传单品' })]),
        field('单品名称', nameInput), categoryField(cascade), error,
      ]),
      h('div', { class: 'modal__actions' }, [cancel, save]),
    ]);
    cancel.addEventListener('click', close);
    save.addEventListener('click', async () => {
      if (busy) return;
      const name = nameInput.value.trim();
      if (!name) { error.textContent = '请填写单品名称'; error.hidden = false; nameInput.focus(); return; }
      busy = true; save.disabled = true; cancel.disabled = true; save.textContent = editing ? '保存中…' : '上传中…'; error.hidden = true;
      try {
        const body = { name, category: cascade.getValue(), subtype: cascade.getSubValue() };
        const saved = await api(editing ? `/api/wardrobe/${encodeURIComponent(item.id)}` : '/api/wardrobe', {
          method: editing ? 'PATCH' : 'POST',
          body: editing ? body : { ...body, tags: [], description: '', image: dataUrl, source: 'upload' },
        });
        dismiss(); toast(editing ? '单品已保存' : '已加入衣橱'); await onSaved({ focusId: editing ? item.id : saved.item?.id });
      } catch (failure) {
        error.textContent = errorText(failure); error.hidden = false;
      } finally {
        busy = false; save.disabled = false; cancel.disabled = false; save.textContent = editing ? '保存修改' : '加入衣橱';
      }
    });
    dismiss = showDialog(host, panel, { label: editing ? '编辑单品' : '加入衣橱', canClose: () => !busy });
    nameInput.focus();
  }

  function removeItem(item) {
    const error = h('p', { class: 'error-text', role: 'alert', hidden: true });
    const remove = h('button', { type: 'button', class: 'btn btn--danger', text: '删除单品' });
    const cancel = h('button', { type: 'button', class: 'btn', text: '保留单品' });
    let busy = false;
    let dismiss;
    const close = () => { if (!busy) dismiss(); };
    const panel = h('section', { class: 'modal' }, [
      title('删除这件单品？', close),
      h('div', { class: 'modal__content' }, [
        h('p', { text: `「${item.name || '未命名单品'}」将从衣橱移除，已有试穿订单不受影响。` }),
        h('p', { class: 'field__hint', text: '删除后需要重新上传或导入，才能再次使用这件单品。' }), error,
      ]),
      h('div', { class: 'modal__actions' }, [cancel, remove]),
    ]);
    cancel.addEventListener('click', close);
    remove.addEventListener('click', async () => {
      if (busy) return;
      busy = true; remove.disabled = true; cancel.disabled = true; remove.textContent = '删除中…'; error.hidden = true;
      try {
        await api(`/api/wardrobe/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        dismiss(); toast('已从衣橱删除'); await onSaved({ focusId: item.id });
      } catch (failure) { error.textContent = errorText(failure); error.hidden = false; }
      finally { busy = false; remove.disabled = false; cancel.disabled = false; remove.textContent = '删除单品'; }
    });
    dismiss = showDialog(host, panel, { label: '删除单品确认', canClose: () => !busy });
    cancel.focus();
  }

  function openImportModal() {
    const state = { source: null, selected: -1, parsing: false, saving: false };
    const urlInput = h('textarea', { rows: '3', placeholder: '粘贴单个商品的链接或整段分享文案' });
    const parse = h('button', { type: 'button', class: 'btn', text: '解析商品图', disabled: true });
    const nameInput = h('input', { type: 'text', maxlength: '40', placeholder: '给这件单品起个名字' });
    const cascade = createCascadeSelect({ groups: GROUPS, value: 'top', ariaLabel: '导入单品类目', subPlaceholder: '选择子类' });
    const error = h('p', { class: 'error-text', role: 'alert', hidden: true });
    const results = h('div', { class: 'import', 'aria-live': 'polite' });
    const details = h('div', { class: 'modal__details', hidden: true }, [field('单品名称', nameInput), categoryField(cascade)]);
    const save = h('button', { type: 'button', class: 'btn btn--primary', text: '加入衣橱', disabled: true });
    const cancel = h('button', { type: 'button', class: 'btn', text: '关闭' });
    let dismiss;
    const close = () => { if (!state.saving) dismiss(); };
    const panel = h('section', { class: 'modal modal--wide' }, [
      title('从商品链接添加', close),
      h('div', { class: 'modal__content' }, [
        h('p', { class: 'field__hint', text: '支持淘宝 / 天猫、京东、拼多多与抖音商城的单个商品链接。博主主页和整个橱窗暂不支持。' }),
        field('商品链接', urlInput), parse, error, results, details,
      ]),
      h('div', { class: 'modal__actions' }, [cancel, save]),
    ]);
    function paintImages() {
      const source = state.source;
      results.replaceChildren(
        h('div', { class: 'import__head' }, [h('span', { class: 'tag', text: source.platformLabel || source.platform }), h('p', { class: 'import__title', text: source.title || '商品图片' }), h('p', { class: 'field__hint', text: `共 ${source.images.length} 张，选择一张加入衣橱` })]),
        h('div', { class: 'import__grid' }, source.images.map(image => {
          const selected = state.selected === image.index;
          const button = h('button', { type: 'button', class: `import__thumb${selected ? ' is-active' : ''}`, 'aria-pressed': String(selected), 'aria-label': `选择第 ${image.index + 1} 张图` }, [
            h('img', { src: `/api/sources/${source.id}/${image.index}`, alt: `商品图片 ${image.index + 1}` }),
            selected ? h('span', { class: 'thumb__check' }, [icon('check')]) : null,
          ]);
          button.addEventListener('click', () => { state.selected = image.index; paintImages(); results.querySelectorAll('button')[source.images.indexOf(image)]?.focus(); });
          return button;
        })),
      );
    }
    parse.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url || state.parsing || state.saving) return;
      state.parsing = true; state.source = null; state.selected = -1;
      save.disabled = true; parse.disabled = true; urlInput.disabled = true; parse.textContent = '解析中…';
      error.hidden = true; details.hidden = true; results.replaceChildren(h('p', { class: 'field__hint', text: '正在读取商品图片，请稍候…' }));
      try {
        const { source } = await api('/api/sources', { method: 'POST', body: { url } });
        if (!panel.isConnected) return;
        if (!source?.images?.length) throw new Error('没有解析到商品图，请换一个链接重试');
        state.source = source; state.selected = source.images[0].index;
        nameInput.value = String(source.title || '').slice(0, 40);
        details.hidden = false; paintImages(); save.disabled = false;
      } catch (failure) {
        error.textContent = errorText(failure); error.hidden = false; results.replaceChildren();
      } finally {
        state.parsing = false; urlInput.disabled = false; parse.disabled = !urlInput.value.trim(); parse.textContent = '解析商品图';
      }
    });
    urlInput.addEventListener('input', () => { parse.disabled = state.parsing || state.saving || !urlInput.value.trim(); });
    cancel.addEventListener('click', close);
    save.addEventListener('click', async () => {
      if (!state.source || state.selected < 0 || state.saving) return;
      const name = nameInput.value.trim();
      if (!name) { error.textContent = '请填写单品名称'; error.hidden = false; nameInput.focus(); return; }
      state.saving = true; save.disabled = true; cancel.disabled = true; parse.disabled = true; save.textContent = '加入中…'; error.hidden = true;
      try {
        const saved = await api('/api/wardrobe', { method: 'POST', body: { sourceId: state.source.id, sourceIndex: state.selected, name, category: cascade.getValue(), subtype: cascade.getSubValue() } });
        dismiss(); toast('已加入衣橱'); await onSaved({ focusId: saved.item?.id });
      } catch (failure) { error.textContent = errorText(failure); error.hidden = false; }
      finally { state.saving = false; save.disabled = false; cancel.disabled = false; parse.disabled = !urlInput.value.trim(); save.textContent = '加入衣橱'; }
    });
    dismiss = showDialog(host, panel, { label: '从商品链接添加', canClose: () => !state.saving });
    urlInput.focus();
  }

  return {
    openUploadModal: (dataUrl, filename) => openItem({ dataUrl, filename }),
    openEditModal: item => openItem({ item }),
    openImportModal,
    removeItem,
  };
}
