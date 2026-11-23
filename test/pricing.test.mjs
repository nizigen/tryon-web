import assert from 'node:assert/strict';
import test from 'node:test';

import { priceCatalog, resolveTier, tiersFor, PACKS } from '../src/pricing.mjs';

test('每个模型都有档位与价格，价格随档位递增', () => {
  for (const model of ['minimax-code/MiniMax-Image', 'codex/gpt-image-2.5']) {
    const tiers = tiersFor(model);
    assert.ok(tiers.length > 0);
    for (const tier of tiers) {
      assert.ok(tier.priceCents > 0);
      assert.ok(tier.costCents > 0);
      assert.ok(tier.priceCents > tier.costCents, '售价必须高于成本');
    }
    for (let index = 1; index < tiers.length; index += 1) {
      assert.ok(tiers[index].priceCents > tiers[index - 1].priceCents);
    }
  }
});

test('未登记的模型走兜底档位', () => {
  const tier = resolveTier('vendor/new-model', undefined);
  assert.equal(tier.priceCents, 390);
  assert.equal(tier.tier, 'fast');
});

test('未知档位被拒绝，不静默回落', () => {
  assert.throws(() => resolveTier('codex/gpt-image-2.5', 'does-not-exist'), (error) => error.code === 'INVALID_REQUEST' && error.field === 'tier');
  assert.throws(() => resolveTier('minimax-code/MiniMax-Image', 'premium'), (error) => error.code === 'INVALID_REQUEST');
});

test('不传档位时取模型的首个档位', () => {
  const tier = resolveTier('codex/gpt-image-2.5');
  assert.equal(tier.tier, 'standard');
  assert.equal(tier.quality, 'medium');
});

test('尊档价格高于精档且画质更高', () => {
  const standard = resolveTier('codex/gpt-image-2.5', 'standard');
  const premium = resolveTier('codex/gpt-image-2.5', 'premium');
  assert.ok(premium.priceCents > standard.priceCents);
  assert.equal(premium.quality, 'high');
});

test('价格目录给出起价、默认模型与默认档位', () => {
  const catalog = priceCatalog(['minimax-code/MiniMax-Image', 'codex/gpt-image-2.5']);
  assert.equal(catalog.tryOnFromCents, 190);
  assert.equal(catalog.defaultModel, 'codex/gpt-image-2.5');
  assert.equal(catalog.defaultTier, 'standard');
  assert.equal(catalog.models.length, 2);
  assert.equal(catalog.packs.length, PACKS.length);
});

test('充值包金额与发放次数一致', () => {
  for (const pack of PACKS) {
    assert.ok(pack.amountCents > 0);
    assert.ok(pack.credits > 0);
  }
});

test('价格目录按最低档位价折算套餐可试次数', () => {
  const catalog = priceCatalog(['minimax-code/MiniMax-Image', 'codex/gpt-image-2.5']);
  const light = catalog.packs.find((pack) => pack.id === 'light');
  assert.equal(light.approxTries, Math.floor(light.amountCents / catalog.tryOnFromCents));
});
