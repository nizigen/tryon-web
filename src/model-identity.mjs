import { hash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { MODEL_FRONT, STUDIO_MAKEUP } from '../public/lib/model-assets.js';
import { HttpError } from './errors.mjs';

export async function studioFaceReference(personImage, personSource, mode, loadFace = readFile) {
  if (personSource !== undefined && !['builtin', 'upload'].includes(personSource)) {
    throw new HttpError(400, 'INVALID_REQUEST', '人物来源无效', 'personSource');
  }
  if (personSource === 'upload' || (mode !== 'studio' && personSource !== 'builtin')) return null;
  const matches = personImage.mime === 'image/png' && hash('sha256', personImage.buffer) === MODEL_FRONT.sha256;
  if (!matches && personSource === 'builtin') {
    throw new HttpError(400, 'INVALID_REQUEST', '内置人物照片版本不匹配，请刷新工作台', 'personSource');
  }
  if (!matches || mode !== 'studio') return null;
  const portrait = await loadFace(new URL(`../public${STUDIO_MAKEUP.path}`, import.meta.url)).catch(() => null);
  if (!portrait || hash('sha256', portrait) !== STUDIO_MAKEUP.sha256) {
    throw new HttpError(500, 'FACE_REFERENCE_INVALID', '内置模特棚拍定妆照缺失或版本不匹配，未开始生成');
  }
  return `data:image/png;base64,${portrait.toString('base64')}`;
}
