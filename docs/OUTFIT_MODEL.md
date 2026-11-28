# 穿搭数据模型与接口契约（v3，2025-11-22）

> 本文件是后端与前端实现的**唯一契约**。改动先改这里，再改代码。

## 1. 为什么改
现状只能「一件单品 + 一个分类」。用户要求：
- 上衣 + 下装可以同时选；内搭 + 外套可以叠穿；裙子下面能加丝袜；鞋子单独一栏；还要有首饰等更多品类。
- 测试期任一启动模式均可免费试拍，模型配置在「设置」页。

## 2. 穿搭格子（slot）
| key | 中文 | 多选 | 典型子类（garmentType 前端下拉，来自 data/taxonomy.json） |
| --- | --- | --- | --- |
| `top` | 上衣（内搭） | 否 | T恤 / 衬衫 / 毛衣 / 针织衫 / 卫衣 / 吊带 / 背心 / 马甲 / 打底衫 |
| `outer` | 外套 | 否 | 西装 / 风衣 / 大衣 / 夹克 / 棉服 / 羽绒服 / 开衫 / 皮衣 / 牛仔外套 |
| `bottom` | 下装 | 否 | 半身裙 / 百褶裙 / A字裙 / 包臀裙 / 牛仔裤 / 直筒裤 / 阔腿裤 / 西装裤 / 短裤 |
| `dress` | 连衣裙 | 否 | 吊带裙 / 衬衫裙 / 针织裙 / 礼服裙 |
| `hosiery` | 袜类 | 否 | 连裤袜 / 丝袜 / 过膝袜 / 中筒袜 / 短袜 / 打底裤袜 |
| `shoes` | 鞋 | 否 | 乐福鞋 / 运动鞋 / 帆布鞋 / 短靴 / 长靴 / 高跟鞋 / 凉鞋 / 玛丽珍 |
| `accessory` | 配饰 | **是（最多 2）** | 项链 / 耳环 / 手链 / 戒指 / 帽子 / 围巾 / 腰带 / 包包 / 墨镜 |

约束：
- `dress` 与 `top`、`bottom` **互斥**（选连衣裙时后端忽略/拒绝 top/bottom）。
- 总单品数 ≤ 5。普通试穿最多 6 张参考，自传棚拍最多 7 张，内置人物棚拍最多 8 张（另含同人定妆照和所选骨架）。
- 每个格子同一时间最多一件（`accessory` 最多 2）。

## 3. 请求体
`POST /api/orders`
```json
{
  "sessionId": "...",
  "person": "data:image/png;base64,...",
  "fit": "regular",
  "prompt": "可选，≤500 字",
  "pieces": [
    { "slot": "top",     "garmentType": "毛衣",
      "source": { "kind": "product", "productId": "..." } },
    { "slot": "bottom",  "garmentType": "百褶裙",
      "source": { "kind": "import", "sourceId": "uuid", "sourceIndex": 3, "name": "商品标题" } },
    { "slot": "hosiery", "garmentType": "连裤袜",
      "source": { "kind": "upload", "image": "data:image/png;base64,..." } }
  ]
}
```
- `source.kind`：`product`（目录商品，服务端自己取图）/ `import`（商品链接取图缓存）/ `upload`（前端直传 dataURL）。
- `personSource` 是人物而非单品的来源。工作台发 `builtin` 或 `upload`；显式自传即使像素与内置相同也不附内置脸。`builtin` 字节与登记哈希不符直接拒单；旧客户端不传才按文件识别。内置棚拍所需的第二张脸图由服务端从固定资产读取、校验，不从客户端接收。
- 兼容旧字段：只有 `productId`+`category`+`garmentType` 时，按单件 `top`/`bottom`/`dress` 处理（历史表单与测试保留）。
- 校验：`slot` 必须在白名单；`garmentType` ≤ 24 字；每件必须能取到图；超限返回 400 `INVALID_REQUEST`。

## 4. 响应
`201 { order: { id, status, slots: ["top","bottom"], priceCents }, orderId, jobId, priceCents, balanceCents }`；测试期每笔新单 `priceCents=0`，余额只为旧客户端兼容保留。

## 5. 提示词（src/prompt.mjs）
按**从内到外、从上到下**的顺序描述，每个人物参考图编号写清楚：
1. 图 1 确定人物与身形。仅内置棚拍加图 2 同人定妆照，确定五官与妆面；单品从下一张依次编号，只取衣物、忽略商品模特。棚拍末张只取 PoseWear 骨架。
2. 分层说明：
   - `top`：贴身上衣，塞进下装或按款式自然垂落。
   - `outer`：按所选层级、外套版型和产品图的开合状态穿着。内搭确实露出的部分应保留，不为展示领口或下摆而强行敞开外套。
   - `bottom`：下装；若 `hosiery` 存在，腿部先穿袜类再穿下装，裙摆/裤口下露出袜类质感与颜色。
   - `hosiery`：连裤袜/丝袜覆盖腿部，颜色与厚度按其名称；不得覆盖鞋面。
   - `shoes`：替换脚上原有鞋履，保持脚部姿态。
   - `accessory`：佩戴在相应位置（项链在颈部、耳环在耳、帽子在头顶、包包手提或斜挎）。
3. 保留人物自己的脸、发型、肤色和身材比例，不给自传照套固定尺寸；普通试穿保留原表情、站姿与背景。棚拍依姿势和机位产生正常透视变化；不得残留被替换的旧衣物。
4. 输出：单人、无文字水印、写实。

## 6. 演示模式（DEMO_MODE）
- `GET /api/config` 增加 `demoMode: true|false`（env `DEMO_MODE=1` 时为 true）。
- 两种模式的 `POST /api/orders` 都允许零余额、使用所选模型直接试穿。创建与确认充值都返回 403 `PAYMENT_DISABLED`。
- 演示模式使用规则选搭并关闭旧同步试穿接口，普通模式使用配置的选搭服务。

## 7. 设置页接口
- `GET /api/settings` → `{ model, models: [...同 config], demoMode, sources: { taobao: bool, jd: bool, pdd: bool, douyin: bool }, gateway: { reachable: bool } }`，`sources.*` 只表示**是否配置了 cookie**（淘宝/拼多多），京东/抖音恒为 true（免登录）；绝不返回 cookie 内容。
- `PATCH /api/settings` `{ model }` → 200 `{ model }`，写进 store 的 settings；下单时若未显式传 model 就用它。
- 试穿页不再暴露模型选择；模型只在「设置」页选择。

## 8. 前端信息架构（v3）
| 路由 | 页面 | 要点 |
| --- | --- | --- |
| `#/shop` | 橱窗 | 商品网格 + 分类 + 搜索 + 「导入商品链接」入口 |
| `#/tryon/:id` | 单件试穿（保留） | 兼容旧链接 |
| `#/studio` | **搭配工作台（新）** | 人物照 + 七个穿搭格子（胶囊下拉）+ 开始试穿 + 结果区 |
| `#/import` | 导入商品链接 | 保持现状 |
| `#/wardrobe` | 我的衣橱 | 已导入/收藏的单品，可直接带入工作台 |
| `#/settings` | 设置 | 模型选择、cookie 状态、网关状态、演示模式说明 |

视觉一律按 `FRONTEND_GUIDELINES.md`（v6 framed-sheet：暖石画框 + 白纸面、无紫色）；`docs/frontend-design-reference.md` 只是 v3 时期对 flyne 的历史实测记录，已被 v6 取代。

## 9. 与 TryItOn 原扩展的关系（REA 实证）
`docs/rea-tryiton-categories.md` 结论：原扩展 v9.0.0 **只支持单件单分类**（`POST /tryon/clothes` 只带一个 file + 一个 category + 至多一个 subcategory，无数组），Live 模式也只是「≤12 个 look 逐个切换」，不是同帧叠穿。它的分类字典是：
- clothing：auto / tops / bottoms / dresses
- jewelry：rings / earrings / necklaces / bracelets / anklets
- accessories：watches / belts / scarves / bags / gloves / ties
- eyewear / footwear / headwear：一级分类存在但子类为空

因此本项目七格多选（上衣+外套+下装+袜类+鞋+配饰）是**自建增强**，不是对原扩展的复刻；`accessory` 的子类直接沿用它的 jewelry/accessories/footwear/headwear 词表即可。
