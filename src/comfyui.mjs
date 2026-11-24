import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { workflowGraph } from './comfy-workflow.mjs';
import { HttpError } from './errors.mjs';
import { deadline, readUpstream } from './imageapi.mjs';
import { decodeImage, MAX_BODY_BYTES, MAX_OUTPUT_BYTES, sniff } from './validate.mjs';

const unavailable = () => new HttpError(503, 'WORKFLOW_UNAVAILABLE', '工作流未就绪，请在设置中检查 ComfyUI 连接、节点与模型文件');
const invalid = () => new HttpError(502, 'UPSTREAM_FORMAT', '工作流返回格式不兼容或图片超限');
export function workflowTimeout(env) {
  const value = Number(env.COMFYUI_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value >= 1000 && value <= 3600000 ? value : 900000;
}

function connection(env) {
  if (!env.COMFYUI_BASE_URL) throw unavailable();
  let url;
  try { url = new URL(env.COMFYUI_BASE_URL); } catch { throw unavailable(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw unavailable();
  return { base: url.href.replace(/\/+$/, ''), headers: env.COMFYUI_API_KEY ? { authorization: `Bearer ${env.COMFYUI_API_KEY}` } : {} };
}

async function request(connectionInfo, path, fetchImpl, signal, { method = 'GET', body, binary = false } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetchImpl(`${connectionInfo.base}${path}`, {
    method, signal, redirect: 'error',
    headers: { ...connectionInfo.headers, ...(!multipart && body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
  });
  // Do not forward arbitrary remote errors (which can contain file paths or credentials).
  if (!response.ok) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
  const buffer = await readUpstream(response, binary ? MAX_OUTPUT_BYTES : MAX_BODY_BYTES, signal);
  if (binary) return buffer;
  try { return JSON.parse(buffer.toString('utf8')); } catch { throw invalid(); }
}

function schemaIssues(info, graph) {
  const issues = new Set();
  for (const node of Object.values(graph)) {
    const definition = info?.[node.class_type];
    if (!definition?.input) { issues.add(`缺少节点 ${node.class_type}`); continue; }
    const required = definition.input.required ?? {};
    const inputs = { ...required, ...definition.input.optional };
    for (const key of Object.keys(required)) if (!(key in node.inputs)) issues.add(`节点 ${node.class_type} 缺少必填输入 ${key}`);
    for (const [key, value] of Object.entries(node.inputs)) {
      const spec = inputs[key];
      if (!spec) { issues.add(`节点 ${node.class_type} 不支持输入 ${key}`); continue; }
      // LoadImage's filename menu is populated only after uploading; all other enumerations must exist now.
      if (Array.isArray(spec[0]) && !Array.isArray(value) && !(node.class_type === 'LoadImage' && key === 'image') && !spec[0].includes(value)) {
        issues.add(`节点 ${node.class_type} 的 ${key} 配置不可用`);
      }
    }
  }
  return [...issues];
}

export async function checkWorkflow(env, fetchImpl = fetch, signal) {
  if (!env.COMFYUI_BASE_URL) return { configured: false, ready: false, message: '尚未配置 ComfyUI，4090 就绪后填写服务端连接配置' };
  const clock = deadline(8000, signal);
  try {
    const endpoint = connection(env);
    const info = await request(endpoint, '/object_info', fetchImpl, clock.signal);
    const graph = workflowGraph({ images: ['person.png', 'garment.png'], prompt: '', env, seed: 1 });
    const issues = schemaIssues(info, graph);
    return { configured: true, ready: issues.length === 0, message: issues.length ? issues.join('；') : '节点与模型目录检查通过；尚未验证实际出图与显存' };
  } catch {
    return { configured: true, ready: false, message: '无法检查工作流，请核对服务端地址、认证与 ComfyUI 是否启动' };
  } finally { clock.dispose(); }
}

function imageLocation(image, expectedType) {
  if (!image || image.type !== expectedType || typeof image.name !== 'string' && typeof image.filename !== 'string') throw invalid();
  const name = image.name ?? image.filename;
  const subfolder = image.subfolder ?? '';
  const safe = value => typeof value === 'string' && !/[\\\x00-\x1f]/.test(value) && !value.split('/').some(part => part === '..' || part === '.') && !value.startsWith('/') && !value.includes(':');
  if (!safe(name) || !name || name.includes('/') || !safe(subfolder)) throw invalid();
  return { name, subfolder, type: expectedType };
}

export async function generateWorkflow({ referenceImages, prompt = '' }, env, fetchImpl = fetch, { timeoutMs = workflowTimeout(env), signal, pollMs = 1000 } = {}) {
  const endpoint = connection(env);
  if (!Array.isArray(referenceImages) || referenceImages.length < 2 || referenceImages.length > 4) {
    throw new HttpError(400, 'WORKFLOW_PIECES', '此试穿工作流支持人物加 1–3 件服装', 'pieces');
  }
  // Validate every reference before sending even the first image to the remote service.
  const decoded = referenceImages.map((image, index) => decodeImage(image, `referenceImages[${index}]`));
  const clock = deadline(timeoutMs, signal);
  let promptId;
  try {
    const images = [];
    const runId = randomUUID();
    for (const [index, { buffer, mime }] of decoded.entries()) {
      const form = new FormData();
      const extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp';
      form.append('image', new Blob([buffer], { type: mime }), `tryon-${runId}-${index}.${extension}`);
      form.append('type', 'input');
      form.append('overwrite', 'false');
      const uploaded = imageLocation(await request(endpoint, '/upload/image', fetchImpl, clock.signal, { method: 'POST', body: form }), 'input');
      if (uploaded.subfolder) throw invalid();
      images.push(uploaded.name);
    }
    const graph = workflowGraph({ images, prompt, env, seed: Math.floor(Math.random() * 2 ** 32) });
    const submitted = await request(endpoint, '/prompt', fetchImpl, clock.signal, { method: 'POST', body: { prompt: graph, client_id: runId } });
    if (typeof submitted.prompt_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(submitted.prompt_id)) throw invalid();
    promptId = submitted.prompt_id;
    while (true) {
      const history = await request(endpoint, `/history/${encodeURIComponent(promptId)}`, fetchImpl, clock.signal);
      const item = history?.[promptId];
      if (item?.status?.status_str === 'error') throw new HttpError(502, 'WORKFLOW_FAILED', 'ComfyUI 执行失败，请检查 GPU 显存、权重与服务端任务日志');
      if (item?.status?.completed) {
        const output = item.outputs?.output?.images?.[0];
        const image = imageLocation(output, 'output');
        const query = new URLSearchParams({ filename: image.name, subfolder: image.subfolder, type: 'output' });
        const buffer = await request(endpoint, `/view?${query}`, fetchImpl, clock.signal, { binary: true });
        const mimeType = sniff(buffer);
        if (!mimeType) throw invalid();
        return { mimeType, buffer };
      }
      await delay(pollMs, undefined, { signal: clock.signal });
    }
  } catch (error) {
    if (promptId && clock.signal.aborted) {
      const cleanup = deadline(3000);
      try { await request(endpoint, '/queue', fetchImpl, cleanup.signal, { method: 'POST', body: { delete: [promptId] } }); } catch { /* Running remote work cannot safely be interrupted globally. */ }
      finally { cleanup.dispose(); }
    }
    if (clock.signal.aborted) throw clock.signal.reason;
    if (error instanceof HttpError) throw error;
    throw unavailable();
  } finally { clock.dispose(); }
}
