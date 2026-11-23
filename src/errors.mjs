export class HttpError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

const MAX_DETAIL = 200;

/**
 * 从上游错误体里取一句能给人看的原因。
 * 兼容 OpenAI 的 {error:{message}}、裸 {message} 与纯文本三种形状。
 * 先抹掉疑似凭据再截断：上游有时会把自己的请求头或密钥回显在错误里。
 */
export function upstreamDetail(body) {
  if (!body) return '';
  let text = String(body).trim();
  try {
    const payload = JSON.parse(text);
    const message = payload?.error?.message ?? payload?.message ?? payload?.error;
    if (typeof message === 'string') text = message;
  } catch {
    // 不是 JSON 就按纯文本处理
  }
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/\b(sk|pk|api|key)[-_][A-Za-z0-9_-]{8,}/gi, '***')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text;
}

/** 上游失败时把原因带上；没有原因才用泛化文案。 */
export function upstreamError(body = '') {
  const detail = upstreamDetail(body);
  return new HttpError(502, 'UPSTREAM_ERROR', detail ? `所选服务返回错误：${detail}` : '所选服务连接失败，请稍后手动重试');
}
