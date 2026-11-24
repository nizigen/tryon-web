# TECH_STACK — OpenAI 兼容图片服务 + 零依赖 Node 后端

## 运行时与依赖
| 层 | 版本/契约 | 说明 |
| --- | --- | --- |
| Node.js | v24.22.3（本机实测） | node:http、fetch、AbortController、node:test、fs/promises；**不新增第三方依赖** |
| 前端 | 原生 HTML/CSS/ESM 浏览器 API | 无框架、无构建器、无 CDN；ESM 分模块 |
| 图片服务 | OpenAI 兼容 HTTP：`POST /v1/images/generations`、`POST /v1/images/edits`、`GET /v1/models` | 地址 `IMAGE_API_BASE_URL`（默认 `http://127.0.0.1:3425/v1`），密钥 `IMAGE_API_KEY` 走 `Authorization: Bearer` |
| 生成 | JSON（无参考图）或 multipart（有参考图） | 有参考图时字段 `model/prompt/n/response_format/size/quality` + `image[]`；回包取 `data[0].b64_json` 与 `mime_type` |
| 模型目录 | `GET /v1/models` 里 `modalities.output` 含 `image` 的条目，再补上 `IMAGE_MODEL` | `IMAGE_MODELS` 显式给出时不再请求目录 |
| 测试 | node --test | API/领域测试 + `test/frontend.test.mjs`；真实临时后端/JSON 状态，模拟外部上游 |
| 存储 | 仓库内 `data/*.json` 原子写入 | 商品目录、会话余额、订单；不存人像照片 |
| 页面驱动 | OpenCLI 2.0.3（首选实时驱动） | 当前容器桥接未连接，单独列明，不假称 OpenCLI 验收通过 |
| 既有浏览器回归方法 | 已安装 Chromium 133.0.6943.141 + Node 内建 WebSocket/CDP | `test/helpers/browser.mjs` 复用本项目既有 CDP 方法，原生键盘/鼠标；无新增依赖、无 Playwright；未找到已装浏览器则显式 skip，可设 TRYON_TEST_CHROME |
| 商品取图 | 四家全部服务端直连：淘宝 = 登录 cookie + mtop；抖音 = 分享链接数据 + ttwid；京东 = 手机版详情页 `window._itemOnly`（免登录）；拼多多 = `goods1.html` 的 `window.rawData`（需 pdd cookie）。OpenCLI 仅在直连失败时兜底 | 不开浏览器、不依赖本机 OpenCLI；兜底才用 `execFile` 调 `node <opencli>/dist/src/main.js` |
| 扫码登录 | 受控 Chrome（独立 `--user-data-dir`）+ CDP | `Target.createTarget` → `attachToTarget(flatten)` → `Network.getAllCookies`，能拿 HttpOnly；OpenCLI 的 `browser eval` 拿不到、`chrome call` 明确拒绝该方法 |
| 视觉 / 对话 | OpenAI 兼容 `POST /v1/chat/completions` | 默认复用图片服务的地址与密钥，可用 `CHAT_API_BASE_URL` / `CHAT_API_KEY` 单独指向；衣橱描述 `CAPTION_MODEL`、今日选搭 `STYLIST_MODEL`，默认 `codex/gpt-6.1-sol`；失败降级不阻断主流程 |
| 衣橱存储 | `data/wardrobe.json` + `data/wardrobe/<uuid>.<ext>` | 原子写、串行队列；检索用内置 BM25（中文按字 + 二元组），不引入向量库 |

## 模型目录（运行时动态发现）
`GET /v1/models` → 取 `modalities.output` 含 `image` 的 `id`，再并入 `IMAGE_MODEL`（默认 `codex/gpt-image-2.5`）。
**不能只按目录过滤**：本机实测 93 个模型里只有 `minimax-code/MiniMax-Image` 标了图片输出，默认模型 `codex/gpt-image-2.5` 根本不在目录里（指定它照样能出图），只按目录过滤会让默认模型凭空消失。用 `IMAGE_MODELS` 可以完全跳过目录请求。
目录可见 ≠ 健康；不发自动付费探测。

## 生成参数约定
- `quality`：`medium` 为默认档（成本与质量平衡），`high` 为高质量档；`size` 默认 `1024x1536`（竖版全身），人物照比例不同时按需调整。
- 参考图固定顺序：人物在前、各件服装按 `SLOT_ORDER` 在后；服务端按这个顺序拼 `image[]`。

## 成本基线（2025-11 公开价，供定价参考，非本项目账单）
| 模型 | 公开价 | 折算单次(1K) |
| --- | --- | --- |
| codex/gpt-image-2.5 | OpenAI 输出 $30 / 1M image tokens（medium 4096 tokens ≈ $0.123） | ≈ ¥0.9 |
| minimax-code/MiniMax-Image | MiniMax 图片编辑（1 参考图，1K）¥0.2978/张 | ≈ ¥0.30 |
| workbuddy/hunyuan-image-alpha | 未取得公开价 | 暂按 ¥0.40 保守估（待核） |
| workbuddy-ai/hy-image-3.5 | 未取得公开价 | 暂按 ¥0.40 保守估（待核） |

## 安全边界
- 单图 ≤8MiB、请求 ≤24MiB、输出 ≤16MiB；生成总时限 120 秒。
- 本机开发态只监听 127.0.0.1 并校验 Host/Origin；对外部署形态（云主机 + HTTPS + 反代）在 BACKEND_STRUCTURE.md 记录为**待实现的部署模式**，本轮不部署。
- 图片服务持有提供方凭据；应用只从环境变量读密钥，不读写、不回传密钥。
- 日志不打印 base64、凭据与完整上游错误体。

## 前端交付与缓存

正式页面采用已批准 B 衣橱 + A 工作台，只有一套 CSS 令牌；系统字体、自有 SVG、原生 dialog，无外链字体或 CDN。
HTML、JS、CSS 每次重新验证（`Cache-Control: no-cache`），防止无构建 ESM 导入链混合新旧版本；图片保留短缓存。
本项目无构建产物，运行实例直接读取 public 源码；发布验证需对照实际 HTTP 文件内容与本地源码摘要。

## 复用决策
复用 Node 内建网络、JSON、字节校验、超时取消与现有 node --test 断言；薄适配一个 OpenAI 兼容的图片服务，不自建模型协议、不引入 SDK、不引入 OpenAI 官方包（`fetch` + `FormData` + `Blob` 都是 Node 24 内建）。
本轮新增的目录/订单/会话模块同样零依赖，用 `node:fs` 原子写 JSON；并发量级为运营初期单机，写锁 + 单文件足够，后续可平移到真实数据库（接口已隔离在 store 层）。
商品取图按平台分两种：**淘宝走登录 cookie + mtop 签名直连**（匿名握手不下发 `_m_h5_tk`、返回 `RGV587_ERROR::SM`，带 cookie 后握手拿 token 再签名即可取详情图）；**抖音走分享链接数据 + ttwid 直连**（商品链接的 `goods_detail` 免登录带主图，视频/图文帖用 `ttwid.bytedance.com` 注册的 ttwid 请求 iesdouyin 分享页解析 `_ROUTER_DATA`，图片 CDN 直链一次性、解析时即取回缓存）。**京东读手机版详情页 `window._itemOnly`（真正的裸 HTTP 免登录，图片前缀必须是 `https://img14.360buyimg.com/n0/`）**；**拼多多读 `goods1.html` 的 `window.rawData`，需要 pdd 登录 cookie**（无 cookie 时 `needLogin:true`，`goods.html` 会 302 到安全验证页）。四家都不再依赖 OpenCLI，OpenCLI 只是直连失败时的兜底。Cookie 存 `data/cookies.json`（`TRYON_COOKIE_FILE` 可覆盖），不进 git。

**扫码登录为什么不复用 OpenCLI**：`opencli browser eval 'document.cookie'` 只能拿到非 HttpOnly 的 cookie，而淘宝的 `cookie2`、拼多多的 `PASS_ID` 都是 HttpOnly；`browser chrome call Network.getAllCookies` 直接被拒（`unsupported_chrome_method`）。因此 `src/login.mjs` 自己 `spawn` 一个带 `--remote-debugging-port` 的 Chrome（`--user-data-dir` 指向 `data/browser-profile/`），用 Node 24 内建的 `WebSocket` 走 CDP 读全量 cookie。零新增依赖，也不接管用户日常的 Chrome 配置。

**衣橱为什么不上向量库**：单品量级是几十到几百件，BM25（中文按单字 + 二元组切分）足够；再让视觉模型在入库时写一句中文描述，就把「看图」转成了「搜文字」。引入 embedding 服务会多一个外部依赖与一份隐私面（要把商品图发出去），当前不值得。
