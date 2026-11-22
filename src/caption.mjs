/**
 * 单品图的一句话描述：走本机 the image service 的 OpenAI 兼容对话接口。
 *
 * 衣橱入库用它补 `description`。任何失败（网关不可用、非 200、空内容、超时）都返回空串，
 * 绝不把异常抛给入库流程——描述只是锦上添花，不能阻断用户把单品收进衣橱。
 */

/** 网关地址与密钥，与 src/outfit.mjs 保持同一套约定。 */
function gatewayBase(env) {
  return (env.IMAGE_API_BASE_URL || 'http://127.0.0.1:3425').replace(/\/+$/, '');
}

const PROMPT = '用一句中文描述这张图的服装：品类、颜色、材质、风格，不超过30字，不要标点结尾';
const TIMEOUT_MS = 20_000;

export function createCaptioner({ env = process.env, fetchImpl = fetch } = {}) {
  const base = gatewayBase(env);
  const model = env.CAPTION_MODEL || 'codex/gpt-6.1-sol';

  async function caption(buffer, mime) {
    if (!buffer || !buffer.length || typeof mime !== 'string' || !mime.startsWith('image/')) return '';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('caption timeout')), TIMEOUT_MS);
    try {
      const dataUrl = `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`;
      const response = await fetchImpl(`${base}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.IMAGE_API_KEY || 'the image service'}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 80,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: PROMPT },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
        }),
      });
      if (!response.ok) return '';
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      return typeof text === 'string' ? text.trim() : '';
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  return { available: true, caption };
}
