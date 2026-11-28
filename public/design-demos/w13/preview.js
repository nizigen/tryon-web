import { MODEL_FRONT, MODEL_TURNAROUND } from '/lib/model-assets.js';

const options = { a: '衣橱图鉴', b: '镜前选搭', c: '搭配桌' };
const direction = document.body.dataset.direction;
const categories = { all: '全部', top: '上衣', bottom: '下装', dress: '连衣裙' };
const clothes = [
  { id: 'sweater-knit', name: '米色麻花针织毛衣', category: 'top', detail: '针织' },
  { id: 'jeans-black', name: '黑色高腰直筒牛仔裤', category: 'bottom', detail: '牛仔' },
  { id: 'blouse-linen', name: '白色亚麻小翻领衬衫', category: 'top', detail: '亚麻' },
  { id: 'dress-slip', name: '黑色吊带缎面连衣裙', category: 'dress', detail: '缎面' },
  { id: 'skirt-pleated', name: '灰色百褶中长半身裙', category: 'bottom', detail: '半身裙' },
  { id: 'shirt-floral', name: '红底白色小花短袖衬衫', category: 'top', detail: '印花' },
];
const stages = ['选人物', '搭衣服', '试拍', '看结果'];
const modes = { preserve: '普通试穿', studio: '无影棚成片' };
const limit = 5;
const icons = {
  add: '<path d="M12 5v14M5 12h14"/>',
  remove: '<path d="m7 7 10 10M17 7 7 17"/>',
  selected: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
};
const app = document.querySelector('#app');
const announcement = document.querySelector('#announcement');
const startInStudio = new URLSearchParams(location.search).get('view') === 'studio';
let state = { view: startInStudio ? 'studio' : 'wardrobe', step: startInStudio ? 2 : 1, selected: ['sweater-knit', 'jeans-black'], category: 'all', query: '', mode: 'preserve', notice: '' };

const icon = name => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const asset = image => `${image.path}?v=${image.sha256}`;
const attribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const image = item => `<img src="/catalog/${item.id}.jpg" alt="" decoding="async">`;
const outfitText = () => `已选 ${state.selected.length} / ${limit} 件`;
const selectedClothes = () => state.selected.map(id => clothes.find(item => item.id === id));

function header() {
  return `<header class="bar"><div class="bar-inner">
    <button type="button" class="brand" data-action="wardrobe"><img src="/icon.svg?v=zhaohua-1" alt="" width="34" height="34">照花</button>
    <nav class="switcher" aria-label="照花主导航">
      <button type="button" data-action="wardrobe" ${state.view === 'wardrobe' ? 'aria-current="page"' : ''}>衣橱</button>
      <button type="button" data-action="studio" ${state.view === 'studio' ? 'aria-current="page"' : ''}>试衣间</button>
    </nav>
    <a class="draft-label" href="#directions">预览 ${direction.toUpperCase()}</a>
  </div></header>`;
}

function footer() {
  return `<footer class="preview-note" id="directions"><p>设计预览 · 仅用项目目录样衣，不读写你的衣橱，不生成图片。</p>
    <nav aria-label="对照三种方向">${Object.entries(options).map(([key, label]) => `<a href="./${key}.html" ${key === direction ? 'aria-current="page"' : ''}>${key.toUpperCase()} ${label}</a>`).join('')}</nav></footer>`;
}

function toolbar() {
  return `<div class="closet-controls"><div class="facets" role="group" aria-label="按类目筛选">
    ${Object.entries(categories).map(([key, label]) => `<button type="button" data-action="category" data-key="${key}" data-focus="facet-${key}" aria-pressed="${state.category === key}">${label}</button>`).join('')}
    </div><form class="search" role="search"><label class="sr-only" for="catalog-search">搜索单品</label>
      <input id="catalog-search" name="query" type="search" maxlength="60" data-focus="search" value="${attribute(state.query)}" placeholder="搜索单品">
      <button type="submit" aria-label="搜索">${icon('search')}</button>
    </form></div>`;
}

function garment(item) {
  const active = state.selected.includes(item.id);
  return `<article class="garment"><button type="button" class="garment-choice" data-action="toggle" data-key="${item.id}" data-focus="garment-${item.id}" aria-pressed="${active}">
    <span class="garment-image">${image(item)}</span><span class="mark">${icon(active ? 'selected' : 'add')}</span>
    <span class="garment-name">${item.name}</span><span class="garment-caption">${categories[item.category]} · ${item.detail}</span></button></article>`;
}

function shelf(items) {
  const grid = group => `<div class="garment-grid">${group.map(garment).join('')}</div>`;
  if (direction !== 'c' || state.category !== 'all') return grid(items);
  return `<div class="closet-shelves">${Object.entries(categories).filter(([key]) => key !== 'all').map(([key, label]) => {
    const group = items.filter(item => item.category === key);
    return group.length ? `<section class="closet-shelf"><h3>${label} <span>${group.length} 件</span></h3>${grid(group)}</section>` : '';
  }).join('')}</div>`;
}

function closet() {
  const query = state.query.toLowerCase();
  const found = clothes.filter(item => (state.category === 'all' || item.category === state.category)
    && `${item.name} ${categories[item.category]} ${item.detail}`.toLowerCase().includes(query));
  return `<section class="closet" aria-labelledby="closet-title">
    <div class="closet-head"><h2 id="closet-title">衣橱单品</h2><span>${found.length} 件</span></div>
    ${toolbar()}${found.length ? shelf(found) : '<div class="empty"><p>没有符合条件的单品。</p><button type="button" class="button" data-action="reset-search">查看全部</button></div>'}
  </section>`;
}

function selection() {
  const items = selectedClothes();
  if (!items.length) return '<p class="outfit-empty">从衣橱选一件，开始搭配。</p>';
  return `<ul class="outfit-items">${items.map(item => `<li class="outfit-item">${image(item)}
    <span class="outfit-meta">${item.name}</span><button class="outfit-remove" type="button" data-action="remove" data-key="${item.id}" aria-label="移除${item.name}">${icon('remove')}</button></li>`).join('')}</ul>`;
}

function outfit() {
  return `<section class="outfit" aria-labelledby="outfit-title">
    <div class="outfit-heading" tabindex="-1" data-focus="outfit"><h2 id="outfit-title">这一套</h2><p>${outfitText()}</p></div>
    ${selection()}<div class="outfit-actions"><button type="button" class="button button--primary" data-action="try" ${state.selected.length ? '' : 'disabled'}>去试穿</button></div>
  </section>`;
}

function portrait() {
  return `<figure class="portrait"><div class="portrait-frame"><img src="${asset(MODEL_FRONT)}" alt="内置模特的完整正面全身参考图" width="1024" height="1536" decoding="async"></div>
    <figcaption><span>内置模特</span><span>参考原图 · 非成片</span></figcaption></figure>`;
}

function wardrobe() {
  const layout = direction === 'b' ? `${portrait()}<div class="mirror-tools">${outfit()}${closet()}</div>`
    : direction === 'c' ? `${outfit()}${closet()}` : `${closet()}${outfit()}`;
  return `<main class="page wardrobe-page"><div class="page-head"><h1 tabindex="-1" data-focus="page">${options[direction]}</h1></div>
    <div class="wardrobe-layout">${layout}</div></main>`;
}

function steps() {
  const status = ['内置模特', `${state.selected.length} 件单品`, modes[state.mode], '暂无成片'];
  return `<ol class="steps" aria-label="试穿步骤">${stages.map((name, index) => `<li>
    <button type="button" data-action="step" data-key="${index}" data-focus="step-${index}" ${state.step === index ? 'aria-current="step"' : ''}>
      <span class="step-index" aria-hidden="true">${index + 1}</span><span>${name}<small>${status[index]}</small></span></button></li>`).join('')}</ol>`;
}

function stepPanel() {
  if (state.step === 0) return `<h2>这次用谁试穿</h2><p>当前使用照花内置模特。全身参考图不会被当作成片。</p>
    <a class="button" href="${asset(MODEL_TURNAROUND)}" target="_blank" rel="noopener">查看三视图</a>
    <button type="button" class="button button--primary" data-action="next">搭衣服</button>`;
  if (state.step === 1) return `<h2>这次穿什么</h2>${selection()}
    <div class="panel-actions"><button type="button" class="button" data-action="wardrobe">回衣橱选衣</button>
    <button type="button" class="button button--primary" data-action="next" ${state.selected.length ? '' : 'disabled'}>去试拍</button></div>`;
  if (state.step === 2) return `<h2>这次怎么拍</h2><p>内置模特 · ${state.selected.length} 件单品</p>
    <div class="mode-options" role="group" aria-label="拍摄方式">${Object.entries(modes).map(([key, label]) => `<button type="button" class="button" data-action="mode" data-key="${key}" data-focus="mode-${key}" aria-pressed="${state.mode === key}">${label}</button>`).join('')}</div>
    <p>${state.mode === 'studio' ? '无缝背景与棚拍姿势。' : '保留原照片的姿势和背景，只试所选衣物。'}</p>
    ${state.selected.length ? '<button type="button" class="button button--primary" data-action="confirm">查看拍摄确认</button>' : '<button type="button" class="button" data-action="wardrobe">先从衣橱选衣</button>'}`;
  return `<h2>还没有成片</h2><p>${state.notice || '这只是设计预览，不会显示假的试穿结果。'}</p>
    <button type="button" class="button" data-action="back-shoot">返回试拍</button>`;
}

function studio() {
  return `<main class="page studio-page"><div class="page-head"><h1 tabindex="-1" data-focus="page">试衣间</h1></div>${steps()}
    <div class="studio-layout">${portrait()}<section class="inspector" tabindex="-1" data-focus="inspector" aria-label="当前步骤">${stepPanel()}</section></div></main>`;
}

function render(focus, keepHorizontal = false) {
  const offsets = keepHorizontal ? ['.garment-grid', '.outfit-items'].map(selector => [selector, app.querySelector(selector)?.scrollLeft ?? 0]) : [];
  app.innerHTML = `${header()}${state.view === 'wardrobe' ? wardrobe() : studio()}${footer()}`;
  for (const [selector, left] of offsets) if (left) app.querySelector(selector)?.scrollTo({ left });
  if (focus) app.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
}

function update(changes, focus, keepHorizontal) {
  state = { ...state, ...changes };
  render(focus, keepHorizontal);
}

function navigate(view, step = state.step) {
  update({ view, step }, 'page');
  window.scrollTo(0, 0);
}

function toggle(key, focus) {
  if (!clothes.some(item => item.id === key)) return;
  const already = state.selected.includes(key);
  if (!already && state.selected.length >= limit) {
    const message = `每套最多 ${limit} 件，请先移除一件。`;
    const counter = app.querySelector('.outfit-heading p');
    if (counter) counter.textContent = message;
    announcement.textContent = message;
    return;
  }
  update({ selected: already ? state.selected.filter(id => id !== key) : [...state.selected, key], notice: '' }, focus, true);
  announcement.textContent = outfitText();
}

app.addEventListener('click', event => {
  const control = event.target.closest('button[data-action]');
  if (!control) return;
  const { action, key, focus } = control.dataset;
  if (action === 'wardrobe' || action === 'studio') navigate(action);
  if (action === 'category') update({ category: key }, focus);
  if (action === 'toggle') toggle(key, focus);
  if (action === 'remove') toggle(key, state.view === 'studio' ? 'inspector' : 'outfit');
  if (action === 'try') navigate('studio', 2);
  if (action === 'step') update({ step: Number(key) }, focus);
  if (action === 'mode') update({ mode: key, notice: '' }, focus);
  if (action === 'next') update({ step: state.step + 1 }, 'inspector');
  if (action === 'back-shoot') update({ step: 2 }, 'inspector');
  if (action === 'confirm') update({ step: 3, notice: '已核对本套试拍设置。原型不下单，也没有生成图片。' }, 'inspector');
  if (action === 'reset-search') update({ category: 'all', query: '' }, 'search');
});

app.addEventListener('submit', event => {
  if (!event.target.matches('.search')) return;
  event.preventDefault();
  update({ query: new FormData(event.target).get('query').trim().slice(0, 60) }, 'search');
  announcement.textContent = `找到 ${app.querySelectorAll('.garment').length} 件单品`;
});

render();
