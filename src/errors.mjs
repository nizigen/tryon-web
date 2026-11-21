export class HttpError extends Error {
  constructor(status, code, message, field) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export function upstreamError(reason = '') {
  const detail = reason.includes('MiniMax Image returned no images') ? '（MiniMax Image returned no images）' : '';
  return new HttpError(502, 'UPSTREAM_ERROR', `所选服务连接失败，请稍后手动重试${detail}`);
}
