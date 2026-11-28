import assert from 'node:assert/strict';
import test from 'node:test';

import { priceCatalog, resolveTier, tiersFor } from '../src/pricing.mjs';

test('所有已知和新发现模型均可零余额使用，目录没有充值套餐', () => {
  const ids = ['minimax-code/MiniMax-Image', 'codex/gpt-image-2.5', 'workbuddy/hunyuan-image-alpha', 'vendor/new-model'];
  const catalog = priceCatalog(ids);
  assert.deepEqual(catalog.packs, []);
  assert.equal(catalog.tryOnFromCents, 0);
  assert.equal(catalog.defaultModel, 'codex/gpt-image-2.5');
  assert.equal(catalog.defaultTier, 'standard');
  for (const model of catalog.models) {
    assert.ok(model.tiers.length > 0);
    for (const tier of model.tiers) {
      assert.equal(tier.priceCents, 0);
      assert.equal(resolveTier(model.id, tier.id).priceCents, 0);
    }
  }
});

test('原有模型质量和尺寸档位均可选', () => {
  const model = 'codex/gpt-image-2.5';
  assert.deepEqual(tiersFor(model).map(({ id }) => id), ['standard', 'premium']);
  assert.equal(resolveTier(model).quality, 'medium');
  assert.equal(resolveTier(model, 'premium').quality, 'high');
  assert.equal(resolveTier(model, 'premium').size, '1024x1536');
  assert.equal(resolveTier('vendor/new-model').tier, 'fast');
});

test('未知档位被拒绝', () => {
  assert.throws(() => resolveTier('codex/gpt-image-2.5', 'does-not-exist'), (error) => error.code === 'INVALID_REQUEST' && error.field === 'tier');
  assert.throws(() => resolveTier('minimax-code/MiniMax-Image', 'premium'), (error) => error.code === 'INVALID_REQUEST');
});
