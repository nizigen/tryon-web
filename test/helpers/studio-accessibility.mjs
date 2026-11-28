import assert from 'node:assert/strict';

import { createFixture, holdResponse, openBrowser, pickTrialGarment, stepButton, waitFor } from './browser.mjs';

const statusSelector = '.studio__preview [role=status]';
const readStatus = browser => browser.evaluate(`document.querySelector('${statusSelector}').textContent`);

async function openMobileStudio(context, options) {
  const fixture = await createFixture(options); context.after(() => fixture.close());
  const browser = await openBrowser(); context.after(() => browser.close());
  await browser.goto(`${fixture.base}/#/studio`, 390);
  return browser;
}

export async function verifyStudioPhotoLayout(context) {
  const fixture = await createFixture(); context.after(() => fixture.close());
  const browser = await openBrowser(); context.after(() => browser.close());
  const { evaluate } = browser;
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const original = window.fetch;
    window.fetch = async (resource, options) => {
      if (String(resource).includes('/model-front.png')) await new Promise(resolve => { window.releasePersonPhoto = resolve; });
      return original(resource, options);
    };
  }` });
  await browser.goto(`${fixture.base}/#/studio`, 391);
  const picker = '[aria-label="从衣橱选择第 1 个单品"]';
  const position = () => evaluate(`document.querySelector(${JSON.stringify(picker)}).getBoundingClientRect().top`);
  await waitFor(() => evaluate('typeof window.releasePersonPhoto === "function"'), 'default photo request held');
  const before = await position();
  await evaluate('window.releasePersonPhoto()');
  await waitFor(() => evaluate('Boolean(document.querySelector(".studio-original img")?.naturalWidth)'), 'default photo decoded');
  assert.equal(await position(), before, '人物图加载不能把选衣按钮推到其它位置');
  await browser.click(picker);
  await waitFor(() => evaluate('Boolean(document.querySelector("dialog[open] .picker__item"))'), 'wardrobe picker opened');
}

async function submitWithKeyboard(browser) {
  await pickTrialGarment(browser);
  await browser.evaluate('document.querySelector(".studio__submit .btn").focus()');
  await browser.key('Enter');
}

async function verifySuccess(context) {
  const generation = Promise.withResolvers();
  const browser = await openMobileStudio(context, { onEdit: () => generation.promise });
  const { evaluate } = browser;
  const accepted = await holdResponse(browser, '/api/orders', 'POST');
  try {
    assert.equal(await readStatus(browser), '');
    await submitWithKeyboard(browser);
    await accepted.ready();
    const queued = await readStatus(browser);
    await accepted.release();
    await waitFor(() => evaluate('document.querySelector(".result .stage")?.innerText.includes("正在生成")'), 'visible generation stage');
    const generating = await readStatus(browser);
    generation.resolve();
    await waitFor(() => evaluate('document.querySelector(".result img")?.naturalWidth > 0 && !!document.querySelector(".result a[download]")'), 'decoded result and download');
    const completed = await readStatus(browser);
    assert.match(queued, /排队/); assert.match(generating, /正在生成/); assert.match(completed, /完成/);
    assert.equal(await evaluate('document.activeElement.dataset.studioStep'), 'result');
    const { root } = await browser.send('DOM.getDocument');
    const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: statusSelector });
    const { nodes: [status] } = await browser.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    assert.equal(status.ignored, false); assert.equal(status.role.value, 'status');
    const property = name => status.properties.find(item => item.name === name)?.value.value;
    assert.equal(property('live'), 'polite'); assert.equal(property('atomic'), true);
    await browser.click(stepButton('shoot'));
    assert.equal(await readStatus(browser), '');
  } finally { generation.resolve(); }
}

async function verifyNonSuccess(context, disconnected) {
  const browser = await openMobileStudio(context, disconnected ? {} : { onEdit: () => { throw new Error('fixture image service unavailable'); } });
  if (disconnected) await browser.evaluate(`{const original = window.fetch; window.fetch = (path, options) => String(path).startsWith('/api/jobs/') ? Promise.reject(new TypeError('fixture offline')) : original(path, options);}`);
  await submitWithKeyboard(browser);
  const expected = disconnected ? /未确认/ : /失败/;
  await waitFor(async () => expected.test(await browser.evaluate('document.querySelector(".result .stage")?.innerText')), 'visible final state');
  assert.match(await readStatus(browser), expected);
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".result a[download]"))'), false);
  if (disconnected) {
    assert.match(await readStatus(browser), /试穿记录/);
    assert.equal(await browser.evaluate(`Boolean(document.querySelector('.result a[href="#/me"]'))`), true);
  }
}

export async function verifyStudioAccessibility(context) {
  await context.test('390px 宽度：可见穿着层级原生选择框的触控高度至少 44px', async mobile => {
    const browser = await openMobileStudio(mobile);
    await browser.click(stepButton('pieces'));
    const height = await browser.evaluate('document.querySelector("#piece-layer-1").getBoundingClientRect().height');
    assert.ok(height > 0, '单品层级选择框应可见');
    assert.ok(height >= 44, `穿着层级选择框触控高度为 ${height}px`);
  });
  await context.test('键盘提交：从排队到生成再到完成均播报，且不抢焦点', verifySuccess);
  await context.test('失败时播报失败，不出现下载', failure => verifyNonSuccess(failure, false));
  await context.test('轮询中断时播报结果未确认，并保留查记录入口', uncertain => verifyNonSuccess(uncertain, true));
}
