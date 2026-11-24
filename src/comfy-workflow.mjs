import { HttpError } from './errors.mjs';

/**
 * FoxBaze Qwen-Edit 试穿 LoRA 的 ComfyUI API 图构造器。
 *
 * 只还原作者 alpha 工作流已验证的那条路径（原版 Qwen-Image-Edit 底座、单张拼图、
 * 单参考 TextEncodeQwenImageEdit）：人物在整张图的顶部，1~3 件服装横向拼成一行放在底部。
 * 作者模型卡写明五件及以上效果会退化，所以这里把服装上限固定为 3 件，不做 2509 Plus 的
 * 多参考输入假设。
 *
 * 作者原图用 KJNodes 的 ImageResizeKJv2 做 832×1248 精确拉伸；这里换成核心 ImageScale
 * （crop=disabled 即忽略比例拉伸），避免为一个节点引入额外自定义节点包，接线参数与
 * 作者原图一致。
 */
export const WORKFLOW_ID = 'comfyui/foxbaze-tryon';

/** 作者推荐的输出画布，也是拼图后精确拉伸到的尺寸。 */
export const CANVAS = Object.freeze({ width: 832, height: 1248 });

/** 作者自述五件及以上会退化；alpha 只按 1~3 件服装作为基线。 */
export const MAX_GARMENTS = 3;

/**
 * 默认模型文件名取自固定版本的作者工作流与 HF 仓库：
 * - UNET/CLIP/VAE 与 Comfy-Org Qwen-Image 官方文件同名；
 * - LoRA 用 HF 实际提供的文件名，作者工作流里残留的是训练时旧名。
 */
export const DEFAULT_MODELS = Object.freeze({
  unet: 'qwen_image_edit_fp8_e4m3fn.safetensors',
  clip: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
  lora: 'Try_On_Qwen_Edit_Lora.safetensors',
});

/** 作者示例里的对齐句（性别中立改写），说明人物在上、服装在下。 */
const ALIGNMENT = 'Style the person in the top of the image, with every article of clothing in the bottom row';

const DEFAULT_SEED = 1088;
const DEFAULT_PREFIX = 'FoxBaze_TryOn';

function invalid(field, message) {
  return new HttpError(400, 'INVALID_REQUEST', message, field);
}

function pick(env, key, fallback) {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function resolveModels(env) {
  return {
    unet: pick(env, 'COMFYUI_UNET', DEFAULT_MODELS.unet),
    clip: pick(env, 'COMFYUI_CLIP', DEFAULT_MODELS.clip),
    vae: pick(env, 'COMFYUI_VAE', DEFAULT_MODELS.vae),
    lora: pick(env, 'COMFYUI_LORA', DEFAULT_MODELS.lora),
  };
}

function isGguf(env) {
  return String(env?.COMFYUI_UNET_TYPE ?? '').trim().toLowerCase() === 'gguf';
}

/**
 * 上传文件名直接进 LoadImage，必须挡掉空串、控制字符与路径片段，
 * 否则 ComfyUI 会把它当成输入目录里的相对路径解析。
 */
function normalizeFilename(value, index) {
  if (typeof value !== 'string') throw invalid('images', `第 ${index + 1} 张图片文件名不合法`);
  const name = value.trim();
  if (!name || name.length > 200 || name.includes('..') || /[\\/\u0000-\u001f\u007f]/.test(name)) {
    throw invalid('images', `第 ${index + 1} 张图片文件名不合法`);
  }
  return name;
}

/** 第一张是人物，后面 1~3 张是服装。 */
function normalizeImages(images) {
  if (!Array.isArray(images)) throw invalid('images', '需要人物照片与 1 到 3 件服装图片');
  const files = images.map(normalizeFilename);
  if (files.length < 2 || files.length > MAX_GARMENTS + 1) {
    throw invalid('images', `需要人物照片与 1 到 ${MAX_GARMENTS} 件服装图片`);
  }
  return files;
}

function normalizeSeed(seed) {
  if (seed === undefined || seed === null) return DEFAULT_SEED;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0) {
    throw invalid('seed', '种子必须是 0 或正整数');
  }
  return seed;
}

/**
 * 主应用按「reference image 1 = 人物，reference image 2..N = 第 N-1 件服装」组织措辞，
 * 而拼图里人物在上、服装成行在下，直接把原句喂给模型会对不上位置，所以在这里改写。
 */
export function mapReferencePrompt(text, garmentCount) {
  return String(text ?? '').replace(/reference images?\s+(\d+)(?:\s*[-–]\s*(\d+))?/gi, (match, raw, last) => {
    const index = Number(raw);
    if (last !== undefined) {
      const end = Number(last);
      if (index >= 2 && end >= index && end <= garmentCount + 1) return `garments ${index - 1}–${end - 1} in the bottom row (numbered from the left)`;
      return match;
    }
    if (index === 1) return 'the top person reference';
    if (index >= 2 && index <= garmentCount + 1) return `garment ${index - 1} in the bottom row (numbered from the left)`;
    return match;
  });
}

function buildPositivePrompt(prompt, garmentCount) {
  const mapped = mapReferencePrompt(prompt, garmentCount).trim();
  return mapped ? `${ALIGNMENT}\n\n${mapped}` : ALIGNMENT;
}

function stitch(id, image1, image2, direction) {
  return {
    class_type: 'ImageStitch',
    inputs: {
      image1: [image1, 0],
      direction,
      match_image_size: true,
      spacing_width: 0,
      spacing_color: 'white',
      image2: [image2, 0],
    },
  };
}

/**
 * 构造 ComfyUI /prompt 可直接提交的 API 图（{nodeId: {class_type, inputs}}）。
 * @param {object} input
 * @param {string[]} input.images 已上传到 ComfyUI input 目录的文件名，人物在前，服装在后
 * @param {string} [input.prompt] 主应用提示词，里面的 reference image N 会被改写为拼图位置
 * @param {object} [input.env] COMFYUI_UNET/CLIP/VAE/LORA 与 COMFYUI_UNET_TYPE 覆盖项
 * @param {number} [input.seed]
 * @returns {Record<string, {class_type: string, inputs: object}>}
 */
export function workflowGraph({ images, prompt = '', env = {}, seed } = {}) {
  const files = normalizeImages(images);
  const garmentCount = files.length - 1;
  const models = resolveModels(env);
  const finalSeed = normalizeSeed(seed);

  const graph = {};

  graph.person = { class_type: 'LoadImage', inputs: { image: files[0] } };
  for (let index = 1; index <= garmentCount; index += 1) {
    graph[`garment_${index}`] = { class_type: 'LoadImage', inputs: { image: files[index] } };
  }

  // 服装先横向拼成一行（right，尺寸对齐），再由人物向下拼，形成「上人物 / 下服装条带」。
  let garmentRow = 'garment_1';
  for (let index = 2; index <= garmentCount; index += 1) {
    const id = `stitch_garment_${index}`;
    graph[id] = stitch(id, garmentRow, `garment_${index}`, 'right');
    garmentRow = id;
  }
  graph.stitch_layout = stitch('stitch_layout', 'person', garmentRow, 'down');

  graph.scale_canvas = {
    class_type: 'ImageScale',
    inputs: {
      image: ['stitch_layout', 0],
      upscale_method: 'nearest-exact',
      width: CANVAS.width,
      height: CANVAS.height,
      crop: 'disabled',
    },
  };

  graph.scale_pixels = {
    class_type: 'ImageScaleToTotalPixels',
    inputs: {
      image: ['scale_canvas', 0],
      upscale_method: 'lanczos',
      megapixels: 1.0,
      resolution_steps: 1,
    },
  };

  graph.encode = { class_type: 'VAEEncode', inputs: { pixels: ['scale_pixels', 0], vae: ['vae', 0] } };

  graph.positive = {
    class_type: 'TextEncodeQwenImageEdit',
    inputs: {
      clip: ['clip', 0],
      vae: ['vae', 0],
      image: ['scale_canvas', 0],
      prompt: buildPositivePrompt(prompt, garmentCount),
    },
  };

  graph.negative = {
    class_type: 'TextEncodeQwenImageEdit',
    inputs: { clip: ['clip', 0], vae: ['vae', 0], image: ['scale_pixels', 0], prompt: '' },
  };

  graph.unet = isGguf(env)
    ? { class_type: 'UnetLoaderGGUF', inputs: { unet_name: models.unet } }
    : { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } };

  graph.lora = {
    class_type: 'LoraLoaderModelOnly',
    inputs: { model: ['unet', 0], lora_name: models.lora, strength_model: 1 },
  };

  graph.model_shift = {
    class_type: 'ModelSamplingAuraFlow',
    inputs: { model: ['lora', 0], shift: 3 },
  };

  graph.cfg_norm = {
    class_type: 'CFGNorm',
    inputs: { model: ['model_shift', 0], strength: 1, pre_cfg: false },
  };

  graph.clip = {
    class_type: 'CLIPLoader',
    inputs: { clip_name: models.clip, type: 'qwen_image', device: 'default' },
  };

  graph.vae = { class_type: 'VAELoader', inputs: { vae_name: models.vae } };

  graph.sampler = {
    class_type: 'KSampler',
    inputs: {
      model: ['cfg_norm', 0],
      positive: ['positive', 0],
      negative: ['negative', 0],
      latent_image: ['encode', 0],
      seed: finalSeed,
      steps: 30,
      cfg: 2.5,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
    },
  };

  graph.decode = { class_type: 'VAEDecode', inputs: { samples: ['sampler', 0], vae: ['vae', 0] } };

  graph.output = {
    class_type: 'SaveImage',
    inputs: { images: ['decode', 0], filename_prefix: DEFAULT_PREFIX },
  };

  return graph;
}

/**
 * 从图本身推导 preflight 要校验的东西：需要的节点类型、模型文件名、输入图片。
 * 不另维护一份常量清单，避免图和校验表漂移。
 */
export function requiredFromGraph(graph) {
  const nodeTypes = [];
  const models = {};
  const images = [];

  for (const node of Object.values(graph ?? {})) {
    const type = node?.class_type;
    if (typeof type !== 'string') continue;
    if (!nodeTypes.includes(type)) nodeTypes.push(type);
    const inputs = node.inputs ?? {};
    if ((type === 'UNETLoader' || type === 'UnetLoaderGGUF') && typeof inputs.unet_name === 'string') {
      models.unet = inputs.unet_name;
    }
    if (type === 'CLIPLoader' && typeof inputs.clip_name === 'string') models.clip = inputs.clip_name;
    if (type === 'VAELoader' && typeof inputs.vae_name === 'string') models.vae = inputs.vae_name;
    if (type === 'LoraLoaderModelOnly' && typeof inputs.lora_name === 'string') models.lora = inputs.lora_name;
    if (type === 'LoadImage' && typeof inputs.image === 'string') images.push(inputs.image);
  }

  return { nodeTypes, models, images };
}
