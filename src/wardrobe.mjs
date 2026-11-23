/**
 * 衣橱数据层：把用户导入/上传的单品图落成本地索引 + 图片文件，并提供关键词检索。
 *
 * 只存本机：索引 `data/wardrobe.json`、图片 `data/wardrobe/<id>.<ext>`（均不进 git）。
 * 索引读写用一个 Promise 串行队列保护，避免并发 add/remove 互相覆盖（同 src/source.mjs 的写法）。
 * 图片字节只在入橱时校验一次（mime 白名单 + 8MiB），之后供试穿/展示按 id 取回。
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { HttpError } from './errors.mjs';
import { MAX_IMAGE_BYTES, decodeImage } from './validate.mjs';

/** 契约第 1 节的七大单品类目（与今日穿搭的 slot 一致）。 */
const WARDROBE_CATEGORIES = ['top', 'outer', 'bottom', 'dress', 'hosiery', 'shoes', 'accessory'];

/** 衣橱条目上限：BM25 每次全量扫描，且这是单进程 JSON 索引，超过这个量级该换存储了。 */
const MAX_ITEMS = 500;

/** mime → 文件扩展名；只接受解码后会被 sniff 认可的三类。 */
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** 把字符串单行化、按码点限长；非字符串一律当空串。 */
function cleanText(value, max = 200) {
  if (typeof value !== 'string') return '';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return [...trimmed].slice(0, max).join('');
}

function requireCategory(value) {
  if (typeof value !== 'string' || !WARDROBE_CATEGORIES.includes(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', '单品类目无效', 'category');
  }
  return value;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const tag = cleanText(raw, 40);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
}

/** 中文按字与二元组切词，拉丁/数字按整词切；让「白衬衫」能命中「白色亚麻衬衫」。 */
function tokenize(text) {
  const lower = String(text ?? '').toLowerCase();
  const tokens = lower.match(/[a-z0-9]+/g) ?? [];
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    for (const ch of run) tokens.push(ch);
    for (let i = 0; i + 1 < run.length; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

/**
 * @param {object} [options]
 * @param {string} [options.dir] 数据目录（索引与图片都在其下）
 * @param {Function} [options.fetchImpl] 与契约签名对齐（衣橱本身不发起网络请求，保留以兼容调用方）
 * @param {object} [options.env] 与契约签名对齐（同上，保留以兼容调用方）
 * @param {{ available?: boolean, caption: (buffer: Buffer, mime: string) => Promise<string> }} [options.captioner]
 * @param {{ get?: (id: string) => any, download: (id: string, index: number) => Promise<{ mime: string, buffer: Buffer }> }} [options.sources]
 *        商品链接来源（src/source.mjs 的实例），用于 `sourceId + sourceIndex` 入库分支。
 */
export function createWardrobe({ dir = 'data', fetchImpl = fetch, env = process.env, captioner, sources } = {}) {
  const indexFile = join(dir, 'wardrobe.json');
  const imageDir = join(dir, 'wardrobe');

  let items = null; // 惰性加载的索引
  let loading = null;
  let queue = Promise.resolve();

  /** 首次访问时读盘；坏文件先备份再按空衣橱继续，缺文件即空。 */
  async function ensureLoaded() {
    if (items) return;
    if (!loading) {
      loading = (async () => {
        await mkdir(imageDir, { recursive: true });
        const raw = await readFile(indexFile, 'utf8').catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (raw === null) {
          items = [];
          return;
        }
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
        if (parsed === null || !Array.isArray(parsed?.items)) {
          // 索引坏了不能直接当空衣橱：下一次 persist 会用空列表覆盖它，索引就永久没了。
          // 先改名备份，再以空索引继续，坏文件还能人工捞回来。
          const backup = `${indexFile}.corrupt-${Date.now()}`;
          await rename(indexFile, backup).catch(() => {});
          console.error(`[wardrobe] 索引无法解析，已备份为 ${backup}`);
          items = [];
          return;
        }
        items = parsed.items;
      })().finally(() => {
        loading = null;
      });
    }
    await loading;
  }

  /** 原子写：先写临时文件再 rename，避免进程中断留下半截索引。 */
  async function persist(next) {
    const payload = JSON.stringify({ version: 1, items: next }, null, 2);
    const temporary = `${indexFile}.tmp`;
    await writeFile(temporary, payload, 'utf8');
    await rename(temporary, indexFile);
  }

  /** 串行执行写入任务，保证索引的读-改-写不会交错。 */
  function serialize(task) {
    const job = queue.then(task);
    queue = job.then(
      () => {},
      () => {},
    );
    return job;
  }

  /**
   * 把索引里的 imageFile 解析成真实路径，并确认它没有跑出图片目录。
   * 索引是本机文件，但它可能被手工改过或被旧版本写坏，取图前必须再校验一次。
   */
  function imagePath(fileName) {
    const path = resolve(imageDir, String(fileName ?? ''));
    if (!path.startsWith(resolve(imageDir) + sep)) return null;
    return path;
  }

  /**
   * 解析入库图片。dataUrl 走 decodeImage（白名单 + 8MiB）；否则从 sources 取图。
   * @returns {Promise<{ mime: string, buffer: Buffer, source: 'import' | 'upload', originTitle: string }>}
   */
  async function resolveImage(input) {
    if (typeof input.image === 'string' && input.image.length) {
      const decoded = decodeImage(input.image, 'image');
      return {
        mime: decoded.mime,
        buffer: decoded.buffer,
        source: input.source === 'import' ? 'import' : 'upload',
        originTitle: '',
      };
    }
    if (input.sourceId) {
      if (!sources || typeof sources.download !== 'function') {
        throw new HttpError(503, 'SOURCE_UNAVAILABLE', '商品图片来源不可用，请重新导入');
      }
      const index = input.sourceIndex == null ? 0 : Number(input.sourceIndex);
      if (!Number.isInteger(index) || index < 0) {
        throw new HttpError(400, 'INVALID_REQUEST', '图片序号无效', 'sourceIndex');
      }
      const origin = typeof sources.get === 'function' ? sources.get(input.sourceId) : null;
      const { mime, buffer } = await sources.download(input.sourceId, index);
      if (!EXT_BY_MIME[mime]) {
        throw new HttpError(400, 'INVALID_IMAGE', '图片格式不支持', 'image');
      }
      if (!buffer || buffer.length > MAX_IMAGE_BYTES) {
        throw new HttpError(413, 'IMAGE_TOO_LARGE', '单张图片不得超过8MiB', 'image');
      }
      return {
        mime,
        buffer,
        source: input.source === 'upload' ? 'upload' : 'import',
        originTitle: typeof origin?.title === 'string' ? origin.title : '',
      };
    }
    throw new HttpError(400, 'INVALID_REQUEST', '缺少图片', 'image');
  }

  return {
    /** 按 createdAt 倒序（最新在前）。 */
    async list() {
      await ensureLoaded();
      return items
        .slice()
        .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''));
    },

    async get(id) {
      await ensureLoaded();
      return items.find((item) => item.id === id) ?? null;
    },

    /**
     * 新增单品。支持三种入参形状：
     * - `{ name, category, subtype?, tags?, description?, image /* dataUrl *\/, source? }`
     * - `{ sourceId, sourceIndex?, name?, category, subtype?, tags? }`
     * 描述为空且注入了 captioner 时补一句视觉模型描述；失败留空不阻断入橱。
     */
    async add(input = {}) {
      const category = requireCategory(input.category);
      const image = await resolveImage(input);
      const { mime, buffer } = image;

      const name = cleanText(input.name, 120) || cleanText(image.originTitle, 120) || '未命名单品';
      const subtype = cleanText(input.subtype, 40);
      const tags = normalizeTags(input.tags);

      let description = cleanText(input.description, 200);
      if (!description && captioner && typeof captioner.caption === 'function') {
        try {
          description = cleanText(await captioner.caption(buffer, mime), 200);
        } catch {
          description = '';
        }
      }

      const id = randomUUID();
      const imageFile = `${id}.${EXT_BY_MIME[mime]}`;
      const item = {
        id,
        name,
        category,
        subtype,
        tags,
        description,
        imageFile,
        mime,
        bytes: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        source: image.source,
        createdAt: new Date().toISOString(),
      };

      return serialize(async () => {
        await ensureLoaded();
        if (items.length >= MAX_ITEMS) {
          throw new HttpError(413, 'WARDROBE_FULL', `衣橱最多 ${MAX_ITEMS} 件，请先删掉一些不常穿的`);
        }
        await mkdir(imageDir, { recursive: true });
        const target = imagePath(imageFile);
        if (!target) throw new Error('衣橱图片路径非法');
        await writeFile(target, buffer);
        const next = [item, ...items];
        try {
          await persist(next);
        } catch (error) {
          // 索引写失败就回滚图片文件，避免留下无主残渣。
          await rm(target, { force: true }).catch(() => {});
          throw error;
        }
        items = next;
        return item;
      });
    },

    async remove(id) {
      return serialize(async () => {
        await ensureLoaded();
        const target = items.find((item) => item.id === id);
        if (!target) return false;
        const next = items.filter((item) => item.id !== id);
        await persist(next);
        items = next;
        // 索引先落盘再删图：即使删图失败也只是留下孤儿文件，不会出现索引指向缺失文件。
        const filePath = imagePath(target.imageFile);
        if (filePath) await rm(filePath, { force: true }).catch(() => {});
        return true;
      });
    },

    /**
     * 修改一件单品的名称 / 类目 / 子类 / 标签 / 描述。图片不参与修改（换图请重新上传）。
     * 只改传入的字段，其余保持原样；找不到返回 null。
     */
    async update(id, patch = {}) {
      return serialize(async () => {
        await ensureLoaded();
        const index = items.findIndex((item) => item.id === id);
        if (index < 0) return null;
        const next = { ...items[index] };
        if (patch.name !== undefined) {
          const name = cleanText(patch.name, 120);
          if (!name) throw new HttpError(400, 'INVALID_REQUEST', '单品名称不能为空', 'name');
          next.name = name;
        }
        if (patch.category !== undefined) next.category = requireCategory(patch.category);
        if (patch.subtype !== undefined) next.subtype = cleanText(patch.subtype, 40);
        if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
        if (patch.description !== undefined) next.description = cleanText(patch.description, 200);
        const list = items.slice();
        list[index] = next;
        await persist(list);
        items = list;
        return next;
      });
    },

    async readImage(id) {
      await ensureLoaded();
      const item = items.find((entry) => entry.id === id);
      if (!item) return null;
      const filePath = imagePath(item.imageFile);
      if (!filePath) return null;
      const buffer = await readFile(filePath).catch(() => null);
      if (!buffer) return null;
      return { mime: item.mime, buffer };
    },

    /** BM25 关键词检索：中文按字/二元组切词，返回 `[{ item, score }]` 按分数倒序。 */
    async search(query, limit = 8) {
      await ensureLoaded();
      const text = cleanText(query, 200);
      const terms = [...new Set(tokenize(text))];
      if (!terms.length || !items.length) return [];

      const docs = items.map((item) => {
        const haystack = [item.name, item.description, item.subtype, item.category, ...(item.tags ?? [])]
          .filter(Boolean)
          .join(' ');
        const tokens = tokenize(haystack);
        const tf = new Map();
        for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
        return { item, tokens, tf };
      });

      const N = docs.length;
      let totalLength = 0;
      const df = new Map(terms.map((term) => [term, 0]));
      for (const doc of docs) {
        totalLength += doc.tokens.length;
        for (const term of terms) if (doc.tf.has(term)) df.set(term, df.get(term) + 1);
      }
      const avgdl = totalLength / N || 1;
      const k1 = 1.5;
      const b = 0.75;

      const results = [];
      for (const doc of docs) {
        const dl = doc.tokens.length || 1;
        let score = 0;
        for (const term of terms) {
          const frequency = doc.tf.get(term) ?? 0;
          if (!frequency) continue;
          const n = df.get(term) ?? 0;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          score += (idf * (frequency * (k1 + 1))) / (frequency + k1 * (1 - b + (b * dl) / avgdl));
        }
        if (score > 0) results.push({ item: doc.item, score });
      }
      results.sort((a, b2) => b2.score - a.score);
      const max = Number.isInteger(limit) && limit > 0 ? limit : 8;
      return results.slice(0, max);
    },
  };
}
