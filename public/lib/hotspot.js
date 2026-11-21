import { h } from './dom.js';

/**
 * 身体区域热区与服装叠加层。
 * 桌面端悬停、移动端点击命中区域后，在该区域叠加显示当前服装图（纯显示层，不触发新的生成与计费）。
 */
export const REGIONS = [
  { id: 'upper', label: '上身', box: { top: 8, height: 40, left: 20, width: 60 }, frame: { top: 10, height: 36, left: 23, width: 54 } },
  { id: 'lower', label: '下身', box: { top: 44, height: 44, left: 22, width: 56 }, frame: { top: 46, height: 40, left: 24, width: 52 } },
  { id: 'full', label: '全身', box: { top: 4, height: 92, left: 12, width: 76 }, frame: { top: 5, height: 90, left: 13, width: 74 } },
];

/** 商品分类决定哪些身体区域与该商品相关，避免在下半身展示上衣。 */
const REGION_BY_CATEGORY = {
  tops: ['upper', 'full'],
  bottoms: ['lower', 'full'],
  dresses: ['upper', 'lower', 'full'],
};

export function regionsFor(category) {
  const allowed = REGION_BY_CATEGORY[category] ?? ['full'];
  return REGIONS.filter((region) => allowed.includes(region.id));
}

function applyBox(element, box) {
  element.style.top = `${box.top}%`;
  element.style.left = `${box.left}%`;
  element.style.width = `${box.width}%`;
  element.style.height = `${box.height}%`;
}

export function createHotspots(container, { onChange, regions = REGIONS } = {}) {
  const overlay = h('div', { class: 'garment-overlay', hidden: true });
  const label = h('span', { class: 'garment-overlay__label' });
  overlay.append(label);
  container.append(overlay);

  const buttons = regions.map((region) => {
    const button = h('button', {
      type: 'button',
      class: 'hotspot',
      'aria-label': `查看${region.label}区域的服装`,
      'aria-pressed': 'false',
      dataset: { region: region.id },
    });
    applyBox(button, region.box);
    const activate = () => show(region);
    button.addEventListener('mouseenter', activate);
    button.addEventListener('focus', activate);
    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (activeRegion === region.id) hide();
      else show(region);
    });
    container.append(button);
    return { region, button };
  });

  let activeRegion = null;
  let garmentUrl = '';
  let garmentLabel = '';

  function show(region) {
    if (!garmentUrl) return;
    activeRegion = region.id;
    overlay.style.backgroundImage = `url("${garmentUrl}")`;
    applyBox(overlay, region.frame);
    label.textContent = garmentLabel ? `${region.label} · ${garmentLabel}` : region.label;
    overlay.hidden = false;
    for (const entry of buttons) {
      const active = entry.region.id === region.id;
      entry.button.classList.toggle('is-active', active);
      entry.button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    onChange?.(region.id);
  }

  function hide() {
    activeRegion = null;
    overlay.hidden = true;
    for (const entry of buttons) {
      entry.button.classList.remove('is-active');
      entry.button.setAttribute('aria-pressed', 'false');
    }
    onChange?.(null);
  }

  return {
    setGarment(url, name = '') {
      garmentUrl = url ?? '';
      garmentLabel = name ?? '';
      if (!garmentUrl) hide();
    },
    hide,
    destroy() {
      overlay.remove();
      for (const entry of buttons) entry.button.remove();
    },
  };
}
