import { SLOTS, SLOT_BY_KEY } from '../lib/garment-taxonomy.js';
import {
  DEFAULT_PERSON_URL,
  BASE_FACE_URL,
  TURNAROUND_URL,
  STUDIO_MAKEUP_URL,
} from '../lib/person.js';

export { SLOTS, SLOT_BY_KEY, DEFAULT_PERSON_URL, BASE_FACE_URL, TURNAROUND_URL, STUDIO_MAKEUP_URL };

export const SHELL_CONFIG = {
  defaultModel: 'seedream-4.0-editorial',
  defaultStudioPreset: 'clean-white-seamless',
  gateway: { reachable: true, label: '本地交互壳子（未接后端）' },
  models: [
    { id: 'seedream-4.0-editorial', label: 'Seedream 4.0 · 棚拍精修' },
    { id: 'gpt-image-1.5-fit', label: 'GPT-Image 1.5 · 服装保真' },
    { id: 'flux-kontext-atelier', label: 'FLUX Kontext · 自然光影' },
  ],
  fits: [
    { id: 'regular', label: '合身', hint: '按单品原版型贴合上身' },
    { id: 'slim', label: '修身', hint: '肩线与腰身略微收紧' },
    { id: 'oversized', label: '宽松', hint: '保留松弛垂坠与余量' },
  ],
  categories: [
    { id: 'tops', label: '上衣' },
    { id: 'bottoms', label: '下装' },
    { id: 'dresses', label: '连衣裙' },
  ],
  studioPresets: [
    { id: 'clean-white-seamless', label: '纯白无影棚', hint: '干净留白，适合多数穿搭封面' },
    { id: 'soft-gray-seamless', label: '浅灰无缝棚', hint: '层次更稳，适合黑白与低饱和搭配' },
    { id: 'warm-white-seamless', label: '暖白无缝棚', hint: '肤色更柔和，适合暖色与针织材质' },
  ],
  posePresets: [
    {
      id: 'contrapposto',
      label: '对立式手叉腰',
      hint: '一手叉腰，平视镜头，双唇轻合。',
      posewearId: 'P015',
      referenceUrl: '/posewear/P015.png',
    },
    {
      id: 'hand-behind-head',
      label: '一手放后脑',
      hint: '抬手托住后脑，望向画面左侧，嘴唇微张。',
      posewearId: 'P020',
      referenceUrl: '/posewear/P020.png',
    },
    {
      id: 'over-shoulder',
      label: '越肩回眸',
      hint: '脸还朝着肩外，目光已回到镜头，双唇轻合。',
      posewearId: 'P017',
      referenceUrl: '/posewear/P017.png',
    },
    {
      id: 'duck-sit',
      label: '鸭子坐',
      hint: '坐稳后垂眼看腿上的指尖，唇角放松。',
      posewearId: 'P041',
      referenceUrl: '/posewear/P041.webp',
    },
    {
      id: 'crouch-chin',
      label: '托腮蹲姿',
      hint: '低重心蹲姿，单手托腮，适合呈现廓形裙摆。',
      posewearId: 'P063',
      referenceUrl: '/posewear/P063.webp',
    },
    {
      id: 'lying-overhead',
      label: '俯拍躺姿',
      hint: '延展全身轮廓，适合长裙与宽松针织。',
      posewearId: 'P049',
      referenceUrl: '/posewear/P049.webp',
    },
  ],
};

export const INITIAL_WARDROBE = [
  {
    id: 'w-sweater-knit',
    name: '米色麻花针织毛衣',
    category: 'top',
    subtype: '毛衣',
    layer: 'middle',
    tags: ['米色', '针织', '秋冬', '通勤', '温柔'],
    imageUrl: '/catalog/sweater-knit.jpg',
    source: 'catalog',
  },
  {
    id: 'w-blouse-linen',
    name: '白色亚麻小翻领衬衫',
    category: 'top',
    subtype: '衬衫',
    layer: 'inner',
    tags: ['白色', '亚麻', '通勤', '清爽', '面试'],
    imageUrl: '/catalog/blouse-linen.jpg',
    source: 'catalog',
  },
  {
    id: 'w-shirt-floral',
    name: '红底白色小花短袖衬衫',
    category: 'top',
    subtype: '衬衫',
    layer: 'middle',
    tags: ['红色', '碎花', '度假', '法式', '短袖'],
    imageUrl: '/catalog/shirt-floral.jpg',
    source: 'catalog',
  },
  {
    id: 'w-skirt-pleated',
    name: '灰色百褶中长半身裙',
    category: 'bottom',
    subtype: '百褶裙',
    layer: 'middle',
    tags: ['灰色', '百褶', '通勤', '学院', '面试'],
    imageUrl: '/catalog/skirt-pleated.jpg',
    source: 'catalog',
  },
  {
    id: 'w-jeans-black',
    name: '黑色高腰直筒牛仔裤',
    category: 'bottom',
    subtype: '牛仔裤',
    layer: 'middle',
    tags: ['黑色', '高腰', '直筒', '百搭', '日常'],
    imageUrl: '/catalog/jeans-black.jpg',
    source: 'catalog',
  },
  {
    id: 'w-dress-slip',
    name: '黑色吊带缎面连衣裙',
    category: 'dress',
    subtype: '吊带裙',
    layer: 'middle',
    tags: ['黑色', '缎面', '晚宴', '约会', '法式'],
    imageUrl: '/catalog/dress-slip.jpg',
    source: 'catalog',
  },
  {
    id: 'w-hosiery-sheer',
    name: '黑色 20D 连裤丝袜',
    category: 'hosiery',
    subtype: '连裤袜',
    layer: 'inner',
    tags: ['黑色', '丝袜', '20D', '秋冬', '通勤'],
    imageUrl: '/taste-shell/assets/tights-macro.jpg',
    source: 'catalog',
  },
];

export const CATALOG_PRODUCTS = [
  {
    id: 'shirt-floral',
    name: '红底白色小花短袖衬衫',
    subtitle: '棉质府绸，宽松短袖，通勤度假都好搭',
    image: '/catalog/shirt-floral.jpg',
    category: 'tops',
    slot: 'top',
    subtype: '衬衫',
    tags: ['衬衫', '红色', '碎花', '短袖'],
  },
  {
    id: 'jeans-black',
    name: '黑色高腰直筒牛仔裤',
    subtitle: '厚磅牛仔，显瘦直筒，不挑腿型',
    image: '/catalog/jeans-black.jpg',
    category: 'bottoms',
    slot: 'bottom',
    subtype: '牛仔裤',
    tags: ['牛仔裤', '黑色', '高腰', '直筒'],
  },
  {
    id: 'sweater-knit',
    name: '米色麻花针织毛衣',
    subtitle: '粗棒针柔软蓬松，秋冬内搭外穿都合适',
    image: '/catalog/sweater-knit.jpg',
    category: 'tops',
    slot: 'top',
    subtype: '毛衣',
    tags: ['毛衣', '米色', '针织', '秋冬'],
  },
  {
    id: 'dress-slip',
    name: '黑色吊带缎面连衣裙',
    subtitle: '细肩带中长款，垂坠缎面，显瘦',
    image: '/catalog/dress-slip.jpg',
    category: 'dresses',
    slot: 'dress',
    subtype: '吊带裙',
    tags: ['连衣裙', '黑色', '缎面', '吊带'],
  },
  {
    id: 'blouse-linen',
    name: '白色亚麻小翻领衬衫',
    subtitle: '天然亚麻，透气微皱，清爽通勤',
    image: '/catalog/blouse-linen.jpg',
    category: 'tops',
    slot: 'top',
    subtype: '衬衫',
    tags: ['衬衫', '白色', '亚麻', '翻领'],
  },
  {
    id: 'skirt-pleated',
    name: '灰色百褶中长半身裙',
    subtitle: '免烫定型褶皱，行走有摆动',
    image: '/catalog/skirt-pleated.jpg',
    category: 'bottoms',
    slot: 'bottom',
    subtype: '百褶裙',
    tags: ['半身裙', '灰色', '百褶', '中长'],
  },
];

export const INITIAL_ORDERS = [
  {
    id: 'ord-261127-01',
    productName: '米色麻花针织毛衣 · 灰色百褶中长半身裙',
    slots: ['top', 'bottom'],
    status: 'success',
    mode: 'studio',
    poseLabel: '对立式手叉腰',
    createdAt: '2026-11-27T10:15:00+08:00',
    resultUrl: DEFAULT_PERSON_URL,
    model: 'seedream-4.0-editorial',
    note: '纯白无影棚 · 连拍成片（前端壳子示例）',
  },
  {
    id: 'ord-261127-02',
    productName: '黑色吊带缎面连衣裙',
    slots: ['dress'],
    status: 'success',
    mode: 'preserve',
    poseLabel: '原图保留',
    createdAt: '2026-11-26T21:40:00+08:00',
    resultUrl: STUDIO_MAKEUP_URL,
    model: 'gpt-image-1.5-fit',
    note: '普通试穿 · 保留原妆面与自然光线（前端壳子示例）',
  },
  {
    id: 'ord-261126-03',
    productName: '白色亚麻小翻领衬衫 · 黑色高腰直筒牛仔裤',
    slots: ['top', 'bottom'],
    status: 'pending',
    mode: 'studio',
    poseLabel: '越肩回眸',
    createdAt: '2026-11-26T18:05:00+08:00',
    resultUrl: '',
    model: 'seedream-4.0-editorial',
    note: '正在生成无影棚成片，可在列表中刷新查看状态',
  },
  {
    id: 'ord-261125-04',
    productName: '红底白色小花短袖衬衫',
    slots: ['top'],
    status: 'failed',
    mode: 'preserve',
    poseLabel: '原图保留',
    createdAt: '2026-11-25T14:22:00+08:00',
    resultUrl: '',
    model: 'flux-kontext-atelier',
    errorMessage: '图片服务超时（演示失败状态，可一键返回工作台重新试拍）。',
  },
];

export const INITIAL_SOURCES = {
  taobao: true,
  jd: false,
  pdd: false,
  douyin: true,
};

export const LOOKBOOK_PRESETS = [
  {
    id: 'commute',
    title: '晨间通勤',
    note: '白色亚麻衬衫叠穿灰色百褶裙，保持利落肩线与自然垂坠。',
    items: ['w-blouse-linen', 'w-skirt-pleated'],
    pose: 'contrapposto',
    backdrop: '纯白无影棚',
    swatch: '#e7e4e0',
  },
  {
    id: 'autumn-knit',
    title: '秋日针织',
    note: '米色麻花毛衣配黑色高腰直筒牛仔裤，暖白棚面衬出织物肌理。',
    items: ['w-sweater-knit', 'w-jeans-black'],
    pose: 'hand-behind-head',
    backdrop: '暖白无缝棚',
    swatch: '#dfd9d1',
  },
  {
    id: 'evening-slip',
    title: '夜色缎面',
    note: '黑色细肩带缎面连衣裙单穿，浅灰无缝棚凸显肩颈与下摆弧度。',
    items: ['w-dress-slip'],
    pose: 'over-shoulder',
    backdrop: '浅灰无缝棚',
    swatch: '#d6d2cc',
  },
];

export function mockParseLink(rawUrl) {
  const text = String(rawUrl || '').trim();
  let platform = 'taobao';
  let platformLabel = '淘宝 / 天猫';
  if (/jd\.com|京东/i.test(text)) {
    platform = 'jd';
    platformLabel = '京东';
  } else if (/pinduoduo|yangkeduo|拼多多/i.test(text)) {
    platform = 'pdd';
    platformLabel = '拼多多';
  } else if (/douyin|抖音/i.test(text)) {
    platform = 'douyin';
    platformLabel = '抖音商城';
  }
  return {
    id: `src-${Date.now()}`,
    platform,
    platformLabel,
    title: '亚麻小翻领通勤套装（本地解析演示）',
    images: [
      { index: 0, url: '/catalog/blouse-linen.jpg', label: '商品主图 1' },
      { index: 1, url: '/catalog/skirt-pleated.jpg', label: '商品主图 2' },
      { index: 2, url: '/catalog/sweater-knit.jpg', label: '商品主图 3' },
      { index: 3, url: '/catalog/dress-slip.jpg', label: '商品主图 4' },
    ],
  };
}
