import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOutfitPrompt } from '../src/prompt.mjs';

import {
  CANVAS,
  DEFAULT_MODELS,
  MAX_GARMENTS,
  WORKFLOW_ID,
  requiredFromGraph,
  workflowGraph,
} from '../src/comfy-workflow.mjs';

const IMAGES = ['person.png', 'garment-1.png'];

function nodeOf(graph, id) {
  const node = graph[id];
  assert.ok(node, `缺少节点 ${id}`);
  return node;
}

function link(origin, slot = 0) {
  return [origin, slot];
}

test('导出固定的工作流标识与画布尺寸', () => {
  assert.equal(WORKFLOW_ID, 'comfyui/foxbaze-tryon');
  assert.deepEqual(CANVAS, { width: 832, height: 1248 });
  assert.equal(MAX_GARMENTS, 3);
});

test('默认模型文件名与已核验的 HF/工作流名称一致', () => {
  assert.equal(DEFAULT_MODELS.unet, 'qwen_image_edit_fp8_e4m3fn.safetensors');
  assert.equal(DEFAULT_MODELS.clip, 'qwen_2.5_vl_7b_fp8_scaled.safetensors');
  assert.equal(DEFAULT_MODELS.vae, 'qwen_image_vae.safetensors');
  assert.equal(DEFAULT_MODELS.lora, 'Try_On_Qwen_Edit_Lora.safetensors');
});

test('人物在上、服装在下：拼接方向与顺序符合作者工作流', () => {
  const graph = workflowGraph({ images: ['person.png', 'a.png', 'b.png', 'c.png'], prompt: '', seed: 1 });

  assert.equal(nodeOf(graph, 'person').class_type, 'LoadImage');
  assert.equal(nodeOf(graph, 'person').inputs.image, 'person.png');
  assert.equal(nodeOf(graph, 'garment_1').inputs.image, 'a.png');

  // 服装先横向拼接：a + b，再 + c，方向 right，尺寸对齐
  const first = nodeOf(graph, 'stitch_garment_2');
  assert.equal(first.class_type, 'ImageStitch');
  assert.deepEqual(first.inputs.image1, link('garment_1'));
  assert.deepEqual(first.inputs.image2, link('garment_2'));
  assert.equal(first.inputs.direction, 'right');
  assert.equal(first.inputs.match_image_size, true);

  const second = nodeOf(graph, 'stitch_garment_3');
  assert.deepEqual(second.inputs.image1, link('stitch_garment_2'));
  assert.deepEqual(second.inputs.image2, link('garment_3'));
  assert.equal(second.inputs.direction, 'right');

  // 人物在上、服装条带在下：方向 down，image1 必须是人物
  const layout = nodeOf(graph, 'stitch_layout');
  assert.equal(layout.class_type, 'ImageStitch');
  assert.deepEqual(layout.inputs.image1, link('person'));
  assert.deepEqual(layout.inputs.image2, link('stitch_garment_3'));
  assert.equal(layout.inputs.direction, 'down');
  assert.equal(layout.inputs.match_image_size, true);
});

test('单件服装不生成多余的横向拼接节点', () => {
  const graph = workflowGraph({ images: ['person.png', 'only.png'], seed: 1 });
  assert.equal(graph.stitch_garment_2, undefined);
  assert.equal(graph.stitch_garment_3, undefined);
  assert.deepEqual(nodeOf(graph, 'stitch_layout').inputs.image2, link('garment_1'));
});

test('用核心 ImageScale 精确拉伸到 832×1248，再按原图接线做总像素缩放', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 1 });

  const scale = nodeOf(graph, 'scale_canvas');
  assert.equal(scale.class_type, 'ImageScale');
  assert.deepEqual(scale.inputs, {
    image: link('stitch_layout'),
    upscale_method: 'nearest-exact',
    width: 832,
    height: 1248,
    crop: 'disabled',
  });

  const pixels = nodeOf(graph, 'scale_pixels');
  assert.equal(pixels.class_type, 'ImageScaleToTotalPixels');
  assert.deepEqual(pixels.inputs, {
    image: link('scale_canvas'),
    upscale_method: 'lanczos',
    megapixels: 1.0,
    resolution_steps: 1,
  });

  // 不使用任何 KJNodes 自定义节点
  const custom = Object.values(graph)
    .map((node) => node.class_type)
    .filter((type) => /KJ|Resize/i.test(type));
  assert.deepEqual(custom, []);
});

test('latent 来自总像素缩放图的 VAE 编码，正负条件图按作者原图分别接线', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 1 });

  assert.equal(nodeOf(graph, 'encode').class_type, 'VAEEncode');
  assert.deepEqual(nodeOf(graph, 'encode').inputs.pixels, link('scale_pixels'));

  assert.equal(nodeOf(graph, 'positive').class_type, 'TextEncodeQwenImageEdit');
  assert.deepEqual(nodeOf(graph, 'positive').inputs.image, link('scale_canvas'));

  assert.equal(nodeOf(graph, 'negative').class_type, 'TextEncodeQwenImageEdit');
  assert.deepEqual(nodeOf(graph, 'negative').inputs.image, link('scale_pixels'));
  assert.equal(nodeOf(graph, 'negative').inputs.prompt, '');

  // 文本编码必须拿到 vae，否则不会产生 reference_latents，人物/服装会丢失
  for (const id of ['positive', 'negative']) {
    assert.deepEqual(nodeOf(graph, id).inputs.vae, link('vae'));
    assert.deepEqual(nodeOf(graph, id).inputs.clip, link('clip'));
  }
});

test('采样参数与作者推荐值一致，种子可覆盖', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 12345 });
  const sampler = nodeOf(graph, 'sampler');

  assert.equal(sampler.class_type, 'KSampler');
  assert.deepEqual(sampler.inputs.model, link('cfg_norm'));
  assert.deepEqual(sampler.inputs.positive, link('positive'));
  assert.deepEqual(sampler.inputs.negative, link('negative'));
  assert.deepEqual(sampler.inputs.latent_image, link('encode'));
  assert.equal(sampler.inputs.seed, 12345);
  assert.equal(sampler.inputs.steps, 30);
  assert.equal(sampler.inputs.cfg, 2.5);
  assert.equal(sampler.inputs.sampler_name, 'euler');
  assert.equal(sampler.inputs.scheduler, 'simple');
  assert.equal(sampler.inputs.denoise, 1);

  assert.deepEqual(nodeOf(graph, 'decode').inputs.samples, link('sampler'));
});

test('输出节点固定 id 为 output 且为 SaveImage', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 1 });
  const output = nodeOf(graph, 'output');
  assert.equal(output.class_type, 'SaveImage');
  assert.deepEqual(output.inputs.images, link('decode'));
  assert.equal(typeof output.inputs.filename_prefix, 'string');
  assert.ok(output.inputs.filename_prefix.length > 0);
});

test('模型链顺序：加载 → LoRA → 采样位移 → CFGNorm', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 1 });

  assert.equal(nodeOf(graph, 'unet').class_type, 'UNETLoader');
  assert.deepEqual(nodeOf(graph, 'unet').inputs, {
    unet_name: DEFAULT_MODELS.unet,
    weight_dtype: 'default',
  });

  const lora = nodeOf(graph, 'lora');
  assert.equal(lora.class_type, 'LoraLoaderModelOnly');
  assert.deepEqual(lora.inputs.model, link('unet'));
  assert.equal(lora.inputs.lora_name, DEFAULT_MODELS.lora);
  assert.equal(lora.inputs.strength_model, 1);

  const shift = nodeOf(graph, 'model_shift');
  assert.equal(shift.class_type, 'ModelSamplingAuraFlow');
  assert.deepEqual(shift.inputs.model, link('lora'));
  assert.equal(shift.inputs.shift, 3);

  const cfg = nodeOf(graph, 'cfg_norm');
  assert.equal(cfg.class_type, 'CFGNorm');
  assert.deepEqual(cfg.inputs.model, link('model_shift'));
  assert.equal(cfg.inputs.strength, 1);
  assert.equal(cfg.inputs.pre_cfg, false);
});

test('环境变量可覆盖四个模型文件名', () => {
  const graph = workflowGraph({
    images: IMAGES,
    seed: 1,
    env: {
      COMFYUI_UNET: 'custom-unet.safetensors',
      COMFYUI_CLIP: 'custom-clip.safetensors',
      COMFYUI_VAE: 'custom-vae.safetensors',
      COMFYUI_LORA: 'custom-lora.safetensors',
    },
  });

  assert.equal(nodeOf(graph, 'unet').inputs.unet_name, 'custom-unet.safetensors');
  assert.equal(nodeOf(graph, 'clip').inputs.clip_name, 'custom-clip.safetensors');
  assert.equal(nodeOf(graph, 'vae').inputs.vae_name, 'custom-vae.safetensors');
  assert.equal(nodeOf(graph, 'lora').inputs.lora_name, 'custom-lora.safetensors');
});

test('COMFYUI_UNET_TYPE=gguf 时切换为 UnetLoaderGGUF 且不传 weight_dtype', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 1, env: { COMFYUI_UNET_TYPE: 'gguf' } });
  const unet = nodeOf(graph, 'unet');
  assert.equal(unet.class_type, 'UnetLoaderGGUF');
  assert.deepEqual(unet.inputs, { unet_name: DEFAULT_MODELS.unet });
  assert.deepEqual(nodeOf(graph, 'lora').inputs.model, link('unet'));
});

test('正 prompt 保留作者对齐句，并把 reference image N 映射到人物/底部服装', () => {
  const graph = workflowGraph({
    images: ['person.png', 'a.png', 'b.png'],
    prompt: 'Keep the pose, and make reference image 2 fit better with reference image 1. Leave reference image 3 as is.',
    seed: 1,
  });
  const prompt = nodeOf(graph, 'positive').inputs.prompt;

  assert.match(prompt, /every article of clothing on the bottom/i);
  assert.match(prompt, /the top person reference/i);
  assert.match(prompt, /garment 1 in the bottom row/i);
  assert.match(prompt, /garment 2 in the bottom row/i);
  assert.doesNotMatch(prompt, /reference image \d/i);
});

test('对齐句与作者原句逐字一致，不用会让模型输出双栏对比图的 bottom row 措辞', () => {
  // 2026-11-24 真实出图对照：把对齐句改成 "in the bottom row" 时模型只复刻拼图、不换衣。
  const prompt = nodeOf(workflowGraph({ images: IMAGES, seed: 1 }), 'positive').inputs.prompt;
  assert.equal(prompt, 'Style the person in the top of the image, with every article of clothing on the bottom');
  assert.doesNotMatch(prompt, /bottom row/i);
});

test('没有附加 prompt 时正 prompt 只保留作者对齐句', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 1 });
  const prompt = nodeOf(graph, 'positive').inputs.prompt;
  assert.match(prompt, /every article of clothing on the bottom/i);
  assert.doesNotMatch(prompt, /reference image \d/i);
});

test('拒绝少于一张服装或多于 MAX_GARMENTS 件的输入', () => {
  for (const images of [[], ['only-person.png'], ['p', '1', '2', '3', '4']]) {
    assert.throws(
      () => workflowGraph({ images, seed: 1 }),
      (error) => error.code === 'INVALID_REQUEST' && error.field === 'images',
    );
  }
});

test('拒绝空文件名、非字符串与路径穿越', () => {
  for (const images of [
    ['person.png', ''],
    ['person.png', 42],
    ['person.png', '../etc/passwd'],
    ['person.png', 'a/b.png'],
  ]) {
    assert.throws(
      () => workflowGraph({ images, seed: 1 }),
      (error) => error.code === 'INVALID_REQUEST' && error.field === 'images',
    );
  }
});

test('requiredFromGraph 从图本身推导所需节点、模型文件与输入图片', () => {
  const graph = workflowGraph({ images: ['person.png', 'a.png', 'b.png'], seed: 1 });
  const required = requiredFromGraph(graph);

  for (const type of ['UNETLoader', 'LoraLoaderModelOnly', 'CLIPLoader', 'VAELoader', 'LoadImage', 'ImageStitch', 'ImageScale', 'ImageScaleToTotalPixels', 'TextEncodeQwenImageEdit', 'VAEEncode', 'KSampler', 'VAEDecode', 'SaveImage']) {
    assert.ok(required.nodeTypes.includes(type), `缺少节点类型 ${type}`);
  }
  assert.deepEqual(required.models, {
    unet: DEFAULT_MODELS.unet,
    clip: DEFAULT_MODELS.clip,
    vae: DEFAULT_MODELS.vae,
    lora: DEFAULT_MODELS.lora,
  });
  assert.deepEqual(required.images, ['person.png', 'a.png', 'b.png']);
});

test('requiredFromGraph 在 gguf 模式下报告 UnetLoaderGGUF', () => {
  const graph = workflowGraph({ images: IMAGES, seed: 1, env: { COMFYUI_UNET_TYPE: 'gguf' } });
  const required = requiredFromGraph(graph);
  assert.ok(required.nodeTypes.includes('UnetLoaderGGUF'));
  assert.ok(!required.nodeTypes.includes('UNETLoader'));
  assert.equal(required.models.unet, DEFAULT_MODELS.unet);
});

test('真实多件提示词的范围与单件引用都映射为合成图位置', () => {
  for (const count of [2, 3]) {
    const pieces = [{ slot: 'top', layer: 'inner' }, { slot: 'bottom', layer: 'middle' }, { slot: 'outer', layer: 'outer' }].slice(0, count);
    const graph = workflowGraph({ images: ['person.png', ...pieces.map((_, i) => `g${i}.png`)], prompt: buildOutfitPrompt({ pieces }) });
    const text = graph.positive.inputs.prompt;
    assert.equal((text.match(new RegExp(`garments 1–${count} in the bottom row`, 'g')) ?? []).length, 2);
    assert.doesNotMatch(text, /reference images?\s+\d/i);
    assert.match(text, /wear outside garment 1 in the bottom row/);
    assert.match(text, /only person in the output is the person in the top person reference/);
  }
});

test('种子缺省时回落到作者的 1088，非法种子不进入图', () => {
  assert.equal(nodeOf(workflowGraph({ images: IMAGES }), 'sampler').inputs.seed, 1088);
  for (const seed of ['abc', -1, 1.5, NaN]) {
    assert.throws(
      () => workflowGraph({ images: IMAGES, seed }),
      (error) => error.code === 'INVALID_REQUEST' && error.field === 'seed',
    );
  }
});
