import { HttpError } from './errors.mjs';

export const MODEL_LABELS = {
  'codex/gpt-image-2.5': 'GPT Image 2.5',
  'codex/gpt-image-2': 'GPT Image 2',
  'workbuddy/hunyuan-image-alpha': '混元图像 Alpha',
  'workbuddy-ai/hy-image-3.5': '混元图像 3.5',
  'minimax-code/MiniMax-Image': 'MiniMax Image',
};

const TIERS = {
  'minimax-code/MiniMax-Image': [
    { id: 'fast', label: '快档', quality: 'medium', size: '1024x1536' },
  ],
  'workbuddy/hunyuan-image-alpha': [
    { id: 'fast', label: '均衡档', quality: 'medium', size: '1024x1536' },
  ],
  'workbuddy-ai/hy-image-3.5': [
    { id: 'fast', label: '均衡档', quality: 'medium', size: '1024x1536' },
  ],
  'codex/gpt-image-2.5': [
    { id: 'standard', label: '精档', quality: 'medium', size: '1024x1536' },
    { id: 'premium', label: '尊档', quality: 'high', size: '1024x1536' },
  ],
  'codex/gpt-image-2': [
    { id: 'standard', label: '精档', quality: 'medium', size: '1024x1536' },
    { id: 'premium', label: '尊档', quality: 'high', size: '1024x1536' },
  ],
};

const FALLBACK_TIER = { id: 'fast', label: '标准档', quality: 'medium', size: '1024x1536' };

export function modelLabel(id) {
  return MODEL_LABELS[id] ?? id;
}

export function tiersFor(modelId) {
  const tiers = Object.hasOwn(TIERS, modelId) ? TIERS[modelId] : [FALLBACK_TIER];
  return tiers.map((tier) => ({ ...tier, priceCents: 0 }));
}

export function resolveTier(modelId, tierId) {
  const tiers = tiersFor(modelId);
  const tier = (tierId === undefined || tierId === null || tierId === '')
    ? tiers[0]
    : tiers.find((item) => item.id === tierId);
  if (!tier) throw new HttpError(400, 'INVALID_REQUEST', '所选档位不属于该模型', 'tier');
  return { model: modelId, tier: tier.id, label: tier.label, quality: tier.quality, size: tier.size, priceCents: tier.priceCents };
}

export function priceCatalog(modelIds) {
  const models = modelIds.map((id) => ({
    id,
    label: modelLabel(id),
    tiers: tiersFor(id),
  }));
  const preferred = models.find((model) => model.id === 'codex/gpt-image-2.5')
    ?? models.find((model) => model.id === 'codex/gpt-image-2')
    ?? models[0]
    ?? null;
  const defaultTier = preferred?.tiers.find((tier) => tier.id === 'standard') ?? preferred?.tiers[0] ?? null;
  return {
    models,
    defaultModel: preferred?.id ?? null,
    defaultTier: defaultTier?.id ?? null,
    tryOnFromCents: 0,
    packs: [],
  };
}
