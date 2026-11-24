import { h } from './dom.js';

const dialogs = new Set();

export function closeAllDialogs() {
  for (const close of [...dialogs]) close();
}

export function showDialog(host, panel, { label, canClose = () => true, onClose } = {}) {
  closeAllDialogs();
  const previousFocus = document.activeElement;
  panel.removeAttribute('role');
  panel.removeAttribute('aria-modal');
  const dialog = h('dialog', { class: 'dialog-frame', 'aria-label': label }, [panel]);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    dialogs.delete(close);
    dialog.close();
    host.replaceChildren();
    host.hidden = true;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    onClose?.();
  }
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (canClose()) close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog || !canClose()) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  host.hidden = false;
  host.replaceChildren(dialog);
  dialogs.add(close);
  dialog.showModal();
  return close;
}
