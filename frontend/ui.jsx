import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { paths } from '../public/lib/icons.js';

export function Icon({ name, className = 'icon' }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {(paths[name] ?? paths.image).map(path => <path key={path} d={path} strokeWidth={name === 'more' ? 4 : undefined} />)}
  </svg>;
}

export function errorText(error) {
  return (typeof error === 'string' ? error : error?.message) || '操作失败，请稍后重试';
}

export function toast(message) {
  window.dispatchEvent(new CustomEvent('tryon:notice', { detail: message }));
}

export function Toast() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let timer;
    function show(event) {
      clearTimeout(timer);
      setMessage(event.detail);
      timer = setTimeout(() => setMessage(''), 3200);
    }
    window.addEventListener('tryon:notice', show);
    return () => { clearTimeout(timer); window.removeEventListener('tryon:notice', show); };
  }, []);
  return <div id="toast" className="toast" role="status" aria-live="polite" hidden={!message}>{message}</div>;
}

function useMenu() {
  const [open, setOpen] = useState(false);
  const wrapper = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = event => {
      if (!wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [open]);
  function close(restoreFocus) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  return { open, setOpen, close, wrapper, trigger, list };
}

function nextIndex(key, current, count) {
  if (!count) return 0;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return (current + (key === 'ArrowDown' ? 1 : -1) + count) % count;
}

const moveKeys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

export function ActionMenu({ label, actions }) {
  const menu = useMenu();
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    if (!menu.open) return;
    const fixed = [...document.querySelectorAll('.nav, .wardrobe-mobile-actions, .studio__submit-card')]
      .filter(node => getComputedStyle(node).position === 'fixed' && node.getBoundingClientRect().height > 0);
    const bottom = Math.min(innerHeight - 12, ...fixed.map(node => node.getBoundingClientRect().top - 8));
    setUp(menu.list.current.getBoundingClientRect().bottom > bottom);
    menu.list.current.firstElementChild?.focus();
  }, [menu.open]);
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); menu.close(true); }
    if (event.key === 'Tab') menu.close(false);
    if (!moveKeys.includes(event.key)) return;
    event.preventDefault();
    if (!menu.open) { setUp(false); menu.setOpen(true); return; }
    const buttons = [...menu.list.current.children];
    buttons[nextIndex(event.key, buttons.indexOf(document.activeElement), buttons.length)]?.focus();
  }
  return <div className={`actions-menu${up && menu.open ? ' opens-up' : ''}`} ref={menu.wrapper} onKeyDown={onKey}>
    <button type="button" ref={menu.trigger} className="icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={menu.open}
      onClick={() => { setUp(false); menu.setOpen(!menu.open); }}><Icon name="more" /></button>
    <div ref={menu.list} className="action-menu" role="menu" aria-label={label} hidden={!menu.open}>
      {actions.map(action => <button key={action.label} type="button" role="menuitem" className={action.danger ? 'is-danger' : undefined}
        onClick={() => { menu.close(true); action.run(); }}><Icon name={action.icon} /><span>{action.label}</span></button>)}
    </div>
  </div>;
}

export function CapsuleSelect({ options = [], value = '', onChange, disabled, placeholder = '请选择', ariaLabel }) {
  const menu = useMenu();
  const listId = useId();
  const items = options.map(item => typeof item === 'string' ? { label: item, value: item } : item);
  const selectedIndex = items.findIndex(item => item.value === value);
  const selected = items[selectedIndex];
  const [active, setActive] = useState(0);
  function open() {
    setActive(Math.max(0, selectedIndex));
    menu.setOpen(true);
  }
  useLayoutEffect(() => {
    if (menu.open && !disabled) menu.list.current?.children[active]?.focus();
  }, [menu.open, active, disabled]);
  useEffect(() => { if (disabled) menu.setOpen(false); }, [disabled]);
  function select(item) {
    menu.close(true);
    if (item) onChange?.(item.value);
  }
  function onKey(event) {
    if (moveKeys.includes(event.key)) {
      event.preventDefault();
      if (menu.open) setActive(nextIndex(event.key, active, items.length));
      else open();
    } else if (event.key === 'Escape' && menu.open) {
      event.preventDefault(); event.stopPropagation(); menu.close(true);
    } else if (event.key === 'Tab') menu.close(false);
  }
  return <div className={`capsule-select${menu.open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`} ref={menu.wrapper} onKeyDown={onKey}>
    <button type="button" ref={menu.trigger} className="capsule-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={menu.open}
      aria-controls={listId} aria-label={`${ariaLabel || placeholder}：${selected?.label || placeholder}`} onClick={() => menu.open ? menu.close(true) : open()}>
      <span className={`capsule-trigger__label${selected ? '' : ' is-placeholder'}`}>{selected?.label || placeholder}</span>
      <span className="capsule-trigger__chevron" aria-hidden="true">▾</span>
    </button>
    <div id={listId} ref={menu.list} className="capsule-menu" role="listbox" aria-label={ariaLabel || placeholder} hidden={!menu.open}>
      {menu.open && items.map((item, index) => <button type="button" key={item.value} role="option" aria-selected={index === selectedIndex}
        className={`capsule-item${index === selectedIndex ? ' is-selected' : ''}${index === active ? ' is-active' : ''}`}
        tabIndex={index === active ? 0 : -1} data-value={item.value} onFocus={() => setActive(index)} onClick={() => select(item)}>
        {index === selectedIndex && <Icon name="check" className="icon capsule-item__check" />}<span className="capsule-item__label">{item.label}</span>
      </button>)}
    </div>
  </div>;
}

export function CascadeSelect({ groups = [], value, subValue, onChange, ariaLabel = '', placeholder = '请选择', subPlaceholder = '请选择子类' }) {
  const subOptions = groups.find(group => group.value === value)?.options ?? [];
  return <div className="cascade">
    <CapsuleSelect options={groups} value={value} onChange={next => onChange(next, '')} placeholder={placeholder} ariaLabel={`${ariaLabel}大类`} />
    <CapsuleSelect options={subOptions} value={subValue} onChange={next => onChange(value, next)} disabled={!subOptions.length} placeholder={subPlaceholder} ariaLabel={`${ariaLabel}子类`} />
  </div>;
}

export function Modal({ title, ariaLabel, onClose, busy = false, closeLabel = '关闭弹窗', children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  function backdrop(event) {
    if (event.target !== ref.current || busy) return;
    const { left, right, top, bottom } = ref.current.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose();
  }
  return <dialog className="dialog-frame" ref={ref} aria-label={ariaLabel || title} onClick={backdrop}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <section className="modal"><div className="modal__head">
      <h2 className="modal__title">{title}</h2><button type="button" className="icon-button" aria-label={closeLabel} disabled={busy} onClick={onClose}><Icon name="close" /></button>
    </div>{children}</section>
  </dialog>;
}
