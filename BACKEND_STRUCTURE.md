# BACKEND_STRUCTURE — 数据模型、API 契约、计费与安全

## 模块划分

```
server.mjs            入口：node --env-file-if-exists=.env server.mjs
src/app.mjs           HTTP 路由、中间件、静态资源、结果票据
src/the image service.mjs        网关发现、模型目录、generate_image + pending 轮询
src/prompt.mjs        服装分类体系与结构化提示词
src/pricing.mjs       按模型/档位的定价表与成本估算
src/source.mjs        商品链接取图：平台识别、短链跟随、OpenCLI 抽取、TTL 缓存
src/store.mjs         JSON 持久化（商品、会话、订单、充值单）
src/tryon.mjs         试穿任务编排（占位→扣费→生成→扣减/退回）
src/validate.mjs      图片/字段校验与限额
src/errors.mjs        统一错误类型
```

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

**订单 orders[]**：`id`、`sessionId`、`productId`、`productName`、`model`、`tier`、`quality`、`size`、`category`、`garmentType`、`prompt`、`priceCents`、`costCents`、`status`、`jobId`、`resultFile`、`createdAt`、`finishedAt`、`errorCode`、`errorMessage`。

- `status`：`pending`（排队/生成中）· `success` · `failed` · `expired`（结果已过期清理）。
- **订单记录不保存人物图与服装图**，只保存提示词与元数据；人像与服装图只在任务内存中流转。

**充值单 payments[]**：`id`、`sessionId`、`packId`、`amountCents`、`status`（pending/paid）、`createdAt`、`paidAt`。

写盘方式：写 `state.json.tmp` 后 rename；会话/订单/充值单按数量上限滚动保留（500/200/100）。

## 定价表（src/pricing.mjs，单次试穿，单位分）

| model | tier | quality | 单次售价 | 成本估算 | 定位 |
| --- | --- | --- | --- | --- | --- |
| minimax-code/MiniMax-Image | fast | medium | 190 | 30 | 引流档 |
| workbuddy/hunyuan-image-alpha | fast | medium | 290 | 40 | 均衡档 |
| workbuddy-ai/hy-image-3.5 | fast | medium | 390 | 40 | 均衡档 |
| codex/gpt-image-2 | standard | medium | 690 | 90 | 精档（主力） |
| codex/gpt-image-2 | premium | high | 1390 | 350 | 尊档 |
| 其它模型 | fast | medium | 390 | 100 | 兜底：目录新模型按默认价，管理员可在 pricing.mjs 覆盖 |

档位不属于该模型时直接 400（不静默回落），避免扣费与前端展示价不一致。

充值包：体验包 ¥1.9、轻享包 ¥9.9、畅玩包 ¥29.9；余额通用，按当前最低档位价折算可试次数。

## 试穿事务语义

1. `POST /api/orders` 校验字段 → 校验会话 → 校验模型与档位 → **占位**（同一会话已有任务则 409）→ 校验余额 → **扣费（冻结）** → 建订单 → 建任务 → 返回。
2. 任务成功：订单 success，冻结额度转为实扣；结果图写入 `data/results/<orderId>.<ext>`。
3. 任务失败/超时/上游无图：订单 failed，冻结额度**全额退回**，记录 `errorCode` 与脱敏错误文案。
4. 占位之后任何异常（含建单失败）都会释放占位并退款，不会出现"扣了钱但没有任务"。
5. 进程重启后内存任务丢失：启动时把磁盘上仍为 `pending` 的订单置为 `failed`（`INTERRUPTED`）并退款。
6. 结果图 24 小时后清理，同时把关联订单置为 `expired`。

## API 契约

所有响应 `application/json; charset=utf-8`。错误统一形状：

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "余额不足，还差 500 分", "field": "balance" } }
```

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | /api/config | — | `{ models:[{id,label,tiers:[{id,label,quality,size,priceCents,costCents}]}], defaultModel, defaultTier, tryOnFromCents, packs, categories, garmentTypes, fits, gateway:{reachable}, limits }` |
| GET | /api/products | `?category=&q=&limit=` | `{ products:[Product] }` |
| GET | /api/products/:id | — | `{ product: Product }` |
| POST | /api/session | `{ deviceId }` | `{ sessionId, balanceCents, packs }` |
| GET | /api/session/:id | — | `{ sessionId, balanceCents, packs }` |
| POST | /api/orders | `{ sessionId, productId?, sourceId?, sourceIndex?, sourceName?, model, tier, category?, garmentType?, fit?, prompt?, person, garment? }` | `{ orderId, jobId, priceCents, balanceCents }` |
| GET | /api/orders | `x-session-id` | `{ orders:[Order] }`（含 jobId，不含 costCents） |
| GET | /api/orders/:id | `x-session-id` | `{ order:Order, resultToken }` |
| GET | /api/jobs/:id | — | `{ jobId, orderId, status, stage, error?, updatedAt }` |
| GET | /api/results/:file | `?k=<token>` | 结果图二进制（票据缺失或过期返回 403） |
| POST | /api/payments | `{ sessionId, packId }` | `{ paymentId, amountCents, status:"pending", channels:[], notice }`（**本地模拟**，部署形态默认关闭） |
| POST | /api/payments/:id/confirm | `{ sessionId }` | `{ paymentId, status:"paid", balanceCents }`（**本地模拟**） |
| POST | /api/tryon | `{ model, person, garment, category, garmentType?, tier?, prompt? }` | 同步生成结果（兼容/本地直连；部署形态默认关闭） |

### 商品链接取图（src/source.mjs）

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| POST | /api/sources | `{ url }`——完整商品链接，或手机分享出来的整段文案 | `{ source:{ id, platform, platformLabel, title, images:[{index, group}] } }` |
| GET | /api/sources/:sourceId/:index | — | 商品图二进制（`no-store`、`nosniff`） |

- 支持淘宝 / 天猫、京东、拼多多、抖音商城；`m.tb.cn`、`e.tb.cn`、`p.pinduoduo.com`、`v.douyin.com` 短链先跟随跳转再判定平台，拼多多的 `goods.html?ps=` 也按短链处理。抖音商城只从跳转地址的 `goods_detail` 取图（H5 详情页对浏览器风控），因此只有主图。
- **列表只给 `index` 与 `group`，不下发原图直链**，取图必须走 `GET /api/sources/:id/:index`，避免把 CDN 地址与 Referer 规则暴露到前端。
- 读取走本机已登录的 OpenCLI；未安装或未登录返回 503 `SOURCE_UNAVAILABLE`，读不到图返回 422 `NO_IMAGES`。
- 缓存 30 分钟、最多 20 条，按 TTL 与容量淘汰；过期返回 404 `SOURCE_EXPIRED`。
- 抽取请求串行执行（OpenCLI 共用同一个浏览器会话，并发会互相踩），单个请求超时 60 秒，排队超过 4 个返回 429 `TOO_MANY_REQUESTS`。
- 淘宝读 `window.__ICE_APP_CONTEXT__.loaderData.home.data.res` 的内嵌数据（`res.item.images` 主图 + `res.skuBase.props[].values[].image` 规格图），不读 DOM：规格图懒加载，未滚进视口的 `img.src` 是 2×2 占位图，从 DOM 只能拿到 4 张。
- 下载只允许各平台 `imageHosts` 白名单、`redirect:'error'`、限 8MiB、`sniff()` 校验格式，并拒绝小于 4KiB 的占位图；下载与短链正文都用流式读取，超限立即断开，不依赖上游 `content-length`。

## 校验与限额

- 图片：仅 `data:image/(png|jpeg|webp);base64,`，解码后 ≤8MiB，magic bytes 与 MIME 必须一致。
- 目录商品图在服务端读盘并转成 data URL，与上传路径走同一套校验与下发方式。
- 请求体 ≤24MiB；输出图 ≤16MiB。
- `prompt` ≤500 码点，只能细化面料/版型/场景；拼接时置于受控段并做单行化与限长。
- `category` 白名单 tops/bottoms/dresses；`garmentType` 必须属于该 category。
- 模型必须出现在当前 `tools/list` 目录中；档位必须属于该模型，否则 400。
- 并发：同一会话同时只允许一个进行中任务（409）。
- 商品链接：只接受 http/https，主机必须在平台白名单内；最多 40 张图；外部商品标题按不可信文本截断到 80 码点后才进提示词。

## 安全

- 开发态仅监听 127.0.0.1，校验 `Host`/`Origin`/`Sec-Fetch-Site`；对外署形态需显式 `PUBLIC_ORIGIN` 白名单与 HTTPS 反代（**本轮不部署**）。
- 部署形态（设置了 `PUBLIC_ORIGIN`）默认关闭本地模拟充值与 `/api/tryon` 直连生成，需显式 `ENABLE_SIMULATED_PAYMENTS=1` 才开启。
- 会话 ID 为随机不可猜测串，仅用于本地演示级归属，**不等于真实鉴权**；真实身份应接抖音/微信登录（`code2session` → openid），本轮留桩未接入。
- 人像与服装图只在任务内存中流转，不写入订单与磁盘；结果图落盘并按 TTL 清理。
- 结果图访问使用带时效的 HMAC 票据，不把会话标识放进 URL。
- 日志与错误消息不含 base64、凭据、完整上游响应体。
- 商品链接取图不把原图 CDN 直链交给浏览器；服务端按平台白名单 + `redirect:'error'` 代取，避免被当成开放代理。抽取只读取当前已登录会话的页面 DOM，不导出 cookie，也不把页面内容回传给前端。
- 静态资源走白名单 + CSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`。
