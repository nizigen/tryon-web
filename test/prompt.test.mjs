import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOutfitPrompt, buildTryonPrompt, GARMENT_TYPES, isCategory, isGarmentType } from '../src/prompt.mjs';
import * as prompts from '../src/prompt.mjs';
import { HttpError } from '../src/errors.mjs';

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

test('多件穿搭提示词分层且参考图编号按有效内中外层排列', () => {
  const prompt = buildOutfitPrompt({
    pieces: [
      { slot: 'bottom', garmentType: '百褶裙' },
      { slot: 'top', garmentType: '毛衣' },
      { slot: 'outer', garmentType: '风衣' },
      { slot: 'hosiery', garmentType: '连裤袜' },
    ],
  });
  assert.match(prompt, /LAYERING \(from inner to outer, top to bottom\)/);
  assert.match(prompt, /reference image 2 = hosiery/);
  assert.match(prompt, /reference image 3 = top/);
  assert.match(prompt, /reference image 4 = bottom/);
  assert.match(prompt, /reference image 5 = outer/);
  assert.match(prompt, /reference image 5 .*outside reference image 2, reference image 3, reference image 4/);
  assert.doesNotMatch(prompt, /closest to the skin|keep the inner top visible|do not cover the neckline or hem/);
  assert.match(prompt, /must not cover the shoe surface/);
});

test('连衣裙在提示词里用一件式描述', () => {
  const prompt = buildOutfitPrompt({ pieces: [{ slot: 'dress', garmentType: '吊带裙' }] });
  assert.match(prompt, /reference image 2 = dress/);
  assert.match(prompt, /one-piece dress/);
});

test('layer validation, automatic mapping and explicit overrides', () => {
  assert.equal(prompts.normalizeLayer(), 'auto');
  for (const layer of ['auto', 'inner', 'middle', 'outer']) assert.equal(prompts.normalizeLayer(layer), layer);
  for (const value of [null, '', 'INNER', ' inner ', 'base', 1, {}, []]) {
    assert.throws(() => prompts.normalizeLayer(value), error => error instanceof HttpError && error.status === 400 && error.field === 'layer');
  }
  for (const [slot, layer] of Object.entries({ top: 'middle', bottom: 'middle', dress: 'middle', hosiery: 'inner', outer: 'outer', shoes: 'outer', accessory: 'outer' })) {
    assert.equal(prompts.effectiveLayer({ slot }), layer);
    assert.equal(prompts.effectiveLayer({ slot, layer: 'auto' }), layer);
    assert.equal(prompts.effectiveLayer({ slot, layer: 'inner' }), 'inner');
  }
});

test('layer sorting is stable and prompt reference numbers follow it', () => {
  const pieces = [{ slot: 'accessory', name: 'a', layer: 'middle' }, { slot: 'top', layer: 'outer' }, { slot: 'outer', layer: 'inner' }, { slot: 'accessory', name: 'b', layer: 'middle' }, { slot: 'hosiery' }, { slot: 'bottom' }];
  const before = structuredClone(pieces);
  assert.deepEqual(prompts.orderPieces(pieces), [pieces[2], pieces[4], pieces[5], pieces[0], pieces[3], pieces[1]]);
  assert.deepEqual(pieces, before);
  const prompt = buildOutfitPrompt({ pieces });
  assert.match(prompt, /reference image 2 = outer/);
  assert.match(prompt, /reference image 7 = top/);
  assert.match(prompt, /reference image 7 .*outside reference image 2, reference image 3, reference image 4, reference image 5, reference image 6/);
  assert.doesNotMatch(prompt, /closest to the skin|keep the inner top visible|hosiery first and then the bottoms/);
});

test('ordinary outfit prompt still preserves the original pose and background', () => {
  const prompt = buildOutfitPrompt({
    pieces: [{ slot: 'top', garmentType: '毛衣' }],
  });
  assert.match(prompt, /background, camera angle, lens perspective, framing, colour grading and light direction/);
  assert.match(prompt, /do not change the background, the pose, the face, the body or the framing/);
  assert.doesNotMatch(prompt, /PHOTOGRAPHY MODE: STUDIO/);
});

test('studio outfit prompt rebuilds only pose and photography while preserving identity and every garment', () => {
  const prompt = buildOutfitPrompt({
    pieces: [
      { slot: 'outer', garmentType: '大衣', name: '深棕色长款风衣' },
      { slot: 'top', garmentType: '针织衫' },
      { slot: 'bottom', garmentType: '半身裙' },
    ],
    photographyMode: 'studio',
    studioPreset: 'clean-white-seamless',
    posePreset: 'over-shoulder',
  });
  assert.match(prompt, /PHOTOGRAPHY MODE: STUDIO/);
  assert.match(prompt, /pure-white seamless studio/i);
  assert.match(prompt, /glance back over one shoulder/i);
  assert.match(prompt, /may replace the original pose, background, camera position and lighting/i);
  assert.match(prompt, /face, facial features, skin tone, skin texture, hair style and body proportions/);
  assert.match(prompt, /combine all the pieces above at the same time on the same person; never drop a selected piece/);
  assert.match(prompt, /shadowless studio lighting/i);
  assert.match(prompt, /no visible cast shadow, no broad contact shadow, no ambient-occlusion halo and no dark patch/i);
  assert.match(prompt, /faintest natural shoe-to-floor contact/i);
  assert.match(prompt, /locked camera, framing, exposure, white balance and light position/i);
  assert.match(prompt, /tall 2:3 full-body vertical fashion photograph/i);
  assert.doesNotMatch(prompt, /9:16/);
  assert.match(prompt, /Reference image 5 is the PoseWear pose reference and is not clothing/);
  assert.match(prompt, /ignore the identity, face, hair, makeup, clothing, phone, accessories, background, framing and art style in reference image 5/);
  assert.match(prompt, /reference image 5 supplies only the body pose/);
  assert.doesNotMatch(prompt, /do not change the background, the pose, the face, the body or the framing/);
});

test('studio pose recommendation returns three unique poses and adapts to outerwear', () => {
  assert.equal(prompts.STUDIO_PRESETS.length >= 1, true);
  assert.equal(prompts.POSE_PRESETS.length >= 3, true);
  const outerPoses = prompts.recommendStudioPoses([{ slot: 'outer' }, { slot: 'bottom' }]);
  assert.deepEqual(outerPoses, ['contrapposto', 'hand-behind-head', 'over-shoulder']);
  assert.equal(new Set(outerPoses).size, 3);
  assert.deepEqual(
    prompts.recommendStudioPoses([{ slot: 'top' }, { slot: 'bottom' }]),
    ['contrapposto', 'hand-behind-head', 'over-shoulder'],
  );
  assert.deepEqual(
    prompts.recommendStudioPoses([{ slot: 'dress' }]),
    ['contrapposto', 'duck-sit', 'crouch-chin'],
  );
});

test('unknown studio and pose presets are rejected at the domain boundary', () => {
  assert.throws(
    () => prompts.normalizeStudioPreset('not-a-studio'),
    (error) => error.status === 400 && error.field === 'studioPreset',
  );
  assert.throws(
    () => prompts.normalizePosePreset('not-a-pose'),
    (error) => error.status === 400 && error.field === 'posePreset',
  );
  assert.equal(prompts.normalizePosePreset('coat-sway'), 'over-shoulder');
  assert.equal(prompts.normalizePosePreset('editorial-stand'), 'contrapposto');
  assert.equal(prompts.DEFAULT_POSE_PRESET, 'contrapposto');
  for (const invalid of [[], ['editorial-stand'], { toString: null }, 42, null]) {
    assert.throws(
      () => prompts.normalizePosePreset(invalid),
      (error) => error.status === 400 && error.field === 'posePreset',
    );
  }
});
