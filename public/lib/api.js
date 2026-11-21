const SESSION_KEY = 'tryon.sessionId';
const DEVICE_KEY = 'tryon.deviceId';

export function getSessionId() {
  return localStorage.getItem(SESSION_KEY) ?? '';
}

export function setSessionId(id) {
  localStorage.setItem(SESSION_KEY, id);
}

export function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const sessionId = getSessionId();
  if (sessionId) headers['x-session-id'] = sessionId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? '请求失败，请稍后重试');
    error.code = payload?.error?.code ?? 'UNKNOWN';
    error.field = payload?.error?.field;
    error.status = response.status;
    throw error;
  }
  return payload;
}
