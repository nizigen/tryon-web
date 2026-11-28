import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createFixture, openBrowser, pickTrialGarment, waitFor } from './browser.mjs';

export async function verifyHomeNavigation(context) {
  const fixture = await createFixture(); context.after(() => fixture.close());
  const browser = await openBrowser(); context.after(() => browser.close());
  const { click, evaluate } = browser;
  const apiCalls = [];
  fixture.app.on('request', request => { if (request.url.startsWith('/api/')) apiCalls.push(`${request.method} ${request.url}`); });
  const view = () => evaluate('document.querySelector("main:has(h1)")?.dataset.view');
  const ready = name => waitFor(async () => await view() === name, `${name} mounted`);
  const studioLink = '.home-hero a[href="#/studio"]';
  const wardrobeLink = '.home-hero a[href="#/wardrobe"]';

  await browser.goto(fixture.base, 390);
  assert.equal(await view(), 'home');
  await waitFor(() => evaluate('document.querySelector(".home-hero img")?.naturalWidth === 1024'), 'public model reference decoded');
  assert.match(await evaluate('document.querySelector(".home-hero figcaption").textContent'), /模特参考/);
  assert.deepEqual(await evaluate('Object.keys(localStorage)'), []);
  assert.deepEqual(apiCalls, []);
  await browser.key('Tab');
  assert.equal(await evaluate('document.activeElement.className'), 'skip-link');

  await click(studioLink); await ready('studio');
  await pickTrialGarment(browser);
  await click('.sidebar__brand'); await ready('home');
  assert.equal(await evaluate('document.activeElement.id'), 'main');
  await click(wardrobeLink); await ready('wardrobe');
  await waitFor(() => evaluate('Boolean(document.querySelector(".wardrobe-card__thumb"))'), 'wardrobe items loaded');
  await evaluate('history.back()'); await ready('home');
  await click(studioLink); await ready('studio');
  assert.deepEqual(await evaluate('[document.querySelector("[aria-current=step]").dataset.studioStep, document.querySelector(".piece__name").textContent]'), ['shoot', fixture.items[0].name]);

  const sessionStarts = () => apiCalls.filter(request => request === 'POST /api/session');
  assert.equal(sessionStarts().length, 1);
  const { sessions, orders } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
  assert.equal(sessions.length, 1);
  assert.deepEqual(orders, []);
  assert.ok(!apiCalls.includes('POST /api/orders'));

  apiCalls.length = 0;
  await browser.goto(`${fixture.base}/#/home`, 320);
  assert.equal(await view(), 'home');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.deepEqual(apiCalls, []);
  assert.deepEqual(browser.errors, []);
}
