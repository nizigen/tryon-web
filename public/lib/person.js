/**
 * 内置模特图：新用户没有自己的全身照时，工作台与衣橱直接用它开箱即用。
 * 服务端只接受 dataURL 形式的人物图，所以这里把静态 PNG 读成 dataURL 并缓存，
 * 同一页面里多次调用只发一次请求。
 */
import { MODEL_BASE_FACE, MODEL_FRONT, MODEL_TURNAROUND, STUDIO_MAKEUP } from './model-assets.js';

const versionedUrl = ({ path, sha256 }) => `${path}?v=${sha256.slice(0, 12)}`;
export const DEFAULT_PERSON_URL = versionedUrl(MODEL_FRONT);
export const BASE_FACE_URL = versionedUrl(MODEL_BASE_FACE);
export const TURNAROUND_URL = versionedUrl(MODEL_TURNAROUND);
export const STUDIO_MAKEUP_URL = versionedUrl(STUDIO_MAKEUP);

let cached = '';
let inflight = null;

export async function loadDefaultPerson() {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch(DEFAULT_PERSON_URL, { cache: 'force-cache' });
      if (!response.ok) return '';
      const blob = await response.blob();
      cached = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('读取内置模特图失败'));
        reader.readAsDataURL(blob);
      });
      return cached;
    } catch {
      return '';
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
