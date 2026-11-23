# v4 契约：两级分类、衣橱、扫码登录、图文检索、今日穿搭

本文件是本轮（v4）子任务之间的**唯一接口契约**。任何实现必须与这里的字段名、路由、错误码一致；要改契约先改本文件。

## 0. 通用约束

- 仓库 `C:\GitHub\tryon-web`，Node 24 原生 ESM，**零第三方依赖**。
- 后端模块放 `src/*.mjs`，前端页面放 `public/views/*.js`，样式 `public/style.css` 与 `public/style-wardrobe.css`。
- 错误一律用 `src/app.mjs` 里的 `HttpError(status, code, message, field?)`。
- 测试用 `node --test`（`test/*.test.mjs`）。
- **禁止用 PowerShell 的 `Get-Content -Raw | Set-Content` 写文件**：会把 UTF-8 中文变成乱码。只允许用 write / edit 工具或 `[System.IO.File]::WriteAllText(path, text, [System.Text.UTF8Encoding]::new($false))`。
- 不 `git commit`、不重启服务、不调用付费上游生成（除今日穿搭的测试可 mock）。

## 1. 衣橱数据层（`src/wardrobe.mjs`）

存储：
- 索引 `data/wardrobe.json`：`{ "version": 1, "items": [Item] }`
- 图片 `data/wardrobe/<id>.<ext>`（ext 由 mime 决定：image/png→png、image/jpeg→jpg、image/webp→webp）

`Item`：
```json
{
  "id": "uuid",
  "name": "商品名或用户填的名字",
  "category": "top|outer|bottom|dress|hosiery|shoes|accessory",
  "subtype": "子类名，可为空字符串",
  "tags": ["白衬衫", "通勤"],
  "description": "一句话中文描述（视觉模型生成或用户填）",
  "imageFile": "<id>.jpg",
  "mime": "image/jpeg",
  "bytes": 12345,
  "sha256": "hex",
  "source": "import|upload",
  "createdAt": "ISO"
}
```

导出：
```js
export function createWardrobe({ dir = 'data', fetchImpl = fetch, env = process.env, captioner } = {})
// 返回对象：
//   list(): Promise<Item[]>                       按 createdAt 倒序
//   get(id): Promise<Item|null>
//   add({ name, category, subtype, tags, description, image /* dataUrl */, source }): Promise<Item>
//   remove(id): Promise<boolean>
//   readImage(id): Promise<{ mime, buffer }|null>
//   search(query, limit = 8): Promise<{ item, score }[]>   // BM25/关键词
```
- `add` 必须校验 mime 白名单（png/jpeg/webp）与 `MAX_IMAGE_BYTES`（复用 `src/validate.mjs` 的 `decodeImage`），落盘后重新计算 sha256。
- 若 `description` 为空且传入了 `captioner`，调用 `captioner(buffer, mime)` 生成一句话描述；失败则留空，不阻断入橱。
- 并发安全：模块内用一个 Promise 串行队列（同 `src/source.mjs` 的写法）保护索引读写。

## 2. 图片描述（`src/caption.mjs`）

```js
export function createCaptioner({ env = process.env, fetchImpl = fetch } = {})
// 返回 { available: boolean, caption(buffer, mime): Promise<string> }
```
- 走 OpenAI 兼容的对话接口：`POST {CHAT_API_BASE_URL||IMAGE_API_BASE_URL}/chat/completions`，有 `CHAT_API_KEY` 或 `IMAGE_API_KEY` 时带 `authorization: Bearer`，模型 `env.CAPTION_MODEL || 'codex/gpt-6.1-sol'`。
- 消息：文本「用一句中文描述这张图的服装：品类、颜色、材质、风格，不超过30字，不要标点结尾」+ `image_url` data URL。
- 超时 20s；非 200 或空内容返回 `''`；任何异常都返回 `''`（绝不让入橱失败）。
- 实测可用：`codex/gpt-6.1-sol` 约 5s 返回「灰色短款背心配同色短裤，脚穿白色细带拖鞋，整体简约休闲。」

## 3. 扫码登录（`src/login.mjs`）

思路：用 Node 24 原生 `WebSocket` 驱动一个**专用 Chrome 实例**（`--user-data-dir=data/browser-profile --remote-debugging-port=<随机>`），打开平台登录页让你扫码；登录成功检测到鉴权 cookie 后用 CDP `Network.getAllCookies` 抓**全量 cookie（含 HttpOnly）**，写进 `data/cookies.json` 对应平台字段。

```js
export function createLoginService({ env = process.env, dir = 'data', chromePath } = {})
// start(platform): Promise<{ sessionId }>          // platform: taobao|jd|pdd
// status(platform, sessionId): Promise<{ status: 'waiting'|'done'|'failed'|'expired', account?: string }>
// cancel(platform, sessionId): Promise<void>
// dispose(): Promise<void>                          // 服务关闭时清理
```
- Chrome 路径默认 `C:\Program Files\Google\Chrome\Application\chrome.exe`，可用 `env.CHROME_PATH` 覆盖；找不到就抛 `HttpError(503,'LOGIN_UNAVAILABLE','没有找到 Chrome，无法启动扫码登录')`。
- 平台登录页与鉴权判据：
  - taobao: `https://login.taobao.com/member/login.jhtml`，判据 cookie 名含 `unb` 或 `cookie2`
  - jd: `https://passport.jd.com/new/login.aspx`，判据 `pt_key` 或 `thor`
  - pdd: `https://mobile.yangkeduo.com/login.html`，判据 `PASS_ID` 或 `PDDAccessToken`
- 轮询间隔 1.5s，默认超时 300s（`LOGIN_TIMEOUT_MS` 可覆盖）；成功后 cookie 串格式 `k=v; k2=v2`（按 cookie 名排序，只取该平台域名相关）。
  - 写入位置：`data/cookies.json` 的 `{ "taobao": "...", "jd": "...", "pdd": "..." }`，与 `src/cookies.mjs` 的 `loadCookies` 完全兼容（必须保留已有其它平台的键）。
- 同一平台同时只允许一个登录会话；重复 start 返回 409 `LOGIN_IN_PROGRESS`。
- 必须能优雅失败：Chrome 起不来 → `LOGIN_UNAVAILABLE`；超时 → status `expired`。

## 4. 今日穿搭（`src/outfit.mjs`）

```js
export function createStylist({ env = process.env, fetchImpl = fetch, wardrobe } = {})
// suggest(request, { sessionId }): Promise<{
//   slots: { top?: Item, outer?: Item, bottom?: Item, dress?: Item, hosiery?: Item, shoes?: Item, accessory?: Item[] },
//   reason: string,
//   missing: string[]      // 衣橱里缺哪些格子
// }>
```
- 实现：先用 `wardrobe.search(request, 12)` 拿到候选（按相关度），按每个候选的 `category` 分桶；
- 若对话模型可用（复用 `createCaptioner` 的接口配置），把「用户需求 + 候选清单（名称/类目/描述）」发给 `codex/gpt-6.1-sol`，要求返回 JSON `{ picks: { slot: itemId | itemId[] }, reason }`；**必须做严格校验**：只接受已存在且类目匹配的 id，返回非法 JSON 或超时则回退到规则选择。
- 规则回退：按 `dress` 优先、否则 `top+bottom`，再补 `outer/hosiery/shoes/accessory`（各取相关度最高、类目匹配者）。
- 返回的 `slots` 里必须是完整的 `Item` 对象，前端要能直接渲染图片与名称。

## 5. 后端路由（主代理负责接线，子代理只写模块）

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/wardrobe` | — | `{ items: [Item & { imageUrl }] }` |
| POST | `/api/wardrobe` | `{ name, category, subtype?, tags?, description?, image /*dataUrl*/, source? }` 或 `{ sourceId, sourceIndex?, name?, category, subtype?, tags? }` | 201 `{ item }` |
| DELETE | `/api/wardrobe/:id` | — | 204 |
| GET | `/api/wardrobe/:id/image` | — | 图片字节（`cache-control: private, max-age=300`，`x-content-type-options: nosniff`） |
| POST | `/api/wardrobe/search` | `{ query, limit? }` | `{ results: [{ item, score }] }` |
| POST | `/api/outfit/suggest` | `{ request }` | `{ suggestion: { slots, reason, missing } }` |
| POST | `/api/login/:platform` | — | 202 `{ sessionId }` |
| GET | `/api/login/:platform/status?sessionId=` | — | `{ status, account? }` |
| POST | `/api/login/:platform/cancel` | `{ sessionId }` | 204 |

订单来源新增一种：`pieces[i].source = { kind: 'wardrobe', wardrobeId }`。

## 6. 前端

- **工作台 studio**：
  - 每个「单品条目」= 一级胶囊（七大类）+ 二级胶囊（该类子类，联动清空）+ 图片来源三选一（上传 / 从衣橱选 / 商品链接）。
  - 默认渲染 **1 个条目**（一级默认「上衣」）；条目区标题栏右上角一个 `+ 添加单品` 按钮追加一个新条目（新条目默认空大类占位）；每个条目右上角有删除（只剩一条时禁用删除）。
  - 「从衣橱选」打开一个弹层网格，列出 `GET /api/wardrobe` 的条目缩略图 + 名称，点选后回填该条目。
  - 提交 `POST /api/orders` 的 `pieces[]` 用 `source.kind='wardrobe'` 或 `upload`/`import`。
  - 使用 `public/lib/dom.js` 的 `createCapsuleSelect`；两级联动在 `onChange` 里 `setOptions`。
- **衣橱页 wardrobe**：
  - 网格显示真实条目（图 + 名称 + 类目胶囊 + 删除按钮）；
  - 顶部「上传图片」按钮（选文件 → 填名称/类目 → `POST /api/wardrobe`）；
  - 搜索框（`POST /api/wardrobe/search`）；
  - 「今日穿搭」输入框：一句需求 → `POST /api/outfit/suggest` → 展示建议搭配（每格图+名 + 理由）→ 「生成试穿图」按钮走多件下单。
- **导入页 import**：解析出的每张图旁边/底部有「加入衣橱」按钮（`POST /api/wardrobe` 带 `sourceId/sourceIndex` + 名称）；页面上另有「这件属于哪一类」胶囊，入橱的 `category` 与「用这件试穿」填的格子都取它（商品页没有可靠类目，默认上衣）。
- **设置页 settings**：每个需要 cookie 的平台（淘宝/京东/拼多多）一行，右侧「扫码登录」按钮 → `POST /api/login/:platform` → 轮询 status → 成功后提示「已写入 cookie」。

## 7. 样式

- `public/style.css` 由 studio 任务维护（含两级下拉与衣橱选择弹层）。
- `public/style-wardrobe.css` 由衣橱/导入/设置任务新建，`public/index.html` 增加一行 `<link rel="stylesheet" href="/style-wardrobe.css" />`（主代理负责加 link，子代理不要改 index.html）。
