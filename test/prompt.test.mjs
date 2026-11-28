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

test('ordinary outfit prompt preserves the original makeup, expression, pose and background', () => {
  const pieces = [{ slot: 'top', garmentType: '毛衣' }];
  const prompt = buildOutfitPrompt({ pieces });
  assert.equal(buildOutfitPrompt({ pieces, photographyMode: 'preserve', posewearBody: true }), prompt);
  assert.match(prompt, /background, camera angle, lens perspective, framing, colour grading and light direction/);
  assert.match(prompt, /PRESERVE EXACTLY \(from reference image 1\):\n-[^\n]*makeup[^\n]*expression/);
  assert.match(prompt, /match the visible skin texture, hair detail, focus and grain of reference image 1/);
  assert.match(prompt, /do not change the background, the pose, the face, the body or the framing/);
  assert.doesNotMatch(prompt, /PHOTOGRAPHY MODE: STUDIO|FLOOR PLANE|246-255|lower-eyeliner band|lips relaxed|caught mid-breath|one shoulder slightly lower|uniform pink flush/);
  assert.doesNotMatch(prompt, /BODY PROPORTIONS \(|gaze target|exhale|key light/i);
  assert.match(prompt, /reference image 2 = top/);
  assert.doesNotMatch(prompt, /pre-makeup|2026-11-26|worn loose|rounded chin|nude-pink lips|nasolabial|pose reference|MOMENT:|drawn under-eye/i);
});

test('内置单件棚拍：全身定头身，定妆照定同人五官与妆面，第三张才是衣物', () => {
  const prompt = buildOutfitPrompt({ photographyMode: 'studio', posewearBody: true, pieces: [{ slot: 'top' }] });
  assert.match(prompt, /reference image 1[^\n]*2026-11-26[^\n]*full-body[^\n]*only[^\n]*head size relative to height[^\n]*overall length of (?:the |her )?long black hair/i);
  assert.match(prompt, /reference image 2[^.\n]*studio makeup portrait[^.\n]*same person/i);
  assert.match(prompt, /facial identity and finished makeup (?:in|from) (?:reference )?image 2/i);
  assert.match(prompt, /reference image 3 is the selected garment product photo/i);
  assert.match(prompt, /^- reference image 3 = top /m);
  assert.match(prompt, /^- reference image 3 \(top\): middle layer; no selected reference is assigned to a layer underneath/m);
  assert.match(prompt, /reference image 3 may itself show a model[^\n]*ignore that model/i);
  assert.match(prompt, /reference image 4 supplies only the body pose/i);
  assert.match(prompt, /ignore the identity[^\n]*in reference image 4/i);
  assert.doesNotMatch(prompt, /reference images 3-3|reference image 2 (?:= top|\(top|may itself show a model)|outside reference image 2/i);
});

test('内置多件棚拍：引用范围、同层顺序、全部内外层关系和最后的骨架用同一套图号', () => {
  const pieces = [{ slot: 'top', layer: 'outer' }, { slot: 'accessory', name: '丝巾', layer: 'middle' },
    { slot: 'outer', layer: 'inner' }, { slot: 'accessory', name: '胸针', layer: 'middle' }, { slot: 'bottom' }];
  const prompt = buildOutfitPrompt({ photographyMode: 'studio', posewearBody: true, pieces, posePreset: 'over-shoulder' });
  assert.match(prompt, /reference images 3-7 are the selected garment product photos/i);
  assert.match(prompt, /reference images 3-7 may each show a model[^\n]*ignore those models/i);
  const roles = [...prompt.matchAll(/^- reference image (\d+) = (\w+) \([^\n]+?(?:, titled <product_title>([^<]+)<\/product_title>)?$/gm)];
  assert.deepEqual(roles.map(([, ref, slot, title]) => [ref, slot, title]), [
    ['3', 'outer', undefined], ['4', 'bottom', undefined], ['5', 'accessory', '丝巾'], ['6', 'accessory', '胸针'], ['7', 'top', undefined],
  ]);
  const layers = [...prompt.matchAll(/^- reference image (\d+) \(\w+\): (\w+) layer; ([^;]+)/gm)];
  assert.deepEqual(layers.map(([, ref, layer, relation]) => [ref, layer, relation.match(/\d+/g) ?? []]), [
    ['3', 'inner', []], ['4', 'middle', ['3']], ['5', 'middle', ['3']], ['6', 'middle', ['3']], ['7', 'outer', ['3', '4', '5', '6']],
  ]);
  assert.match(prompt, /reference image 8 supplies only the body pose/i);
  assert.match(prompt, /ignore the identity[^\n]*in reference image 8/i);
});

test('内置棚拍图 2 定自然披下的黑长直，不固定露耳或左右；R4b 本人五官、圆下巴和妆保留', () => {
  const prompt = buildOutfitPrompt({ photographyMode: 'studio', posewearBody: true, pieces: [{ slot: 'dress' }] });
  assert.match(prompt, /studio makeup[^\n]*reference image 2/i);
  assert.match(prompt, /(?:length and width|width and length)[^\n]*midface length[^\n]*chin length/i);
  assert.match(prompt, /eye spacing[^\n]*eye opening[^\n]*height and width/i);
  const hair = prompt.split('\n').find(line => /follow reference image 2 for the hair/i.test(line));
  assert.match(hair ?? '', /long, straight black hair[^\n]*worn loose[^\n]*naturally/i);
  assert.match(hair, /part and fringe[^\n]*pose/i);
  assert.doesNotMatch(hair, /\b(?:left|right|ear|ears|tuck|tucked|tucking)\b/i);
  assert.doesNotMatch(prompt, /behind (?:the |her )?(?:(?:left|right) )?ear|small triangle of forehead|(?:expose|reveal) (?:both |either |her |the )?ears?/i);
  assert.match(prompt, /smooth cheek-to-jaw contour[^\n]*cheekbones[^\n]*rounded chin/i);
  assert.match(prompt, /fine black upper lashes[^\n]*separated clusters[^\n]*short outer liner[^\n]*pale nude-pink lips/i);
  assert.match(prompt, /short[^\n]*(?:natural|soft) shadow[^\n]*(?:nose wing|nostril)/i);
  assert.match(prompt, /(?:fade|fades)[^\n]*cheek[^\n]*(?:mouth|lip)/i);
  assert.doesNotMatch(prompt, /black hair silhouette|wispy fringe across the forehead|(?:hairline|part|face width)[^.\n]*(?:of|from) reference image 1/i);
  assert.match(prompt, /do not rescale the head to match the crop/i);
  assert.match(prompt, /black hair[^.\n]*gold/i);
  assert.match(prompt, /no drawn under-eye[^\n]*lower eyeliner[^\n]*natural lower-lid shadow/i);
  assert.match(prompt, /no eye-enlarging filters[^\n]*contour[^\n]*lengthen/i);
  assert.match(prompt, /lash[^\n]*liner[^\n]*blush[^\n]*lip/i);
  assert.match(prompt, /skin texture[^\n]*studio light/i);
  assert.doesNotMatch(prompt, /facial proportions only|pre-makeup|copy old makeup|keep the makeup from reference image 1|PRESERVE EXACTLY \(from reference image 1\):\n- face/i);
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
  assert.match(prompt, /soft, very low-contrast shadow[^\n]*sole meets the floor/i);
  assert.match(prompt, /no hard shadow edge, no long cast shadow/i);
  assert.doesNotMatch(prompt, /shadowless studio lighting|no broad contact shadow/i);
  assert.match(prompt, /wall[^\n]*246-255[^\n]*floor[^\n]*228-238/i);
  assert.match(prompt, /5-9% lower luminance/);
  assert.match(prompt, /1024x1536[^\n]*hair top[^\n]*lowest sole/);
  assert.match(prompt, /locked camera, framing, exposure, white balance and light position/i);
  assert.match(prompt, /tall 2:3 full-body vertical photograph/i);
  assert.doesNotMatch(prompt, /9:16/);
  assert.match(prompt, /Reference image 5 is the PoseWear pose reference and is not clothing/);
  assert.match(prompt, /ignore the identity, face, hair, makeup, clothing, phone, accessories, background, framing and art style in reference image 5/);
  assert.match(prompt, /reference image 5 supplies only the body pose/);
  assert.doesNotMatch(prompt, /do not change the background, the pose, the face, the body or the framing/);
});

test('standing studio frames and grounds bare feet without inventing shoes for a top-only outfit', () => {
  const prompt = buildOutfitPrompt({ pieces: [{ slot: 'top' }], photographyMode: 'studio', studioPreset: 'clean-white-seamless', posewearBody: true });
  assert.match(prompt, /visible floor stays below the feet \(or worn shoes\)/i);
  assert.match(prompt, /never let the feet or worn shoes touch or cross the bottom edge/i);
  assert.match(prompt, /under each grounded bare foot or worn shoe[^\n]*sole meets the floor/i);
  assert.match(prompt, /do not add shoes for the shadow/i);
});

test('built-in standing prompt cites source pixels and clothing edges, not anatomical targets', () => {
  const prompt = buildOutfitPrompt({ pieces: [{ slot: 'top' }], photographyMode: 'studio', studioPreset: 'clean-white-seamless', posewearBody: true });
  assert.match(prompt, /crown[^\n]*\b43\b[^\n]*chin[^\n]*\b241\b[^\n]*sole[^\n]*\b1460\b/i);
  assert.match(prompt, /7\.16 heads/i);
  assert.match(prompt, /tee hem[^\n]*586[^\n]*38\.3%/i);
  assert.match(prompt, /gap between the trouser legs[^\n]*761[^\n]*50\.7%/i);
  assert.match(prompt, /not anatomical landmarks/i);
  assert.match(prompt, /knee[^\n]*1020[^\n]*75\/77 px/i);
  assert.match(prompt, /calf[^\n]*1151\/1144[^\n]*73\/74 px/i);
  assert.match(prompt, /bare ankle[^\n]*1360[^\n]*40 px/i);
  assert.match(prompt, /source pixels[^\n]*not output/i);
  assert.match(prompt, /bent knees[^\n]*foreshortening/i);
  assert.doesNotMatch(prompt, /8\.57|natural waist sits|crotch sits|no calf bulge|0\.60x the knee width/);
});

test('built-in seated, crouching and lying poses follow perspective without standing screen targets', () => {
  for (const posePreset of ['duck-sit', 'crouch-chin', 'lying-overhead', 'seated-editorial']) {
    const prompt = buildOutfitPrompt({ pieces: [{ slot: 'dress' }], photographyMode: 'studio', posePreset, posewearBody: true });
    assert.match(prompt, /foreshortening/i);
    assert.doesNotMatch(prompt, /\b(?:7\.16|8\.57|75\/77|73\/74|38\.3%|50\.7%|1360)\b|crown-to-sole|the knee width|40 px/i);
  }
});

test('uploaded studio portraits keep their own proportions in standing and folded poses', () => {
  for (const posePreset of ['over-shoulder', 'duck-sit']) {
    const prompt = buildOutfitPrompt({ pieces: [{ slot: 'top' }], photographyMode: 'studio', posePreset });
    assert.match(prompt, /keep the exact body:/i);
    assert.match(prompt, /keep the makeup from reference image 1 as photographed/i);
    assert.match(prompt, /reference image 2 may itself show a model/i);
    assert.match(prompt, /reference image 3 supplies only the body pose/i);
    assert.doesNotMatch(prompt, /BODY PROPORTIONS \(|7\.16 heads|8\.57|75\/77|73\/74|tee hem[^\n]*586|leg gap[^\n]*761|pre-makeup|compact face|worn loose|rounded chin|nude-pink lips|nasolabial|near-black|under-eye|lower eyeliner|lower-eyeliner/i);
    assert.equal(buildOutfitPrompt({ pieces: [{ slot: 'top' }], photographyMode: 'studio', posePreset, posewearBody: 'true' }), prompt);
  }
});

test('studio lighting uses one raised side key and retains readable face, clothes and neutral colour', () => {
  const prompt = buildOutfitPrompt({ pieces: [{ slot: 'top' }], photographyMode: 'studio', studioPreset: 'clean-white-seamless' });
  assert.match(prompt, /soft key light[^\n]*slightly above[^\n]*one side/i);
  assert.match(prompt, /fill[^\n]*face[^\n]*garment[^\n]*readable/i);
  assert.match(prompt, /neutral white balance/i);
  assert.doesNotMatch(prompt, /frontal key light|local white-balance variation|golden[- ]hour|selfie|85\s*mm/i);
});

test('六种棚拍各给一个有目光对象、眼睑、唇部和头肩关系的静态瞬间', () => {
  const targets = { contrapposto: /lens/i, 'hand-behind-head': /softbox/i, 'over-shoulder': /photographer/i,
    'duck-sit': /fingertips/i, 'crouch-chin': /lens/i, 'lying-overhead': /ceiling/i };
  assert.deepEqual(Object.keys(targets).sort(), prompts.POSE_PRESETS.map(({ id }) => id).sort());
  for (const posewearBody of [false, true]) {
    const moments = Object.entries(targets).map(([posePreset, target]) => {
      const prompt = buildOutfitPrompt({ pieces: [{ slot: 'top' }], photographyMode: 'studio', posePreset, posewearBody });
      const matches = [...prompt.matchAll(/^- MOMENT: (.+)$/gm)];
      assert.equal(matches.length, 1, posePreset);
      const moment = matches[0][1];
      for (const cue of [target, /lids?/i, /lips?/i, /shoulder/i]) assert.match(moment, cue, posePreset);
      if (posePreset === 'hand-behind-head') assert.match(moment, /lips (?:slightly )?parted/i);
      if (posePreset === 'over-shoulder') assert.match(moment, /nose[^.]*past[^.]*but[^.]*eyes[^.]*lens/i);
      if (posePreset === 'crouch-chin') {
        assert.match(moment, /face angled[^.]*hand[^.]*lens/i);
        assert.match(moment, /lips[^.]*rest[^.]*together[^.]*without (?:pouting|a pout)/i);
        assert.doesNotMatch(moment, /lips[^.]*(?:parted|apart|open)/i);
      }
      assert.match(prompt, /full-body distance/i);
      assert.match(prompt, /hair[^\n]*overlap[^\n]*(?:collar|fabric|clothing)/i);
      assert.match(prompt, /(?:occluded|hidden) (?:face|features)[^\n]*(?:do not|never) (?:uncover|reconstruct)/i);
      assert.doesNotMatch(prompt, /one quiet exhale|half[- ](?:lidded|closed)|pursed[- ]lip smile|1-2 mm|every strand stays individually readable|skin keeps visible pores|delicate vessels|crying|tears|selfie|85\s*mm/i);
      assert.doesNotMatch(moment, /\d|degree|millimet/i);
      return moment;
    });
    assert.equal(new Set(moments).size, 6);
  }
});

test('工作台的现有姿势 hint 用一句中文说明同一个动作和目光', () => {
  const examples = {
    contrapposto: [/腰/, /平视镜头/, /唇/],
    'hand-behind-head': [/手/, /画面左侧/, /微张/],
    'over-shoulder': [/脸.*肩外/, /目光.*镜头/, /唇/],
    'duck-sit': [/垂眼.*指尖/, /腿/, /唇角/],
    'crouch-chin': [/脸.*掌心/, /余光.*镜头/, /双唇放松合拢/, /不嘟嘴/],
    'lying-overhead': [/后脑.*地/, /天花板/, /唇/],
  };
  for (const { id, hint } of prompts.POSE_PRESETS) {
    for (const cue of examples[id]) assert.match(hint, cue, id);
    assert.ok(hint.length <= 35 && !hint.includes('\n'), id);
  }
});

test('旧姿势别名选到完全相同的动作瞬间、骨架和构图', () => {
  const aliases = { 'editorial-stand': 'contrapposto', 'front-walk': 'contrapposto', 'hand-in-pocket': 'hand-behind-head',
    'coat-sway': 'over-shoulder', 'profile-walk': 'over-shoulder', 'seated-editorial': 'duck-sit' };
  const input = { photographyMode: 'studio', posewearBody: true, pieces: [{ slot: 'dress' }] };
  for (const [alias, canonical] of Object.entries(aliases)) {
    assert.equal(buildOutfitPrompt({ ...input, posePreset: alias }), buildOutfitPrompt({ ...input, posePreset: canonical }));
  }
});

test('gray and warm-white studios keep their selected tone and soft contact shadow', () => {
  for (const [studioPreset, tone] of [['soft-gray-seamless', /soft light-gray/], ['warm-white-seamless', /warm off-white/]]) {
    const prompt = buildOutfitPrompt({ pieces: [{ slot: 'top' }], photographyMode: 'studio', studioPreset });
    assert.match(prompt, tone);
    assert.match(prompt, /soft, very low-contrast shadow/);
    assert.doesNotMatch(prompt, /246-255|228-238|5-9% lower luminance|stays near-white|never grey|no grey backdrop card/);
  }
});

test('seated, crouching and lying poses use the full posed body and its actual floor contacts', () => {
  for (const posePreset of ['duck-sit', 'crouch-chin', 'lying-overhead', 'seated-editorial']) {
    const prompt = buildOutfitPrompt({ pieces: [{ slot: 'dress' }], photographyMode: 'studio', posePreset });
    assert.match(prompt, /2:3[^\n]*full-body/);
    assert.match(prompt, /foreshortening and overlap/i);
    assert.match(prompt, /soft, very low-contrast shadow[^\n]*where the body or clothing touches the floor/);
    assert.doesNotMatch(prompt, /lowest sole|waist height|76-82%|behind both shoes|sole meets the floor|knees and ankles bearing weight|246-255|228-238|5-9% lower luminance/);
  }
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
