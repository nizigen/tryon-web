# BACKEND_STRUCTURE — 数据模型、API 契约、计费与安全

## W5：IDM HTTP 边界与订单接线

新增 `src/idm.mjs` 薄适配，复用 `decodeImage/decodeBase64/sniff` 与 `deadline/readUpstream`。模型 ID `idm/idm-vton`；只读 `GET /api/workflows/idm/status` 回 `{configured,ready,message}`。生成只走现有 `/api/orders`：preflight 先校验全部 pieces 的分类/件数和健康，再占位建单。任务内新增无图片的 `{slot,layer,garmentType,name}` 元数据，与现有有序 referenceImages 一一对应；不增加另一套订单/状态模型。

远端 `POST /tryon` 仅收 `{person,garment,category,description,seed}`，图片为纯 base64；分类 upper_body/lower_body/dresses，一次一件。服务启动前按 manifest/receipt 逐件 SHA 校验、缓存 Parsing/OpenPose/DensePose 预测器与 SDXL pipeline；忙时在读请求/解码前拒入。内部补白不拉伸，结果裁回原人物画框。Node 适配先验证全部引用与单品，再逐件调用，前段内联结果成为后段人物，不跟随重定向、不代取第三方 URL。响应体 ≤24MiB、图 ≤16MiB、下一段输入 ≤8MiB、严格 base64/图头；错误不转发远端路径/凭据。任一阶段失败沿用整单失败/全额退款；远端超时后或仍运行，不做自动重发。

应用人像/中间图只在任务内存流转；验证脚本的参考图/样本另存为显式实验产物，不代表服务会留存所有用户图。鞋袜/配饰无 IDM 分类；同部位串联不保证露出领口或内层，页面与文档据实表达。

## 模块划分

```
server.mjs            入口：node --env-file-if-exists=.env server.mjs
src/app.mjs           HTTP 路由、中间件、静态资源、结果票据
src/imageapi.mjs      OpenAI 兼容图片服务：模型目录、images/generations 与 images/edits
src/prompt.mjs        服装分类体系与结构化提示词
src/pricing.mjs       按模型/档位的定价表与成本估算
src/source.mjs        商品链接取图：平台识别、短链跟随、淘宝/抖音直连、OpenCLI 兜底、TTL 缓存
src/wardrobe.mjs      我的衣橱：入库（上传 / 导入结果）、编辑、取图、删除、BM25 检索
src/caption.mjs       视觉描述：调对话模型给单品写一句中文描述（失败返回空串）
src/outfit.mjs        AI 今日穿搭：检索候选 → 模型选搭（严格校验）→ 规则回退
src/login.mjs         扫码登录：拉起受控 Chrome、CDP 读全量 cookie（含 HttpOnly）、写 cookies.json
src/cookies.mjs       cookie 文件路径与读取
src/store.mjs         JSON 持久化（商品、会话、订单、充值单、设置）
src/tryon.mjs         试穿任务编排（占位→扣费→生成→扣减/退回）
src/validate.mjs      图片/字段校验与限额
src/errors.mjs        统一错误类型
```

## ComfyUI 与分层契约（2026-11-24）

- 衣橱与订单 pieces 新增 layer enum auto/inner/middle/outer；非法值400，旧数据视为auto。auto 依品类推导有效层；先层后 SLOT_ORDER 排列并共用于图和提示词。
- 模型目录增加 comfyui/foxbaze-tryon；它复用 settings.model 和原订单链路，最多三件服装，固定标准实验档零应用费用（租卡成本由环境持有者承担，未估价）。
- GET /api/workflows/status 只读配置与 /object_info，返回 configured/ready/message，不回地址、密钥或文件路径；下单时同样先预检再占位扣费。
- ComfyUI adapter 只连环境配置的根地址，拒绝重定向，限响应体/输出大小，单任务独立prompt_id，失败/超时走原退款。工作流等待默认900秒（可设 COMFYUI_TIMEOUT_MS），普通API仍120秒。超时仅尝试从queue删除当前prompt，不中断其它任务；无法保证远端已停止。
- 人像上传后会暂存在ComfyUI input目录及历史，区别于本应用内存；4090管理员必须按手册清理专用实例输入/历史。本应用不声称远端不落盘。

## 数据模型

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

**订单 orders[]**：`id`、`sessionId`、`productId`、`productName`、`model`、`tier`、`quality`、`size`、`category`、`garmentType`、`slots`、`pieces`、`photographyMode`、`studioPreset`、`posePreset`、`prompt`、`priceCents`、`costCents`、`status`、`jobId`、`resultFile`、`createdAt`、`finishedAt`、`errorCode`、`errorMessage`。

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

写盘方式：写 `state.json.tmp` 后 rename；会话/订单/充值单按数量上限滚动保留（500/200/100）。

## 定价表（src/pricing.mjs，单次试穿，单位分）

| model | tier | quality | 单次售价 | 成本估算 | 定位 |
| --- | --- | --- | --- | --- | --- |
| minimax-code/MiniMax-Image | fast | medium | 190 | 30 | 引流档 |
| workbuddy/hunyuan-image-alpha | fast | medium | 290 | 40 | 均衡档 |
| workbuddy-ai/hy-image-3.5 | fast | medium | 390 | 40 | 均衡档 |
| codex/gpt-image-2.5 | standard | medium | 690 | 90 | 精档（主力） |
| codex/gpt-image-2.5 | premium | high | 1390 | 350 | 尊档 |
| 其它模型 | fast | medium | 390 | 100 | 兜底：目录新模型按默认价，管理员可在 pricing.mjs 覆盖 |

档位不属于该模型时直接 400（不静默回落），避免扣费与前端展示价不一致。

充值包：体验包 ¥1.9、轻享包 ¥9.9、畅玩包 ¥29.9；余额通用，按当前最低档位价折算可试次数。

## 试穿事务语义

1. `POST /api/orders` 校验字段 → 校验会话 → 校验模型与档位 → 解析每件单品的服装图 → **占位**（同一会话已有任务则 409）→ 校验余额 → **扣费（冻结）** → 建订单 → 建任务 → 返回。
2. 任务成功：订单 success，冻结额度转为实扣；结果图写入 `data/results/<orderId>.<ext>`。
3. 任务失败/超时/上游无图：订单 failed，冻结额度**全额退回**，记录 `errorCode` 与脱敏错误文案。
4. 占位之后任何异常（含建单失败、某件单品取图失败）都会释放占位并退款，不会出现"扣了钱但没有任务"。
5. 进程重启后内存任务丢失：启动时把磁盘上仍为 `pending` 的订单置为 `failed`（`INTERRUPTED`）并退款。
6. 结果图 24 小时后清理，同时把关联订单置为 `expired`。
7. **演示模式**（`DEMO_MODE=1`）：`priceCents`/`costCents` 一律为 0，跳过余额校验与扣费，`POST /api/payments` 与确认接口返回 403 `PAYMENT_DISABLED`。任务编排与结果产物和真实模式完全一致，便于验收。

## API 契约

所有响应 `application/json; charset=utf-8`。错误统一形状：

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "余额不足，还差 500 分", "field": "balance" } }
```

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | /api/config | — | `{ models:[{id,label,tiers:[{id,label,quality,size,priceCents,costCents}]}], defaultModel, defaultTier, tryOnFromCents, packs, categories, slots, garmentTypes, fits, studioPresets:[{id,label,hint}], posePresets:[{id,label,hint,posewearId,referenceUrl}], defaultStudioPreset, defaultPosePreset, demoMode, gateway:{reachable}, limits }` |
| GET | /api/products | `?category=&q=&limit=` | `{ products:[Product] }` |
| GET | /api/products/:id | — | `{ product: Product }` |
| POST | /api/session | `{ deviceId }` | `{ sessionId, balanceCents, packs }` |
| GET | /api/session/:id | — | `{ sessionId, balanceCents, packs }` |
| GET | /api/settings | — | `{ model, models, demoMode, sources:{taobao,jd,pdd,douyin}, gateway:{reachable} }`（`sources` 只回布尔，不回 cookie） |
| PATCH | /api/settings | `{ model }` | `{ model }` |
| POST | /api/orders | `{ sessionId, pieces:[{slot, garmentType?, source}], model, tier, fit?, prompt?, person, photographyMode?, studioPreset?, posePreset? }`；`pieces[].source` 为 `{kind:'product', productId}` / `{kind:'import', sourceId, sourceIndex, name}` / `{kind:'upload', garment}` / `{kind:'wardrobe', wardrobeId}`；兼容旧的单件入参 `{productId?/category?/garmentType?/sourceId?/sourceIndex?/sourceName?, garment?}` | `{ order:{id,status,slots,priceCents}, orderId, jobId, priceCents, balanceCents }` |
| GET | /api/orders | `x-session-id` | `{ orders:[Order] }`（含 jobId、slots，不含 costCents） |
| GET | /api/orders/:id | `x-session-id` | `{ order:Order, resultToken }` |
| GET | /api/jobs/:id | — | `{ jobId, orderId, status, stage, error?, updatedAt }` |
| GET | /api/results/:file | `?k=<token>` | 结果图二进制（票据缺失或过期返回 403） |
| POST | /api/payments | `{ sessionId, packId }` | `{ paymentId, amountCents, status:"pending", channels:[], notice }`（**本地模拟**，部署形态与演示模式默认关闭） |
| POST | /api/payments/:id/confirm | `{ sessionId }` | `{ paymentId, status:"paid", balanceCents }`（**本地模拟**） |
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
- 服务端按 `SLOT_ORDER`（top → outer → bottom → dress → hosiery → shoes → accessory）排序后再拼提示词与参考图，保证「reference image N」编号与实际顺序一致：第 1 张恒为人物，其后依次为各件单品。
- 每件单品的服装图在**占位之前**全部取好（目录商品读盘、导入走 `sourceId`、上传走 data URL、衣橱走 `wardrobeId`），任一件失败都不会占用任务槽或扣费。

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
- `photographyMode` 缺省为 `preserve`，保持旧请求行为；`studio` 必须在取图、扣费、建单前验证 `studioPreset` 与 `posePreset` 属于服务端固定目录，非字符串姿势 ID 一律 400。无影棚三姿势由前端顺序创建三笔独立订单，服务端不新增批量订单状态机。
- 无影棚生成按 `[人物, ...有序服装, 本地 PoseWear 参考图]` 组装，姿势图固定为最后一张且只提供骨骼与身体力学；订单只持久化姿势 ID，不持久化姿势图或人像。输出尺寸固定为 `1024x1536`（2:3），提示词不得声明另一画幅。
- 仅支持多参考图编辑的图片模型接受 `studio`；IDM-VTON 与 ComfyUI 拼图工作流在取图、扣费前返回 400 `MODEL_MODE_UNSUPPORTED`，客户端应保持普通试穿并禁用无影棚入口。
- 模型必须出现在当前 `GET /v1/models` 目录中（或由 `IMAGE_MODELS` 显式指定）；档位必须属于该模型，否则 400。
- 并发：同一会话同时只允许一个进行中任务（409）。
- 商品链接：只接受 http/https，主机必须在平台白名单内；最多 40 张图；外部商品标题按不可信文本截断到 80 码点后才进提示词。
- `PATCH /api/settings` 只接受 `model` 一个字段，长度 ≤120，且必须出现在当前图片服务模型目录里（否则 400 `MODEL_UNAVAILABLE`）。
- 衣橱：`id` 只允许 `[0-9a-f-]`，读取时二次校验落在 `data/wardrobe/` 内；`name`/`tags`/`description` 走 `sanitizeText`（去控制符、零宽、尖括号）。
- `POST /api/outfit/suggest` 的 `request` ≤200 码点；AI 返回只用于选搭，任何字符串都当不可信文本渲染。
- 扫码登录接口只允许 `taobao|jd|pdd`，不接收用户给的 URL 或路径；profile 目录固定为 `data/browser-profile/`。

## 安全

- 开发态仅监听 127.0.0.1，校验 `Host`/`Origin`/`Sec-Fetch-Site`；对外署形态需显式 `PUBLIC_ORIGIN` 白名单与 HTTPS 反代（**本轮不部署**）。
- 部署形态（设置了 `PUBLIC_ORIGIN`）默认关闭本地模拟充值与 `/api/tryon` 直连生成，需显式 `ENABLE_SIMULATED_PAYMENTS=1` 才开启。
- 会话 ID 为随机不可猜测串，仅用于本地演示级归属，**不等于真实鉴权**；真实身份应接抖音/微信登录（`code2session` → openid），本轮留桩未接入。
- 演示模式（`DEMO_MODE=1`）只影响计费与前端展示，不降低鉴权或校验强度；开启时充值接口显式 403，避免演示环境被当成真实收款通道。
- 人像与服装图只在任务内存中流转，不写入订单与磁盘；结果图落盘并按 TTL 清理。
- 结果图访问使用带时效的 HMAC 票据，不把会话标识放进 URL。
- 日志与错误消息不含 base64、凭据、完整上游响应体。
- 商品链接取图不把原图 CDN 直链交给浏览器；服务端按平台白名单 + `redirect:'error'` 代取，避免被当成开放代理。淘宝/抖音直连只用 `data/cookies.json`（git-ignored）里的 cookie，不回传前端；京东/拼多多直连只读页面内嵌数据（京东免登录；拼多多用 `data/cookies.json` 的 pdd cookie），不导出 cookie 给前端。
- 静态资源走白名单 + CSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`。
