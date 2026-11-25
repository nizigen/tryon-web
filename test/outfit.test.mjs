import test from 'node:test';
import assert from 'node:assert/strict';
import { createStylist } from '../src/outfit.mjs';

function item(id, category, name, description = '') {
  return { id, category, name, description, imageUrl: `/api/wardrobe/${id}/image` };
}

const CATALOG = [
  item('t1', 'top', '白色亚麻衬衫', '清爽通勤'),
  item('t2', 'top', '黑色针织打底', '显瘦百搭'),
  item('b1', 'bottom', '灰色百褶裙', '学院风'),
  item('b2', 'bottom', '深灰阔腿裤', '正式'),
  item('d1', 'dress', '黑色缎面连衣裙', '晚宴'),
  item('o1', 'outer', '米色风衣', '春秋外搭'),
  item('h1', 'hosiery', '黑色连裤袜', '保暖'),
  item('s1', 'shoes', '黑色乐福鞋', '通勤'),
  item('s2', 'shoes', '白色运动鞋', '休闲'),
  item('a1', 'accessory', '细腰带', '收腰'),
  item('a2', 'accessory', '珍珠项链', '优雅'),
  item('a3', 'accessory', '丝巾', '点缀'),
];

function wardrobeReturning(list) {
  return {
    async search() {
      return list.map((it) => ({ item: it, score: 1 }));
    },
  };
}

test('规则回退：没有可用模型时按类目凑一套并报缺鞋', async () => {
  const wardrobe = wardrobeReturning(CATALOG.filter((it) => it.category !== 'shoes' && it.category !== 'dress'));
  const stylist = createStylist({
    wardrobe,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  const res = await stylist.suggest('明天面试，想正式一点');
  assert.ok(res.slots.top, '应有上衣');
  assert.ok(res.slots.bottom, '应有下装');
  assert.equal(res.slots.dress, undefined, '有上衣下装时不应再选连衣裙');
  assert.ok(res.missing.includes('shoes'), '缺鞋应被报告');
  assert.equal(typeof res.reason, 'string');
});

test('连衣裙优先于上衣下装', async () => {
  const wardrobe = wardrobeReturning(CATALOG);
  const stylist = createStylist({
    wardrobe,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  const res = await stylist.suggest('今晚有个晚宴');
  assert.ok(res.slots.dress, '应优先选连衣裙');
  assert.equal(res.slots.top, undefined);
  assert.equal(res.slots.bottom, undefined);
});

test('检索只命中上衣时，从全量衣橱补齐下装而不是只给一件', async () => {
  const full = CATALOG.filter((it) => it.category !== 'dress');
  const wardrobe = {
    async search() {
      // 需求句里的关键词只落在上衣上，下装检索不到。
      return [{ item: CATALOG[0], score: 2 }];
    },
    async list() {
      return full;
    },
  };
  const stylist = createStylist({
    wardrobe,
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  const res = await stylist.suggest('想要清爽一点的上衣');
  assert.ok(res.slots.top, '应有上衣');
  assert.ok(res.slots.bottom, '下装应从全量衣橱补齐');
});

test('模型挑选：合法 JSON 被采用，非法 id 被丢弃', async () => {
  const wardrobe = wardrobeReturning(CATALOG);
  const reply = {
    choices: [
      {
        message: {
          content:
            '```json\n{"picks":{"top":"t2","bottom":"b2","shoes":"s1","accessory":["a2","a3","a1"],"outer":"不存在"},"reason":"深色显瘦又正式"}\n```',
        },
      },
    ],
  };
  const stylist = createStylist({ wardrobe, fetchImpl: async () => ({ ok: true, json: async () => reply }) });
  const res = await stylist.suggest('明天面试');
  assert.equal(res.slots.top.id, 't2');
  assert.equal(res.slots.bottom.id, 'b2');
  assert.equal(res.slots.shoes.id, 's1');
  assert.equal(res.slots.outer, undefined, '不存在的 id 必须被丢弃');
  assert.equal(res.slots.accessory.length, 2, '配饰最多 2 件');
  assert.equal(res.reason, '深色显瘦又正式');
});

test('模型返回连衣裙加下装时判为冲突并回退到规则选择', async () => {
  const wardrobe = wardrobeReturning(CATALOG);
  const reply = {
    choices: [{ message: { content: '{"picks":{"dress":"d1","bottom":"b1"},"reason":"冲突"}' } }],
  };
  const stylist = createStylist({ wardrobe, fetchImpl: async () => ({ ok: true, json: async () => reply }) });
  const res = await stylist.suggest('随便穿');
  assert.ok(!(res.slots.dress && (res.slots.top || res.slots.bottom)), '不能同时出现连衣裙与上/下装');
});

test('空需求被拒绝', async () => {
  const stylist = createStylist({ wardrobe: wardrobeReturning(CATALOG), fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(() => stylist.suggest('   '), (error) => error.status === 400);
});

test('衣橱为空时返回空建议而不是抛错', async () => {
  const stylist = createStylist({ wardrobe: wardrobeReturning([]), fetchImpl: async () => ({ ok: false }) });
  const res = await stylist.suggest('今天想穿裙子');
  assert.deepEqual(res.slots, {});
  assert.ok(res.missing.length > 0);
});

test('推理模型把预算花光导致 content 为 null 时，给出可诊断的回退原因', async () => {
  // 真实故障形态：finish_reason=length、message.content=null、reasoning 占满 completion。
  const truncated = {
    choices: [{ finish_reason: 'length', message: { content: null, role: 'assistant' } }],
    usage: { completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 500 } },
  };
  const warnings = [];
  const stylist = createStylist({
    wardrobe: wardrobeReturning(CATALOG),
    fetchImpl: async () => ({ ok: true, json: async () => truncated }),
    logger: { warn: (message) => warnings.push(message) },
  });
  const res = await stylist.suggest('明天面试');
  assert.ok(Object.keys(res.slots).length > 0, '仍要给出一套可执行建议');
  assert.equal(warnings.length, 1, '回退必须留一行原因');
  assert.match(warnings[0], /token 上限截断/);
  assert.match(warnings[0], /reasoning=500/);
});

test('挑选请求给推理模型留足输出预算', async () => {
  let sent = null;
  const stylist = createStylist({
    wardrobe: wardrobeReturning(CATALOG),
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"picks":{"top":"t1","bottom":"b1"},"reason":"通勤"}' } }] }) };
    },
  });
  await stylist.suggest('明天面试');
  // 输出只需约 160 token，但推理会浮动到 940 左右；预算必须高于推理上限。
  assert.ok(sent.max_tokens >= 1500, `max_tokens 应留出推理余量，实际 ${sent.max_tokens}`);
});

test('上游报错时回退原因里带状态码', async () => {
  const warnings = [];
  const stylist = createStylist({
    wardrobe: wardrobeReturning(CATALOG),
    fetchImpl: async () => ({ ok: false, status: 429 }),
    logger: { warn: (message) => warnings.push(message) },
  });
  await stylist.suggest('明天面试');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /429/);
});
