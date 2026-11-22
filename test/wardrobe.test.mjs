import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createWardrobe } from '../src/wardrobe.mjs';

const PNG_SIG = Buffer.from('89504e470d0a1a0a', 'hex');

/** 造一张「够 sniff 认可为 png」的字节与 dataUrl（decodeImage 只验签名，不解析像素）。 */
function pngImage(extra = 'pixel') {
  const buffer = Buffer.concat([PNG_SIG, Buffer.from(extra, 'utf8')]);
  return { buffer, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
}

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'tryon-wardrobe-'));
}

function sample(overrides = {}) {
  const { dataUrl } = pngImage();
  return {
    name: '白色亚麻衬衫',
    category: 'top',
    subtype: '衬衫',
    tags: ['白衬衫', '通勤'],
    description: '纯棉白衬衫',
    image: dataUrl,
    ...overrides,
  };
}

test('新增 / 列表 / 取图字节 / 删除', async () => {
  const dir = freshDir();
  try {
    const wardrobe = createWardrobe({ dir });
    const created = await wardrobe.add(sample());
    assert.ok(created.id, '新单品应有 id');
    assert.equal(created.mime, 'image/png');
    assert.equal(created.imageFile, `${created.id}.png`);
    assert.equal(created.bytes, pngImage().buffer.length);
    assert.equal(created.source, 'upload');
    assert.match(created.sha256, /^[0-9a-f]{64}$/);

    const list = await wardrobe.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);

    const got = await wardrobe.get(created.id);
    assert.equal(got.name, '白色亚麻衬衫');
    assert.deepEqual(got.tags, ['白衬衫', '通勤']);

    const image = await wardrobe.readImage(created.id);
    assert.equal(image.mime, 'image/png');
    assert.ok(image.buffer.equals(pngImage().buffer), '取回的字节应与写入一致');

    assert.equal(await wardrobe.remove(created.id), true);
    assert.equal(await wardrobe.get(created.id), null);
    assert.equal((await wardrobe.list()).length, 0);
    assert.equal(await wardrobe.readImage(created.id), null);
    assert.equal(await wardrobe.remove('不存在的id'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('mime 白名单拒绝：gif 不入库', async () => {
  const dir = freshDir();
  try {
    const wardrobe = createWardrobe({ dir });
    const { buffer } = pngImage();
    const gif = `data:image/gif;base64,${buffer.toString('base64')}`;
    await assert.rejects(
      () => wardrobe.add(sample({ image: gif })),
      (error) => error.status === 400 && error.code === 'INVALID_IMAGE',
    );
    assert.equal((await wardrobe.list()).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('超过 8MiB 拒绝', async () => {
  const dir = freshDir();
  try {
    const wardrobe = createWardrobe({ dir });
    const oversized = Buffer.concat([PNG_SIG, Buffer.alloc(8 * 1024 * 1024 + 1)]);
    const dataUrl = `data:image/png;base64,${oversized.toString('base64')}`;
    await assert.rejects(
      () => wardrobe.add(sample({ image: dataUrl })),
      (error) => error.status === 413 && error.code === 'IMAGE_TOO_LARGE',
    );
    assert.equal((await wardrobe.list()).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sourceId + sourceIndex 分支从注入的 sources 取图', async () => {
  const dir = freshDir();
  try {
    const { buffer } = pngImage('source-image');
    const calls = [];
    const sources = {
      get(id) {
        assert.equal(id, 'src-1');
        return { id, title: '淘宝白色衬衫' };
      },
      async download(id, index) {
        calls.push([id, index]);
        return { mime: 'image/png', buffer };
      },
    };
    const wardrobe = createWardrobe({ dir, sources });
    const created = await wardrobe.add({ sourceId: 'src-1', sourceIndex: 2, category: 'top' });

    assert.deepEqual(calls, [['src-1', 2]], '应按 sourceId/sourceIndex 取图');
    assert.equal(created.source, 'import', '来自商品链接的单品来源应为 import');
    assert.equal(created.name, '淘宝白色衬衫', '未填名称时回退到来源标题');
    assert.equal(created.imageFile, `${created.id}.png`);

    const image = await wardrobe.readImage(created.id);
    assert.ok(image.buffer.equals(buffer));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('search 对中文关键词能命中', async () => {
  const dir = freshDir();
  try {
    const wardrobe = createWardrobe({ dir });
    const shirt = await wardrobe.add(sample());
    const jeans = await wardrobe.add(sample({
      name: '黑色直筒牛仔裤',
      category: 'bottom',
      subtype: '牛仔裤',
      tags: ['牛仔', '通勤'],
      description: '弹力直筒',
    }));

    const results = await wardrobe.search('白衬衫', 5);
    assert.ok(results.length >= 1, '应至少命中一件');
    assert.equal(results[0].item.id, shirt.id, '最相关的应是白衬衫');
    assert.ok(results[0].score > 0, '命中项分数应大于 0');
    assert.ok(!results.some((entry) => entry.item.id === jeans.id), '无关的下装不应被命中');

    assert.deepEqual(await wardrobe.search('不存在的词'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('注入的 captioner 失败不影响入库', async () => {
  const dir = freshDir();
  try {
    const captioner = {
      available: true,
      async caption() {
        throw new Error('网关炸了');
      },
    };
    const wardrobe = createWardrobe({ dir, captioner });
    const created = await wardrobe.add(sample({ description: '' }));
    assert.equal(created.description, '', 'captioner 失败时描述留空');
    assert.equal((await wardrobe.list()).length, 1, '描述失败不应阻断入橱');

    // 已带描述时不会调用 captioner，描述原样保留。
    const kept = await wardrobe.add(sample({ description: '用户自己填的' }));
    assert.equal(kept.description, '用户自己填的');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('索引被改成目录穿越的 imageFile 时不会读到目录外的文件', async () => {
  const dir = freshDir();
  try {
    const wardrobe = createWardrobe({ dir });
    const created = await wardrobe.add(sample());
    // 模拟索引被手工改坏：把 imageFile 指向上级目录的文件。
    const indexPath = join(dir, 'wardrobe.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    index.items[0].imageFile = '../../secret.png';
    writeFileSync(indexPath, JSON.stringify(index), 'utf8');

    const reopened = createWardrobe({ dir });
    assert.equal(await reopened.readImage(created.id), null, '目录外路径必须当作取不到');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
