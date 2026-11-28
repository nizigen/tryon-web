import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createFixture, observeStudioOrders, openBrowser, stepButton, waitFor } from './browser.mjs';

export async function productNavigation(t) {
  const { products: [product] } = JSON.parse(await readFile(new URL('../../data/catalog.json', import.meta.url), 'utf8'));
  const fixture = await createFixture({ products: [product] }); t.after(() => fixture.close());
  const browser = await openBrowser(); t.after(() => browser.close());
  const { click, evaluate } = browser;
  const orders = observeStudioOrders(fixture.app);
  const route = view => waitFor(() => evaluate(`document.querySelector('main[data-view="${view}"] h1') !== null`), `${view} mounted`);
  const draft = () => evaluate(`({step:document.querySelector('[aria-current=step]')?.dataset.studioStep, pieces:Array.from(document.querySelectorAll('.piece__name'), el=>el.textContent)})`);
  const traverse = async (direction, view) => { await evaluate(`history.${direction}()`); await route(view); };

  await browser.goto(`${fixture.base}/#/shop`, 390);
  await evaluate(`addEventListener('hashchange', () => history.replaceState({...history.state, peer: 'preserve me'}, ''), {once:true,capture:true})`);
  await click('button.product'); await route('tryon');
  assert.deepEqual(await draft(), { step: 'shoot', pieces: [product.name] });
  assert.equal(await evaluate('history.state.peer'), 'preserve me');
  await click(stepButton('pieces'));
  await click('.slot summary.piece'); await click('[aria-label="清除第 1 个单品的图片"]');
  await click('[aria-label="从衣橱选择第 1 个单品"]');
  const pants = 'dialog[open] [aria-label="选择黑色长裤"]';
  await waitFor(() => evaluate(`Boolean(document.querySelector('${pants}'))`), 'wardrobe picker'); await click(pants);
  await click(stepButton('person'));
  const edited = { step: 'person', pieces: [fixture.items[1].name] };
  assert.deepEqual(await draft(), edited);
  await click('.nav [data-route=settings]'); await route('settings');
  await traverse('back', 'tryon'); assert.deepEqual(await draft(), edited);
  await traverse('forward', 'settings'); await traverse('back', 'tryon'); assert.deepEqual(await draft(), edited);

  await traverse('back', 'shop'); await click('button.product'); await route('tryon');
  assert.deepEqual(await draft(), { step: 'shoot', pieces: [fixture.items[1].name, product.name] });
  assert.equal(await evaluate('location.hash'), `#/tryon/${product.id}`);
  const documentStart = await evaluate('performance.timeOrigin');
  await browser.send('Page.reload', { ignoreCache: true });
  await waitFor(() => evaluate(`performance.timeOrigin !== ${documentStart} && Boolean(document.querySelector('.piece__name'))`), 'fresh document imports product');
  assert.deepEqual(await draft(), { step: 'shoot', pieces: [product.name] });
  await browser.goto(`${fixture.base}/#/tryon/${product.id}`, 390); await route('tryon');
  assert.deepEqual(await draft(), { step: 'shoot', pieces: [product.name] });
  assert.equal(orders.length, 0);
}
