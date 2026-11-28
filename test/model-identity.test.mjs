import assert from 'node:assert/strict';
import { hash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';

import { MODEL_FRONT, MODEL_TURNAROUND, STUDIO_MAKEUP } from '../public/lib/model-assets.js';
import { DEFAULT_PERSON_URL, STUDIO_MAKEUP_URL } from '../public/lib/person.js';
import { studioFaceReference } from '../src/model-identity.mjs';

const readAsset = (asset) => readFile(new URL(`../public${asset.path}`, import.meta.url));

test('R5 三视图与单人正面各自登记实际字节，换身图不换内置棚拍图 2', async () => {
  assert.equal(MODEL_TURNAROUND.path, '/model/posewear-01/turnaround.png');
  for (const asset of [MODEL_TURNAROUND, MODEL_FRONT, STUDIO_MAKEUP]) {
    assert.equal(hash('sha256', await readAsset(asset)), asset.sha256);
  }
  assert.notEqual(MODEL_TURNAROUND.sha256, '5ec0967b834261a12a7ab428acbedecd98db90d6fa49d0359d1661754f412c80');
  assert.notEqual(MODEL_FRONT.sha256, '0c90f7aae2894821cf1693a870afb273c11c698f89eb8cc35af605535cda0770');
  assert.equal(DEFAULT_PERSON_URL, `${MODEL_FRONT.path}?v=${MODEL_FRONT.sha256.slice(0, 12)}`);
  assert.equal(STUDIO_MAKEUP_URL, `${STUDIO_MAKEUP.path}?v=f5c99a7ca302`);
});

test('内置定妆照缺失、换成妆前原片或历史妆面时拒绝出图，自传和普通试穿不读取它', async () => {
  const person = { mime: 'image/png', buffer: await readAsset(MODEL_FRONT) };
  const wrongFace = await readFile(new URL('../public/model/posewear-01/face.png', import.meta.url));
  const baseFace = await readFile(new URL('../public/model/posewear-01/face-base.jpg', import.meta.url));
  const missing = mock.fn(async () => { throw new Error('ENOENT'); });
  const different = mock.fn(async () => wrongFace);
  for (const load of [missing, different, mock.fn(async () => baseFace)]) {
    assert.equal(await studioFaceReference(person, 'builtin', 'preserve', load), null);
    assert.equal(await studioFaceReference(person, 'upload', 'studio', load), null);
    assert.equal(load.mock.callCount(), 0);
    await assert.rejects(studioFaceReference(person, 'builtin', 'studio', load), { code: 'FACE_REFERENCE_INVALID' });
    assert.equal(load.mock.callCount(), 1);
  }
});

test('旧客户端按内置身图字节识别，棚拍发送已选 R5 原字节，其它人物不附加人脸', async () => {
  const source = { mime: 'image/png', buffer: await readAsset(MODEL_FRONT) };
  const dataUrl = await studioFaceReference(source, undefined, 'studio');
  assert.match(dataUrl.slice(0, 32), /^data:image\/png;base64,/);
  const portrait = await readFile(new URL('../public/model/posewear-01/face-studio-makeup.png', import.meta.url));
  assert.equal(hash('sha256', portrait), 'f5c99a7ca3023a961deffd00e0b7c9cc14bda8644eb4daf5c471904a45e7c167');
  assert.deepEqual(Buffer.from(dataUrl.split(',')[1], 'base64'), portrait);
  assert.equal(await studioFaceReference({ ...source, buffer: Buffer.from('another user') }, undefined, 'studio'), null);
});
