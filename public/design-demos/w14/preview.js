import { MODEL_FRONT, MODEL_TURNAROUND, STUDIO_MAKEUP } from '/lib/model-assets.js';

import { filterGarments, garments, groups, lookProblem, maxPieces } from './catalog.js';

const select = selector => document.querySelector(selector);
const selectAll = selector => [...document.querySelectorAll(selector)];
const garmentById = Object.fromEntries(garments.map(garment => [garment.id, garment]));
const photoPath = asset => `${asset.path}?v=${asset.sha256.slice(0, 12)}`;
const references = Object.freeze({
  front: { asset: MODEL_FRONT, alt: '照花内置模特的正面全身参考' },
  turnaround: { asset: MODEL_TURNAROUND, alt: '照花内置模特的正面、侧面、背面参考' },
  makeup: { asset: STUDIO_MAKEUP, alt: '照花内置模特的黑色长直发与棚拍定妆参考' },
});
let selected = [];
let category = 'all';
let activeScreen;

function garmentButton(garment) {
  const { id, name } = garment;
  return `<li data-garment-cell="${id}">
    <button class="garment" type="button" data-garment="${id}" aria-pressed="false">
      <span class="garment__photo"><img src="/catalog/${id}.jpg" alt="" decoding="async"></span>
      <span class="garment__caption"><span>${name}</span><span class="garment__mark" aria-hidden="true"></span></span>
    </button>
  </li>`;
}

function buildCatalog() {
  const filters = [{ id: 'all', name: '全部' }, ...groups];
  select('#filters').innerHTML = filters.map(({ id, name }) => `
    <button type="button" data-filter="${id}" aria-pressed="${id === 'all'}">${name}</button>`).join('');
  select('#closet-sheet').innerHTML = groups.map(({ id, name }) => {
    const items = garments.filter(garment => garment.slot === id);
    return `<section class="garment-shelf" data-shelf="${id}" aria-labelledby="shelf-${id}">
      <h2 id="shelf-${id}">${name}</h2>
      <ul class="shelf-items">${items.map(garmentButton).join('')}</ul>
    </section>`;
  }).join('');
}

function renderCatalog() {
  const query = select('#closet-search').value;
  const visible = filterGarments(category, query);
  const visibleIds = new Set(visible.map(garment => garment.id));
  const visibleGroups = new Set(visible.map(garment => garment.slot));
  select('#closet-sheet').toggleAttribute('data-single', visibleGroups.size === 1);
  select('#catalog-count').textContent = `${visible.length} 件样衣`;
  select('#catalog-empty').hidden = visible.length > 0;
  for (const button of selectAll('[data-filter]')) button.setAttribute('aria-pressed', String(button.dataset.filter === category));
  for (const cell of selectAll('[data-garment-cell]')) cell.hidden = !visibleIds.has(cell.dataset.garmentCell);
  for (const shelf of selectAll('[data-shelf]')) shelf.hidden = !visibleGroups.has(shelf.dataset.shelf);
}

function selectedGarment({ id, name }) {
  return `<li class="look-piece">
    <img src="/catalog/${id}.jpg" alt="" width="42" height="46">
    <span>${name}</span>
    <button class="remove" type="button" data-remove="${id}" aria-label="移除${name}"><span aria-hidden="true">×</span></button>
  </li>`;
}

function renderLook() {
  const problem = lookProblem(selected);
  const disabled = !selected.length || !!problem;
  const selectedIds = new Set(selected.map(garment => garment.id));
  for (const button of selectAll('[data-garment]')) button.setAttribute('aria-pressed', String(selectedIds.has(button.dataset.garment)));
  for (const count of selectAll('[data-look-count]')) count.textContent = `${selected.length} 件`;
  for (const note of selectAll('[data-look-feedback]')) {
    note.textContent = problem;
    note.hidden = !problem;
  }
  for (const list of selectAll('[data-look-list]')) {
    list.innerHTML = selected.length ? selected.map(selectedGarment).join('') : '<li class="look-empty muted">还没选衣物</li>';
  }
  select('#to-fitting').disabled = disabled;
  select('#review-shoot').disabled = disabled;
}

function toggleGarment(id, removeButton) {
  const garment = garmentById[id];
  const existing = selected.indexOf(garment);
  const list = removeButton?.closest('[data-look-list]');
  if (existing < 0 && selected.length >= maxPieces) {
    const message = `最多选 ${maxPieces} 件，先取消一件。`;
    for (const note of selectAll('[data-look-feedback]')) {
      note.textContent = message;
      note.hidden = false;
    }
    select('#announcement').textContent = message;
    return;
  }
  selected = existing >= 0 ? selected.filter(item => item !== garment) : [...selected, garment];
  renderLook();
  const result = existing >= 0 ? '已移除' : '已选';
  select('#announcement').textContent = [`${result}${garment.name}，共 ${selected.length} 件。`, lookProblem(selected)].filter(Boolean).join(' ');
  if (!list) return;
  const next = list.querySelectorAll('[data-remove]')[Math.min(existing, selected.length - 1)];
  const fallback = activeScreen === 'fitting' ? select('#edit-look') : select('[data-garment-cell]:not([hidden]) [data-garment]');
  (next ?? fallback ?? select('#closet-search')).focus();
}

function renderScreen() {
  const screen = location.hash === '#fitting' ? 'fitting' : 'closet';
  if (activeScreen === screen) return;
  const wasOpen = Boolean(activeScreen);
  activeScreen = screen;
  document.documentElement.dataset.route = screen;
  for (const section of selectAll('[data-screen]')) section.hidden = section.dataset.screen !== screen;
  for (const element of selectAll('[data-closet-only]')) element.hidden = screen !== 'closet';
  for (const item of selectAll('[data-destination]')) {
    if (item.dataset.destination === screen) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  const heading = select('#page-title');
  heading.textContent = screen === 'fitting' ? '试衣间' : '衣橱';
  document.title = `${heading.textContent} · 照花`;
  if (wasOpen) {
    window.scrollTo(0, 0);
    heading.focus({ preventScroll: true });
  }
}

function setProof(view) {
  const reference = references[view];
  const image = select('#proof-image');
  const original = select('#proof-original');
  select('#proof-title').textContent = reference ? '人物参考' : '试穿成片';
  select('#proof-empty').hidden = Boolean(reference);
  select('#proof-stage').dataset.view = view;
  image.hidden = !reference;
  original.hidden = !reference;
  if (reference) {
    const url = photoPath(reference.asset);
    image.src = url;
    image.alt = reference.alt;
    original.href = url;
  }
  for (const button of selectAll('[data-proof]')) button.setAttribute('aria-pressed', String(button.dataset.proof === view));
}

function openReview() {
  const dialog = select('#shoot-review');
  if (dialog.open) return;
  const studio = select('[name="shoot-mode"]:checked').value === 'studio';
  select('#review-summary').textContent = `内置模特 · ${selected.length} 件衣物 · ${studio ? '无影棚 3 个姿势' : '普通试穿 1 张'}`;
  dialog.returnValue = '';
  dialog.showModal();
}

buildCatalog();
renderCatalog();
renderLook();
renderScreen();
if (activeScreen === 'fitting') setProof('front');

window.addEventListener('hashchange', () => {
  renderScreen();
  if (activeScreen === 'fitting' && !select('#proof-image').hasAttribute('src')) setProof('front');
});

select('#closet-search').addEventListener('input', renderCatalog);
select('#to-fitting').addEventListener('click', () => { location.hash = '#fitting'; });
select('#review-shoot').addEventListener('click', openReview);
select('#shoot-review').addEventListener('close', event => {
  if (event.target.returnValue !== 'result') return;
  setProof('result');
  select('[data-proof="result"]').focus();
});

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button?.dataset.filter) {
    category = button.dataset.filter;
    renderCatalog();
  }
  if (button?.dataset.garment) toggleGarment(button.dataset.garment);
  if (button?.dataset.remove) toggleGarment(button.dataset.remove, button);
  if (button?.dataset.proof) setProof(button.dataset.proof);
});
