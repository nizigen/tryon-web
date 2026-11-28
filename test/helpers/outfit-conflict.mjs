import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertCannotShoot, createFixture, observeStudioOrders, openBrowser, shootLocks, stepButton, trialButton, waitFor } from './browser.mjs';

export async function verifyOutfitConflict(context) {
  const { products } = JSON.parse(await readFile(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
  const product = products.find(item => item.id === 'shirt-floral');
  const fixture = await createFixture({ products: [product] });
  context.after(() => fixture.close());
  const browser = await openBrowser();
  context.after(() => browser.close());
  const posts = observeStudioOrders(fixture.app);
  const { click, evaluate } = browser;
  await browser.goto(`${fixture.base}/#/tryon/${product.id}`, 390);
  await waitFor(() => evaluate('Boolean(document.querySelector("[data-studio-step=shoot][aria-current=step]"))'), 'catalog shirt ready');
  await click(stepButton('pieces'));
  await click('[aria-label="添加一个单品条目"]');
  await click('[aria-label="从衣橱选择第 2 个单品"]');
  const shirt = 'dialog[open] .picker__item[aria-label="选择独特白色衬衫"]';
  await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(shirt)}))`), 'wardrobe shirt ready');
  await click(shirt);

  assert.match(await evaluate('document.querySelector(".studio-next [role=status]").textContent'), /第 1 件和第 2 件.*中层/);
  assert.equal(await evaluate('document.querySelector(".studio-next .btn--primary").disabled'), true);
  await click(stepButton('shoot'));
  await click('[data-photography-mode=studio]');
  await assertCannotShoot(browser, posts, 'same-slot auto layers conflict before creating an order');

  await click(stepButton('pieces'));
  await click('.slot:nth-child(2) summary');
  await evaluate('document.querySelector("#piece-layer-2").focus()');
  await browser.key('ArrowDown');
  await waitFor(() => evaluate('document.querySelector("#piece-layer-2").value === "inner"'), 'second shirt moved to inner layer');
  await click('.studio-next .btn--primary');
  assert.deepEqual(await evaluate(shootLocks), [false, false]);
  await click(trialButton);
  await waitFor(() => evaluate('Boolean(document.querySelector(".result a[download]"))'), 'stacked outfit result');
  const { orders } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
  assert.equal(posts.length, 1);
  assert.deepEqual(orders.map(({ slots, status }) => ({ slots, status })), [{ slots: ['top', 'top'], status: 'success' }]);
}
