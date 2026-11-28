# BACKEND_STRUCTURE — 数据模型、API 契约、计费与安全

W9 测试期间，新订单统一以零分写入，保留档位对应的真实模型参数、输入校验、单任务限制与结果票据。充值入口停止接受新交易，已有记录继续可读，重启时按旧单实际冻结金额处理。旧设置和环境变量不能重新开启应用内计费。本文历史增量里的冻结规则只适用于存量订单。

W10 内置棚拍输入契约为「11-26 正面全身、同人定妆照、按层排序的单品、所选 PoseWear 骨架」。图 1 只定身材与长黑发长度；图 2 的固定路径为 `/model/posewear-01/face-studio-makeup.png`，当前 R5 提供自然披发与 R4b 的五官、脸型和妆面。v3r3 是制作和核对定妆照的身份母本。服务端负责选择文件、核对 SHA-256，并在建单前报告 `FACE_REFERENCE_INVALID`；客户端不能指定另一张脸图。普通试穿和显式自传人物各使用自身的外观。

W11 的内置人物图 1 使用从 R5 三视图正面导出的 `model-front.png`，继承 11-26 的身材、衣着与姿势。工作台与设计预览从同一资产登记生成版本链接，棚拍输入图序沿用上述契约。

普通试穿与无影棚均调用 `src/imageapi.mjs` 的多图编辑接口。设置写入、下单、旧同步接口及底层生成器显式收到已停用的试穿模型时，直接返回 400 `MODEL_UNAVAILABLE`，不查询模型目录也不发起生成。存量设置选中过旧模型且当前目录有有效模型时，下单缺省使用当前默认模型。历史订单按原记录提供详情与结果。

## 模块划分

```
server.mjs            入口：node --env-file-if-exists=.env server.mjs
src/app.mjs           HTTP 路由、中间件、静态资源、结果票据
src/imageapi.mjs      OpenAI 兼容图片服务：模型目录、images/generations 与 images/edits
src/prompt.mjs        服装分类体系与结构化提示词
src/pricing.mjs       模型档位、质量、尺寸与零分兼容字段
src/source.mjs        商品链接取图：平台识别、短链跟随、淘宝/抖音直连、OpenCLI 兜底、TTL 缓存
src/wardrobe.mjs      我的衣橱：入库（上传 / 导入结果）、编辑、取图、删除、BM25 检索
src/caption.mjs       视觉描述：调对话模型给单品写一句中文描述（失败返回空串）
src/outfit.mjs        AI 今日穿搭：检索候选 → 模型选搭（严格校验）→ 规则回退
src/login.mjs         扫码登录：拉起受控 Chrome、CDP 读全量 cookie（含 HttpOnly）、写 cookies.json
src/cookies.mjs       cookie 文件路径与读取
src/store.mjs         会话、零分订单、历史账目与设置的原子持久化，读取商品目录
src/tryon.mjs         占位、排队、生成、结果写入及中断订单恢复
src/validate.mjs      图片/字段校验与限额
src/errors.mjs        统一错误类型
```

## 单品分层

- 衣橱与订单 pieces 新增 layer enum auto/inner/middle/outer；非法值400，旧数据视为auto。auto 依品类推导有效层；先层后 SLOT_ORDER 排列并共用于图和提示词。

## 数据模型

无影棚首张人物图跟随当前选择。显式 `upload` 保留来图身份，即使它与内置正面照逐字节相同。`builtin` 必须匹配登记的全身 PNG 字节；缺省 `personSource` 的旧请求由服务端按字节判定。内置棚拍的定妆文件缺失或摘要不符时停止该次生成。上传人像与其指纹只在请求内使用。

**商品**（只读目录 `data/catalog.json`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | 商品 ID |
| name | string | 商品名 |
| subtitle | string | 卖点/材质一句话 |
| image | string | 商品图相对路径（public/ 下） |
| priceCents | number | 售价（分） |
| category | enum | tops / bottoms / dresses |
| garmentType | enum | 服装子类，决定替换区域语义 |
| tags | string[] | 标签 |
| shopLink | string? | 抖音小店商品链接（可空） |

**会话 sessions[]**（`data/state.json`）：`id`、`deviceId`、`balanceCents`（余额，单位分）、`createdAt`、`lastSeenAt`。

**订单 orders[]**：`id`、`sessionId`、`productId`、`productName`、`model`、`tier`、`quality`、`size`、`category`、`garmentType`、`slots`、`pieces`、`photographyMode`、`studioPreset`、`posePreset`、`prompt`、`priceCents`、`status`、`jobId`、`resultFile`、`createdAt`、`finishedAt`、`errorCode`、`errorMessage`。旧记录可含 `costCents`；曾冻结的中断单恢复时记录 `refund:{status,amountCents}`。

- `status`：`pending`（排队/生成中）· `success` · `failed` · `expired`（结果已过期清理）。
- `slots` 是这次搭配用到的格子（`top/outer/bottom/dress/hosiery/shoes/accessory`，accessory 可出现两次）；`pieces` 记录每格的服装子类与名称，不含图片。
- `photographyMode` 为 `preserve` 或 `studio`；普通试穿保存为 `preserve` 且棚拍字段为 null。无影棚保存固定 `studioPreset` 与 `posePreset`，旧订单读取时默认 `preserve`。
- **订单记录不保存人物图与服装图**，只保存提示词与元数据；人像与服装图只在任务内存中流转。

**设置 settings**（`data/state.json` 的 `settings`）：`model`——设置页选定的图片模型，`null` 表示跟随目录默认值。只在设置页写，下单时不再让用户选模型。

**衣橱 wardrobe**（`data/wardrobe.json` 索引 + `data/wardrobe/<id>.<ext>` 图片，均被 `.gitignore` 忽略）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `randomUUID()`，同时用作图片文件名，入库前校验只含 `[0-9a-f-]` |
| name | string | 单品名（≤80 码点） |
| category | enum | 七大类：top / outer / bottom / dress / hosiery / shoes / accessory |
| subtype | string | 子类（来自 `data/taxonomy.json`，可空） |
| tags | string[] | 标签 |
| description | string | 一句中文描述，入库时若为空则调视觉模型补写；模型不可用时留空 |
| imageFile | string | `<id>.<ext>`，读取时按 id 重建路径并校验落在 `data/wardrobe/` 内 |
| mime / bytes / sha256 | string / number / string | 入库时算好，供检索与去重参考 |
| source | object | `{kind:'upload'}` / `{kind:'import', sourceId, sourceIndex, platform}` / `{kind:'product', productId}` |
| createdAt | string | ISO 时间 |

**登录会话 logins**（内存态，不落盘）：`{platform, state:'starting'|'waiting'|'done'|'failed'|'expired', sessionId, startedAt, profileDir}`；每个平台同时只允许一个会话，cookie 写到 `data/cookies.json` 的对应平台键（只改该键，保留其它键）。

**充值单 payments[]**：`id`、`sessionId`、`packId`、`amountCents`、`status`（pending/paid）、`createdAt`、`paidAt`。

写盘方式为临时文件原子替换。滚动保留普通会话与订单，同时保留历史付费订单、未完成订单、旧充值记录及关联会话。

## 测试期模型档位

`src/pricing.mjs` 保存各模型可用的档位、质量和尺寸。模型与档位不匹配返回 400。所有新订单 `priceCents` 均为 0，配置与会话接口的 `packs` 为空数组。

## 试穿事务语义

1. `POST /api/orders` 校验会话、模型、档位及输入后，占用会话的任务名额（同会话同时提交返回 409），创建零分订单和任务，持久化该订单的 `jobId` 后才启动生成。
2. 成功时写入 `data/results/<orderId>.<ext>`，失败时记录实际错误并释放名额。新订单在两种结果下均不改变余额。
3. 重启将遗留 `pending` 单置为 `failed`，标记 `INTERRUPTED`。旧付费单与退款在同一次原子写入中结算；若旧会话已被淘汰，保留原 `sessionId`、冻结金额及 `refund.status=needs_review` 供核对，其它订单继续恢复。
4. 结果保留 24 小时，到期将关联订单置为 `expired`。两种启动模式均拒绝充值与确认请求；`DEMO_MODE=1` 继续使用规则选搭并关闭旧直连生成入口。

## API 契约

未注册的 API 路径返回 404 `NOT_FOUND`。路径已注册但不支持所用 HTTP 方法时返回 405 `METHOD_NOT_ALLOWED`，响应头 `Allow` 列出该路径已注册的方法。

所有响应 `application/json; charset=utf-8`。错误统一形状：

```json
{ "error": { "code": "INVALID_REQUEST", "message": "所选档位不属于该模型", "field": "tier" } }
```

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | /api/config | — | `{ models:[{id,label,tiers:[{id,label,quality,size,priceCents:0}]}], defaultModel, defaultTier, tryOnFromCents:0, packs:[], categories, slots, garmentTypes, fits, studioPresets:[{id,label,hint}], posePresets:[{id,label,hint,posewearId,referenceUrl}], defaultStudioPreset, defaultPosePreset, demoMode, gateway:{reachable}, limits }` |
| GET | /api/products | `?category=&q=&limit=` | `{ products:[Product] }` |
| GET | /api/products/:id | — | `{ product: Product }` |
| POST | /api/session | `{ deviceId }` | `{ sessionId, balanceCents, packs }` |
| GET | /api/session/:id | — | `{ sessionId, balanceCents, packs }` |
| GET | /api/settings | — | `{ model, models, demoMode, sources:{taobao,jd,pdd,douyin}, gateway:{reachable} }`（`sources` 只回布尔，不回 cookie） |
| PATCH | /api/settings | `{ model }` | `{ model }` |
| POST | /api/orders | `{ sessionId, pieces:[{slot, garmentType?, source}], model?, tier?, fit?, prompt?, person, personSource?, photographyMode?, studioPreset?, posePreset? }`；`pieces[].source` 为 `{kind:'product', productId}` / `{kind:'import', sourceId, sourceIndex, name}` / `{kind:'upload', image}` / `{kind:'wardrobe', wardrobeId}`；兼容旧的单件入参 `{productId?/category?/garmentType?/sourceId?/sourceIndex?/sourceName?, garment?}` | `{ order:{id,status,slots,priceCents}, orderId, jobId, priceCents, balanceCents }` |
| GET | /api/orders | `x-session-id` | `{ orders:[Order] }`（含 jobId、slots，不含 costCents） |
| GET | /api/orders/:id | `x-session-id` | `{ order:{...Order, hasResult, resultToken} }` |
| GET | /api/jobs/:id | — | `{ jobId, orderId, status, stage, error?, updatedAt }` |
| GET | /api/results/:file | `?k=<token>` | 结果图二进制（票据缺失或过期返回 403） |
| POST | /api/payments | 旧客户端兼容入口 | 403 `PAYMENT_DISABLED` |
| POST | /api/payments/:id/confirm | 旧客户端兼容入口 | 403 `PAYMENT_DISABLED` |
| POST | /api/tryon | `{ model, person, garment, category, garmentType?, tier?, prompt? }` | 同步生成结果（兼容/本地直连；部署形态与演示模式默认关闭） |
| GET | /api/wardrobe | — | `{ items:[{id,name,category,subtype,tags,description,source,imageUrl,createdAt}] }` |
| POST | /api/wardrobe | `{ name, category, subtype?, tags?, description?, image }` 或 `{ ..., sourceId, sourceIndex }`（从导入结果取图） | `{ item }`（201） |
| DELETE | /api/wardrobe/:id | — | `{ ok:true }`（不存在 404 `WARDROBE_NOT_FOUND`） |
| PATCH | /api/wardrobe/:id | `{ name?, category?, subtype?, tags?, description? }`（只改传入字段，图片不参与） | `{ item }`（不存在 404 `WARDROBE_NOT_FOUND`，名称空/类目非法 400 `INVALID_REQUEST`） |
| GET | /api/wardrobe/:id/image | — | 单品图二进制（`no-store`、`nosniff`） |
| POST | /api/wardrobe/search | `{ query }` | `{ results:[{item,score}] }`（BM25，只回 score>0） |
| POST | /api/outfit/suggest | `{ request }`（≤200 码点） | `{ suggestion:{ slots:{top?,outer?,bottom?,dress?,hosiery?,shoes?,accessory?}, reason, missing:[slot] } }`（`slots` 里每格是衣橱单品视图，配饰可能是数组） |
| POST | /api/login/:platform | —（platform ∈ taobao/jd/pdd） | `{ sessionId }`（202；已有会话 409 `LOGIN_IN_PROGRESS`） |
| GET | /api/login/:platform/status | `?sessionId=` | `{ status, platform }`（未知 session 返回 `expired`） |
| POST | /api/login/:platform/cancel | `{ sessionId }` | 204 |

- **回包形状**：优先读 `data[0].b64_json`；服务只给 `data[0].url` 时，仅当该地址与 `IMAGE_API_BASE_URL` 同源才去取回，第三方地址一律拒绝并报 `UPSTREAM_FORMAT`（避免服务端被当成任意 URL 的取信通道）。
- **目录不可用**：`GET /models` 连不上或没有该端点时退回 `IMAGE_MODEL`（默认 `codex/gpt-image-2.5`），不让整个功能失效；真正的可达性由生成请求自己报。

### 多件搭配（pieces）

- 七个格子：`top` 上衣、`outer` 外套、`bottom` 下装、`dress` 连衣裙、`hosiery` 袜、`shoes` 鞋、`accessory` 配饰。
- 每个格子最多一件，`accessory` 最多两件，单次总件数 ≤5（`limits.maxPieces`）。
- `dress` 与 `top`/`bottom` 互斥（同时出现返回 400）。
- 单品按有效穿着层排序，同层再按 `SLOT_ORDER`；相同次序用于图号与上传。第 1 张恒为人物；内置棚拍的单品从第 3 张起，其余从第 2 张起。
- 每件单品的服装图在**占位之前**全部取好（目录商品读盘、导入走 `sourceId`、上传走 data URL、衣橱走 `wardrobeId`），任一件失败都不会占用任务槽。

### 我的衣橱（src/wardrobe.mjs）

- 入库只接受 `data:image/(png|jpeg|webp);base64,` 或 `{sourceId, sourceIndex}`；解码后 ≤8MiB，`sniff()` 必须与 MIME 一致（gif 等直接 400 `INVALID_IMAGE`）。
- `category` 必须在七大类白名单内；`subtype` 可选，前端上传弹层用两级下拉让用户选到子类（如 `bottom/百褶裙`），导入页则用「这件属于哪一类」的胶囊决定 `category`；`name` ≤80 码点；`tags` 最多 12 个、每个 ≤20 码点。
- 图片写入 `data/wardrobe/<id>.<ext>`，`id` 用 `randomUUID()`；读取时按 id 重建路径并校验仍在 `data/wardrobe/` 内，防止路径穿越。
- 索引写盘走 `.tmp` → rename，写入串行化，避免并发写坏 JSON。
- 入库时若 `description` 为空，调 `src/caption.mjs` 用视觉模型补一句（`CAPTION_MODEL`，默认 `codex/gpt-6.1-sol`，8s 超时）；模型失败只是留空，不影响入库。
- `search` 用 BM25（中文按单字 + 二元组切分，索引 `name`/`description`/`subtype`/`category`/`tags`），只返回 score>0 的结果。

### AI 今日穿搭（src/outfit.mjs）

- 先 `wardrobe.search(request, 12)`；**候选凑不成一套时从全量衣橱补齐**（缺上衣/下装且没有连衣裙时，把最多 24 件全量单品并进候选）。两个原因实测都会踩到：需求句往往不含单品关键词（「今天去逛街，想穿得清爽一点」BM25 零命中），命中也常只落在某一格（只搜到上衣，下装凑不出来）。
- 候选交给 `STYLIST_MODEL`（默认同 `CAPTION_MODEL`），要求只回 JSON；返回后严格校验：id 必须存在于候选、`category` 必须与格子匹配、`accessory` ≤2、`dress` 与 `top`/`bottom` 互斥。任一非法则整体判为不可用。
- 模型不可用/超时/返回非法 JSON 时走 `rulePick` 规则回退（连衣裙优先，否则上衣+下装，再补外套/袜/鞋，配饰 ≤2），并在 `missing` 里报告缺的格子。
- 只做选搭，不生成图片；出图仍走 `POST /api/orders`。

### 扫码登录（src/login.mjs）

- 每个平台一个会话，`start` 时用**受控 Chrome**（独立 `--user-data-dir`，落在 `data/browser-profile/`）打开对应登录页，然后经 CDP `Network.getAllCookies` 读取**含 HttpOnly** 的全量 cookie（OpenCLI 的 `browser eval` 拿不到 HttpOnly，故不走它）。
- 判据只认真正的登录标识：淘宝 `unb`、京东 `pt_key`、拼多多 `PASS_ID`。**`cookie2` 在未登录访客页也会下发，不能当判据**（实测会误判成功并覆盖真实 cookie）。
- 同一域名的多个 cookie 按 `domainRank`（带前导点 > 标签数 > 长度）取，保证 `.taobao.com` 胜过 host-only 的 `login.taobao.com`（后者不会随商品页请求发出）。
- 成功后只改 `data/cookies.json` 里该平台的键，串行写 + `.tmp` → rename；超时（默认 300s，`LOGIN_TIMEOUT_MS`）或失败统一 503 `LOGIN_UNAVAILABLE`。
- 进程退出（SIGINT/SIGTERM）时 `dispose()` 杀掉受控 Chrome，避免残留进程。

### 商品链接取图（src/source.mjs）

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| POST | /api/sources | `{ url }`——完整商品链接，或手机分享出来的整段文案 | `{ source:{ id, platform, platformLabel, title, images:[{index, group}] } }` |
| GET | /api/sources/:sourceId/:index | — | 商品图二进制（`no-store`、`nosniff`） |

- 支持淘宝 / 天猫、京东、拼多多、抖音（商城商品 + 视频/图文帖）；`m.tb.cn`、`e.tb.cn`、`p.pinduoduo.com`、`v.douyin.com` 短链先跟随跳转再判定平台，拼多多的 `goods.html?ps=` 也按短链处理。
- **取图路线（四家全部直连，均不开浏览器）**：淘宝用 `data/cookies.json` 里的登录 cookie 调 mtop `pcdetail`（握手取 `_m_h5_tk` 再签名）；抖音商品从跳转地址 `goods_detail` 取主图、抖音视频/图文帖用 ttwid 请求 iesdouyin 分享页解析 `_ROUTER_DATA`；京东读 `item.m.jd.com/product/<sku>.html` 的 `window._itemOnly`（免登录，图片前缀 `https://img14.360buyimg.com/n0/`）；拼多多读 `goods1.html` 的 `window.rawData`（需 pdd cookie，无 cookie 返回 503 提示把 pdd cookie 放进 `data/cookies.json`）。OpenCLI 只在直连失败且本机装有 OpenCLI 时兜底，传 `runCli:null` 可显式禁用。淘宝无 cookie 又无 OpenCLI 时返回 503 `SOURCE_UNAVAILABLE`。
- **列表只给 `index` 与 `group`，不下发原图直链**，取图必须走 `GET /api/sources/:id/:index`，避免把 CDN 地址与 Referer 规则暴露到前端。
- 抖音视频/图文帖的图片 CDN 直链基本一次性（第二次请求 403），解析时即把字节取回并入内存（单张 ≤8MiB、最多 9 张、累计 ≤24MiB），`download` 命中缓存直接返回，全部取不到才 422 `NO_IMAGES`。
- 缓存 30 分钟、最多 20 条，按 TTL 与容量（LRU）淘汰；过期返回 404 `SOURCE_EXPIRED`。
- 抽取请求串行执行（复用同一队列；OpenCLI 兜底时才共享浏览器会话），单个请求超时 60 秒，排队超过 4 个返回 429 `TOO_MANY_REQUESTS`。
- 淘宝直连读 mtop 返回的 `res.item.images` 主图与 `res.skuBase.props[].values[].image` 规格图；OpenCLI 兜底才读 `window.__ICE_APP_CONTEXT__` 内嵌数据，DOM 分组仅作最后兜底（规格图懒加载，DOM 只有 2×2 占位图）。
- 下载只允许各平台 `imageHosts` 白名单、`redirect:'error'`、限 8MiB、`sniff()` 校验格式，并拒绝小于 4KiB 的占位图；下载与短链正文都用流式读取，超限立即断开，不依赖上游 `content-length`。抖音用手机 UA（`platform.ua`）。

## 校验与限额

- 图片：仅 `data:image/(png|jpeg|webp);base64,`，解码后 ≤8MiB，magic bytes 与 MIME 必须一致。
- 目录商品图在服务端读盘并转成 data URL，与上传路径走同一套校验与下发方式。
- 请求体 ≤24MiB；输出图 ≤16MiB。
- `prompt` ≤500 码点，只能细化面料/版型/场景；拼接时置于受控段并做单行化与限长。
- `pieces`：`slot` 必须属于七格白名单；`garmentType` 必须属于该格的服装子类；每格至多一件（`accessory` 至多两件）；总数 ≤5；`dress` 与 `top`/`bottom` 互斥。
- `photographyMode` 缺省为 `preserve`。`studio` 在取图、建单前验证 `studioPreset` 与 `posePreset` 属于服务端固定目录，非字符串姿势 ID 返回 400。三姿势由前端依次建三张独立订单。
- 内置棚拍依次上传人物全身、同人定妆 PNG、服装和 PoseWear 骨架。自传棚拍从图 2 起放衣物，普通换装只发人物和衣物。订单保存姿势 ID 和图片角色对应的提示词；棚拍请求指定 `1024x1536`。
- 无影棚依赖所选图片模型接受多参考图编辑，生成失败时保留上游错误与订单状态。
- 模型必须出现在当前 `GET /v1/models` 目录中（或由 `IMAGE_MODELS` 显式指定）；档位必须属于该模型，否则 400。
- 并发：同一会话同时只允许一个进行中任务（409）。
- 商品链接：只接受 http/https，主机必须在平台白名单内；最多 40 张图；外部商品标题按不可信文本截断到 80 码点后才进提示词。
- `PATCH /api/settings` 只接受 `model` 一个字段，长度 ≤120，且必须出现在当前图片服务模型目录里（否则 400 `MODEL_UNAVAILABLE`）。
- 衣橱：`id` 只允许 `[0-9a-f-]`，读取时二次校验落在 `data/wardrobe/` 内；`name`/`tags`/`description` 走 `sanitizeText`（去控制符、零宽、尖括号）。
- `POST /api/outfit/suggest` 的 `request` ≤200 码点；AI 返回只用于选搭，任何字符串都当不可信文本渲染。
- 扫码登录接口只允许 `taobao|jd|pdd`，不接收用户给的 URL 或路径；profile 目录固定为 `data/browser-profile/`。

## 安全

- 开发态仅监听 127.0.0.1，校验 `Host`/`Origin`/`Sec-Fetch-Site`；对外署形态需显式 `PUBLIC_ORIGIN` 白名单与 HTTPS 反代（**本轮不部署**）。
- `PUBLIC_ORIGIN` 下默认关闭旧同步 `/api/tryon`。可信部署可用 `ENABLE_RAW_TRYON=1` 开启该入口；旧 `ENABLE_SIMULATED_PAYMENTS=1` 仅保留相同的直连兼容行为。充值创建与确认始终返回 403。
- 会话 ID 为随机不可猜测串，仅用于本地演示级归属，**不等于真实鉴权**；真实身份应接抖音/微信登录（`code2session` → openid），本轮留桩未接入。
- `DEMO_MODE=1` 使用规则选搭并关闭旧同步生成入口。两种模式的正常试穿均通过零分订单调用所选模型。
- 人像与服装图只在任务内存中流转，不写入订单与磁盘；结果图落盘并按 TTL 清理。
- 结果图访问使用带时效的 HMAC 票据，不把会话标识放进 URL。
- 日志与错误消息不含 base64、凭据、完整上游响应体。
- 商品链接取图不把原图 CDN 直链交给浏览器；服务端按平台白名单 + `redirect:'error'` 代取，避免被当成开放代理。淘宝/抖音直连只用 `data/cookies.json`（git-ignored）里的 cookie，不回传前端；京东/拼多多直连只读页面内嵌数据（京东免登录；拼多多用 `data/cookies.json` 的 pdd cookie），不导出 cookie 给前端。
- 静态资源走白名单 + CSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`。
