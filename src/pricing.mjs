import { HttpError } from './errors.mjs';

/**
 * 按模型 × 档位的定价表。
 *
 * 成本列是公开价的折算估算（见 findings.md 第 2 节），售价由成本 × 量级系数得到，
 * 改价只改这张表。单位：分。
 */

export const MODEL_LABELS = {
  'codex/gpt-image-2': 'GPT Image 2',
  'workbuddy/hunyuan-image-alpha': '混元图像 Alpha',
  'workbuddy-ai/hy-image-3.5': '混元图像 3.5',
  'minimax-code/MiniMax-Image': 'MiniMax Image',
};

const TIERS = {
  'minimax-code/MiniMax-Image': [
    { id: 'fast', label: '快档', quality: 'medium', size: '1024x1536', priceCents: 190, costCents: 30 },
  ],
  'workbuddy/hunyuan-image-alpha': [
    { id: 'fast', label: '均衡档', quality: 'medium', size: '1024x1536', priceCents: 290, costCents: 40 },
  ],
  'workbuddy-ai/hy-image-3.5': [
    { id: 'fast', label: '均衡档', quality: 'medium', size: '1024x1536', priceCents: 390, costCents: 40 },
  ],
  'codex/gpt-image-2': [
    { id: 'standard', label: '精档', quality: 'medium', size: '1024x1536', priceCents: 690, costCents: 90 },
    { id: 'premium', label: '尊档', quality: 'high', size: '1024x1536', priceCents: 1390, costCents: 350 },
  ],
};

const FALLBACK_TIER = { id: 'fast', label: '标准档', quality: 'medium', size: '1024x1536', priceCents: 390, costCents: 100 };

export const PACKS = [
  { id: 'trial', label: '体验包', amountCents: 190, credits: 1 },
  { id: 'light', label: '轻享包', amountCents: 990, credits: 5 },
  { id: 'plus', label: '畅玩包', amountCents: 2990, credits: 15 },
];

export const TRIAL_CREDITS = 1;

export function modelLabel(id) {
  return MODEL_LABELS[id] ?? id;
}

export function tiersFor(modelId) {
  return TIERS[modelId] ?? [FALLBACK_TIER];
}

export function resolveTier(modelId, tierId) {
  const tiers = tiersFor(modelId);
  const tier = (tierId === undefined || tierId === null || tierId === '')
    ? tiers[0]
    : tiers.find((item) => item.id === tierId);
  if (!tier) throw new HttpError(400, 'INVALID_REQUEST', '所选档位不属于该模型', 'tier');
  return { model: modelId, tier: tier.id, label: tier.label, quality: tier.quality, size: tier.size, priceCents: tier.priceCents, costCents: tier.costCents };
}

export function priceCatalog(modelIds) {
  const models = modelIds.map((id) => ({
    id,
    label: modelLabel(id),
    tiers: tiersFor(id).map((tier) => ({ ...tier })),
  }));
  const cheapest = models
    .flatMap((model) => model.tiers.map((tier) => tier.priceCents))
    .reduce((min, value) => (min === null || value < min ? value : min), null);
  const preferred = models.find((model) => model.id === 'codex/gpt-image-2') ?? models[0] ?? null;
  const defaultTier = preferred?.tiers.find((tier) => tier.id === 'standard') ?? preferred?.tiers[0] ?? null;
  const cheapestPrice = cheapest ?? PACKS[0].amountCents;
  return {
    models,
    defaultModel: preferred?.id ?? null,
    defaultTier: defaultTier?.id ?? null,
    tryOnFromCents: cheapest,
    packs: PACKS.map((pack) => ({
      ...pack,
      // 可试次数按当前最低档位价折算；余额通用，可抵扣任意档位。
      approxTries: Math.floor(pack.amountCents / cheapestPrice),
    })),
  };
}

export function formatYuan(cents) {
  return `¥${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
