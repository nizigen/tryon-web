import assert from 'node:assert/strict';
import test from 'node:test';

import { chromePath, createFixture, openBrowser, waitFor } from './browser.mjs';
import { verifyHomeNavigation } from './home-navigation.mjs';
import { verifyOutfitConflict } from './outfit-conflict.mjs';
import { productNavigation } from './product-navigation.mjs';
import { verifyStudioAccessibility, verifyStudioPhotoLayout } from './studio-accessibility.mjs';
import { verifyConsecutiveRecommendations } from './stylist-regression.mjs';

async function verifyBrand(context) {
  const fixture = await createFixture(); context.after(() => fixture.close());
  const browser = await openBrowser(); context.after(() => browser.close());
  await browser.goto(`${fixture.base}/#/wardrobe`, 390);
  await waitFor(() => browser.evaluate('!!document.querySelector("h1")'), 'wardrobe mounted');
  assert.match(await browser.evaluate('document.title'), /^照花/);
  assert.equal(await browser.evaluate('document.querySelector(".sidebar__brand").textContent.trim()'), '照花');
  assert.equal(await browser.evaluate(`document.querySelector('.sidebar__brand img')?.src === document.querySelector('link[rel="icon"]').href`), true);
  await waitFor(() => browser.evaluate('document.querySelector(".sidebar__brand img")?.naturalWidth > 0'), 'brand asset decoded');
}

async function verifyNarrowWardrobeMenu(context) {
  const fixture = await createFixture(); context.after(() => fixture.close());
  const browser = await openBrowser(); context.after(() => browser.close());
  const { evaluate, key } = browser;
  await browser.goto(`${fixture.base}/#/wardrobe`, 320);
  await waitFor(() => evaluate('document.querySelectorAll(".wardrobe-card").length >= 2'), 'two wardrobe cards');
  for (const column of [1, 2]) {
    const trigger = `document.querySelector('.wardrobe-card:nth-child(${column}) [aria-haspopup="menu"]')`;
    await evaluate(`${trigger}.focus()`);
    await key('Enter');
    const menu = 'document.querySelector(".action-menu:not([hidden])")';
    await waitFor(() => evaluate(`Boolean(${menu})`), 'menu opened');
    const box = await evaluate(`(() => {
      const { left, right } = ${menu}.getBoundingClientRect();
      return { left, right, width: document.documentElement.clientWidth, focused: ${menu}.contains(document.activeElement) };
    })()`);
    assert.ok(box.left >= 0 && box.right <= box.width, `column ${column}: menu is outside the viewport (${box.left}–${box.right} of ${box.width})`);
    assert.equal(box.focused, true);
    await key('Escape');
    assert.equal(await evaluate(`!${menu} && document.activeElement === ${trigger}`), true);
  }
}

export function registerFlowRegressions() {
  const browserTest = { skip: !chromePath, timeout: 30000 };
  test('首页公开浏览，两个真实入口与工作台往返不清草稿、不建订单', browserTest, verifyHomeNavigation);
  test('照花页签与导航使用同一可加载的品牌图标', browserTest, verifyBrand);
  test('320px 衣橱双列的更多菜单不越界，Escape 恢复焦点', browserTest, verifyNarrowWardrobeMenu);
  test('衣橱连续选搭：下一套清除上一套成片和下载入口', browserTest, verifyConsecutiveRecommendations);
  test('商品深链接区分历史返回、主动重选和刷新，不重放已消费的商品导入', browserTest, productNavigation);
  test('工作台在提交前拦住同层冲突，改层后正常试拍', browserTest, verifyOutfitConflict);
  test('手机工作台的穿着层级与普通试穿状态播报', browserTest, verifyStudioAccessibility);
  test('手机试穿加载原图时不挪动选衣入口', browserTest, verifyStudioPhotoLayout);
}
