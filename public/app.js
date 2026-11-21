'use strict';

const $ = (id) => document.getElementById(id);
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
const noModelsMessage = '未检测到 the image service 图片模型，请确认 the image service 正在运行（默认网关 127.0.0.1:3425）';
const categories = { tops: '上衣', bottoms: '下装', dresses: '连衣裙' };
const state = {
  engines: [], configLoading: false, configVersion: 0, busy: false, disposed: false,
  files: { person: null, garment: null }, versions: { person: 0, garment: 0 },
  fieldErrors: { person: '', garment: '', prompt: '' },
  readers: {}, previewURLs: {}, downloadURLs: new Set(), history: [], current: null,
  controller: null, configController: null, view: 'result',
};
const codePoints = (text) => Array.from(text).length;

function setStatus(message, error = false) {
  $('generation-status').textContent = message;
  $('generation-status').classList.toggle('is-error', error);
}

function showFieldError(field, message) {
  if (!['person', 'garment', 'prompt'].includes(field)) return;
  state.fieldErrors[field] = message;
  $(field + '-error').textContent = message;
  $(field === 'prompt' ? 'prompt' : field + '-file').setAttribute('aria-invalid', 'true');
}

function updateReady() {
  const engine = state.engines.find((item) => item.id === $('engine').value);
  const promptLength = codePoints($('prompt').value.trim());
  $('prompt-count').textContent = `${codePoints($('prompt').value)} / 2000 字符`;
  const promptError = promptLength > 2000 ? '补充要求不能超过 2000 个字符。' : state.fieldErrors.prompt;
  $('prompt-error').textContent = promptError;
  $('prompt').setAttribute('aria-invalid', String(Boolean(promptError)));
  const hasFieldError = Object.values(state.fieldErrors).some(Boolean);
  const ready = !state.busy && !state.configLoading && engine?.available
    && state.files.person && state.files.garment && promptLength <= 2000 && !hasFieldError;
  $('generate').disabled = !ready;
  $('engine-detail').textContent = engine ? engine.id : '';
  $('ready-status').textContent = state.busy ? '本次素材已锁定，请等待生成完成。'
    : state.configLoading ? '正在读取引擎配置…'
      : !engine?.available ? noModelsMessage
        : !state.files.person || !state.files.garment ? '请准备有效的人物照片与服装参考图。'
          : promptLength > 2000 ? '请缩短补充要求。' : hasFieldError ? '请修正标记的素材或补充要求。' : '素材已就绪，点击生成会向所选服务发送图片。';
}

async function loadConfig() {
  if (state.busy || state.configLoading) return;
  const version = ++state.configVersion;
  state.configLoading = true;
  state.engines = [];
  state.configController = new AbortController();
  const timer = setTimeout(() => state.configController?.abort(), 15000);
  $('reload-config').disabled = true;
  $('engine').disabled = true;
  $('config-status').textContent = '正在读取本机服务配置…';
  updateReady();
  try {
    const response = await fetch('/api/config', { cache: 'no-store', signal: state.configController.signal });
    if (!response.ok) throw new Error('配置读取失败');
    const config = await response.json();
    if (!Array.isArray(config.engines) || !config.engines.every((item) =>
      item && typeof item.id === 'string' && item.id.length > 0 && typeof item.label === 'string'
      && typeof item.available === 'boolean' && typeof item.default === 'boolean')) throw new Error('配置格式无效');
    if (state.disposed || version !== state.configVersion) return;
    state.engines = config.engines;
    $('engine').replaceChildren();
    for (const engine of state.engines) {
      const option = document.createElement('option');
      option.value = engine.id;
      option.textContent = engine.label;
      option.disabled = !engine.available;
      $('engine').append(option);
    }
    const selected = state.engines.find((item) => item.id === config.defaultEngine && item.available)
      || state.engines.find((item) => item.available);
    if (selected) {
      $('engine').value = selected.id;
      $('config-status').textContent = '已读取 the image service 图片模型。模型已配置，上游可用性将在生成时确认。';
    } else {
      $('engine').replaceChildren(new Option('未检测到图片模型', ''));
      $('config-status').textContent = noModelsMessage;
    }
  } catch {
    if (state.disposed || version !== state.configVersion) return;
    $('engine').replaceChildren(new Option('配置加载失败', ''));
    $('config-status').textContent = noModelsMessage;
  } finally {
    clearTimeout(timer);
    if (!state.disposed && version === state.configVersion) {
      state.configLoading = false;
      state.configController = null;
      $('reload-config').disabled = false;
      $('engine').disabled = !state.engines.some((engine) => engine.available);
      updateReady();
    }
  }
}

function clearFile(kind) {
  state.files[kind] = null;
  if (state.previewURLs[kind]) URL.revokeObjectURL(state.previewURLs[kind]);
  delete state.previewURLs[kind];
  const preview = $(`${kind}-preview`);
  preview.hidden = true;
  preview.removeAttribute('src');
  $(`${kind}-drop`).classList.remove('has-image');
  $(`${kind}-action`).textContent = kind === 'person' ? '上传人物照片' : '上传服装参考图';
  $(`${kind}-info`).textContent = '点击选择或拖放图片';
}

function readDataURL(file, kind) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    state.readers[kind] = reader;
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取这张图片，请重新选择。'));
    reader.onabort = () => reject(new Error('图片读取已取消。'));
    reader.readAsDataURL(file);
  });
}

function decodeImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth && image.naturalHeight) resolve();
      else reject(new Error('图片内容无效，请选择可正常打开的图片。'));
    };
    image.onerror = () => reject(new Error('图片无法解码，请选择有效的 JPEG、PNG 或 WebP 图片。'));
    image.src = source;
  });
}

async function selectFile(kind, fileList) {
  if (state.busy || state.disposed) return;
  const version = ++state.versions[kind];
  state.fieldErrors[kind] = '';
  state.readers[kind]?.abort();
  clearFile(kind);
  const input = $(`${kind}-file`);
  input.value = '';
  input.removeAttribute('aria-invalid');
  $(`${kind}-error`).textContent = '';
  updateReady();
  if (!fileList.length) return;
  let url;
  try {
    if (fileList.length !== 1) throw new Error('每次请选择一张图片。');
    const file = fileList[0];
    if (!allowedTypes.includes(file.type)) throw new Error('仅支持 JPEG、PNG 或 WebP 图片。');
    if (!file.size) throw new Error('这张图片是空文件，请重新选择。');
    if (file.size > 8 * 1024 * 1024) throw new Error('图片超过 8 MiB，请选择更小的原始文件。');
    $(`${kind}-info`).textContent = '正在读取并检查图片…';
    url = URL.createObjectURL(file);
    const [dataURL] = await Promise.all([readDataURL(file, kind), decodeImage(url)]);
    if (version !== state.versions[kind] || state.disposed) return;
    state.files[kind] = { dataURL, name: file.name, mimeType: file.type };
    state.previewURLs[kind] = url;
    url = null;
    $(`${kind}-preview`).src = state.previewURLs[kind];
    $(`${kind}-preview`).hidden = false;
    $(`${kind}-drop`).classList.add('has-image');
    $(`${kind}-action`).textContent = '点击或拖放，替换图片';
    $(`${kind}-info`).textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MiB`;
  } catch (error) {
    if (version !== state.versions[kind] || state.disposed) return;
    input.setAttribute('aria-invalid', 'true');
    $(`${kind}-error`).textContent = error.message;
    $(`${kind}-info`).textContent = '未选择有效图片';
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (version === state.versions[kind]) {
      delete state.readers[kind];
      updateReady();
    }
  }
}

function setBusy(busy) {
  state.busy = busy;
  $('input-fields').disabled = busy;
  $('canvas').setAttribute('aria-busy', String(busy));
  $('loading').hidden = !busy;
  $('generate').firstChild.textContent = busy ? '正在生成，请稍候 ' : '生成试穿图 ';
  if (!busy) $('engine').disabled = !state.engines.some((engine) => engine.available);
  updateReady();
}

function showRecord(record) {
  state.current = record;
  $('empty-result').hidden = true;
  $('result-original').src = record.person;
  $('result-image').src = record.image.dataURL;
  document.querySelectorAll('.result-frame').forEach((frame) => { frame.hidden = false; });
  document.querySelectorAll('[data-view]').forEach((button) => {
    if (button.tagName === 'BUTTON') button.disabled = false;
  });
  $('download').disabled = false;
  const time = new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false });
  $('result-meta').textContent = `${record.label} · ${categories[record.category]} · ${time}`;
  for (const button of $('history-list').children) {
    button.setAttribute('aria-pressed', String(button.dataset.record === record.id));
  }
}

function renderHistory() {
  $('history-empty').hidden = state.history.length > 0;
  $('history-count').textContent = `${state.history.length} / 10`;
  $('history-list').replaceChildren();
  for (const record of state.history) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    button.dataset.record = record.id;
    button.setAttribute('aria-pressed', String(record === state.current));
    const image = document.createElement('img');
    image.src = record.image.dataURL;
    image.alt = `${categories[record.category]}试穿记录`;
    const label = document.createElement('span');
    label.textContent = `${record.label} · ${categories[record.category]}`;
    const time = document.createElement('small');
    time.textContent = new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour12: false });
    button.append(image, label, time);
    button.addEventListener('click', () => {
      showRecord(record);
      setStatus('正在查看历史结果；待提交的人物、服装和设置保持不变。');
    });
    $('history-list').append(button);
  }
}

async function generate(event) {
  event.preventDefault();
  updateReady();
  if ($('generate').disabled || state.busy) return;
  const engine = state.engines.find((item) => item.id === $('engine').value && item.available);
  const snapshot = {
    model: engine.id, person: state.files.person.dataURL, garment: state.files.garment.dataURL,
    category: document.querySelector('input[name="category"]:checked').value,
    prompt: $('prompt').value.trim(),
  };
  setBusy(true);
  setStatus('正在生成，请稍候。此次请求不会自动重试或切换引擎。');
  const controller = new AbortController();
  state.controller = controller;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
  try {
    const response = await fetch('/api/tryon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot), signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const message = result?.error?.code === 'UPSTREAM_TIMEOUT'
        ? '等待超时，上游可能仍已处理或计费。请确认后决定是否再次生成。'
        : typeof result?.error?.message === 'string' ? result.error.message
          : '生成失败，本地服务未返回有效响应。请检查服务后再手动重试。';
      showFieldError(result?.error?.field, message);
      throw new Error(message);
    }
    const image = result?.image;
    if (result?.engine !== snapshot.model || !image || !allowedTypes.includes(image.mimeType)
      || typeof image.dataURL !== 'string' || !image.dataURL.startsWith(`data:${image.mimeType};base64,`)
      || image.dataURL.length > 22400000 || !Number.isFinite(Date.parse(result.createdAt))) {
      throw new Error('所选服务返回格式不兼容，未保存此次结果。请检查本机网关或模型配置。');
    }
    await decodeImage(image.dataURL);
    if (state.disposed) return;
    if (timedOut) throw new Error('等待超时，上游可能仍已处理或计费。');
    const record = { ...snapshot, image, createdAt: result.createdAt, label: engine.label, id: crypto.randomUUID() };
    state.history = [record, ...state.history].slice(0, 10);
    showRecord(record);
    renderHistory();
    setStatus('试穿图已生成。可以切换原图、并排对比或下载图片。');
  } catch (error) {
    if (state.disposed) return;
    setStatus(timedOut ? '等待超时，上游可能仍已处理或计费。请确认后决定是否再次生成。'
      : error.name === 'TypeError' ? '无法连接本地服务。请检查服务状态；重试可能再次计费。'
        : error.message, true);
  } finally {
    clearTimeout(timer);
    state.controller = null;
    if (!state.disposed) setBusy(false);
  }
}

function downloadCurrent() {
  if (!state.current) return;
  const { image, createdAt } = state.current;
  try {
    const bytes = atob(image.dataURL.split(',')[1]);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      const part = bytes.slice(offset, offset + 65536);
      chunks.push(Uint8Array.from(part, (char) => char.charCodeAt(0)));
    }
    const blob = new Blob(chunks, { type: image.mimeType });
    const url = URL.createObjectURL(blob);
    state.downloadURLs.add(url);
    const link = document.createElement('a');
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    link.href = url;
    link.download = `tryon-${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}.${extensions[image.mimeType]}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); state.downloadURLs.delete(url); }, 30000);
  } catch {
    setStatus('下载准备失败，请再次点击下载。已有结果仍保留在当前页面。', true);
  }
}

for (const kind of ['person', 'garment']) {
  $(`${kind}-file`).addEventListener('change', (event) => selectFile(kind, [...event.target.files]));
  const drop = $(`${kind}-drop`);
  for (const name of ['dragenter', 'dragover']) {
    drop.addEventListener(name, (event) => {
      event.preventDefault();
      if (!state.busy) drop.classList.add('drag-over');
    });
  }
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('drag-over');
    selectFile(kind, [...event.dataTransfer.files]);
  });
}
// Prevent dropped files outside a target from navigating away and discarding the session.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());
$('tryon-form').addEventListener('submit', generate);
$('prompt').addEventListener('input', () => { state.fieldErrors.prompt = ''; updateReady(); });
$('engine').addEventListener('change', updateReady);
$('reload-config').addEventListener('click', loadConfig);
$('download').addEventListener('click', downloadCurrent);
for (const button of document.querySelectorAll('button[data-view]')) {
  button.addEventListener('click', () => {
    state.view = button.dataset.view;
    $('canvas').dataset.view = state.view;
    document.querySelectorAll('button[data-view]').forEach((item) => {
      item.setAttribute('aria-pressed', String(item === button));
    });
  });
}
window.addEventListener('pagehide', () => {
  state.disposed = true;
  state.controller?.abort();
  state.configController?.abort();
  for (const kind of ['person', 'garment']) {
    state.versions[kind] += 1;
    state.readers[kind]?.abort();
    if (state.previewURLs[kind]) URL.revokeObjectURL(state.previewURLs[kind]);
  }
  for (const url of state.downloadURLs) URL.revokeObjectURL(url);
});
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
loadConfig();
