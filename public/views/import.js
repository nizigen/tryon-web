import { api } from '../lib/api.js';
import { h, toast } from '../lib/dom.js';

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
        h('img', { src: thumbUrl(image), alt: `商品图 ${image.index + 1}`, loading: 'lazy' }),
        selected ? h('span', { class: 'thumb__check', 'aria-hidden': 'true', text: '✓' }) : null,
      ]);
      item.addEventListener('click', () => {
        state.selected = image.index;
        paintResults();
      });
      grid.append(item);
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
        h('span', { class: 'field__hint', text: '选中的图会放进工作台「上衣」格，可在那里改到其它格子或新增单品。' }),
        h('span', { class: 'push-end' }, [useBtn]),
      ]),
    );
  }

  function useThis() {
    const source = state.source;
    if (!source || source.images.length === 0) {
      toast('请先解析出商品图');
      return;
    }
    const image = source.images.find((item) => item.index === state.selected) ?? source.images[0];
    ctx.pendingPiece = {
      slot: 'top',
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
        errorEl,
      ]),
    ]),
    h('section', { class: 'card' }, [h('h2', { class: 'section__title', text: '解析结果' }), results]),
  );
  paintResults();
}
