import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { createFixture, holdNextStudioRead, observeStudioOrders, openBrowser, setStudioPhotoFile, stepButton, waitFor } from './browser.mjs';

const file = fileURLToPath(new URL('../../public/catalog/blouse-linen.jpg', import.meta.url));
const summary = '.slot summary.piece';
const picker = '[aria-label="从衣橱选择第 1 个单品"]';
const upload = '[aria-label="上传第 1 个单品的图片"]';
const clear = '[aria-label="清除第 1 个单品的图片"]';
const addPiece = '[aria-label="添加一个单品条目"]';

async function pressEnter(browser, selector) {
  await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await browser.key('Enter');
}

async function selectFile(browser) {
  await pressEnter(browser, upload);
  await setStudioPhotoFile(browser, file, '.slot input[type=file]');
}

async function assertFocus(browser, selector) {
  const result = await browser.evaluate(`({ expected: document.activeElement === document.querySelector(${JSON.stringify(selector)}), active: document.activeElement.tagName })`);
  assert.ok(result.expected, `预期焦点 ${selector}，实际 ${result.active}`);
}

export async function verifyPieceFocus(context) {
  const fixture = await createFixture(); context.after(() => fixture.close());
  const browser = await openBrowser(); context.after(() => browser.close());
  const orders = observeStudioOrders(fixture.app);
  const present = selector => browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const ready = async width => {
    await browser.goto(`${fixture.base}/#/studio`, width);
    await browser.click(stepButton('pieces'));
    await browser.send('Page.setInterceptFileChooserDialog', { enabled: true });
  };

  await context.test('手机键盘上传后，焦点转到刚上传单品的摘要', async () => {
    await ready(390);
    await selectFile(browser);
    await waitFor(() => present(summary), 'uploaded item summary');
    await assertFocus(browser, summary);
  });
  await context.test('从衣橱选中后按 Enter 清空，焦点回到本条目的选衣入口', async () => {
    await ready(1440);
    await pressEnter(browser, picker);
    const shirt = 'dialog[open] [aria-label="选择独特白色衬衫"]';
    await waitFor(() => present(shirt), 'wardrobe shirt');
    await pressEnter(browser, shirt); await assertFocus(browser, summary);
    await browser.key('Enter');
    await pressEnter(browser, clear);
    await waitFor(async () => !(await present(summary)), 'cleared piece');
    await assertFocus(browser, picker);
  });
  for (const [label, destination] of [['其它条目操作', addPiece], ['其它步骤', stepButton('person')]]) {
    await context.test(`读图结束时，不从${label}抢回焦点`, async () => {
      await ready(390);
      const finish = await holdNextStudioRead(browser);
      await selectFile(browser);
      await waitFor(() => browser.evaluate('typeof window.finishHeldStudioRead === "function"'), 'file read held');
      await pressEnter(browser, destination);
      await assertFocus(browser, destination);
      assert.equal(await finish(), null);
      await waitFor(() => present(summary), 'late upload applied to its original piece');
      await assertFocus(browser, destination);
    });
  }
  assert.equal(orders.length, 0);
}
