import { HttpError } from './errors.mjs';
import { sanitizeText } from './prompt.mjs';

const SLOT_KEYS = ['top', 'outer', 'bottom', 'dress', 'hosiery', 'shoes', 'accessory'];
const MAX_REQUEST_CHARS = 200;
const MAX_ACCESSORY = 2;

function gatewayBase(env) {
  return (env.IMAGE_API_BASE_URL || 'http://127.0.0.1:3425').replace(/\/+$/, '');
}

/** 从模型回复里抠出第一个 JSON 对象（容许 ```json 围栏与前后废话）。 */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 今日穿搭：先用衣橱搜索把候选缩小，再让对话模型在候选里挑一套；
 * 模型不可用或返回不合法时退回规则挑选，保证永远能给出一套可执行建议。
 */
export function createStylist({ env = process.env, fetchImpl = fetch, wardrobe } = {}) {
  if (!wardrobe) throw new Error('createStylist 需要一个 wardrobe');

  function bucket(candidates) {
    const bySlot = new Map(SLOT_KEYS.map((slot) => [slot, []]));
    const known = new Map();
    for (const { item, score } of candidates) {
      const list = bySlot.get(item.category);
      if (!list) continue;
      list.push({ item, score });
      known.set(item.id, item);
    }
    return { bySlot, known };
  }

  /**
   * 候选里是否还凑不出一套（缺上衣/下装、且没有连衣裙）。
   * 命中词只落在某一格时很常见，这时要把其它格从全量衣橱补齐。
   */
  function needsTopUp(candidates) {
    const categories = new Set(candidates.map((entry) => entry.item?.category));
    if (categories.has('dress')) return false;
    return !(categories.has('top') && categories.has('bottom'));
  }

  function rulePick(bySlot) {
    const slots = {};
    const take = (slot) => {
      const list = bySlot.get(slot) || [];
      return list.length ? list[0].item : null;
    };
    const dress = take('dress');
    if (dress) {
      slots.dress = dress;
    } else {
      const top = take('top');
      const bottom = take('bottom');
      if (top) slots.top = top;
      if (bottom) slots.bottom = bottom;
    }
    for (const slot of ['outer', 'hosiery', 'shoes']) {
      const picked = take(slot);
      if (picked) slots[slot] = picked;
    }
    const accessories = (bySlot.get('accessory') || []).slice(0, MAX_ACCESSORY).map((entry) => entry.item);
    if (accessories.length) slots.accessory = accessories;

    const missing = [];
    if (!dress && (!slots.top || !slots.bottom)) {
      if (!slots.top) missing.push('top');
      if (!slots.bottom) missing.push('bottom');
    }
    if (!slots.shoes) missing.push('shoes');
    return { slots, missing };
  }

  async function modelPick(request, candidates, bySlot, known) {
    const lines = candidates.map(({ item }) => `${item.id} | ${item.category} | ${item.name}${item.description ? ` | ${item.description}` : ''}`);
    if (lines.length === 0) return null;
    const prompt = [
      '你是穿搭顾问。下面是从用户衣橱里检索到的候选单品，每行「id | 类目 | 名称 | 描述」。',
      '请根据用户需求，从候选里挑一套搭配。规则：',
      '- 只能在给出的候选里挑，不要编造 id；',
      `- 类目取值：${SLOT_KEYS.join('/')}；`,
      '- 连衣裙(dress) 与 上衣(top)+下装(bottom) 互斥，二选一；',
      `- 配饰(accessory) 最多 ${MAX_ACCESSORY} 件；`,
      '- 尽量凑齐鞋(shoes)；',
      '只输出 JSON：{"picks":{"top":"id","bottom":"id",...},"reason":"一句中文理由"}，不要别的内容。',
      '',
      `用户需求：${request}`,
      '',
      '候选：',
      ...lines,
    ].join('\n');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), 25_000);
    try {
      const response = await fetchImpl(`${gatewayBase(env)}/v1/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.IMAGE_API_KEY || 'the image service'}`,
        },
        body: JSON.stringify({
          model: env.STYLIST_MODEL || env.CAPTION_MODEL || 'codex/gpt-6.1-sol',
          max_tokens: 500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      const parsed = extractJson(text);
      if (!parsed || typeof parsed.picks !== 'object' || !parsed.picks) return null;

      const slots = {};
      let dressId = null;
      let hasTopBottom = false;
      for (const slot of SLOT_KEYS) {
        const raw = parsed.picks[slot];
        if (raw === undefined || raw === null) continue;
        if (slot === 'accessory') {
          const ids = Array.isArray(raw) ? raw : [raw];
          const picked = ids
            .filter((id) => typeof id === 'string')
            .map((id) => known.get(id))
            .filter((item) => item && item.category === 'accessory')
            .slice(0, MAX_ACCESSORY);
          if (picked.length) slots.accessory = picked;
          continue;
        }
        const id = typeof raw === 'string' ? raw : '';
        const item = known.get(id);
        if (!item || item.category !== slot) continue;
        slots[slot] = item;
        if (slot === 'dress') dressId = id;
        if (slot === 'top' || slot === 'bottom') hasTopBottom = true;
      }
      if (dressId && hasTopBottom) return null; // 互斥冲突，交给规则回退
      if (!slots.dress && !(slots.top && slots.bottom)) return null;
      const missing = [];
      if (!slots.shoes) missing.push('shoes');
      return { slots, reason: sanitizeText(String(parsed.reason || ''), 120) || '按你的需求挑了一套', missing };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 检索 + 补齐候选：检索命中凑不成一套时从全量衣橱补，返回可直接交给挑选逻辑的候选。 */
  async function gather(query) {
    let candidates = await wardrobe.search(query, 12);
    if (!Array.isArray(candidates)) candidates = [];
    // 检索命中不等于凑得成一套：命中词常常只落在上衣上，只剩上衣时不能认输。
    // 缺哪一格就从全量衣橱补哪一格（最多 24 件），让挑选逻辑在完整候选里做选择。
    if (needsTopUp(candidates)) {
      const all = typeof wardrobe.list === 'function' ? await wardrobe.list() : [];
      const seen = new Set(candidates.map((entry) => entry.item.id));
      for (const item of (all ?? []).slice(0, 24)) {
        if (seen.has(item.id)) continue;
        candidates.push({ item, score: 0 });
        seen.add(item.id);
      }
    }
    return candidates;
  }

  function emptySuggestion() {
    return { slots: {}, reason: '衣橱里还没有单品，先去衣橱页加几件吧', missing: ['top', 'bottom', 'shoes'] };
  }

  return {
    async suggest(request) {
      const query = sanitizeText(String(request ?? ''), MAX_REQUEST_CHARS);
      if (!query) throw new HttpError(400, 'INVALID_REQUEST', '请用一句话描述你今天想穿什么', 'request');

      const candidates = await gather(query);
      if (candidates.length === 0) return emptySuggestion();
      const { bySlot, known } = bucket(candidates);
      const fromModel = await modelPick(query, candidates, bySlot, known);
      if (fromModel) return fromModel;
      const fallback = rulePick(bySlot);
      return { ...fallback, reason: '按衣橱里最接近你需求的单品挑了一套' };
    },

    /** 不打模型的版本：演示模式与网关不可用时用，行为与 suggest 的规则回退一致。 */
    async suggestByRule(request) {
      const query = sanitizeText(String(request ?? ''), MAX_REQUEST_CHARS);
      if (!query) throw new HttpError(400, 'INVALID_REQUEST', '请用一句话描述你今天想穿什么', 'request');
      const candidates = await gather(query);
      if (candidates.length === 0) return emptySuggestion();
      const { bySlot } = bucket(candidates);
      return { ...rulePick(bySlot), reason: '按衣橱里最接近你需求的单品挑了一套' };
    },
  };
}
