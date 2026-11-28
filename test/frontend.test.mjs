import assert from 'node:assert/strict';
import { hash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFrontend } from '../scripts/build-frontend.mjs';
import { assertCannotShoot, assertTrialResult, chromePath, createFixture, holdNextStudioRead, holdResponse, imageBytes, MODEL, observeStudioOrders,
  openBrowser, openReadyTrial, pickTrialGarment, setStudioPhotoFile, shootLocks, stepButton, trialButton, trialNode, waitFor } from './helpers/browser.mjs';
import { registerFlowRegressions } from './helpers/flow-regressions.mjs';

before(buildFrontend);

registerFlowRegressions();

test('目录商品与衣橱单品带入同一份试拍草稿，不重选人物，不隐式建单', { skip: !chromePath }, async t => {
  const { products } = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url), 'utf8'));
  const fixture = await createFixture({ products: [products[0]] }); t.after(() => fixture.close());
  const browser = await openBrowser(); t.after(() => browser.close());
  const posts = observeStudioOrders(fixture.app);
  await browser.goto(`${fixture.base}/#/shop`, 390);
  await browser.click('button.product');
  await waitFor(() => browser.evaluate('document.querySelector("[aria-current=step]")?.dataset.studioStep === "shoot"'), 'catalog item ready for shooting');
  await browser.click(stepButton('person'));
  await setStudioPhotoFile(browser, fileURLToPath(new URL('../public/catalog/blouse-linen.jpg', import.meta.url)));
  await waitFor(() => browser.evaluate('document.querySelector(".dropzone__title").textContent === "你的照片"'), 'uploaded actor');
  await browser.click('.nav [data-route=wardrobe]');
  await waitFor(() => browser.evaluate('Boolean(document.querySelector(".wardrobe-card__thumb"))'), 'wardrobe');
  await browser.click(`.wardrobe-card[data-item-id="${fixture.items[1].id}"] .wardrobe-card__thumb`);
  await browser.click('.wardrobe-mobile-actions .btn--primary');
  await waitFor(() => browser.evaluate('document.querySelector("[aria-current=step]")?.dataset.studioStep === "shoot"'), 'wardrobe handoff');
  assert.deepEqual(await browser.evaluate('Array.from(document.querySelectorAll(".piece__name"), node => node.textContent)'), [products[0].name, fixture.items[1].name]);
  assert.equal(await browser.evaluate('document.querySelector(".dropzone__title").textContent'), '你的照片');
  assert.equal(posts.length, 0);
});

test('棚拍轮询中断：只保留首张未确认，后续姿势不建单，可查记录或退回修改', { skip: !chromePath }, async t => {
  const fixture = await createFixture(); t.after(() => fixture.close());
  const browser = await openBrowser(); t.after(() => browser.close());
  const orders = observeStudioOrders(fixture.app);
  await browser.goto(`${fixture.base}/#/studio`, 390);
  await pickTrialGarment(browser);
  await browser.click('[data-photography-mode=studio]');
  await browser.evaluate(`{const original = window.fetch; window.fetch = (path, options) => String(path).startsWith('/api/jobs/') ? Promise.reject(new TypeError('test network offline')) : original(path, options);}`);
  await browser.click('.studio__submit .btn');
  await waitFor(() => browser.evaluate('document.querySelector(".result")?.innerText.includes("未提交")'), 'unsent poses are distinct from a failed order');
  assert.equal(orders.length, 1);
  assert.match(await browser.evaluate('document.querySelector(".result").innerText'), /未确认/);
  assert.equal(await browser.evaluate(`Boolean(document.querySelector('.result a[href="#/me"]'))`), true);
  await browser.click(stepButton('shoot'));
  assert.equal(await browser.evaluate('document.querySelector("[data-photography-mode=studio]").getAttribute("aria-pressed")'), 'true');
  assert.equal(orders.length, 1);
});

test('四步试拍：草稿跨步骤和设置往返保留，未点试拍不产生订单', { skip: !chromePath, timeout: 30000 }, async t => {
  const fixture = await createFixture(); t.after(() => fixture.close());
  const browser = await openBrowser(); t.after(() => browser.close());
  const { click, evaluate } = browser;
  const posts = observeStudioOrders(fixture.app);
  const active = () => evaluate('document.querySelector("[aria-current=step]")?.dataset.studioStep');
  await browser.goto(`${fixture.base}/#/studio`, 390);
  await waitFor(async () => await active() === 'pieces', 'default person is already selected');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll("[data-studio-step] strong"), node => node.textContent)'), ['选人物', '搭衣服', '试拍', '看结果']);
  await click(stepButton('person'));
  await setStudioPhotoFile(browser, fileURLToPath(new URL('../public/catalog/blouse-linen.jpg', import.meta.url)));
  await waitFor(() => evaluate('document.querySelector(".dropzone__title")?.textContent === "你的照片"'), 'uploaded identity');
  await click(stepButton('pieces'));
  await pickTrialGarment(browser);
  await click(stepButton('shoot'));
  await click('[data-photography-mode=studio]');
  await click('[data-fit=slim]');
  await click('.studio__advanced summary');
  await browser.fill('#studio-prompt', '保留针织纹理');
  await click('.nav [data-route=settings]');
  await waitFor(() => evaluate('Boolean(document.querySelector(".settings"))'), 'settings route');
  assert.doesNotMatch(await evaluate('document.querySelector(".settings").textContent'), /IDM|ComfyUI|试穿 LoRA/i);
  await click('.nav [data-route=studio]');
  await waitFor(async () => await active() === 'shoot', 'return to current draft');
  assert.equal(await evaluate('document.querySelector("#studio-prompt").value'), '保留针织纹理');
  assert.equal(await evaluate('document.querySelector("[data-fit=slim]").getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate('document.querySelector("[data-photography-mode=studio]").getAttribute("aria-pressed")'), 'true');
  await click(stepButton('person'));
  assert.equal(await evaluate('document.querySelector(".dropzone__title").textContent'), '你的照片');
  await click(stepButton('pieces'));
  assert.equal(await evaluate('document.querySelector(".piece__name").textContent'), '独特白色衬衫');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(posts.length, 0);
});

test('默认人像画布与自选原图按原字节送达试穿上传边界', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  let sentReference;
  const fixture = await createFixture({ onEdit: async (form) => {
    const first = form.get('image[]');
    sentReference = [first.type, hash('sha256', new Uint8Array(await first.arrayBuffer()))];
  } });
  const orders = observeStudioOrders(fixture.app);
  t.after(() => fixture.close());
  const browser = await openBrowser();
  t.after(() => browser.close());
  const dimensions = (selector) => browser.evaluate(`(() => { const photo = document.querySelector(${JSON.stringify(selector)}); return [photo.naturalWidth, photo.naturalHeight]; })()`);
  const defaultHash = hash('sha256', await readFile(new URL('../public/model/posewear-01/model-front.png', import.meta.url)));
  await browser.goto(`${fixture.base}/#/wardrobe`, 390);
  await waitFor(() => browser.evaluate('document.querySelector(".wardrobe-person__image")?.naturalWidth > 0'), 'wardrobe portrait');
  assert.deepEqual(await dimensions('.wardrobe-person__image'), [1024, 1536]);
  const fetched = await browser.evaluate('performance.getEntriesByType("resource").map(entry => entry.name).filter(url => new URL(url).pathname.endsWith("/model-front.png"))');
  assert.equal(fetched.length, 1);
  assert.equal(new URL(fetched[0]).searchParams.get('v'), defaultHash.slice(0, 12));
  await browser.click('.wardrobe-card__thumb');
  await browser.click('.wardrobe-mobile-actions .btn--primary');
  await waitFor(() => browser.evaluate('document.querySelector(".dropzone__preview")?.naturalWidth > 0 && document.querySelector(".studio__submit .btn")?.disabled === false'), 'studio portrait');
  assert.deepEqual(await dimensions('.dropzone__preview'), [1024, 1536]);
  await browser.click('.studio__submit .btn');
  await waitFor(() => browser.evaluate('Boolean(document.querySelector(".result a[download]"))'), 'default order');
  assert.deepEqual(sentReference, ['image/png', defaultHash]);

  const customPath = fileURLToPath(new URL('../public/catalog/blouse-linen.jpg', import.meta.url));
  const customHash = hash('sha256', await readFile(customPath));
  await browser.click(stepButton('person'));
  await setStudioPhotoFile(browser, customPath);
  await waitFor(() => browser.evaluate('document.querySelector(".dropzone__preview").currentSrc.startsWith("data:image/jpeg;") && document.querySelector(".dropzone__preview").naturalWidth === 900'), 'custom JPEG');
  assert.deepEqual(await dimensions('.dropzone__preview'), [900, 822]);
  assert.doesNotMatch(await browser.evaluate('document.querySelector(".dropzone").innerText'), /查看模特参考资料|比例校样/);
  await browser.click(stepButton('shoot'));
  await browser.click('.studio__submit .btn');
  await waitFor(() => sentReference?.[1] === customHash, 'custom order reference');
  assert.deepEqual(sentReference, ['image/jpeg', customHash]);
  await waitFor(() => browser.evaluate('Boolean(document.querySelector(".result a[download]"))'), 'custom order');
  assert.deepEqual(orders, [
    { mode: 'preserve', source: 'builtin', hash: defaultHash },
    { mode: 'preserve', source: 'upload', hash: customHash },
  ]);

  for (const page of ['a.html', 'index.html']) {
    await browser.goto(`${fixture.base}/design-demos/${page}`);
    await waitFor(() => browser.evaluate('document.querySelector(\'img[src*="model-front.png"]\')?.naturalWidth > 0'), 'demo portrait');
    assert.equal(await browser.evaluate('document.querySelector(\'img[src*="model-front.png"]\').src'), fetched[0]);
  }
});

test('工作台人物卡：内置棚拍直接展示和打开定妆照，妆前原片供对照，自传及普通试穿不加载定妆照', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const browser = await openBrowser();
  t.after(() => browser.close());
  const { evaluate, key } = browser;
  const cardText = () => evaluate('document.querySelector(".dropzone").innerText');
  const activeLink = () => evaluate('document.activeElement.getAttribute("href")');
  const pressEnter = async (selector) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await key('Enter');
  };
  const modelDir = '/model/posewear-01/';
  const turnaroundHash = hash('sha256', await readFile(new URL('../public/model/posewear-01/turnaround.png', import.meta.url)));
  const turnaround = `${modelDir}turnaround.png?v=${turnaroundHash.slice(0, 12)}`;
  const makeupFile = `${modelDir}face-studio-makeup.png`;
  const baseFace = `${modelDir}face-base.jpg?v=4204794d46d6`;
  const preview = 'document.querySelector(\'.dropzone a[href*="face-studio-makeup.png"] img\')';
  const otherAssets = 'performance.getEntriesByType("resource").map(entry => new URL(entry.name).pathname).filter(path => path.startsWith("/model/posewear-01/") && !path.endsWith("/model-front.png"))';
  await browser.goto(`${fixture.base}/#/studio`, 390);
  await browser.click(stepButton('person'));
  await waitFor(() => evaluate('document.querySelector(".dropzone__preview")?.naturalWidth > 0'), 'default studio portrait');
  assert.equal(await evaluate('document.querySelector("[data-photography-mode=preserve]").getAttribute("aria-pressed")'), 'true');
  assert.match(await cardText(), /原图.*妆.*表情/);
  assert.doesNotMatch(await cardText(), /PoseWear|妆前|定妆|11-26/);
  assert.equal(await evaluate(`Boolean(${preview})`), false);
  assert.deepEqual(await evaluate(otherAssets), []);
  await pressEnter(stepButton('shoot'));
  await pressEnter('[data-photography-mode=studio]');
  const referenceLinks = await evaluate(`Array.from(document.querySelectorAll('.shoot-references a'), link => [link.textContent, link.getAttribute('href')])`);
  assert.deepEqual(referenceLinks.map(([label]) => label), ['正面全身照', '全身三视图', '棚拍定妆照']);
  assert.equal(referenceLinks[1][1], turnaround);
  await pressEnter(stepButton('person'));
  assert.match(await cardText(), /正面全身.*身材.*长黑发的长度.*定妆照.*五官.*自然披下的黑长直.*脸侧轮廓.*妆.*PoseWear.*骨架/s);
  await waitFor(() => evaluate(`${preview}?.naturalWidth > 0 && ${preview}.checkVisibility()`), 'visible decoded studio makeup portrait');
  const makeupLink = await evaluate(`${preview}.closest('a').getAttribute('href')`);
  const referenceHash = hash('sha256', await readFile(new URL(`../public${makeupFile}`, import.meta.url)));
  assert.equal(makeupLink, `${makeupFile}?v=${referenceHash.slice(0, 12)}`);
  assert.equal(await evaluate(`${preview}.getAttribute('src')`), makeupLink);
  assert.equal(await evaluate('document.querySelector(".dropzone details").open'), false);
  await evaluate('document.querySelector(".dropzone__actions button").focus()');
  await key('Tab');
  assert.equal(await activeLink(), makeupLink);
  await key('Tab');
  assert.equal(await evaluate('document.activeElement.matches(".dropzone summary")'), true);
  await key('Enter');
  await key('Tab');
  assert.equal(await activeLink(), turnaround);
  await key('Tab');
  assert.equal(await activeLink(), baseFace);
  assert.match(await cardText(), /比例校样.*不参与生成/s);
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".dropzone a"), link => link.getAttribute("href"))'),
    [makeupLink, turnaround, baseFace, `${modelDir}fit-proof.jpg`, `${modelDir}posewear-01.glb`]);
  assert.deepEqual(await evaluate(otherAssets), [makeupFile]);
  for (const [href, filename, mime] of [[makeupLink, 'face-studio-makeup.png', 'image/png'], [turnaround, 'turnaround.png', 'image/png'], [baseFace, 'face-base.jpg', 'image/jpeg'], [`${modelDir}fit-proof.jpg`, 'fit-proof.jpg', 'image/jpeg']]) {
    const response = await fetch(new URL(href, fixture.base));
    assert.equal(response.status, 200, href);
    assert.equal(response.headers.get('content-type'), mime);
    const local = new URL(`../public${modelDir}${filename}`, import.meta.url);
    assert.equal(hash('sha256', new Uint8Array(await response.arrayBuffer())), hash('sha256', await readFile(local)));
  }
  assert.equal(await evaluate('document.documentElement.scrollWidth'), 390);
  await setStudioPhotoFile(browser, fileURLToPath(new URL('../public/model/posewear-01/model-front.png', import.meta.url)));
  await waitFor(() => evaluate('document.querySelector(".dropzone__title").textContent === "你的照片"'), 'uploaded portrait selected');
  assert.match(await cardText(), /你的照片.*五官.*身材.*不套用内置模特.*PoseWear.*骨架/s);
  assert.equal(await evaluate('document.querySelector(".dropzone details").open'), false);
  assert.doesNotMatch(await cardText(), /11-26|妆前|定妆|比例校样/);
  assert.equal(await evaluate(`Boolean(${preview})`), false);
  await pressEnter(stepButton('shoot'));
  await pressEnter('[data-photography-mode=preserve]');
  await pressEnter(stepButton('person'));
  assert.match(await cardText(), /你的照片.*原图.*妆.*表情/s);
  assert.doesNotMatch(await cardText(), /PoseWear|妆前|11-26|比例校样/);
  assert.equal(await evaluate('[...document.querySelectorAll(".dropzone summary, .dropzone a")].some(node => node.checkVisibility())'), false);
  assert.deepEqual(browser.errors, []);
});

test('三姿势固定提交时的人图字节和来源；下批同字节自传也不回退内置身份', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  const resumeBatch = Promise.withResolvers();
  const fixture = await createFixture({ onEdit: () => resumeBatch.promise });
  t.after(() => fixture.close());
  const orders = observeStudioOrders(fixture.app);
  const browser = await openBrowser();
  t.after(() => browser.close());
  const defaultFile = fileURLToPath(new URL('../public/model/posewear-01/model-front.png', import.meta.url));
  const defaultHash = hash('sha256', await readFile(defaultFile));
  const alternateFile = fileURLToPath(new URL('../public/model/posewear-01/face-base.jpg', import.meta.url));
  await browser.goto(`${fixture.base}/#/studio`, 391);
  await browser.click('[aria-label="从衣橱选择第 1 个单品"]');
  await waitFor(() => browser.evaluate('Boolean(document.querySelector("dialog[open] .picker__item"))'), 'wardrobe options');
  await browser.click('dialog[open] .picker__item');
  await waitFor(() => browser.evaluate('document.querySelector(".studio__submit .btn").disabled === false'), 'builtin and garment');
  await browser.click(stepButton('shoot'));
  await browser.click('[data-photography-mode=studio]');
  try {
    await browser.click('.studio__submit .btn');
    await waitFor(() => orders.length === 1, 'first builtin order POST');
    await setStudioPhotoFile(browser, alternateFile);
    assert.equal(await browser.evaluate('document.querySelector("[data-studio-step=person]").disabled && document.querySelector(".dropzone__preview").src.startsWith("data:image/png;")'), true);
    assert.equal(await browser.evaluate('[...document.querySelectorAll(".dropzone summary, .dropzone a")].some(node => node.checkVisibility())'), false);
  } finally {
    resumeBatch.resolve();
  }
  const batchFinished = () => browser.evaluate('document.querySelectorAll(".studio-batch .canvas img").length === 3 && !document.querySelector(".studio__submit .btn").disabled');
  await waitFor(batchFinished, 'builtin batch');
  assert.deepEqual(orders, Array(3).fill({ mode: 'studio', source: 'builtin', hash: defaultHash }));
  await browser.click(stepButton('person'));
  await setStudioPhotoFile(browser, defaultFile);
  await waitFor(() => browser.evaluate('document.querySelector(".dropzone__preview").src.startsWith("data:image/png;") && !document.querySelector(".studio__submit .btn").disabled'), 'uploaded equivalent PNG ready');
  await browser.click(stepButton('shoot'));
  await browser.click('.studio__submit .btn');
  await waitFor(() => orders.length === 6, 'upload batch POSTs');
  await waitFor(batchFinished, 'upload batch');
  assert.deepEqual(orders.slice(3), Array(3).fill({ mode: 'studio', source: 'upload', hash: defaultHash }));
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth'), 391);
});

test('人物文件读取期间不能提交旧人物，连续选择以最后选定的文件为准', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const orders = observeStudioOrders(fixture.app);
  const browser = await openBrowser();
  t.after(() => browser.close());
  const { evaluate, click } = browser;
  const submit = '.studio__submit .btn';
  await browser.goto(`${fixture.base}/#/studio`, 391);
  await click('[aria-label="从衣橱选择第 1 个单品"]');
  await waitFor(() => evaluate('Boolean(document.querySelector("dialog[open] .picker__item"))'), 'wardrobe options');
  await click('dialog[open] .picker__item');
  await waitFor(() => evaluate('!document.querySelector(".studio__submit .btn").disabled'), 'initial person and garment');
  await click(stepButton('shoot'));
  await evaluate(`{
    const read = FileReader.prototype.readAsDataURL;
    const pending = [];
    FileReader.prototype.readAsDataURL = function(file) {
      pending.push(() => new Promise(resolve => { this.addEventListener('loadend', resolve, {once:true}); read.call(this, file); }));
    };
    window.finishPhotoRead = (index) => { FileReader.prototype.readAsDataURL = read; return pending[index]().then(() => true); };
  }`);
  const older = fileURLToPath(new URL('../public/catalog/blouse-linen.jpg', import.meta.url));
  const latest = fileURLToPath(new URL('../public/model/posewear-01/model-front.png', import.meta.url));
  await setStudioPhotoFile(browser, older);
  assert.equal(await evaluate('document.querySelector(".studio__submit .btn").disabled'), true);
  assert.equal(await evaluate('document.querySelector(".dropzone summary").checkVisibility()'), false);
  await click(submit);
  assert.equal(orders.length, 0);
  await setStudioPhotoFile(browser, latest);
  await evaluate('finishPhotoRead(0)');
  assert.equal(await evaluate('document.querySelector(".studio__submit .btn").disabled'), true);
  await evaluate('finishPhotoRead(1)');
  await waitFor(() => evaluate('!document.querySelector(".studio__submit .btn").disabled'), 'latest file ready');
  await click(submit);
  await waitFor(() => evaluate('Boolean(document.querySelector(".result a[download]"))'), 'uploaded photo order');
  assert.deepEqual(orders, [{ mode: 'preserve', source: 'upload', hash: hash('sha256', await readFile(latest)) }]);
});

test('正式前端：原生 Chromium 真实 API 与交互回归', { skip: !chromePath && '未找到已安装 Chromium；可用 TRYON_TEST_CHROME 指向已有浏览器', timeout: 90000 }, async (t) => {
  const fixture = await createFixture();
  const browser = await openBrowser();
  const { base, call, items } = fixture;
  const { evaluate: ev, goto, click, key, fill } = browser;
  const url = (route) => `${base}/#/${route}`;
  const card = (item) => `.wardrobe-card[data-item-id="${item.id}"]`;
  async function wardrobe(width = 1440) {
    await goto(url('wardrobe'), width);
    await waitFor(() => ev('document.querySelectorAll(".wardrobe-card").length > 0'), 'wardrobe cards');
  }
  try {
    await t.test('更多菜单原生键盘、焦点恢复与弹窗背景隔离', async () => {
      await wardrobe();
      const trigger = `${card(items[0])} [aria-haspopup="menu"]`;
      await ev(`document.querySelector(${JSON.stringify(trigger)}).focus()`);
      await key('Enter');
      await waitFor(() => ev('Boolean(document.querySelector(".action-menu:not([hidden])"))'), 'open menu');
      assert.equal(await ev('document.activeElement.textContent'), '编辑单品');
      await key('ArrowDown');
      assert.equal(await ev('document.activeElement.textContent'), '删除单品');
      await key('Escape');
      assert.equal(await ev(`document.activeElement === document.querySelector(${JSON.stringify(trigger)})`), true);
      assert.equal(await ev('document.querySelectorAll(".action-menu:not([hidden])").length'), 0);
      await key('Enter');
      await key('Enter');
      await waitFor(() => ev('Boolean(document.querySelector("dialog[open]"))'), 'edit dialog');
      assert.equal(await ev('document.querySelector("dialog").contains(document.activeElement)'), true);
      assert.equal(await ev('(() => { document.querySelector(".wardrobe-head__actions button").focus(); return document.querySelector("dialog").contains(document.activeElement); })()'), true);
      for (let i = 0; i < 12; i += 1) {
        await key('Tab');
        assert.equal(await ev('document.activeElement === document.body || document.querySelector("dialog").contains(document.activeElement)'), true);
      }
      await ev('document.querySelector("dialog .modal__head button").focus()');
      await key('Escape');
      assert.equal(await ev(`document.activeElement === document.querySelector(${JSON.stringify(trigger)})`), true);
    });

    await t.test('最多五件，点击第六件不改变当前搭配', async () => {
      await wardrobe();
      for (const item of items.slice(0, 5)) await click(`${card(item)} .wardrobe-card__thumb`);
      await click(`${card(items[5])} .wardrobe-card__thumb`);
      assert.equal(await ev('document.querySelectorAll(".wardrobe-card__thumb[aria-pressed=true]").length'), 5);
      assert.match(await ev('document.querySelector(".wardrobe-picks [aria-live]").textContent'), /5 \/ 5/);
      assert.equal(await ev(`document.querySelector(${JSON.stringify(`${card(items[5])} .wardrobe-card__thumb`)}).getAttribute('aria-pressed')`), 'false');
    });

    await t.test('搜索后编辑更新真实持久化条目，删除先确认再移除', async () => {
      await wardrobe();
      await fill('.search-field input', '独特');
      await ev('document.querySelector(".search-field input").focus()');
      await key('Enter');
      await waitFor(() => ev('document.querySelectorAll(".wardrobe-card").length === 1'), 'search result');
      await click(`${card(items[0])} [aria-haspopup="menu"]`);
      await click('.action-menu:not([hidden]) button');
      await waitFor(() => ev('Boolean(document.querySelector("dialog[open] input"))'), 'name field');
      await fill('dialog[open] input', '已经修改的白色衬衫');
      await click('dialog[open] .modal__actions .btn--primary');
      await waitFor(() => ev('!document.querySelector("dialog[open]") && document.querySelectorAll(".wardrobe-card").length === 0 && document.querySelector(".wardrobe-empty__title")?.textContent.includes("没有找到")'), 'renamed item leaves old search');
      assert.equal(await ev('document.activeElement === document.querySelector(".wardrobe-head__actions .btn--primary")'), true);
      const persisted = await call('/api/wardrobe');
      const changed = persisted.payload.items.find((item) => item.id === items[0].id);
      assert.equal(changed.name, '已经修改的白色衬衫');
      assert.equal(changed.imageUrl, items[0].imageUrl);
      const disk = JSON.parse(await readFile(join(fixture.dir, 'wardrobe.json'), 'utf8'));
      assert.equal(disk.items.find((item) => item.id === items[0].id).name, changed.name);
      await fill('.search-field input', '已经修改');
      await ev('document.querySelector(".search-field input").focus()');
      await key('Enter');
      await waitFor(() => ev('document.querySelectorAll(".wardrobe-card").length === 1'), 'new search membership');
      await click(`${card(items[0])} [aria-haspopup="menu"]`);
      await click('.action-menu:not([hidden]) button:last-child');
      assert.equal(await ev('document.activeElement.textContent'), '保留单品');
      await key('Escape');
      assert.equal((await call('/api/wardrobe')).payload.items.length, 6);
      await click(`${card(items[0])} [aria-haspopup="menu"]`);
      await click('.action-menu:not([hidden]) button:last-child');
      await click('dialog[open] .btn--danger');
      await waitFor(async () => !(await call('/api/wardrobe')).payload.items.some((item) => item.id === items[0].id), 'deleted persistent item');
      await waitFor(() => ev('document.querySelectorAll(".wardrobe-card").length === 0'), 'deleted search result removed');
      assert.equal((await call('/api/wardrobe')).payload.items.length, 5);
    });

    await t.test('移动端搭配条可查看和移除，整套交接保留单品信息与人物', async () => {
      await wardrobe(390);
      await click(`${card(items[1])} [aria-haspopup="menu"]`);
      await click('.action-menu:not([hidden]) button');
      await ev('const select = document.querySelector("dialog[open] select:has(option[value=inner])"); select.value = "inner"; select.dispatchEvent(new Event("change", {bubbles:true}))');
      await click('dialog[open] .modal__actions .btn--primary');
      await waitFor(() => ev('!document.querySelector("dialog[open]")'), 'layer saved');
      assert.equal((await call('/api/wardrobe')).payload.items.find(item => item.id === items[1].id).layer, 'inner');
      for (const item of items.slice(1, 3)) await click(`${card(item)} .wardrobe-card__thumb`);
      assert.equal(await ev('document.querySelectorAll(".wardrobe-card__thumb[aria-pressed=true]").length'), 2);
      assert.equal(await ev('document.querySelector(".wardrobe-mobile-actions .btn--primary").disabled'), false);
      const gap = await ev('document.querySelector(".nav").getBoundingClientRect().top - document.querySelector(".wardrobe-mobile-actions").getBoundingClientRect().bottom');
      assert.ok(gap >= 0);
      await click('.wardrobe-mobile-actions .btn--ghost');
      await waitFor(() => ev('Boolean(document.querySelector("dialog[open] .selection-list"))'), 'selection sheet');
      assert.equal(await ev('document.querySelectorAll("dialog[open] .selection-item").length'), 2);
      await key('Escape');
      await click('.wardrobe-mobile-actions .btn--primary');
      await waitFor(() => ev('document.querySelectorAll(".slot").length === 2'), 'studio preset');
      await waitFor(() => ev('document.querySelector(".dropzone__preview")?.naturalWidth > 0'), 'person');
      assert.equal(await ev('location.hash'), '#/studio');
      assert.equal(await ev('document.querySelector(".slot select:has(option[value=inner])").value'), 'inner');
      assert.equal(await ev('[...document.querySelectorAll(".piece__name")].some(n => n.textContent.includes("黑色长裤"))'), true);
      assert.equal(await ev('[...document.querySelectorAll(".piece__thumb img")].every(i => i.getAttribute("src").startsWith("/api/wardrobe/"))'), true);
      assert.equal(await ev('document.querySelector(".studio__submit .btn").disabled'), false);
    });

    await t.test('未生成时显示原图，真实订单成功后才显示与下载 AI 结果', async () => {
      await wardrobe(390);
      for (const item of items.slice(1, 3)) await click(`${card(item)} .wardrobe-card__thumb`);
      await click('.wardrobe-mobile-actions .btn--primary');
      await waitFor(() => ev('document.querySelectorAll(".slot").length === 2 && document.querySelector(".dropzone__preview")?.naturalWidth > 0'), 'generation inputs');
      assert.match(await ev('document.querySelector(".canvas__label")?.textContent || ""'), /原图/);
      await ev('const select = document.querySelector(".slot select:has(option[value=inner])"); select.value = "outer"; select.dispatchEvent(new Event("change", {bubbles:true}))');
      await click('.studio__submit .btn');
      await waitFor(() => ev('Boolean(document.querySelector(".result a[download]"))'), 'generation result');
      assert.match(await ev('document.querySelector(".result .ai-note").textContent'), /AI 生成/);
      assert.match(await ev('document.querySelector(".result a[download]").getAttribute("download")'), /AI生成/);
      const orders = await ev("(async () => { const { api } = await import('/lib/api.js'); return await api('/api/orders'); })()");
      assert.equal(orders.orders.length, 1);
      const persisted = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
      const values = Object.values(persisted.orders);
      assert.equal(values.length, 1);
      assert.equal(values[0].status, 'success');
      assert.equal(values[0].priceCents, 0);
      assert.equal(values[0].pieces.find(piece => piece.slot === 'bottom').layer, 'outer');
      assert.equal((await call('/api/wardrobe')).payload.items.find(item => item.id === items[1].id).layer, 'inner');
    });

    await t.test('工作台切换到无影棚，一键依次生成三个姿势并保留真实订单字段', async () => {
      await wardrobe(390);
      for (const item of items.slice(1, 3)) await click(`${card(item)} .wardrobe-card__thumb`);
      await click('.wardrobe-mobile-actions .btn--primary');
      await waitFor(() => ev('document.querySelectorAll(".slot").length === 2 && document.querySelector(".dropzone__preview")?.naturalWidth > 0'), 'studio inputs');
      await click('[data-photography-mode="studio"]');
      await waitFor(() => ev('Boolean(document.querySelector(".studio-photo__presets"))'), 'studio controls');
      assert.equal(await ev('document.querySelector("[data-photography-mode=studio]").getAttribute("aria-pressed")'), 'true');
      assert.equal(await ev('document.querySelectorAll(".studio-photo__pose").length'), 3);
      assert.equal(await ev('document.querySelectorAll(".studio-photo__pose").length === 3 && [...document.querySelectorAll(".studio-photo__pose img")].every(node => node.getAttribute("src").startsWith("/posewear/"))'), true);
      assert.equal(await ev('document.querySelectorAll(".studio-photo__pose select").length'), 3);
      const selectedPoses = await ev('[...document.querySelectorAll(".studio-photo__pose select")].map((node) => node.value)');
      assert.equal(new Set(selectedPoses).size, 3);
      await ev('const select = document.querySelectorAll(".studio-photo__pose select")[0]; select.value = "duck-sit"; select.dispatchEvent(new Event("change", {bubbles:true}))');
      assert.equal(await ev('document.querySelectorAll(".studio-photo__pose select")[0].value'), 'duck-sit');
      assert.equal(await ev('document.activeElement === document.querySelectorAll(".studio-photo__pose select")[0]'), true);
      const changedPoses = await ev('[...document.querySelectorAll(".studio-photo__pose select")].map((node) => node.value)');
      assert.equal(new Set(changedPoses).size, 3);
      await click('.studio-photo__pose-tools .btn');
      const restoredPoses = await ev('[...document.querySelectorAll(".studio-photo__pose select")].map((node) => node.value)');
      assert.deepEqual(restoredPoses, ['contrapposto', 'hand-behind-head', 'over-shoulder']);
      assert.equal(await ev('document.querySelector("[data-photography-mode=studio]").disabled'), false);
      assert.equal(await ev('document.querySelector(".studio__submit .btn").textContent.includes("3 个姿势")'), true);
      await click('.studio__submit .btn');
      assert.equal(await ev('document.querySelector("[data-photography-mode=preserve]").disabled'), true);
      assert.equal(await ev('document.querySelector("#studio-preset").disabled'), true);
      await waitFor(() => ev('document.querySelectorAll(".studio-batch .canvas img").length === 3'), 'three studio results', 15000);
      assert.equal(await ev('document.querySelectorAll(".studio-batch .canvas img").length'), 3);
      await waitFor(() => ev('document.querySelector(".studio__submit .btn").disabled === false'), 'studio submit re-enabled');
      assert.equal(await ev('document.querySelector(".studio__submit .btn").textContent'), '生成 3 个姿势');
      assert.equal(await ev('document.querySelector(".result").textContent.includes("null")'), false);
      assert.equal(await ev('document.querySelector(".studio__preview [role=status]").textContent.includes("已完成")'), true);
      assert.equal(await ev('(() => { const result = document.querySelector(".result"); const rect = result.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0; })()'), true);
      const sessionId = await ev('localStorage.getItem("tryon.sessionId")');
      const orders = (await call('/api/orders', 'GET', undefined, { 'x-session-id': sessionId })).payload.orders;
      assert.equal(orders.length >= 3, true);
      const studioOrders = orders.filter((order) => order.photographyMode === 'studio');
      assert.equal(studioOrders.length, 3);
      assert.equal(new Set(studioOrders.map((order) => order.posePreset)).size, 3);
      assert.equal(studioOrders.every((order) => order.studioPreset === 'clean-white-seamless'), true);
      const persisted = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
      assert.equal(persisted.orders.filter((order) => order.photographyMode === 'studio').length, 3);
      const state = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
      assert.equal(Object.values(state.orders).filter((order) => order.photographyMode === 'studio').every((order) => ['contrapposto', 'hand-behind-head', 'over-shoulder'].includes(order.posePreset)), true);
    });

    await t.test('普通试穿结果标签页保持焦点并支持方向键切换', async () => {
      await wardrobe(1440);
      for (const item of items.slice(1, 3)) await click(`${card(item)} .wardrobe-card__thumb`);
      await click('.wardrobe-aside .btn--primary');
      await waitFor(() => ev('document.querySelectorAll(".slot").length === 2 && document.querySelector(".dropzone__preview")?.naturalWidth > 0'), 'tab inputs');
      await click('.studio__submit .btn');
      await waitFor(() => ev('Boolean(document.querySelector("[role=tab]"))'), 'result tabs');
      await click('#result-tab-original');
      assert.equal(await ev('document.activeElement.id'), 'result-tab-original');
      await key('ArrowRight', 'ArrowRight');
      assert.equal(await ev('document.activeElement.id'), 'result-tab-compare');
      assert.equal(await ev('document.querySelector("#result-tab-compare").getAttribute("aria-selected")'), 'true');
      assert.equal(await ev('document.querySelector("#result-tabpanel").getAttribute("aria-labelledby")'), 'result-tab-compare');
    });

    await t.test('工作台从衣橱选择使用原生弹窗，选中后返回对应条目', async () => {
      await goto(url('studio'), 390);
      await waitFor(() => ev('Boolean(document.querySelector(".slot .inline-field"))'), 'piece controls');
      await click('.slot button[aria-label*="从衣橱选择"]');
      await waitFor(() => ev('document.querySelectorAll("dialog[open] .picker__item").length === 5'), 'native picker');
      const bounds = await ev('(() => { const r = document.querySelector("dialog[open]").getBoundingClientRect(); return {left:r.left,right:r.right,bottom:r.bottom}; })()');
      assert.ok(bounds.left >= 0 && bounds.right <= 390 && bounds.bottom <= 844);
      await click('dialog[open] .picker__item');
      await waitFor(() => ev('!document.querySelector("dialog[open]") && Boolean(document.querySelector(".piece__thumb img"))'), 'picker applied');
      assert.equal(await ev('document.activeElement.tagName'), 'SUMMARY');
      assert.equal(await ev('document.querySelector(".piece__thumb img").getAttribute("src").startsWith("/api/wardrobe/")'), true);
    });

    await t.test('导入失败保留链接，Escape 关闭后恢复入口焦点', async () => {
      await wardrobe(390);
      await click('.wardrobe-head__actions .btn');
      await fill('dialog[open] textarea', 'https://unsupported.example/item/1');
      await click('dialog[open] .modal__content > .btn');
      await waitFor(() => ev('!document.querySelector("dialog[open] .error-text").hidden'), 'import error');
      assert.equal(await ev('document.querySelector("dialog[open] textarea").value'), 'https://unsupported.example/item/1');
      assert.equal(await ev('document.querySelector("dialog[open] .modal__actions .btn--primary").disabled'), true);
      await key('Escape');
      assert.equal(await ev('document.activeElement.textContent.includes("链接导入")'), true);
    });

    await t.test('四档布局与所有正式导航页面无溢出、无脚本异常', async () => {
      for (const width of [1440, 1024, 768, 390]) {
        for (const route of ['home', 'studio', 'wardrobe', 'settings', 'me', 'shop']) {
          await goto(url(route), width);
          await waitFor(() => ev('Boolean(document.querySelector("h1"))'), route);
          assert.equal(await ev('document.documentElement.scrollWidth <= innerWidth'), true, `${route} @ ${width}`);
          assert.equal(await ev('document.querySelectorAll("h1").length'), 1, `${route} heading`);
        }
      }
      assert.deepEqual(browser.errors, []);
    });
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test('单张棚拍：旧计费设置下，零余额也可用所选模型免费生成 P063 一单一图', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  const model = 'workbuddy/hunyuan-image-alpha';
  const resume = Promise.withResolvers();
  const edit = t.mock.fn(() => resume.promise);
  const fixture = await createFixture({ models: [MODEL, 'minimax-code/MiniMax-Image', model], env: { DEMO_MODE: '0' }, onEdit: edit });
  t.after(() => fixture.close());
  const posts = observeStudioOrders(fixture.app);
  const browser = await openBrowser();
  t.after(() => browser.close());
  assert.equal((await fixture.call('/api/settings', 'PATCH', { model })).status, 200);
  const { models } = (await fixture.call('/api/config')).payload;
  const [tier] = models.find(({ id }) => id === model).tiers;
  const { click, evaluate } = browser;
  await browser.goto(`${fixture.base}/#/studio`, 390);
  await pickTrialGarment(browser);
  await click('[data-photography-mode=studio]');
  assert.match(await evaluate(`${trialNode}?.innerText ?? ''`), /只试拍/, '棚拍模式须有独立的只试拍入口');
  assert.match(await evaluate('document.querySelector(".studio__submit .btn").innerText'), /3 个姿势/);
  await evaluate(`{ const first = document.querySelector('[aria-label="第 1 个姿势"]'); first.value = 'crouch-chin'; first.dispatchEvent(new Event('change', { bubbles: true })); }`);
  assert.match(await evaluate('document.querySelector(".studio-photo__pose select").selectedOptions[0].textContent'), /P063/);
  const copy = await evaluate('document.querySelector(".studio__submit-card").innerText');
  assert.match(copy, /蹲姿托腮|P063/);
  assert.doesNotMatch(copy, /¥|￥|余额|充值|扣费/);
  assert.deepEqual(await evaluate(shootLocks), [false, false]);
  const sessionId = await evaluate('localStorage.getItem("tryon.sessionId")');
  const { balanceCents } = (await fixture.call(`/api/session/${sessionId}`)).payload;
  try {
    await evaluate(`window.addEventListener('click', () => { window.atTrialClick = ${shootLocks}; }, { once: true })`);
    await click(trialButton);
    assert.deepEqual(await evaluate('window.atTrialClick'), [true, true], '启动当下即锁定单张与连拍，不等建单响应');
    await waitFor(() => edit.mock.callCount() > 0, 'local image edit');
    assert.deepEqual(await evaluate(shootLocks), [true, true]);
    assert.match(await evaluate('document.querySelector(".result").innerText'), /0\s*\/\s*1\s*张/);
    await click(trialButton);
    await click('.studio__submit .btn');
  } finally {
    resume.resolve();
  }
  await assertTrialResult(browser, fixture, { sessionId, model, tier: tier.id, priceCents: 0 }, balanceCents);
  assert.equal(posts.length, 1, '忙时重复点击不能再发建单请求');
  assert.equal(edit.mock.callCount(), 1);
  const [form] = edit.mock.calls[0].arguments;
  assert.equal(form.get('n'), '1');
  const pose = form.getAll('image[]').at(-1);
  assert.equal(hash('sha256', new Uint8Array(await pose.arrayBuffer())), hash('sha256', await readFile(new URL('../public/posewear/P063.webp', import.meta.url))));
});

test('单张棚拍：普通模式无入口，缺单品或读图中不能提交', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const browser = await openBrowser();
  t.after(() => browser.close());
  const posts = observeStudioOrders(fixture.app);
  const { click, evaluate } = browser;
  const visible = () => evaluate(`${trialNode}?.checkVisibility() ?? false`);
  await browser.goto(`${fixture.base}/#/studio`, 390);
  await waitFor(() => evaluate('document.querySelector(".dropzone__preview")?.naturalWidth > 0'), 'default person');
  await click(stepButton('shoot'));
  await click('[data-photography-mode=studio]');
  assert.equal(await evaluate(`!${trialNode}?.checkVisibility() || ${trialNode}.disabled`), true, '未选衣不能试拍');
  await pickTrialGarment(browser);
  assert.equal(await visible(), true, '有可用人物和单品时，棚拍模式展示只试拍');
  assert.doesNotMatch(await evaluate(`${trialNode}.innerText`), /[¥￥]/u, '演示试拍按钮不显示金额');
  assert.doesNotMatch(await evaluate('document.querySelector(".studio__submit-card").innerText'), /[¥￥]/u, '演示生成区不显示金额');
  await click('[data-photography-mode=preserve]');
  assert.equal(await visible(), false, '已备好人物与单品，普通换装仍不展示试拍');
  await click('[data-photography-mode=studio]');
  assert.deepEqual(await evaluate(shootLocks), [false, false]);
  const finishRead = await holdNextStudioRead(browser);
  await setStudioPhotoFile(browser, fileURLToPath(new URL('../public/catalog/blouse-linen.jpg', import.meta.url)));
  assert.deepEqual(await evaluate(shootLocks), [true, true], '旧图不能在读取替换照片时用于任何提交');
  await click(trialButton);
  await click('.studio__submit .btn');
  assert.equal(await finishRead(), null);
  await waitFor(() => evaluate('document.querySelector(".dropzone__preview").currentSrc.startsWith("data:image/jpeg;")'), 'new portrait ready');
  assert.deepEqual(await evaluate(shootLocks), [false, false]);
  assert.equal(posts.length, 0, '不可用操作不得发出建单请求');
});

test('单张棚拍：替换衣图读取失败后仍锁住两种拍摄，直到重选或删除错误项', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  const { browser, fixture, posts } = await openReadyTrial(t);
  const { click, evaluate } = browser;
  const firstInput = '.slot:first-child input[type=file]';
  const failReplacement = async () => {
    const file = join(fixture.dir, 'unreadable.png');
    await writeFile(file, imageBytes);
    await click(stepButton('pieces'));
    await click('.slot:first-child summary.piece');
    const finishRead = await holdNextStudioRead(browser);
    await setStudioPhotoFile(browser, file, firstInput);
    assert.deepEqual(await evaluate(shootLocks), [true, true], '替换衣图读取中不能提交旧图');
    await rm(file);
    assert.match(await finishRead(), /^(?:NotFound|NotReadable)Error$/, 'Chromium 应在读取已删除的文件时报告错误');
    await assertCannotShoot(browser, posts, 'FileReader 报错后不能提交上一件衣图');
  };
  await failReplacement();
  assert.match(await evaluate('document.querySelector(".slot:first-child").innerText'), /读取图片失败/);
  const submitHint = 'document.querySelector(".studio__submit-card").innerText';
  assert.doesNotMatch(await evaluate(submitHint), /移除该单品/, '仅剩一件时不提示不可用的删除操作');
  await click('[aria-label="添加一个单品条目"]');
  await click('[aria-label="从衣橱选择第 2 个单品"]');
  const pants = 'dialog[open] [aria-label="选择黑色长裤"]';
  await waitFor(() => evaluate(`Boolean(document.querySelector(${JSON.stringify(pants)}))`), 'wardrobe pants');
  await click(pants);
  assert.equal(await evaluate('document.querySelector(".slot:nth-child(2) .piece__name").innerText'), '黑色长裤');
  await assertCannotShoot(browser, posts, '第二件有效也不能跳过第一件的读图错误');
  assert.match(await evaluate(submitHint), /移除该单品/, '有其它条目时说明可以删除失败项');
  await setStudioPhotoFile(browser, fileURLToPath(new URL('../public/catalog/blouse-linen.jpg', import.meta.url)), firstInput);
  await waitFor(() => evaluate('document.querySelector(".slot:first-child .piece__thumb img")?.currentSrc.startsWith("data:image/jpeg;")'), 'new uploaded garment');
  assert.deepEqual(await evaluate(shootLocks), [false, false], '重新选好有效衣图后允许拍摄');
  await failReplacement();
  await click('[aria-label="删除第 1 个单品"]');
  assert.deepEqual(await evaluate(shootLocks), [false, false], '主动删除错误项后允许用剩下的单品拍摄');
  await click(stepButton('shoot'));
  await click(trialButton);
  await waitFor(() => evaluate('Boolean(document.querySelector(".result a[download]"))'), 'remaining garment trial');
  const { orders } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
  assert.deepEqual(orders.map(order => order.pieces.map(piece => piece.name)), [['黑色长裤']]);
});

test('单张棚拍：非法人物替换使已有照片和稍后读完的旧照片都不能下单', { skip: !chromePath && '未找到已安装 Chromium', timeout: 30000 }, async (t) => {
  const { browser, posts } = await openReadyTrial(t);
  const portrait = fileURLToPath(new URL('../public/model/posewear-01/face-base.jpg', import.meta.url));
  const invalid = fileURLToPath(new URL('../public/posewear/README.md', import.meta.url));
  const assertInvalidPerson = async (reason) => {
    await assertCannotShoot(browser, posts, reason);
    await browser.click(stepButton('person'));
    assert.equal(await browser.evaluate('document.querySelector(".dropzone__preview").checkVisibility()'), false, reason);
    assert.match(await browser.evaluate('document.querySelector(".dropzone").innerText'), /只支持.*PNG.*JPEG.*WebP/);
  };
  await setStudioPhotoFile(browser, portrait);
  await waitFor(() => browser.evaluate('document.querySelector(".dropzone__preview").currentSrc.startsWith("data:image/jpeg;")'), 'uploaded portrait ready');
  assert.deepEqual(await browser.evaluate(shootLocks), [false, false]);
  await setStudioPhotoFile(browser, invalid);
  await assertInvalidPerson('拒绝新文件后不能使用已读好的旧人像');
  const finishRead = await holdNextStudioRead(browser);
  await setStudioPhotoFile(browser, portrait);
  await setStudioPhotoFile(browser, invalid);
  assert.equal(await finishRead(), null, '旧人像在非法文件被选中之后才读完');
  await assertInvalidPerson('旧读取成功也不能覆盖最近的非法选择');
});

test('衣橱 AI 选搭可直接交接无影棚模式', { skip: !chromePath && '未找到已安装 Chromium；可用 TRYON_TEST_CHROME 指向已有浏览器', timeout: 30000 }, async () => {
  const fixture = await createFixture();
  const browser = await openBrowser();
  try {
    await browser.goto(`${fixture.base}/#/wardrobe`, 390);
    await waitFor(() => browser.evaluate('document.querySelectorAll(".wardrobe-card").length > 0'), 'wardrobe');
    await browser.fill('.stylist .inline-field input', '明天通勤');
    await browser.click('.stylist .inline-field .btn');
    await waitFor(() => browser.evaluate('[...document.querySelectorAll(".stylist__order button")].find((button) => button.textContent === "去无影棚拍 3 张")?.disabled === false'), 'studio handoff');
    await browser.evaluate('[...document.querySelectorAll(".stylist__order button")].find((button) => button.textContent === "去无影棚拍 3 张").click()');
    await waitFor(() => browser.evaluate('location.hash === "#/studio" && Boolean(document.querySelector(".studio"))'), 'studio route');
    await waitFor(() => browser.evaluate('location.hash === "#/studio" && document.querySelector("[data-photography-mode=studio]")?.getAttribute("aria-pressed") === "true"'), 'studio preset');
    assert.equal(await browser.evaluate('document.querySelector(".studio__submit .btn").textContent.includes("3 个姿势")'), true);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test('设置只展示网关通用图像模型，不访问已撤销的工作流探测', { skip: !chromePath, timeout: 30000 }, async t => {
  const alternate = 'workbuddy/hunyuan-image-alpha';
  const fixture = await createFixture({ models: [MODEL, alternate] }); t.after(() => fixture.close());
  const requested = []; fixture.app.on('request', request => requested.push(request.url));
  const browser = await openBrowser(); t.after(() => browser.close());
  await browser.goto(`${fixture.base}/#/settings`, 390);
  await waitFor(() => browser.evaluate('!document.querySelector(".settings .capsule-trigger").disabled'), 'models ready');
  await browser.click('.settings .capsule-trigger');
  assert.equal(await browser.evaluate(`Boolean(document.querySelector('[data-value="${alternate}"]'))`), true);
  assert.doesNotMatch(await browser.evaluate('document.querySelector(".settings").textContent'), /IDM|ComfyUI|试穿 LoRA/i);
  assert.equal(requested.some(url => url.startsWith('/api/workflows')), false);
});

for (const inFlight of [false, true]) {
  test(`工作台处理迟到模型设置，${inFlight ? '已开始的三张仍按原模型完成' : '下一次使用新图像模型而不改变拍摄方式'}`, { skip: !chromePath, timeout: 30000 }, async t => {
    const finishImage = Promise.withResolvers();
    const alternate = 'workbuddy/hunyuan-image-alpha';
    const fixture = await createFixture({ models: [MODEL, alternate], onEdit: () => finishImage.promise });
    t.after(() => fixture.close());
    const browser = await openBrowser();
    t.after(() => browser.close());
    const posts = observeStudioOrders(fixture.app);
    await browser.goto(`${fixture.base}/#/settings`);
    await waitFor(() => browser.evaluate('!document.querySelector(".settings .capsule-trigger").disabled'), 'model selection ready');
    const patch = await holdResponse(browser, '/api/settings', 'PATCH');
    await browser.click('.settings .capsule-trigger');
    await browser.click(`[data-value="${alternate}"]`);
    await patch.ready();
    assert.equal((await fixture.call('/api/settings')).payload.model, alternate);
    await browser.click('.nav [data-route=studio]');
    await waitFor(() => browser.evaluate('Boolean(document.querySelector(".studio"))'), 'studio route');
    await pickTrialGarment(browser);
    await browser.click('[data-photography-mode=studio]');
    assert.equal(await browser.evaluate('document.querySelectorAll(".studio-photo__pose").length'), 3);
    try {
      if (inFlight) {
        await browser.click('.studio__submit .btn');
        await waitFor(() => posts.length === 1, 'first shot submitted');
      }
      await patch.release();
      await waitFor(() => browser.evaluate('document.querySelector("#toast").innerText === "模型已切换"'), 'model response consumed');
      if (inFlight) assert.match(await browser.evaluate('document.querySelector(".studio__submit .btn").textContent'), /1\/3/);
    } finally { finishImage.resolve(); }
    if (inFlight) {
      await waitFor(() => browser.evaluate('!document.querySelector(".studio__submit .btn").disabled'), 'batch completed');
      const { orders } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
      assert.deepEqual(orders.map(order => [order.model, order.photographyMode, order.status]), Array(3).fill([MODEL, 'studio', 'success']));
      assert.equal(await browser.evaluate('document.querySelectorAll(".studio-batch a[download]").length'), 3);
      await browser.click(stepButton('shoot'));
    }
    assert.deepEqual(await browser.evaluate(`[document.querySelector('[data-photography-mode=preserve]').getAttribute('aria-pressed'),
      document.querySelector('[data-photography-mode=studio]').getAttribute('aria-pressed'), document.querySelector('[data-photography-mode=studio]').disabled,
      document.querySelectorAll('.studio-photo__pose').length, document.querySelector('.studio__trial').checkVisibility(), document.querySelector('.studio__submit .btn').textContent]`),
    ['false', 'true', false, 3, true, '生成 3 个姿势']);
    await browser.click(trialButton);
    await waitFor(() => browser.evaluate('Boolean(document.querySelector(".studio-batch a[download]"))'), 'next single studio result');
    const { orders } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
    assert.ok(orders.some(order => order.model === alternate && order.photographyMode === 'studio'));
  });
}

test('工作台编辑商品链接立即清除旧缩略图，迟到解析不能覆盖新链接', { skip: !chromePath, timeout: 30000 }, async t => {
  function sourceFetch(url) {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'img14.360buyimg.com') return Promise.resolve(new Response(imageBytes, { headers: { 'content-type': 'image/png' } }));
    assert.equal(hostname, 'item.m.jd.com');
    const sku = pathname.match(/(\d+)\.html$/)[1];
    const item = { skuName: `上衣 ${sku}`, image: [`jfs/${sku}.png`] };
    return Promise.resolve(new Response(`<script>window._itemOnly = (${JSON.stringify({ item })});</script>`, { headers: { 'content-type': 'text/html' } }));
  }
  const fixture = await createFixture({ sourceFetch });
  t.after(() => fixture.close());
  const browser = await openBrowser();
  t.after(() => browser.close());
  await browser.goto(`${fixture.base}/#/studio`);
  await browser.click('[aria-label="用商品链接添加第 1 个单品"]');
  const input = '.slot__body input';
  const parse = '.slot__body [type=submit]';
  const currentImage = () => browser.evaluate('document.querySelector(".slot__body .picker__item img")?.getAttribute("src") ?? null');
  const url = sku => `https://item.jd.com/${sku}.html`;
  await browser.fill(input, url('100001'));
  await browser.click(parse);
  await waitFor(currentImage, 'first parsed source');
  await browser.fill(input, url('100002'));
  assert.equal(await currentImage(), null);
  const delayed = await holdResponse(browser, '/api/sources', 'POST');
  await browser.click(parse);
  await delayed.ready();
  assert.equal(await browser.evaluate('document.querySelector(".slot__body input").disabled'), false);
  await browser.fill(input, url('100003'));
  await browser.click(parse);
  await waitFor(currentImage, 'latest parsed source');
  const image = await currentImage();
  await delayed.release();
  await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await currentImage(), image);
  await browser.click('.slot__body .picker__item');
  assert.equal(await browser.evaluate('document.querySelector(".slot .piece__name").innerText'), '上衣 100003');
  await browser.click(stepButton('shoot'));
  await browser.click('.studio__submit .btn');
  await waitFor(() => browser.evaluate('Boolean(document.querySelector(".result a[download]"))'), 'order with latest import');
  const { orders } = JSON.parse(await readFile(join(fixture.dir, 'state.json'), 'utf8'));
  assert.deepEqual(orders.map(order => order.pieces.map(piece => piece.name)), [['上衣 100003']]);
});
