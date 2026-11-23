import { api } from '../lib/api.js';
import { createCapsuleSelect, errorText, h, toast } from '../lib/dom.js';
import { SLOTS } from '../lib/garment-taxonomy.js';

const CATEGORY_OPTIONS = SLOTS.map((slot) => ({ value: slot.key, label: slot.label }));

/**
 * 商品链接导入：粘贴链接 → 解析出缩略图网格 → 选一张 → 「用这件试穿」。
 * 选中的图以 import 来源写进工作台对应的格子（默认上衣格），随后跳转 #/studio。
 */
export function renderImport(root, ctx) {
  const state = { url: '', loading: false, source: null, selected: 0, error: '' };

  const urlInput = h('input', { type: 'text', class: 'search', placeholder: '粘贴淘宝 / 京东 / 拼多多 / 抖音商品链接', 'aria-label': '商品链接' });
  const parseBtn = h('button', { type: 'button', class: 'btn btn--primary', text: '解析链接' });
  const errorEl = h('p', { class: 'error-text', hidden: true });
  const results = h('div', { class: 'import' });
  // 「加入衣橱」时按这里选的大类入库：商品链接里没有可靠的类目字段，让用户自己指定最省事。
  const categorySelect = createCapsuleSelect({
    options: CATEGORY_OPTIONS,
    value: 'top',
    ariaLabel: '加入衣橱时的大类',
    placeholder: '选择大类',
  });

  urlInput.addEventListener('input', () => {
    state.url = urlInput.value.trim();
    parseBtn.disabled = state.loading || !state.url;
  });
  parseBtn.disabled = true;
  urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !parseBtn.disabled) void parse();
  });
  parseBtn.addEventListener('click', () => void parse());

  async function parse() {
    if (!state.url || state.loading) return;
    state.loading = true;
    state.error = '';
    errorEl.hidden = true;
    parseBtn.disabled = true;
    parseBtn.textContent = '解析中…';
    try {
      const payload = await api('/api/sources', { method: 'POST', body: { url: state.url } });
      state.source = payload.source;
      state.selected = 0;
      paintResults();
    } catch (error) {
      state.source = null;
      state.error = error.message;
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      paintResults();
    } finally {
      state.loading = false;
      parseBtn.disabled = !state.url;
      parseBtn.textContent = '解析链接';
    }
  }

  function thumbUrl(image) {
    return `/api/sources/${state.source.id}/${image.index}`;
  }

  function paintResults() {
    results.replaceChildren();
    if (!state.source) {
      results.append(h('div', { class: 'empty' }, [
        h('p', { class: 'empty__title', text: '还没有解析到商品图' }),
        h('p', { text: '在上面粘贴商品链接，点「解析链接」。' }),
      ]));
      return;
    }
    const source = state.source;
    const head = h('div', { class: 'import__head' }, [
      h('span', { class: 'tag', text: source.platformLabel || source.platform || '商品' }),
      h('span', { class: 'import__title', text: source.title || '商品图' }),
      h('span', { class: 'field__hint', text: `共 ${source.images.length} 张，选一张试穿` }),
    ]);

    const grid = h('div', { class: 'import__grid' });
    for (const image of source.images) {
      const selected = image.index === state.selected;
      const item = h('button', {
        type: 'button',
        class: `import__thumb${selected ? ' is-active' : ''}`,
        'aria-pressed': selected ? 'true' : 'false',
        'aria-label': `选择第 ${image.index + 1} 张图`,
      }, [
        h('img', { src: thumbUrl(image), alt: `商品图 ${image.index + 1}` }),
        selected ? h('span', { class: 'thumb__check', 'aria-hidden': 'true', text: '✓' }) : null,
      ]);
      item.addEventListener('click', () => {
        state.selected = image.index;
        paintResults();
      });
      const addBtn = h('button', { type: 'button', class: 'btn btn--sm import__add', text: '加入衣橱' });
      addBtn.addEventListener('click', () => void addToWardrobe(image, addBtn));
      grid.append(h('div', { class: 'import__cell' }, [item, addBtn]));
    }

    const useBtn = h('button', {
      type: 'button',
      class: 'btn btn--primary',
      text: '用这件试穿',
      onclick: () => useThis(),
    });
    useBtn.disabled = source.images.length === 0;

    results.append(
      head,
      grid,
      h('div', { class: 'import__foot' }, [
        h('span', { class: 'field__hint', text: '选中的图会放进工作台对应的格子，可在那里改到其它格子或新增单品。' }),
        h('span', { class: 'push-end' }, [useBtn]),
      ]),
    );
  }

  async function addToWardrobe(image, button) {
    if (!state.source) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = '加入中…';
    try {
      await api('/api/wardrobe', {
        method: 'POST',
        body: {
          sourceId: state.source.id,
          sourceIndex: image.index,
          name: state.source.title || '',
          category: categorySelect.getValue(),
          subtype: '',
        },
      });
      toast('已加入衣橱');
      button.textContent = '已加入';
    } catch (error) {
      button.disabled = false;
      button.textContent = previous;
      toast(errorText(error));
    }
  }

  function useThis() {
    const source = state.source;
    if (!source || source.images.length === 0) {
      toast('请先解析出商品图');
      return;
    }
    const image = source.images.find((item) => item.index === state.selected) ?? source.images[0];
    ctx.pendingPiece = {
      slot: categorySelect.getValue(),
      subtype: '',
      source: {
        kind: 'import',
        sourceId: source.id,
        sourceIndex: image.index,
        name: source.title || '',
        imageUrl: thumbUrl(image),
      },
    };
    ctx.onNavigate('studio');
  }

  root.append(
    h('section', { class: 'page-head' }, [
      h('h1', { class: 'page-title', text: '导入商品链接' }),
      h('p', { class: 'page-sub', text: '粘贴商品链接抓取图片，选一张直接拿去试穿。' }),
    ]),
    h('section', { class: 'card' }, [
      h('div', { class: 'field' }, [
        h('span', { class: 'field__label', text: '商品链接' }),
        h('div', { class: 'inline-field' }, [urlInput, parseBtn]),
        h('span', { class: 'field__hint', text: '支持单个商品的详情链接（淘宝 / 天猫、京东、拼多多）和抖音商城的商品分享链接。博主橱窗或主页链接暂不支持——那需要平台授权才能读取，请点进具体商品再复制它的链接。' }),
        errorEl,
      ]),
      h('div', { class: 'field' }, [
        h('span', { class: 'field__label', text: '这件属于哪一类' }),
        categorySelect.el,
        h('span', { class: 'field__hint', text: '加入衣橱和拿去试穿时都按这个大类；商品页没有可靠的类目信息，所以让你自己选。' }),
      ]),
    ]),
    h('section', { class: 'card' }, [h('h2', { class: 'section__title', text: '解析结果' }), results]),
  );
  paintResults();
}
