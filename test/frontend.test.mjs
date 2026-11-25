import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createApp } from '../src/app.mjs';
import { createSourceService } from '../src/source.mjs';
import { createStore } from '../src/store.mjs';
import { createTryonService } from '../src/tryon.mjs';
import { createWardrobe } from '../src/wardrobe.mjs';
import { chromePath, openBrowser, waitFor } from './helpers/browser.mjs';

const MODEL = 'codex/gpt-image-2.5';
const imageBytes = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(8192)]);

async function createFixture({ models = [MODEL], env: envOverrides = {} } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tryon-frontend-'));
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({ products: [] }));
  const env = { IMAGE_API_BASE_URL: 'http://127.0.0.1:3425/v1', IMAGE_MODEL: MODEL, DEMO_MODE: '1', ...envOverrides };
  const fetchImpl = async (url) => new Response(JSON.stringify(String(url).endsWith('/models')
    ? { data: models.map((id) => ({ id, modalities: { output: ['image'] } })) }
    : { data: [{ b64_json: imageBytes.toString('base64'), mime_type: 'image/png' }] }), { headers: { 'content-type': 'application/json' } });
  const store = createStore({ dir, catalogFile: join(dir, 'catalog.json') });
  await store.ready();
  const sources = createSourceService({ runCli: null, fetchImpl, settleMs: 0 });
  const wardrobe = createWardrobe({ dir, env, fetchImpl, sources, captioner: async () => '' });
  const tryon = createTryonService({ store, env, fetchImpl, resultsDir: join(dir, 'results') });
  const app = createApp({
    env,
    store,
    sources,
    wardrobe,
    tryon,
    fetchImpl,
    stylist: {
      suggestByRule: async () => {
        const items = (await wardrobe.list()) ?? [];
        return {
          slots: {
            top: items.find((item) => item.category === 'top') ?? null,
            bottom: items.find((item) => item.category === 'bottom') ?? null,
          },
          reason: '按通勤场景选择',
          missing: [],
        };
      },
      suggest: async () => {
        const payload = await wardrobe.list();
        const items = payload ?? [];
        return {
          slots: {
            top: items.find((item) => item.category === 'top') ?? null,
            bottom: items.find((item) => item.category === 'bottom') ?? null,
          },
          reason: '按通勤场景选择',
          missing: [],
        };
      },
    },
    login: {},
    resultsDir: join(dir, 'results'),
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path, method = 'GET', body, extraHeaders = {}) {
    const response = await fetch(base + path, { method, headers: { origin: base, 'content-type': 'application/json', ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, payload: text ? JSON.parse(text) : null };
  }
  const items = [];
  for (const [name, category, subtype] of [['独特白色衬衫', 'top', '衬衫'], ['黑色长裤', 'bottom', '牛仔裤'], ['短外套', 'outer', '夹克'], ['吊带连衣裙', 'dress', '吊带裙'], ['白色运动鞋', 'shoes', '运动鞋'], ['细项链', 'accessory', '项链']]) {
    const response = await call('/api/wardrobe', 'POST', { name, category, subtype, image: `data:image/png;base64,${imageBytes.toString('base64')}` });
    assert.equal(response.status, 201);
    items.push(response.payload.item);
  }
  await call('/api/outfit/suggest', 'POST', { request: '测试' });
  return { dir, app, base, call, items, async close() { await new Promise((resolve) => app.close(resolve)); await rm(dir, { recursive: true, force: true }); } };
}

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
      await click('.slot .inline-field .btn:nth-child(2)');
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
        for (const route of ['studio', 'wardrobe', 'settings', 'me', 'shop']) {
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

test('IDM 或拼图工作流从衣橱交接时不会伪装进入无影棚模式', { skip: !chromePath && '未找到已安装 Chromium；可用 TRYON_TEST_CHROME 指向已有浏览器', timeout: 30000 }, async () => {
  const fixture = await createFixture({ models: [MODEL, 'idm/idm-vton'] });
  const browser = await openBrowser();
  try {
    const settings = await fixture.call('/api/settings', 'PATCH', { model: 'idm/idm-vton' });
    assert.equal(settings.status, 200);
    await browser.goto(`${fixture.base}/#/wardrobe`, 390);
    await waitFor(() => browser.evaluate('document.querySelectorAll(".wardrobe-card").length > 0'), 'wardrobe');
    await browser.fill('.stylist .inline-field input', '明天通勤');
    await browser.click('.stylist .inline-field .btn');
    await waitFor(() => browser.evaluate('[...document.querySelectorAll(".stylist__order button")].find((button) => button.textContent === "去无影棚拍 3 张")?.disabled === false'), 'studio handoff');
    await browser.evaluate('[...document.querySelectorAll(".stylist__order button")].find((button) => button.textContent === "去无影棚拍 3 张").click()');
    assert.equal(await browser.evaluate('location.hash'), '#/wardrobe');
    assert.match(await browser.evaluate('document.querySelector(".toast")?.textContent ?? ""'), /不支持无影棚/);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
