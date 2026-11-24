import { icon } from './icons.js';

export function h(tag, props = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function money(cents) {
  if (cents === null || cents === undefined) return '—';
  const yuan = cents / 100;
  return `¥${yuan % 1 === 0 ? yuan.toFixed(0) : yuan.toFixed(2)}`;
}

export function timeLabel(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let toastTimer = null;

export function toast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.hidden = true;
    // 收起时清空文本：否则下一个人读 textContent 会读到上一次的报错，
    // 明明成功了也像是失败（验收脚本就被这条残留骗过一次）。
    node.textContent = '';
  }, 3200);
}

export function errorText(error) {
  if (!error) return '操作失败，请稍后重试';
  if (typeof error === 'string') return error;
  return error.message || '操作失败，请稍后重试';
}

/**
 * 自制胶囊下拉（不用原生 <select>）。
 *
 * 一致性铁律：触发器在收起/展开两种状态下是同一个元素，字体、字号、行高、
 * 高度、左右内边距、圆角都取自同一套类名，展开时只改描边颜色与浮层显隐，
 * 绝不改变自身尺寸；因此两次状态不存在任何度量漂移。
 *
 * 选项列表的每一项与触发器使用相同字号/行高/高度/左右内边距（14px），
 * 未选中项不渲染任何占位符，选中项在左侧 14px 内边距内绝对定位一枚紫色对勾，
 * 不挤占文字位置，从而保证选项文字左边缘与触发器文字左边缘严格对齐。
 *
 * @param {object} options
 * @param {Array<{value:string,label:string}|string>} options.options
 * @param {string} [options.value]
 * @param {string} [options.placeholder]
 * @param {string} [options.ariaLabel]
 * @param {(value:string)=>void} [options.onChange]
 * @returns {{el:HTMLElement,getValue:()=>string,setValue:(v:string)=>void,setOptions:(list:Array)=>void,setDisabled:(b:boolean)=>void}}
 */
/**
 * 所有已展开的胶囊下拉。换页时统一收摊：节点被 root 清掉后，
 * document 上的 pointerdown 监听器如果没有摘除就会一直留着，越点越多。
 */
const openMenus = new Set();

export function closeAllMenus() {
  for (const close of [...openMenus]) close();
}

export function createActionMenu(label, actions) {
  const trigger = h('button', { type: 'button', class: 'icon-button', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, [icon('more')]);
  const menu = h('div', { class: 'action-menu', role: 'menu', 'aria-label': label, hidden: true });
  const wrapper = h('div', { class: 'actions-menu' }, [trigger, menu]);
  function close(restoreFocus = false) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside);
    openMenus.delete(close);
    if (restoreFocus && trigger.isConnected) trigger.focus();
  }
  function outside(event) {
    if (!wrapper.contains(event.target)) close();
  }
  function open() {
    closeAllMenus();
    menu.hidden = false;
    wrapper.classList.remove('opens-up');
    const bottom = [...document.querySelectorAll('.nav, .wardrobe-mobile-actions, .studio__submit-card')]
      .filter((node) => getComputedStyle(node).position === 'fixed' && node.getBoundingClientRect().height > 0)
      .reduce((edge, node) => Math.min(edge, node.getBoundingClientRect().top - 8), innerHeight - 12);
    wrapper.classList.toggle('opens-up', menu.getBoundingClientRect().bottom > bottom);
    trigger.setAttribute('aria-expanded', 'true');
    openMenus.add(close);
    document.addEventListener('pointerdown', outside);
    menu.querySelector('button')?.focus();
  }
  for (const action of actions) {
    menu.append(h('button', { type: 'button', role: 'menuitem', class: action.danger ? 'is-danger' : '', onclick: () => { close(true); action.run(); } }, [icon(action.icon), h('span', { text: action.label })]));
  }
  trigger.addEventListener('click', () => menu.hidden ? open() : close(true));
  wrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (menu.hidden) { open(); return; }
      const buttons = [...menu.querySelectorAll('button')];
      const current = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  return wrapper;
}

export function createCapsuleSelect({ options = [], value = '', placeholder = '请选择', ariaLabel = '', onChange } = {}) {
  let items = normalize(options);
  let current = value;
  let open = false;
  let activeIndex = -1;
  let disabled = false;

  const label = h('span', { class: 'capsule-trigger__label' });
  const trigger = h('button', {
    type: 'button',
    class: 'capsule-trigger',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-label': ariaLabel || placeholder,
  }, [label, h('span', { class: 'capsule-trigger__chevron', 'aria-hidden': 'true', text: '▾' })]);
  const menu = h('div', { class: 'capsule-menu', role: 'listbox', hidden: true });
  const el = h('div', { class: 'capsule-select' }, [trigger, menu]);

  function normalize(list) {
    return (list || []).map((item) => (typeof item === 'string' ? { value: item, label: item } : item));
  }

  function selectedLabel() {
    const found = items.find((item) => item.value === current);
    return found ? found.label : '';
  }

  function paintTrigger() {
    const text = selectedLabel();
    label.textContent = text || placeholder;
    label.classList.toggle('is-placeholder', !text);
    trigger.setAttribute('aria-label', `${ariaLabel || placeholder}：${text || placeholder}`);
  }

  function paintMenu() {
    menu.replaceChildren();
    items.forEach((item, index) => {
      const selected = item.value === current;
      const option = h('button', {
        type: 'button',
        class: `capsule-item${selected ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`,
        role: 'option',
        'aria-selected': selected ? 'true' : 'false',
        tabindex: index === activeIndex ? '0' : '-1',
        dataset: { value: item.value },
      }, [
        selected ? h('span', { class: 'capsule-item__check', 'aria-hidden': 'true', text: '✓' }) : null,
        h('span', { class: 'capsule-item__label', text: item.label }),
      ]);
      option.addEventListener('click', () => select(item.value));
      option.addEventListener('mouseenter', () => {
        activeIndex = index;
        markActive();
      });
      menu.append(option);
    });
  }

  function markActive() {
    [...menu.children].forEach((node, index) => {
      node.classList.toggle('is-active', index === activeIndex);
      node.tabIndex = index === activeIndex ? 0 : -1;
    });
  }

  function openMenu() {
    if (disabled || open) return;
    open = true;
    activeIndex = Math.max(0, items.findIndex((item) => item.value === current));
    paintMenu();
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    el.classList.add('is-open');
    document.addEventListener('pointerdown', onOutside, true);
    openMenus.add(closeMenu);
    const active = menu.children[activeIndex];
    active?.focus?.();
  }

  function closeMenu(focusTrigger = false) {
    if (!open) return;
    open = false;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    el.classList.remove('is-open');
    document.removeEventListener('pointerdown', onOutside, true);
    openMenus.delete(closeMenu);
    if (focusTrigger) trigger.focus();
  }

  function onOutside(event) {
    // 节点已被换页清掉时自己收摊，避免 document 上的监听器留在空节点上。
    if (!el.isConnected) closeMenu();
    else if (!el.contains(event.target)) closeMenu();
  }

  function select(next) {
    current = next;
    paintTrigger();
    closeMenu(true);
    onChange?.(current);
  }

  function move(delta) {
    if (items.length === 0) return;
    activeIndex = (activeIndex + delta + items.length) % items.length;
    markActive();
    menu.children[activeIndex]?.focus?.();
  }

  trigger.addEventListener('click', () => (open ? closeMenu() : openMenu()));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) select(items[activeIndex]?.value ?? current);
      else openMenu();
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu(true);
    }
  });

  menu.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(items[activeIndex]?.value ?? current);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      closeMenu();
    }
  });

  paintTrigger();

  return {
    el,
    getValue: () => current,
    setValue(next) {
      current = next;
      paintTrigger();
    },
    setOptions(list) {
      items = normalize(list);
      paintTrigger();
    },
    setDisabled(next) {
      disabled = next;
      trigger.disabled = next;
      el.classList.toggle('is-disabled', next);
      if (next) closeMenu();
    },
  };
}

/**
 * 两级联动胶囊：一级选大类，二级选该大类的子类。
 *
 * 一级变化时清空二级并重建它的选项，因此不会出现「上衣 · 牛仔裤」这种
 * 跨类组合；二级在没有可选项时置灰。两级都直接复用 createCapsuleSelect，
 * 高度、圆角、内边距与展开行为与单级胶囊完全一致，不存在第二套度量。
 *
 * setValue / setSubValue 只改值、不触发 onChange（与 createCapsuleSelect 一致），
 * 供外部回填状态用；setValue 会同时清空二级，因为旧子类已不属于新大类。
 *
 * @param {object} config
 * @param {Array<{value:string,label:string,options:Array<{value:string,label:string}|string>}>} config.groups
 * @param {string} [config.value] 一级初始值
 * @param {string} [config.subValue] 二级初始值
 * @param {string} [config.placeholder] 一级占位文案
 * @param {string} [config.subPlaceholder] 二级占位文案
 * @param {string} [config.ariaLabel] 两级共用的无障碍前缀，如「第 1 个单品」
 * @param {(value:string,subValue:string)=>void} [config.onChange] 任一级变化后回调
 * @returns {{el:HTMLElement,getValue:()=>string,getSubValue:()=>string,setValue:(v:string)=>void,setSubValue:(v:string)=>void,setGroups:(list:Array)=>void}}
 */
export function createCascadeSelect({
  groups = [],
  value = '',
  subValue = '',
  placeholder = '请选择',
  subPlaceholder = '请选择子类',
  ariaLabel = '',
  onChange,
} = {}) {
  let currentGroups = normalizeGroups(groups);
  let currentValue = value;
  let currentSubValue = subValue;

  function normalizeGroups(list) {
    return (list || []).map((group) => ({
      value: group.value,
      label: group.label ?? group.value,
      options: (group.options || []).map((option) => (typeof option === 'string' ? { value: option, label: option } : option)),
    }));
  }

  function optionsFor(key) {
    return currentGroups.find((group) => group.value === key)?.options ?? [];
  }

  const primary = createCapsuleSelect({
    options: currentGroups,
    value: currentValue,
    placeholder,
    ariaLabel: ariaLabel ? `${ariaLabel}大类` : '',
    onChange: (next) => {
      currentValue = next;
      currentSubValue = '';
      paintSecondary();
      onChange?.(currentValue, currentSubValue);
    },
  });

  const secondary = createCapsuleSelect({
    options: [],
    value: '',
    placeholder: subPlaceholder,
    ariaLabel: ariaLabel ? `${ariaLabel}子类` : '',
    onChange: (next) => {
      currentSubValue = next;
      onChange?.(currentValue, currentSubValue);
    },
  });

  function paintSecondary() {
    const options = optionsFor(currentValue);
    secondary.setOptions(options);
    secondary.setValue(currentSubValue);
    secondary.setDisabled(options.length === 0);
  }

  paintSecondary();

  return {
    el: h('div', { class: 'cascade' }, [primary.el, secondary.el]),
    getValue: () => currentValue,
    getSubValue: () => currentSubValue,
    setValue(next) {
      currentValue = next;
      currentSubValue = '';
      primary.setValue(next);
      paintSecondary();
    },
    setSubValue(next) {
      currentSubValue = next;
      secondary.setValue(next);
    },
    setGroups(list) {
      currentGroups = normalizeGroups(list);
      if (!currentGroups.some((group) => group.value === currentValue)) {
        currentValue = '';
        currentSubValue = '';
      }
      primary.setOptions(currentGroups);
      primary.setValue(currentValue);
      paintSecondary();
    },
  };
}
