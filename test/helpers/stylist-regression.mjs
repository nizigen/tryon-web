import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createFixture, observeStudioOrders, openBrowser, waitFor } from './browser.mjs';

export async function verifyConsecutiveRecommendations(context) {
  const fixture = await createFixture({
    suggestOutfit(request, items) {
      const slot = request === '晚上聚餐' ? 'dress' : 'top';
      return { slots: { [slot]: items.find(item => item.category === slot) }, reason: request, missing: [] };
    },
  });
  context.after(() => fixture.close());
  const browser = await openBrowser();
  context.after(() => browser.close());
  const posts = observeStudioOrders(fixture.app);
  const generate = '.stylist__order .btn--primary';
  const download = '.stylist__result-img-wrap a[download]';
  const resultImage = '.stylist__result-img-wrap img';
  const downloadHref = () => browser.evaluate(`document.querySelector(${JSON.stringify(download)})?.getAttribute('href')`);
  await browser.goto(`${fixture.base}/#/wardrobe`, 390);
  await waitFor(() => browser.evaluate('Boolean(document.querySelector(".wardrobe-card"))'), 'wardrobe ready');

  async function selectRecommendation(request, slot) {
    await browser.fill('.stylist .inline-field input', request);
    await browser.click('.stylist .inline-field button');
    const garment = fixture.items.find(item => item.category === slot).name;
    await waitFor(() => browser.evaluate(`document.querySelector('.stylist__slot-name')?.textContent === ${JSON.stringify(garment)} && !document.querySelector('${generate}').disabled`), 'recommended outfit ready');
  }

  await selectRecommendation('白天通勤', 'top');
  await browser.click(generate);
  await waitFor(downloadHref, 'first outfit result');
  const firstResult = await downloadHref();

  await selectRecommendation('晚上聚餐', 'dress');
  assert.equal(await browser.evaluate(`document.querySelector('${resultImage}, ${download}') === null`), true);
  assert.equal(posts.length, 1);
  assert.equal(await browser.evaluate('document.querySelector("#toast").hidden'), true);

  await browser.click(generate);
  await waitFor(downloadHref, 'second outfit result');
  assert.notEqual(await downloadHref(), firstResult);
  assert.equal(posts.length, 2);
  const { orders } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
  assert.deepEqual(orders.map(order => order.status), ['success', 'success']);
}
