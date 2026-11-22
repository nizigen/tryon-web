import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOutfitPrompt, buildTryonPrompt, GARMENT_TYPES, isCategory, isGarmentType } from '../src/prompt.mjs';

test('分类白名单只有上衣、下装、连衣裙', () => {
  assert.equal(isCategory('tops'), true);
  assert.equal(isCategory('bottoms'), true);
  assert.equal(isCategory('dresses'), true);
  assert.equal(isCategory('shoes'), false);
  assert.equal(isCategory('auto'), false);
});

test('服装子类属于对应分类', () => {
  assert.equal(isGarmentType('tops', 'shirt'), true);
  assert.equal(isGarmentType('tops', 'jeans'), false);
  assert.equal(isGarmentType('bottoms', 'jeans'), true);
  assert.equal(isGarmentType('dresses', 'dress'), true);
  assert.equal(GARMENT_TYPES.tops.some((type) => type.id === 'coat'), true);
});

test('上装提示词要求完全替换并保留下装与鞋', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'tee' });
  assert.match(prompt, /REPLACE COMPLETELY - upper body garment/);
  assert.match(prompt, /nothing of the original garment may remain visible anywhere/);
  assert.match(prompt, /the original lower-body clothing, the shoes/);
  assert.match(prompt, /PRESERVE EXACTLY/);
});

test('外套保留内搭，替换外层', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'coat' });
  assert.match(prompt, /REPLACE COMPLETELY - outer layer/);
  assert.match(prompt, /the clothing worn underneath, which stays visible only where the new coat does not cover it/);
});

test('连衣裙同时替换上下装并保留鞋', () => {
  const prompt = buildTryonPrompt({ category: 'dresses', garmentType: 'dress' });
  assert.match(prompt, /REPLACE COMPLETELY - torso and legs garment/);
  assert.match(prompt, /the shoes, the hair, the arms and hands/);
});

test('下装保留上装与鞋', () => {
  const prompt = buildTryonPrompt({ category: 'bottoms', garmentType: 'jeans' });
  assert.match(prompt, /REPLACE COMPLETELY - lower body garment/);
  assert.match(prompt, /the original upper-body clothing, the shoes/);
});

test('提示词包含去 AI 味的光影与褶皱要求', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'shirt' });
  assert.match(prompt, /no repetitive uniform creases/);
  assert.match(prompt, /no glossy plastic highlights/);
  assert.match(prompt, /no CGI render look/);
  assert.match(prompt, /soft contact shadows/);
  assert.match(prompt, /DO NOT COMPOSITE/);
  assert.match(prompt, /FINAL CHECK/);
});

test('商品标题进入提示词用于还原印花与版型', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'shirt', garmentName: '红底白色小花短袖衬衫' });
  assert.match(prompt, /红底白色小花短袖衬衫/);
  assert.match(prompt, /same collar shape, same button placket and buttons/);
});

test('用户补充要求单独成段且不得覆盖区域与身份规则', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'tee', extra: '  袖子短一点  ' });
  assert.match(prompt, /USER REQUEST/);
  assert.match(prompt, /袖子短一点/);
  assert.match(prompt, /must not change the replacement region, the identity of the person/);
});

test('商品图里的模特不会被当成人物参考', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'shirt', garmentName: '水手服' });
  assert.match(prompt, /IDENTITY SOURCE/);
  assert.match(prompt, /reference image 2 may itself show a model wearing the garment; ignore that model entirely/);
  assert.match(prompt, /from reference image 2 take the garment only/);
  assert.match(prompt, /the output must contain exactly one person, and that person is reference image 1/);
});

test('用户补充要求为空时不生成 USER REQUEST 段', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'tee', extra: '   ' });
  assert.doesNotMatch(prompt, /USER REQUEST/);
});

test('版型选择进入提示词', () => {
  const prompt = buildTryonPrompt({ category: 'tops', garmentType: 'tee', fit: 'oversized' });
  assert.match(prompt, /worn slightly oversized/);
});

test('多件穿搭提示词分层且参考图编号按 top→outer→bottom→hosiery 排列', () => {
  const prompt = buildOutfitPrompt({
    pieces: [
      { slot: 'bottom', garmentType: '百褶裙' },
      { slot: 'top', garmentType: '毛衣' },
      { slot: 'outer', garmentType: '风衣' },
      { slot: 'hosiery', garmentType: '连裤袜' },
    ],
  });
  assert.match(prompt, /LAYERING \(from inner to outer, top to bottom\)/);
  assert.match(prompt, /reference image 2 = top/);
  assert.match(prompt, /reference image 3 = outer/);
  assert.match(prompt, /reference image 4 = bottom/);
  assert.match(prompt, /reference image 5 = hosiery/);
  assert.match(prompt, /keep the inner top visible/);
  assert.match(prompt, /hosiery texture and colour show below/);
  assert.match(prompt, /must not cover the shoe surface/);
});

test('连衣裙在提示词里用一件式描述', () => {
  const prompt = buildOutfitPrompt({ pieces: [{ slot: 'dress', garmentType: '吊带裙' }] });
  assert.match(prompt, /reference image 2 = dress/);
  assert.match(prompt, /one-piece dress/);
});
