import assert from 'node:assert/strict';
import test from 'node:test';

import { upstreamDetail, upstreamError } from '../src/errors.mjs';

test('upstreamDetail 取 OpenAI 形状的 error.message', () => {
  const body = JSON.stringify({ error: { code: null, message: 'an edit needs the image to edit', type: 'invalid_request_error' } });
  assert.equal(upstreamDetail(body), 'an edit needs the image to edit');
});

test('upstreamDetail 兼容裸 message 与纯文本', () => {
  assert.equal(upstreamDetail(JSON.stringify({ message: '额度用尽' })), '额度用尽');
  assert.equal(upstreamDetail('Bad Gateway'), 'Bad Gateway');
});

test('upstreamDetail 抹掉疑似凭据并压成一行', () => {
  // 令牌按片段拼出来，避免仓库里出现形如真实密钥的字符串。
  const token = ['sk', 'live', '0'.repeat(12)].join('-');
  const detail = upstreamDetail(`failed with\nAuthorization: Bearer ${token}`);
  assert.equal(detail.includes(token), false);
  assert.equal(detail.includes('Bearer ***'), true);
  assert.equal(detail.includes('\n'), false);
});

test('upstreamDetail 超长截断', () => {
  const detail = upstreamDetail('x'.repeat(500));
  assert.equal(detail.length, 201);
  assert.ok(detail.endsWith('…'));
});

test('没有原因时用泛化文案，有原因时带上原因', () => {
  assert.equal(upstreamError().message, '所选服务连接失败，请稍后手动重试');
  assert.ok(upstreamError('{"error":{"message":"connectex: 连接超时"}}').message.includes('connectex'));
});
