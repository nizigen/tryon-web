import assert from 'node:assert/strict';
import test from 'node:test';

import { createSourceService, locateOpenCli, originalImageUrl } from '../src/source.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** 真实商品图远大于 4KiB；这里补零把测试图撑过占位图阈值。 */
const PNG_BYTES = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(8192)]);

function imageResponse(bytes = PNG_BYTES) {
  return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
}

/** 假的 OpenCLI：记录调用，按 eval 脚本区分平台返回。 */
function makeRunner({ taobao, pdd, jd } = {}) {
  const calls = [];
  const runCli = async (args) => {
    calls.push(args);
    if (args[0] === 'browser' && args[3] === 'eval') {
      const js = args[4];
      if (js.includes('rawData')) return { ok: true, data: JSON.stringify(pdd) };
      return { ok: true, data: JSON.stringify(taobao) };
    }
    if (args[0] === 'jd') return { ok: true, data: [jd] };
    return { ok: true, data: { url: 'about:blank' } };
  };
  return { runCli, calls };
}

test('归一化：三家都把尺寸/格式后缀剥成原图', () => {
  assert.equal(
    originalImageUrl('https://img.alicdn.com/imgextra/i1/1099675835/O1CN01NnqqeI1syU8MPPYKX_!!1099675835.jpg_760x760q30.jpg_.webp', 'taobao'),
    'https://img.alicdn.com/imgextra/i1/1099675835/O1CN01NnqqeI1syU8MPPYKX_!!1099675835.jpg',
  );
  assert.equal(
    originalImageUrl('https://img10.360buyimg.com/s320x320_jfs/t1/568823/38/14641/162233/6afec45bF120b1b0d/00834655dcf42538.jpg.avif', 'jd'),
    'https://img10.360buyimg.com/jfs/t1/568823/38/14641/162233/6afec45bF120b1b0d/00834655dcf42538.jpg',
  );
  assert.equal(
    originalImageUrl('https://img.pddpic.com/mms-material-img/2026-04-11/af1a3201.jpeg?imageMogr2/quality/90/thumbnail/1300x9999%3E', 'pdd'),
    'https://img.pddpic.com/mms-material-img/2026-04-11/af1a3201.jpeg',
  );
});

test('淘宝链接：按 DOM 分组解析，并丢掉非白名单主机的图片', async () => {
  const { runCli } = makeRunner({
    taobao: {
      title: '测试衬衫',
      images: [
        { url: 'https://img.alicdn.com/a.jpg_760x760q30.jpg_.webp', group: 'main' },
        { url: 'https://img.alicdn.com/a.jpg', group: 'thumb' },
        { url: 'https://img.alicdn.com/b.jpg', group: 'sku' },
      ],
    },
  });
  const sources = createSourceService({ runCli, settleMs: 0 });
  const source = await sources.create('https://item.taobao.com/item.htm?id=862667630822');
  assert.equal(source.platform, 'taobao');
  assert.equal(source.title, '测试衬衫');
  assert.deepEqual(source.images.map((image) => image.url), ['https://img.alicdn.com/a.jpg', 'https://img.alicdn.com/b.jpg']);
  assert.deepEqual(source.images.map((image) => image.group), ['main', 'sku']);
});

test('拼多多链接：读 rawData 的 topGallery / detailGallery / skus', async () => {
  const { runCli } = makeRunner({
    pdd: {
      title: '测试格裙',
      images: [
        { url: 'https://img.pddpic.com/top.jpeg?imageMogr2/quality/90', group: 'main' },
        { url: 'https://img.pddpic.com/detail.jpeg', group: 'detail' },
        { url: 'https://img.pddpic.com/top.jpeg?imageMogr2/quality/90', group: 'main' },
      ],
    },
  });
  const sources = createSourceService({ runCli, settleMs: 0 });
  const source = await sources.create('https://mobile.yangkeduo.com/goods.html?goods_id=933206308326');
  assert.equal(source.platform, 'pdd');
  assert.deepEqual(source.images.map((image) => image.url), ['https://img.pddpic.com/top.jpeg', 'https://img.pddpic.com/detail.jpeg']);
});

test('京东链接：直连失败时回退到 jd item，main + detail 合并', async () => {
  const { runCli } = makeRunner({
    jd: {
      title: '测试商品',
      mainImages: ['https://img10.360buyimg.com/jfs/main.jpg.avif'],
      detailImages: ['https://img30.360buyimg.com/sku/jfs/detail.jpg'],
    },
  });
  const sources = createSourceService({ runCli, settleMs: 0, fetchImpl: async () => { throw new Error('offline'); } });
  const source = await sources.create('https://item.jd.com/100012043978.html');
  assert.equal(source.platform, 'jd');
  assert.deepEqual(source.images.map((image) => image.url), ['https://img10.360buyimg.com/jfs/main.jpg', 'https://img30.360buyimg.com/sku/jfs/detail.jpg']);
});

test('京东链接：直连手机页解析 window._itemOnly（不需要 OpenCLI）', async () => {
  const item = {
    skuName: '直连测试商品',
    image: ['jfs/t1/a/1/a.jpg', 'jfs/t1/b/2/b.jpg'],
    newColorSize: [{ imagePath: 'jfs/t1/c/3/c.png' }],
  };
  const html = `<script>window._itemOnly = (${JSON.stringify({ item })});</script>`;
  const sources = createSourceService({ settleMs: 0, runCli: null, cookies: {}, fetchImpl: async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => html }) });
  const source = await sources.create('https://item.jd.com/100012043978.html');
  assert.equal(source.title, '直连测试商品');
  assert.deepEqual(source.images.map((image) => image.url), [
    'https://img14.360buyimg.com/n0/jfs/t1/a/1/a.jpg',
    'https://img14.360buyimg.com/n0/jfs/t1/b/2/b.jpg',
    'https://img14.360buyimg.com/n0/jfs/t1/c/3/c.png',
  ]);
});

test('拼多多链接：需要登录 cookie 时给出可操作错误', async () => {
  const html = `<script>window.rawData = ${JSON.stringify({ store: { initDataObj: { needLogin: true } } })};</script>`;
  const sources = createSourceService({ settleMs: 0, cookies: {}, runCli: null, fetchImpl: async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => html }) });
  await assert.rejects(() => sources.create('https://mobile.yangkeduo.com/goods1.html?goods_id=845720245931'), (error) => error.code === 'SOURCE_UNAVAILABLE' && /pdd cookie/.test(error.message));
});

test('拼多多链接：带 cookie 直连解析 rawData 的 topGallery/detailGallery', async () => {
  const goods = {
    goodsName: '拼多多直连商品',
    topGallery: [{ url: 'https://img.pddpic.com/a.jpeg?imageMogr2/quality/90' }, { url: 'https://img.pddpic.com/b.jpeg' }],
    detailGallery: [{ url: 'https://img.pddpic.com/c.jpeg' }],
    skus: [{ thumbUrl: null }],
  };
  const html = `<script>window.rawData = ${JSON.stringify({ store: { initDataObj: { needLogin: false, goods } } })};</script>`;
  const sources = createSourceService({ settleMs: 0, cookies: { pdd: 'PASS_ID=1' }, fetchImpl: async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => html }) });
  const source = await sources.create('https://mobile.yangkeduo.com/goods1.html?goods_id=845720245931');
  assert.equal(source.title, '拼多多直连商品');
  assert.deepEqual(source.images.map((image) => image.url), ['https://img.pddpic.com/a.jpeg', 'https://img.pddpic.com/b.jpeg', 'https://img.pddpic.com/c.jpeg']);
});

test('不支持的平台与缺少商品 ID 都被拒绝', async () => {
  const sources = createSourceService({ runCli: async () => ({ ok: true, data: '{}' }), settleMs: 0 });
  await assert.rejects(() => sources.create('https://www.amazon.com/dp/B0001'), { code: 'UNSUPPORTED_PLATFORM' });
  await assert.rejects(() => sources.create('https://item.taobao.com/item.htm'), { code: 'INVALID_URL' });
  await assert.rejects(() => sources.create('not a url'), { code: 'INVALID_URL' });
  await assert.rejects(() => sources.create('javascript:alert(1)'), { code: 'INVALID_URL' });
});

test('非白名单图片主机被丢弃，全丢完报 NO_IMAGES', async () => {
  const { runCli } = makeRunner({
    taobao: { title: 'x', images: [{ url: 'https://evil.example.com/a.jpg', group: 'main' }] },
  });
  const sources = createSourceService({ runCli, settleMs: 0 });
  await assert.rejects(() => sources.create('https://item.taobao.com/item.htm?id=1'), { code: 'NO_IMAGES' });
});

test('下载只走白名单主机，非图片内容被拒绝', async () => {
  const { runCli } = makeRunner({
    taobao: { title: 'x', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] },
  });
  const seen = [];
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    fetchImpl: async (url, init) => {
      seen.push({ url, redirect: init.redirect });
      return imageResponse();
    },
  });
  const source = await sources.create('https://item.taobao.com/item.htm?id=1');
  const { mime, buffer } = await sources.download(source.id, 0);
  assert.equal(mime, 'image/png');
  assert.equal(buffer.length, PNG_BYTES.length);
  assert.equal(seen[0].url, 'https://img.alicdn.com/a.jpg');
  assert.equal(seen[0].redirect, 'error');
});

test('下载到非图片内容时拒绝，不把 HTML 当商品图', async () => {
  const { runCli } = makeRunner({
    taobao: { title: 'x', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] },
  });
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    fetchImpl: async () => new Response('<html>no</html>', { headers: { 'content-type': 'text/html' } }),
  });
  const source = await sources.create('https://item.taobao.com/item.htm?id=1');
  await assert.rejects(() => sources.download(source.id, 0), { code: 'IMAGE_FETCH_FAILED' });
});

test('超过 8MiB 的商品图被拒绝', async () => {
  const { runCli } = makeRunner({
    taobao: { title: 'x', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] },
  });
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    fetchImpl: async () => imageResponse(Buffer.alloc(8 * 1024 * 1024 + 1, 0)),
  });
  const source = await sources.create('https://item.taobao.com/item.htm?id=1');
  await assert.rejects(() => sources.download(source.id, 0), { code: 'IMAGE_TOO_LARGE' });
});

test('未知 sourceId 与越界索引报 404，过期后失效', async () => {
  const { runCli } = makeRunner({
    taobao: { title: 'x', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] },
  });
  const sources = createSourceService({ runCli, settleMs: 0, ttlMs: 1 });
  assert.throws(() => sources.get('nope'), { code: 'SOURCE_EXPIRED' });
  const source = await sources.create('https://item.taobao.com/item.htm?id=1');
  assert.throws(() => sources.pick(source.id, 5), { code: 'IMAGE_NOT_FOUND' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.throws(() => sources.get(source.id), { code: 'SOURCE_EXPIRED' });
});

test('没有 OpenCLI 时给出可读的 503，而不是静默降级', async () => {
  const sources = createSourceService({ env: { PATH: '' }, cookies: {}, settleMs: 0 });
  await assert.rejects(() => sources.create('https://item.taobao.com/item.htm?id=1'), { code: 'SOURCE_UNAVAILABLE' });
});

test('locateOpenCli 在 PATH 目录里找到 opencli 入口', () => {
  const fake = 'C:\\fake\\bin';
  const entry = locateOpenCli(
    { PATH: `${fake};C:\\other`, OS: 'Windows_NT' },
    (candidate) => candidate === `${fake}\\node_modules\\@jackwener\\opencli\\dist\\src\\main.js`,
  );
  assert.equal(entry, `${fake}\\node_modules\\@jackwener\\opencli\\dist\\src\\main.js`);
  assert.equal(locateOpenCli({ PATH: '' }, () => false), null);
});

test('手机分享文案：从整段中文里抠出短链，跟随跳转到商品页', async () => {
  const { runCli, calls } = makeRunner({
    taobao: { title: '短链商品', images: [{ url: 'https://img.alicdn.com/s.jpg', group: 'main' }] },
  });
  const fetched = [];
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    fetchImpl: async (url) => {
      fetched.push(url);
      return new Response('<html><a href="https://item.taobao.com/item.htm?id=862667630822&price=58">go</a></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
  });
  const shared =
    '【淘宝】7天无理由退货 https://e.tb.cn/h.jOsyNkrq1meduE8?tk=Q3tr6gaTAZ7 CZ321 「火星JK制服墨石格裙」 点击链接直接打开';
  const source = await sources.create(shared);
  assert.equal(source.platform, 'taobao');
  assert.equal(source.title, '短链商品');
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /^https:\/\/e\.tb\.cn\//);
  const opened = calls.find((args) => args[3] === 'open');
  assert.equal(opened[4], 'https://item.taobao.com/item.htm?id=862667630822');
});

test('短链带 Location 时按跳转地址解析', async () => {
  const { runCli, calls } = makeRunner({
    taobao: { title: '重定向商品', images: [{ url: 'https://img.alicdn.com/r.jpg', group: 'main' }] },
  });
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    fetchImpl: async () =>
      new Response(null, { status: 302, headers: { location: 'https://item.taobao.com/item.htm?id=1234567890' } }),
  });
  const source = await sources.create('https://m.tb.cn/h.abcdefg');
  assert.equal(source.title, '重定向商品');
  assert.equal(calls.find((args) => args[3] === 'open')[4], 'https://item.taobao.com/item.htm?id=1234567890');
});

test('短链里没有商品时报 INVALID_URL', async () => {
  const sources = createSourceService({
    runCli: async () => ({ ok: true, data: '{}' }),
    settleMs: 0,
    fetchImpl: async () => new Response('<html>nothing here</html>', { status: 200 }),
  });
  await assert.rejects(() => sources.create('https://e.tb.cn/h.nothing'), { code: 'INVALID_URL' });
});

test('短链返回 4xx 时不把错误页当商品页解析', async () => {
  const sources = createSourceService({
    runCli: async () => ({ ok: true, data: '{}' }),
    settleMs: 0,
    fetchImpl: async () =>
      new Response('<html><a href="https://item.taobao.com/item.htm?id=123">x</a></html>', { status: 502 }),
  });
  await assert.rejects(() => sources.create('https://e.tb.cn/h.broken'), { code: 'IMAGE_FETCH_FAILED' });
});

test('没有 content-length 的超大响应在读取时就被截断', async () => {
  const { runCli } = makeRunner({
    taobao: { title: 'x', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] },
  });
  const chunk = Buffer.alloc(1024 * 1024, 0);
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls > 40) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(chunk));
    },
  });
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    // 故意不给 content-length：只有流式累计才能挡住这条路径。
    fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'image/png' } }),
  });
  const source = await sources.create('https://item.taobao.com/item.htm?id=1');
  await assert.rejects(() => sources.download(source.id, 0), { code: 'IMAGE_TOO_LARGE' });
  assert.ok(pulls < 40, '超限后应停止读取');
});

test('客户端断开后排队任务不再继续解析', async () => {
  // 一次淘宝解析要跑 open + eval 两条命令，所以只数 open。
  let opened = 0;
  const sources = createSourceService({
    runCli: async (args) => {
      if (args[0] === 'browser' && args[3] === 'open') opened += 1;
      return { ok: true, data: '{}' };
    },
    settleMs: 0,
  });
  const controller = new AbortController();
  const first = sources.create('https://item.taobao.com/item.htm?id=1');
  controller.abort(new Error('gone'));
  const second = sources.create('https://item.taobao.com/item.htm?id=2', controller.signal);
  await assert.rejects(() => first, { code: 'NO_IMAGES' });
  await assert.rejects(() => second);
  assert.equal(opened, 1, '被取消的请求不应继续调用 OpenCLI');
});

test('解析串行化：并发请求不会同时占用浏览器会话', async () => {
  let active = 0;
  let peak = 0;
  const sources = createSourceService({
    runCli: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, data: JSON.stringify({ title: 't', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] }) };
    },
    settleMs: 0,
  });
  await Promise.all([
    sources.create('https://item.taobao.com/item.htm?id=1'),
    sources.create('https://item.taobao.com/item.htm?id=2'),
    sources.create('https://item.taobao.com/item.htm?id=3'),
  ]);
  assert.equal(peak, 1);
});

test('容量上限生效，不会多留一条', async () => {
  const sources = createSourceService({
    runCli: async () => ({
      ok: true,
      data: JSON.stringify({ title: 't', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] }),
    }),
    settleMs: 0,
    max: 2,
  });
  const created = [];
  for (const id of [1, 2, 3]) created.push(await sources.create(`https://item.taobao.com/item.htm?id=${id}`));
  assert.throws(() => sources.get(created[0].id), { code: 'SOURCE_EXPIRED' });
  assert.equal(sources.get(created[2].id).platform, 'taobao');
});

test('淘汰的是最久没用的那条，刚取过的不会被挤掉', async () => {
  const sources = createSourceService({
    runCli: async () => ({
      ok: true,
      data: JSON.stringify({ title: 't', images: [{ url: 'https://img.alicdn.com/a.jpg', group: 'main' }] }),
    }),
    settleMs: 0,
    max: 2,
  });
  const first = await sources.create('https://item.taobao.com/item.htm?id=1');
  const second = await sources.create('https://item.taobao.com/item.htm?id=2');
  // 取一次把 first 挪到最新，随后插入第三条应该淘汰 second。
  sources.get(first.id);
  const third = await sources.create('https://item.taobao.com/item.htm?id=3');
  assert.equal(sources.get(first.id).id, first.id);
  assert.throws(() => sources.get(second.id), { code: 'SOURCE_EXPIRED' });
  assert.equal(sources.get(third.id).id, third.id);
});

/** 抖音分享链接跳转后的详情页地址，`goods_detail` 就是 URL 编码的商品 JSON。 */
function douyinTarget(detail) {
  const url = new URL('https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html');
  url.searchParams.set('id', '3839832884752023958');
  url.searchParams.set('goods_detail', JSON.stringify(detail));
  return url.href;
}

test('抖音分享链接：从 goods_detail 参数取主图，不需要浏览器', async () => {
  const { runCli, calls } = makeRunner({});
  const target = douyinTarget({
    title: '透黑美学get到了！微透80d天鹅绒连裤袜',
    min_price: 980,
    img: {
      url_list: [
        'https://p3-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_8109a91e_sx_404259_www1440-1440~tplv-5mmsx3fupr-image.png',
        'https://p26-item.ecombdimg.com/img/ecom-shop-material/jpeg_m_8109a91e_sx_404259_www1440-1440~tplv-5mmsx3fupr-image.png',
      ],
    },
  });
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: target } }),
  });
  const shared =
    '5.30 11/09 Z@z.gO FUL:/ 【抖音商城】https://v.douyin.com/OEGaAtCdX2Q/ 透黑美学get到了！微透80d天鹅绒连裤袜 长按复制此条消息，打开抖音搜索，查看商品详情！:2pm';
  const source = await sources.create(shared);
  assert.equal(source.platform, 'douyin');
  assert.equal(source.platformLabel, '抖音');
  assert.equal(source.title, '透黑美学get到了！微透80d天鹅绒连裤袜');
  assert.equal(source.images.length, 2);
  assert.match(source.images[0].url, /^https:\/\/p3-item\.ecombdimg\.com\//);
  assert.equal(calls.length, 0, '抖音不需要启动浏览器');
});

test('抖音分享链接缺 goods_detail 时报 INVALID_URL', async () => {
  const sources = createSourceService({
    runCli: async () => ({ ok: true, data: '{}' }),
    settleMs: 0,
    fetchImpl: async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1' },
      }),
  });
  await assert.rejects(() => sources.create('https://v.douyin.com/nogoods/'), { code: 'INVALID_URL' });
});

test('拼多多 ?ps= 分享链接：跟随 307 拿到 goods_id 再解析', async () => {
  const { runCli, calls } = makeRunner({
    pdd: { title: '分享商品', images: [{ url: 'https://img.pddpic.com/top.jpeg?imageMogr2/quality/90', group: 'main' }] },
  });
  const sources = createSourceService({
    runCli,
    settleMs: 0,
    fetchImpl: async () =>
      new Response(null, {
        status: 307,
        headers: {
          location:
            'https://mobile.yangkeduo.com/goods.html?goods_id=845720245931&page_from=35&refer_share_channel=copy_link',
        },
      }),
  });
  const source = await sources.create('https://mobile.yangkeduo.com/goods.html?ps=zQaGVZ6mxC');
  assert.equal(source.platform, 'pdd');
  assert.equal(source.title, '分享商品');
  assert.equal(
    calls.find((args) => args[3] === 'open')[4],
    'https://mobile.yangkeduo.com/goods1.html?goods_id=845720245931',
  );
});

test('淘宝直连：无 _m_h5_tk 时先握手拿令牌，再签名取图', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    if (new URL(String(url)).host === 'h5api.m.taobao.com') {
      const cookie = (init.headers && init.headers.cookie) || '';
      if (!/_m_h5_tk=/.test(cookie)) {
        const headers = new Headers();
        headers.append('set-cookie', '_m_h5_tk=abc123_1799999999999; Path=/');
        headers.append('set-cookie', '_m_h5_tk_enc=xyz; Path=/');
        return new Response(JSON.stringify({ ret: ['FAIL_SYS_TOKEN_EMPTY::令牌为空'] }), { status: 200, headers });
      }
      return new Response(
        JSON.stringify({
          ret: ['SUCCESS::调用成功'],
          data: {
            item: { title: '测试商品', images: ['https://img.alicdn.com/imgextra/i1/1/O1CN01NnqqeI1syU8MPPYKX_!!1.jpg'] },
            skuBase: { props: [{ values: [{ image: 'https://gw.alicdn.com/bao/uploaded/i3/1/O1CN01jVjoXP1syU8GHejdR_!!1.jpg' }] }] },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return imageResponse();
  };
  const sources = createSourceService({ fetchImpl, cookies: { taobao: '_tb_token_=t; cookie2=c' }, settleMs: 0 });
  const source = await sources.create('https://item.taobao.com/item.htm?id=1');
  assert.equal(source.title, '测试商品');
  assert.equal(source.images.length, 2);
  assert.ok(source.images.every((i) => /alicdn\.com/.test(i.url)));
  assert.ok(calls.filter((c) => c.includes('h5api.m.taobao.com')).length >= 2, '应握手一次再签名请求一次');
});

test('抖音图文帖直连：ttwid + 分享页 _ROUTER_DATA 取图', async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u === 'https://ttwid.bytedance.com/ttwid/union/register/') {
      const headers = new Headers();
      headers.append('set-cookie', 'ttwid=tw123; Path=/');
      return new Response('{}', { status: 200, headers });
    }
    if (u.includes('iesdouyin.com/share/video/')) {
      const payload = { loaderData: { x: { videoInfoRes: { item_list: [{ desc: '图文标题', images: [{ url_list: ['https://p3-item.ecombdimg.com/a.jpg'] }] }] } } } };
      return new Response(`<script>window._ROUTER_DATA = ${JSON.stringify(payload)};</script>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return imageResponse();
  };
  const sources = createSourceService({ fetchImpl, cookies: {}, settleMs: 0 });
  const source = await sources.create('https://www.douyin.com/note/7704466212453371235');
  assert.equal(source.title, '图文标题');
  assert.equal(source.images.length, 1);
});

test('抖音视频封面受抖音 CDN 保护时给出可读提示', async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('ttwid.bytedance.com')) {
      const headers = new Headers();
      headers.append('set-cookie', 'ttwid=tw; Path=/');
      return new Response('{}', { status: 200, headers });
    }
    if (u.includes('share/video/')) {
      const payload = { loaderData: { a: { x: { item_list: [{ desc: '视频', video: { cover: { url_list: ['https://p3-sign.douyinpic.com/c.jpg'] } } }] } } } };
      return new Response(`<script>window._ROUTER_DATA = ${JSON.stringify(payload)};</script>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('forbidden', { status: 403 });
  };
  const sources = createSourceService({ fetchImpl, cookies: {}, settleMs: 0 });
  await assert.rejects(() => sources.create('https://www.douyin.com/video/7704466212453371235'), { code: 'NO_IMAGES' });
});
