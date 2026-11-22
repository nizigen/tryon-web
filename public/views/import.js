import { api } from '../lib/api.js';
import { h, toast } from '../lib/dom.js';

const PLATFORM_HINT = '支持淘宝 / 天猫、京东、拼多多、抖音（商品与视频/图文帖）；手机分享出来的整段文案可以直接粘贴。';

/** 粘贴商品链接 → 解析出商品图 → 选一张、选分类 → 进入试穿。 */
export function renderImport(root, ctx) {
  const state = {
    url: '',
    loading: false,
    source: null,
    imageIndex: 0,
    category: 'tops',
    garmentType: 'shirt',
  };

  const urlInput = h('input', {
    type: 'text',
    placeholder: '粘贴商品链接或手机分享文案，例如 https://e.tb.cn/h.…',
    'aria-label': '商品链接',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const parseButton = h('button', { type: 'button', class: 'btn btn--primary', text: '解析商品图' });
  const statusText = h('p', { class: 'field__hint' });
  const resultBox = h('div', { class: 'import__result' });
  const categoryChips = h('div', { class: 'filters', role: 'group', 'aria-label': '服装分类' });
  const typeSelect = h('select', { 'aria-label': '服装子类' });
  const startButton = h('button', { type: 'button', class: 'btn btn--primary btn--block', text: '用这件试穿', disabled: true });

  function paintStatus() {
    if (state.loading) statusText.textContent = '正在读取商品页，通常需要 10–30 秒…';
    else if (state.source) statusText.textContent = `已从${state.source.platformLabel}读取 ${state.source.images.length} 张商品图`;
    else statusText.textContent = PLATFORM_HINT;
  }

  function paintCategories() {
    categoryChips.replaceChildren();
    for (const category of ctx.config.categories ?? []) {
      const active = category.id === state.category;
      categoryChips.append(h('button', {
        type: 'button',
        class: `filter${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        text: category.label,
        onclick: () => {
          state.category = category.id;
          state.garmentType = (ctx.config.garmentTypes?.[category.id] ?? [])[0]?.id ?? '';
          paintCategories();
          paintTypes();
        },
      }));
    }
  }

  function paintTypes() {
    typeSelect.replaceChildren();
    for (const type of ctx.config.garmentTypes?.[state.category] ?? []) {
      typeSelect.append(h('option', { value: type.id, text: type.label }));
    }
    typeSelect.value = state.garmentType;
  }

  function paintResult() {
    resultBox.replaceChildren();
    startButton.disabled = !state.source;
    if (!state.source) return;
    const grid = h('div', { class: 'import__grid' });
    state.source.images.forEach((image, index) => {
      const active = index === state.imageIndex;
      grid.append(h('button', {
        type: 'button',
        class: `import__thumb${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
        'aria-label': `第 ${index + 1} 张商品图（${image.group === 'detail' ? '详情图' : '主图'}）`,
        onclick: () => {
          state.imageIndex = index;
          paintResult();
        },
      }, [
        h('img', { src: `/api/sources/${state.source.id}/${index}`, alt: '', loading: 'lazy', decoding: 'async' }),
      ]));
    });
    resultBox.append(
      h('div', { class: 'import__head' }, [
        h('h2', { class: 'import__title', text: state.source.title }),
        h('span', { class: 'tag', text: state.source.platformLabel }),
      ]),
      grid,
      h('p', { class: 'field__hint', text: '点一张图选中它。试穿用的是这张商品图，不是商品页截图。' }),
      h('div', { class: 'field' }, [
        h('span', { class: 'field__label', text: '这件衣服属于' }),
        categoryChips,
      ]),
      h('div', { class: 'field' }, [
        h('label', { class: 'field__label', for: 'import-type', text: '服装子类' }),
        typeSelect,
      ]),
      startButton,
    );
  }

  async function parse() {
    const url = urlInput.value.trim();
    if (!url) {
      toast('先粘贴一个商品链接');
      urlInput.focus();
      return;
    }
    state.loading = true;
    state.source = null;
    parseButton.disabled = true;
    parseButton.textContent = '解析中…';
    paintStatus();
    paintResult();
    try {
      const payload = await api('/api/sources', { method: 'POST', body: { url } });
      state.source = payload.source;
      state.imageIndex = 0;
      state.url = url;
      paintStatus();
      paintResult();
    } catch (error) {
      state.loading = false;
      parseButton.disabled = false;
      parseButton.textContent = '解析商品图';
      statusText.textContent = error.message;
      return;
    }
    state.loading = false;
    parseButton.disabled = false;
    parseButton.textContent = '解析商品图';
    paintStatus();
  }

  function startTryon() {
    if (!state.source) return;
    ctx.importedSource = {
      id: state.source.id,
      title: state.source.title,
      platformLabel: state.source.platformLabel,
      imageIndex: state.imageIndex,
      category: state.category,
      garmentType: state.garmentType,
    };
    ctx.onNavigate('source-tryon');
  }

  parseButton.addEventListener('click', () => void parse());
  urlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void parse();
    }
  });
  typeSelect.addEventListener('change', () => {
    state.garmentType = typeSelect.value;
  });
  startButton.addEventListener('click', startTryon);
  typeSelect.id = 'import-type';

  root.append(
    h('section', { class: 'hero' }, [
      h('h1', { class: 'hero__title', text: '从商品链接导入' }),
      h('p', { class: 'hero__text', text: '把商品链接粘进来——手机分享出来的整段文案也行，我们读取那件衣服的原图，再穿到你身上。' }),
      h('div', { class: 'hero__meta' }, [
        h('span', { class: 'tag tag--accent', text: '支持手机分享短链' }),
        h('span', { class: 'tag', text: '淘宝 / 抖音免开浏览器' }),
        h('span', { class: 'tag', text: '京东 / 拼多多需本机登录' }),
      ]),
    ]),
    h('div', { class: 'card import' }, [
      h('div', { class: 'search' }, [urlInput, parseButton]),
      statusText,
      resultBox,
    ]),
  );

  paintStatus();
  paintCategories();
  paintTypes();
  paintResult();
}
