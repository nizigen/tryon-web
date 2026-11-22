# progress — 会话日志（操作、变更、验证、错误）

## 2025-11-22 · v2 改造：从本地工作台到付费试穿产品

### 输入与决策
- 用户诉求：把 GitHub 上的 tryon-web（照 Chrome TryItOn 扩展实现）拉到本机；补充服饰选项与提示词，解决"衣服替换不到位、原衣留一半"与"AI 味光影褶皱"；补齐插件式的"鼠标移到身体就显示对应服装"；做抖音穿搭号的橱窗选衣 + 付费试穿；前端去 Demo 味；平台形态（抖音小程序 vs App）由我调研决定；定价由我按模型成本决定。
- 仓库已克隆到 `/root/pi-work/tryon-web`（原仓库在 `C:\GitHub\tryon-web`，本机为 Linux 容器副本）。
- 平台决策与定价依据见 findings.md 第 1、2 节。

### 变更
- 后端按模块拆分：`server.mjs`（入口）+ `src/{app,store,tryon,pricing,prompt,the image service,validate,errors}.mjs`。
- 提示词：结构化分节 + 服装子类（tops 7 类 / bottoms 4 类 / dresses 1 类），外套类走"替换外层、保留内搭"语义；商品标题进入提示词。
- 新增商品目录（`data/catalog.json`，6 件商品，商品图为 AI 生成并在界面标注）、按模型 × 档位定价（`src/pricing.mjs`）、会话/订单/充值单 JSON 持久化（`data/state.json`，原子写）、异步试穿任务（下单冻结额度 → 生成 → 成功扣减 / 失败退回）。
- 前端重做：橱窗（商品网格 + 分类筛选 + 搜索）→ 试穿页（模型/档位/上传/版型/补充要求）→ 结果页（原图对比、区域热点叠加、下载带 AI 标识）→ 我的（余额、充值、订单历史）。移动优先，底部固定 CTA。
- 文档：六份规范（PRD / APP_FLOW / TECH_STACK / FRONTEND_GUIDELINES / BACKEND_STRUCTURE / IMPLEMENTATION_PLAN）按 v2 重写；`design/` 预览移入 `public/design/`（仍可访问）。
- 测试：删除旧的 `test/server.test.mjs`，新增 `test/{api,pricing,prompt,store}.test.mjs`，共 39 项。

### 验证（真实执行）
- `node --test` → 39/39 通过（含扣费、失败退额、并发 409、pending 轮询、跨站拒绝、目录穿越拒绝）。
- 本机 the image service 真实生成（gpt-image-2 / medium / 1024x1536）：
  - tops（红花衬衫）→ 整件替换，无白色残影，证据 `docs/evidence/ui-result-390.png`、`ui-result-1440.png`；
  - bottoms（黑牛仔裤）→ 下装完整替换，证据 `docs/evidence/tryon-bottoms.jpg`；
  - dresses（黑缎面吊带裙）→ 上下装同时替换、保留鞋，证据 `docs/evidence/tryon-dresses.jpg`；
  - 提示词对照实验 `docs/evidence/prompt-lab-v0/v1/v2.jpg`。
- 页面真实交互（Chromium headless + CDP 驱动，容器内）：390/768/1440 三档均无横向溢出；上传人物照 → 提交 → 排队 → 生成 → 结果图加载 → 悬停/点击热区叠加服装图 → 下载按钮 → "我的"订单记录，均实测通过，截图见 `docs/evidence/ui-*.png`。
- 真实 HTTP：/api/config 返回 4 个模型与定价；/api/products 返回 6 件商品；下单扣费 ¥6.90 → 余额 ¥0；失败场景由自动化测试覆盖（退费）。

### 独立评审与修复（2025-11-22）

由独立评审代理（只读，不改代码）复核最终实现，报出 3 个 P0、5 个 P1 与 18 个 P2。已修：

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| P0-1 | 人像 base64 落盘到 `data/state.json` | 订单不再保存人物图/服装图，改为随任务只在内存中流转；`data/state.json` 与 `data/results/` 加入 .gitignore；新增断言"落盘文件不含 base64" |
| P0-2 | 扣费与入队之间的 TOCTOU：409 会吞掉余额并留下永久 pending 订单 | 先占位（`tryon.reserve`）再扣费建单，占位后任何异常都释放占位并全额退款 |
| P0-3 | 进程重启后 pending 订单永久漏退 | 启动时 `reconcileInterruptedOrders()` 把 pending 订单置为 failed 并退款；订单记录 jobId |
| P1-1 | 目录商品图以本机绝对路径下发且绕过图片校验 | 服务端读盘并转成已校验的 data URL，与上传路径同一套校验 |
| P1-2 | 非法档位静默回落到首档（扣费与展示价可能不一致） | 非法档位直接 400；新增 API 层用例 |
| P1-3 | "全身"热区盖住上身/下身，移动端点不到 | 热区按 z-index 分层，上身/下身在上；补 `aria-pressed` 同步 |
| P1-4 | `/api/tryon` 不计量、会话可无限注册领额度 | 部署形态（设置 `PUBLIC_ORIGIN`）默认关闭直连与模拟充值，需显式开关 |
| P1-5 | 模拟充值无闸门 | 同上；充值幂等已有测试覆盖 |
| P2 | 提示词语法错误（"The the ..."）、目录文案注入面、外套语义冲突、提示词字数不一致、CSP 拦内联样式、套餐文案、刷新丢任务、写盘错误静默、任务表不清理、TTL 不改订单、limit 参数、文档与实现不一致、结果 URL 带会话标识 | 逐条修复：提示词去冠词、商品文案单行化限长并加引号、外套改条件式表述、补充要求统一 500 字、骨架改用 class、套餐按最低档折算、进入试穿页接管未完成订单、写盘失败落日志、任务终态 30 分钟清理、TTL 同步把订单置 expired、`limit` 参数透传、文档按实现回填、结果图改为带时效的 HMAC 票据 |

修复后：`node --test` 46/46 通过（含新增的"落盘无 base64""目录图 data URL""结果票据""重启对账""非法档位"用例）。

### 环境说明
- 本容器为 Linux，无 Chrome/预装浏览器；为做真实 UI 验证，在容器内安装了系统包 `chromium`（EPEL），仅用于本次验证，不是项目依赖，仓库未记录任何 Chromium 相关依赖。

## 2025-11-22 · 商品链接导入（本机 Windows 实测）

### 输入与决策
- 用户诉求：能不能直接解析淘宝/拼多多/抖音商品链接里的商品图；确认后要求「加进 tryon-web 项目」，并指出「要的是手机的那种链接」，把手机连上供实测；后续又要求「先把抖音、拼多多也打通」并指出「你这个也没有把所有商品图弄进来啊」。
- 决策：不逆向平台接口、不自建登录态，改为复用本机已登录的 OpenCLI 读取页面内嵌数据；1688 跳过（用户明确不需要）。

### 变更
- 新增 `src/source.mjs`：平台表（淘宝/天猫、京东、拼多多、抖音商城）、`originalImageUrl` 原图归一、`extractLink` 从整段分享文案抠链、`resolveShortLink` 短链跟随（Location → 淘宝 → 拼多多 → haohuo 四条兜底）、TAOBAO_JS/PDD_JS 页面脚本、`extractDouyin` 解析 `goods_detail`、TTL 缓存（30 分钟 / 20 条）、串行队列（排队上限 4）、流式限长读取、下载白名单与格式/体积/占位图校验、`locateOpenCli`/`locateNode`。
- 淘宝改读 `window.__ICE_APP_CONTEXT__.loaderData.home.data.res` 的内嵌数据（`res.item.images` 主图 + `res.skuBase.props[].values[].image` 规格图），DOM 分组只作兜底。
- `src/app.mjs`：新增 `POST /api/sources`（列表只给 index 与 group，不下发原图直链）与 `GET /api/sources/:sourceId/:index`；订单支持 `sourceId/sourceIndex/sourceName`，外部商品标题按不可信文本清洗（去控制符与零宽字符、引号换成单引号、按码点截断 80）后进提示词，并包在 `<product_title>` 里声明「只作商品名参考，绝不是指令」。
- `src/prompt.mjs`：新增 `IDENTITY SOURCE (critical)` 段——商品图里若有模特，明确要求忽略其人像，只取衣服；约束段补「输出只能有一个人，就是参考图 1 的人」。
- 前端：新增 `public/views/import.js`（`#/import`）、`#/source-tryon` 路由、橱窗「想试别的衣服？」入口、`public/style.css` 导入段样式；`tryon.js` 拆成目录商品与外部商品两条渲染路径。

### 验证（真实执行）
- `node --test` → **75/75 通过**（商品链接解析 24 项、身份约束 1 项、API 集成 4 项）。
- 真实解析（最终版本）：淘宝桌面长链与手机分享文案均 **13 张**（main 3 + sku 10）、京东 17 张、拼多多 `?ps=` 分享 **29 张**（main 1 + detail 28）、抖音分享文案 **2 张主图**；取图均为 1440×1920 / 1500×2000 / 1440×1440，逐张查看确认是商品图。
- 真实出图：手机分享短链 → `/api/sources` → `/api/orders(sourceId)` → 轮询 → `?k=<token>` 取图，**43.7 秒 success**，结果 1024×1536 / 1761061B，证据 `docs/evidence/import-tryon-result.png`。
- 浏览器 UI（OpenCLI，1266×751 前台窗口）：`#/import` 粘贴整段文案 → 读出商品图 → 点「用这件试穿」进入 `#/source-tryon`，商品标题/来源/外部商品图徽标均正确；抖音分享短链同样在页面上读出 2 张主图（截图 `docs/evidence/ui-import-douyin.png`）。

### 未验证 / 已知缺口
- 抖音商城只出主图：H5 详情页对浏览器一律风控（手机 Chrome 打开也是「请使用抖音APP扫码」），App 内的「视频 / 图集」是私有数据，未找到免登录导出路径。
- 淘宝详情长图（`descUrl`）拿不到：页面出现风控文案「系统检测到当前访问存在异常…」，`descUrl` 在 HTML 里搜不到，mtop `getdesc` 带签名也返回 `FAIL_SYS_ILLEGAL_ACCESS::非法请求`。
- 1688 需登录态未接（用户明确不需要）。
- 导入结果缓存 30 分钟，重启服务即失效。
- 浏览器内「上传人物照」仍受 OpenCLI `upload` 限制（`{"code":-32000,"message":"Not allowed"}`），出图证据走的是接口链路，不是页面上传。

### 错误与修正记录
- `process.execPath` 在 Electron 宿主下是 `DSH Desktop.exe`，`execFile` 把它当 node 跑导致 503 → 新增 `locateNode()` 探测真实 `node.exe`。
- 为过滤占位图而按 `naturalWidth < 200` 过滤，把懒加载图整批误杀（未进视口时 `naturalWidth` 为 0），淘宝图从 12 张掉到 4 张 → 改读内嵌数据，DOM 兜底路径改按 URL 文件名里的尺寸判定。
- 淘宝规格图懒加载，固定等 8 秒去取仍可能只拿到 4 张 → 内嵌数据一次拿全，不再依赖时机。
- 首跑出的图是商品图模特本人（脸与车站背景都被复制）→ 提示词加身份约束段后修复。
- 用 PowerShell 的 `Get-Content -Raw | Set-Content -Encoding utf8` 改 `src/source.mjs`，UTF-8 被按 GBK 解码回写，中文全变乱码且不可逆 → 用 write 工具整份重建。**此后改文件只用 edit/write。**
- 浏览器侧缩略图「空白」是误报：`loading="lazy"` 未进视口时 `naturalWidth` 为 0，滚动后正常。
- OpenCLI 的 `click`/`keys` 在窗口失焦时统一报 `Native input requires a visible browser page`，把 Chrome 窗口恢复并置前后仍可能复现；可靠做法是用 `browser eval` 触发 `element.click()`（本页证据就是这么拿到的），或关掉会话重开前台窗口。

### 未验证 / 已知缺口（v2 阶段，保留）
- 真实支付（抖音虚拟支付）与真实登录未接入，当前充值为本地模拟，会话为匿名设备标识。
- 隐式 AI 标识（图片元数据）未实现；界面与导出文件名有显式标识。
- 混元两个模型与 MiniMax 未做真实生成验证；价格表中的成本估算对混元为保守估值（公开价未取得）。
- "外套保留内搭"未做真实生成验证。
- 提示词对比仅一次三图，未做盲评与多样本统计。

### 错误与修正记录
- 初版 `createStore` 用 `tiersFor('MiniMax')` 计算体验额度，导致默认精档（¥6.90）下单即余额不足 → 改为固定一次标准档额度（690 分）。
- 初版并发检查排在余额检查之后，同会话第二次下单返回 402 而非 409 → 调整为先判并发再判余额；独立评审进一步指出扣费与入队之间的 TOCTOU，改为"先占位再扣费"。
- 初版区域热区对所有分类开放，下半身会叠加上衣 → 按商品分类限制热区；独立评审指出"全身"热区会盖住上身/下身 → 加 z-index 分层。
- CSS 中 `img { display:block }` 覆盖了 `hidden` 属性，导致未上传时露出预览占位图 → 加 `[hidden]{display:none!important}`。
- `createApp` 复杂度 83 → 拆成路由表 + 具名 handler。
- 验证脚本自身的问题：CDP 复用旧标签页（同一 URL 不触发重载）+ 浏览器实例端口冲突导致复用了上一个浏览器，表现为"订单不落盘、订单列表为空"。改为每次使用独立调试端口、独立 profile 并强制 reload 后，浏览器链路与 curl 链路结果一致。

## 2025-11-22 · 商品链接取图改直连（淘宝 mtop / 抖音 ttwid，不再依赖 OpenCLI）

**输入与决策**：用户要求「用我抖音登录态、不通过 OpenCLI 直接解析」，淘宝同样，抖音「商品 + 视频/图文帖两类都要」。Chrome 的 cookie 库被独占（`esentutl` 报 `JET_errFileAccessDenied -1032`，非管理员），故由用户从 DevTools 复制淘宝 cookie；抖音用 `C:\Note\video_pipeline\cookies\douyin.netscape.txt`。

**变更**
- 新增 `src/cookies.mjs`（`loadCookies` / `cookieFilePath`，默认 `data/cookies.json`，`TRYON_COOKIE_FILE` 可覆盖）；`.gitignore` 加 `data/cookies.json`；`.env.example` 补 `TRYON_COOKIE_FILE`。
- `src/source.mjs`：新增 `taobaoDirect`（mtop 握手取 `_m_h5_tk` → md5 签名 → 令牌过期重试 → `deepCollectImages` 递归收 alicdn 图）、`douyinTtwid`/`parseRouterData`/`findItemList`/`extractDouyinShare`（ttwid + iesdouyin `_ROUTER_DATA`）、`deepFindString`；抖音平台表改 label `抖音`、扩 hosts 与 `imageHosts`、`ua: UA_M`；`extract()` 淘宝优先直连、抖音按商品/视频分流；`createSourceService` 新增 `cookies` 选项与 `cookieJar`；`download()` 用 `platform.ua ?? UA`。
- 抖音视频/图文帖的图片直链一次性（第二次 403），改为解析时逐个取回字节入内存（单张 4KiB–8MiB、最多 9 张、累计 24MiB），`download()` 命中 `image.buffer` 直接返回缓存；全取不到才 422。

**验证**
- `node --test` 78/78 通过（新增淘宝直连签名、抖音图文帖、抖音视频 403 三条；平台标签断言改 `抖音`；无 OpenCLI 用例补 `cookies:{}`）。
- 真实 HTTP（`artifacts/probe/probe-direct-http.mjs`）：抖音视频帖 1 图 23672B；抖音商品 2 图 2142895B；抖音商品下单 → 25s success → 结果 1746258B。淘宝分享文案（`artifacts/probe-source-order.mjs`）13 图 → 下单 690 分 → 25s success → 结果 1781282B。

**未验证 / 已知缺口**
- 淘宝 `descUrl` 详情长图仍被风控挡住（只有轮播/主图/规格图）。
- 抖音商品 `goods_detail` 只有一张主图；视频/图文帖能拿封面/图集但受 CDN 一次性直链约束（已用缓存规避）。
- 京东 / 拼多多仍需本机 OpenCLI；1688 未接。
- 淘宝 cookie 会过期，过期后需用户重新从 DevTools 复制。

**错误与修正**
- 用 PowerShell `Get-Content -Raw | Set-Content -Encoding utf8` 改含中文的 `src/source.mjs` 导致整份乱码，只能按已读版本用 write 整份重建。此后改文件一律用 edit/write 工具或 `[System.IO.File]` 显式 UTF-8。
- 抖音图片 CDN 认手机 UA：下载最初用桌面 UA 会 403，改为 `platform.ua`。

## 2025-11-22 · 京东 / 拼多多也改直连，彻底不依赖 OpenCLI

**输入与决策**
- 用户要求「拼多多和京东不能用同样的方式来完成不要用 opencli 了？我还要给别人用别人不一定有 opencli」。据此把京东、拼多多也改为服务端直连，OpenCLI 降级为「直连失败时的可选兜底」，`runCli:null` 可完全禁用。

**变更**
- `src/source.mjs` 新增 `extractBalancedJson(html, marker)`（marker → 其后 `=` → 其后 `{`，按字符串/转义/括号配对截取 JSON）、`extractJdDirect`（`item.m.jd.com/product/<sku>.html` 的 `window._itemOnly`，图片拼 `https://img14.360buyimg.com/n0/`）、`extractPddDirect`（`goods1.html` 的 `window.rawData.store.initDataObj`，`needLogin` 时返回 503 并提示把 pdd cookie 放进 `data/cookies.json`）。
- `extract()` 京东 / 拼多多改为「先直连，失败且无 OpenCLI 兜底才抛」；`createSourceService` 的 `runCli` 支持传 `null` 显式禁用兜底。

**验证**
- `node --test` 81/81 通过（新增京东直连 `window._itemOnly`、拼多多 needLogin 可操作错误、拼多多带 cookie 解析 rawData 三条；京东回退用例注入离线 `fetchImpl` 强制走 OpenCLI 分支）。
- 真实网络（`runCli:null` 完全禁用 OpenCLI）：京东 `https://item.jd.com/100012043978.html` → 10 图 0.4s、首图 107439B；拼多多 `goods1.html?goods_id=845720245931` → `SOURCE_UNAVAILABLE`「拼多多需要登录 cookie…」（本机无 pdd cookie，符合预期）。
- 真实 HTTP 全链路：`artifacts/probe/probe-jd-http.mjs` → `POST /api/sources` 201（京东 10 图）→ 取图 200 image/jpeg 107439B → 下单 690 分 → 轮询 5–25s running → 25s success → 结果 200 image/png 1500318B。服务重启后 `POST /api/sources` 淘宝 13 图 8.1s、抖音 2 图 0.2s。

**未验证 / 已知缺口**
- 拼多多真实出图未验证（本机没有 pdd 登录 cookie；代码路径用构造 HTML 覆盖测试）。用户提供 pdd cookie 后可直接验证。
- 淘宝详情长图仍受风控；抖音商品只有一张主图（同前）。

**错误与修正**
- 拼多多无 cookie 时最初报「页面里没有找到商品数据」，因为 `extractBalancedJson` 的 marker 写死了 `window.rawData =`（带空格）。改为 marker `window.rawData` + 找 `=` 再找 `{` 后，能正确识别 `needLogin:true` 并给出可操作错误。
- 全仓 `node --test` 与我并行的真实网络 `node -e` 同时跑时会 flaky（会话并发、充值断言），单独或连续两次均全绿，属并行负载时序。

## 2025-11-23 · v3：多件穿搭 + 演示模式 + 设置页模型入口 + 仿 flyne 深色工作台

**输入与决策**
- 用户要求：①「先把付费这套拿下来，我要先做个演示不要让人看到付费」；②「模型给配置的入口在设置里面」；③ 前端照 `https://flyne.ai/cn/` 做（布局、质感、下拉菜单、按钮形状、字体）；④ 上衣下装之外要有首饰等更多品类，并继续 REA 原扩展；⑤ 支持多选（上衣 + 下装同时、里衣 + 外套、裙子 + 丝袜、鞋子单独一栏）；⑥ 去淘宝抄标签做选项；⑦ 下拉「未选择态」与「展开态」样式必须一致；⑧ 多开 subagent。
- 设计来源与令牌见 `docs/frontend-design-reference.md`；多件契约见 `docs/OUTFIT_MODEL.md`；原扩展品类能力见 `docs/rea-tryiton-categories.md`（结论：原扩展只支持单件单分类，Live 模式是逐个 switch 不是叠穿）；淘宝词表见 `docs/taobao-tags.md` 与 `data/taxonomy.json`。

**变更**
- 后端：`POST /api/orders` 支持 `pieces[]`（七格、accessory ≤2、总数 ≤5、dress 与 top/bottom 互斥），每件单品在占位前取图；新增 `GET/PATCH /api/settings`（模型持久化到 `state.json` 的 `settings.model`）；`DEMO_MODE=1` 时 `priceCents/costCents` 为 0、跳过余额校验、支付接口 403；`src/prompt.mjs` 新增 `SLOTS/SLOT_ORDER/orderPieces/buildOutfitPrompt`（按格排序后编号参考图）；`src/tryon.mjs` 支持 `payload.referenceImages` 数组（缺省回退 `[person, garment]`）。
- 前端：按 flyne 重做为深色工作台——左侧可折叠导航、`#0a0a0a` 底/`#111` 面板、卡片 20px 圆角、控件 8px、胶囊 999px、紫色渐变主按钮、PingFang 字体栈；新增 `#/studio`（七格搭配台）、`#/wardrobe`（七组类目词表）、`#/settings`（模型选择、取图来源状态、网关连通性）；自制胶囊下拉（`public/lib/dom.js` 的 `createCapsuleSelect`）保证收起态与展开态同尺寸同字体。
- 演示模式：`public/app.js` 的 `applyDemoMode()` 切换 `body.is-demo`、隐藏余额与演示徽标；橱窗、订单、工作台在演示模式下不渲染任何金额。
- 新增 `run-demo.cmd`（`DEMO_MODE=1` 启动）。

**验证（真实执行）**
- `node --test` **96/96 通过**（新增多件下单、pieces 校验、settings 读写、演示模式计费为 0、设置模型白名单、cookie 不外泄、演示模式关直连、导入图进多件、非法单品四连、两配饰 + 5 件上限、下单中途失败回滚等用例）。
- 真实多件出图（`DEMO_MODE=1`，`artifacts/probe/probe-studio.mjs`）：上衣 + 下装 → 201、`priceCents:0`、35s success、结果 1846617B，人物身份保留且上下装同时替换（证据 `docs/evidence/v3-multi-piece-result.png`）。
- 全路由截图（`artifacts/shoot-all.mjs`，6 路由 × 1440/768/390 = 18 张）全部成功，`scrollWidth === clientWidth`、无越界元素；入库证据 `docs/evidence/v3-{shop,studio,wardrobe,settings,import}-1440.png` 与 `v3-{studio,settings}-390.png`。
- 设置页：`GET /api/settings` 返回 model/4 个模型/取图来源布尔/网关连通；`PATCH` 后回读一致；写不存在的模型返回 400 `MODEL_UNAVAILABLE` 且不改动设置。
- 下拉一致性实测：trigger 与 item 同为 40px 高、`padding 0 14px`、14px 字号，文字左边缘坐标一致。

**独立评审与修复（2025-11-23）**
只读评审（基线 `3c79ea2`）结论：无 P0，1 个 P1 + 若干 P2。已修：

| 项 | 问题 | 修复 |
| --- | --- | --- |
| P1 | 演示模式下 `/api/tryon` 仍可直连上游，绕过下单消耗额度 | 改为 `isDemoMode(env) \|\| !allowSimulation` 即 403；补「演示模式不得向上游发起生成」用例 |
| P2-a | 下单 catch 只退款，不撤已入队任务、不撤订单 → 「钱退了图还出了」、重启后二次退款 | `tryon.enqueue({ start:false })` + 新增 `start()/cancel()`；先把 jobId 落库再启动；回滚顺序为撤任务 → 订单置失败 → 退款；补「下单中途失败」用例 |
| P2-c | `PATCH /api/settings` 不校验模型是否存在 | 校验 `models.includes(model)`，否则 400 `MODEL_UNAVAILABLE` |
| P2-d | 商品标题可闭合提示词里的 `<product_title>` 标签 | `sanitizeText` 增加剔除 `<` `>` |
| P2-e | 胶囊下拉在换页时未摘除 document 监听器 | 新增 `closeAllMenus()`，`render()` 清空前调用；`onOutside` 对已脱离文档的节点自行收摊 |

评审确认无 SSRF（导入图只读服务端白名单缓存、目录商品读 catalog、上传只 decode dataURL）、前端 `h()` 全 textContent 无 XSS、参考图顺序与提示词编号一致。仍记录未修：扣费与建单之间进程崩溃的极窄窗口、`GET /api/config` 在演示模式仍返回价格表（仅 DevTools 可见）。

**修复的真机缺陷**
- 换页不重置滚动 → 从长页跳到短页时标题被顶栏压住（`render()` 末尾补 `window.scrollTo(0, 0)`）。
- `.btn` 在横向 flex 里被压缩，「解析链接」断成两行（补 `white-space: nowrap; flex: 0 0 auto`）。
- `.app-shell` 的 `min-height:100vh` 把短页面内容推低（补 `align-content: start`）。

**未验证 / 已知缺口**
- 多件越多越容易串味；本轮只验证了上衣 + 下装两件，五件满配未做真实生成对比（最多 6 张参考图上游是否稳定支持未验证）。
- 演示模式只隐藏前端金额，`data/state.json` 里仍记录 `priceCents`（值恒为 0），真实计费模式未在本轮回归。
- 抖音小程序工程仍未开始（本轮只做 Web 工作台）。

**错误与修正**
- `public/lib/garment-taxonomy.js` 由子代理生成时整份中文被 GBK 覆写成乱码（`node --check` 不报错，因为它只查语法）。改为从 `data/taxonomy.json` 程序化生成（`artifacts/build-taxonomy.mjs`），并在全仓扫描 U+FFFD 确认 0 命中。
## 2025-11-23 · v4：衣橱 + 扫码登录 + AI 今日穿搭 + 两级下拉

**输入与决策**
- 用户要求：①「前端为什么不做成两个下拉菜单，第一个是上衣首饰这些，第二个是具体分类」；②「上传页有一个默认的可选分类条目，右边放一个 + 继续添加」；③「抖音这些能不能做成扫码登录然后自动写入 cookie」；④「连接获取到的图片应该可以添加到我的衣橱，保存商品名和图片」；⑤「上传图片那里也应该可以从衣橱选择」；⑥「我的衣橱应该也支持上传图片」；⑦「我的衣橱已有衣服能不能做一个轻量的 RAG」；⑧「能够通过描述今天的需求让 AI 帮助选择今日穿搭并附上试穿图」；⑨「三视图给你帮我测一下，可以借鉴 GitHub 成熟实现，开几个 subagent」。
- 契约落在 `docs/NEW_FEATURES.md`（v4 唯一接口约定：模块签名、路由、前端职责、样式归属）。四个子代理并行：衣橱 + 视觉描述、扫码登录、工作台两级下拉、衣橱/导入/设置三页前端；主代理自己写 AI 选搭、接线 `src/app.mjs` 与 `server.mjs`。

**变更**
- 新增后端模块：`src/wardrobe.mjs`（入库/取图/删除/BM25 检索，图片落 `data/wardrobe/`）、`src/caption.mjs`（视觉模型写一句中文描述）、`src/outfit.mjs`（AI 选搭 + 规则回退）、`src/login.mjs`（受控 Chrome + CDP 读全量 cookie，写 `data/cookies.json`）。
- `src/app.mjs`：新增 11 条路由（衣橱 5 条、选搭 1 条、登录 3 条、衣橱取图 1 条、衣橱搜索 1 条）；`resolvePieces` 新增 `source.kind='wardrobe'` 分支（校验 id → 读图 → sniff → dataUrl）。
- `server.mjs`：装配 wardrobe/captioner/stylist/login；SIGINT/SIGTERM 时 `server.close()` + `login.dispose()`。
- 前端：`public/lib/dom.js` 新增 `createCascadeSelect`（两级联动，一级变更清空二级、无子类置灰）；`public/views/studio.js` 的单品从固定格子改为可增删条目 + 两级下拉 + 四来源（上传/衣橱/链接/目录）；新增 `public/views/wardrobe.js`（卡片、搜索、上传、今日穿搭全链路）与 `public/style-wardrobe.css`；`public/views/import.js` 每张缩略图加「加入衣橱」；`public/views/settings.js` 三平台扫码登录。
- 演示模式下 `POST /api/tryon` 也关闭（承诺零上游消耗）。

**验证（真实执行）**
- `node --test` **127/127 通过**（新增衣橱 6、衣橱 API 7、登录 10、选搭 7、衣橱穿越 1、选搭补齐 1、衣橱格子错配 1、同名 cookie 取平台域 1、取消竞态 1）。
- 真实链路：衣橱入库 4 件（视觉模型自动写描述，如「红底白色碎花短袖衬衫，棉质面料，休闲度假风」）→ 今日穿搭需求「今天去逛街，想穿得清爽又有精神，帮我配一套」→ 模型回上衣 + 下装并给理由、`missing:['shoes']` → 下单 201 → 30s success → 结果 1871400B（`artifacts/test/v4-ai-outfit.png`），目视确认身份与服装正确。
- 浏览器实测：两级下拉展开七项；「＋ 添加单品」1→2 条；「从衣橱选」把类目与图片填进条目；导入页 13 张缩略图可「加入衣橱」（衣橱 4→5）；衣橱页上传后 5→6；工作台用真实正面全身照（512x1024）下单 201 → 结果图正常显示。
- 登录：`POST /api/login/taobao` → 202 → 未扫码时状态保持 `waiting`（不再误判 done）；`cancel` 204。

**修复的真机缺陷**
- AI 选搭只用 BM25 检索，需求句不含单品关键词时零命中直接回「衣橱里还没有可用的单品」→ 改为检索为空时退回全量衣橱（最多 24 件）。
- 衣橱与今日穿搭的图片带 `loading="lazy"`，后台会话里永不加载（空白卡片）→ 去掉懒加载。
- `.section__title` 自带下外边距，放进横向 `.piece-head` 后与提示文字重叠 → `.piece-head .section__title { margin: 0 }`。
- `.canvas img` 原为 `width:100%`，竖版结果图在 1440 视口被拉到 896×1792 → 改为 `width:auto; max-height:min(72vh,720px); margin-inline:auto`，实测 270×541。
- 登录判据原用 `unb || cookie2`，未登录访客页也下发 `cookie2` → 误判成功并覆盖真实 cookie；改为只认 `unb`，并补「只有访客 cookie 不算登录成功」用例。
- 导入页「加入衣橱」把大类写死成 `top`（套装被记成上衣），「用这件试穿」也只填上衣格 → 页面新增「这件属于哪一类」胶囊，入橱与试穿都按它走；实测选「下装」后入库 `category=bottom`。
- 衣橱上传弹层只有大类、`subtype` 写死空串 → 改成两级下拉，实测选「下装 → 百褶裙」后入库 `bottom/百褶裙`。
- 衣橱 `imageFile` 原先直接 `resolve(imageDir, fileName)`，索引被改成 `../../secret.png` 就能读到目录外 → 抽出 `imagePath()` 统一校验仍在 `data/wardrobe/` 内，并补穿越用例。
- 选搭只用检索结果：只命中上衣时下装被判缺货 → 候选凑不成一套时从全量衣橱补齐（补「只命中上衣」用例）。

**独立评审与修复（v4，基线含 v4 全部改动）**
只读评审结论：无 P0，3 个 P1 + 9 个 P2。已全部落地：

| 项 | 问题 | 修复 |
| --- | --- | --- |
| P1-1 | cookie 路径三处不一致（写用数据目录、读用 cwd）→ 从仓库根以外启动会「登录成功却一直显示未配置」 | `cookies.mjs` 第二参数统一为数据目录；`createApp` 新增 `dataDir` 并透传到 `handleSettingsRead`；`server.mjs` 两处都传 |
| P1-2 | `source.mjs` 启动时把 cookie 读成快照，扫码登录后必须重启进程才生效 | 改为 `readJar()` 每次解析前重读文件（注入 `cookies` 时仍用固定值） |
| P1-3 | 工作台轮询无上限、离开页面不停止；五件大图叠加会撞 24MiB 请求上限 | `POLL_MAX_TICKS=160`（≈4 分钟）、`root.isConnected` 检查、`payloadBytes()` 前端预判并禁用提交 |
| P2-4 | `DELETE` 未纳入 Origin 校验 | 白名单改为 `POST/PATCH/DELETE` |
| P2-5 | 衣橱单品可塞进任意格子（下装进上衣格）→ 生成张冠李戴 | 新增 `PIECE_SLOT_MISMATCH` 400 拦截 |
| P2-6 | 演示模式 `/api/orders` 仍真实调用上游 | 决定保留（演示必须真出图），改文档与注释说明「不计费但会真实生成，直连接口关闭」 |
| P2-7 | 演示模式 `outfit/suggest` 每次都打对话模型 | 新增 `suggestByRule()`，演示模式走规则挑选，不消耗上游额度 |
| P2-8 | 登录轮询与取消竞态（`browser` 已被置空仍去取 cookie） | `checkOnce` 先取局部引用并判空 |
| P2-9 | 同名 cookie 分属 taobao.com / tmall.com 时取错域 | `domainRank` 排序键加入平台域列表顺序 |
| P2-10 | 衣橱无上限 | `MAX_ITEMS=500`，超限 413 `WARDROBE_FULL` |
| P2-11 | 索引损坏被当空衣橱，下一次写入会永久覆盖 | 先备份为 `.corrupt-<ts>` 再以空索引继续 |
| P2-12 | 设置页刷新后不回写演示状态 | `refresh()` 调用 `ctx.applyDemoMode()` |

新增回归测试 4 条（衣橱格子错配、同名 cookie 取平台域、取消竞态、衣橱上限相关断言），全仓 **127/127 通过**（3291ms）。

**评审修复后的真机复测（`DEMO_MODE=1`，`artifacts/probe-review-fixes.mjs`）**
- `/api/config` → `demoMode=true slots=7`。
- `/api/outfit/suggest` 演示模式走规则：返回 `top+bottom`、`missing:['shoes']`、理由「按衣橱里最接近你需求的单品挑了一套」（未调用上游对话模型）。
- 衣橱 5 件；把下装塞进上衣格下单 → **400 `PIECE_SLOT_MISMATCH`**「这件单品是下装，不能放进上衣（内搭）」。
- 扫码登录：start 202 → 9 秒后仍 `waiting`（未扫码不误判）→ cancel 204。
- `/api/settings` 无 cookie 值泄漏。

**未验证 / 已知缺口**
- 真实手机扫码走通并写出 cookie 未验证（只验了不误判、只改当前平台键、并发 409、取消竞态）。
- 五件满配真实出图未验证；裙 + 丝袜组合未验证。
- AI 选搭依赖 the image service 对话模型；模型不可用时按规则回退，此时不理解自然语言需求。
- 衣橱索引与图片是本机单进程 JSON + 文件，没有多实例并发控制。

**错误与修正**
- 工作台点「开始试穿」后读到 toast「图片编码、格式或内容无效」，一度以为是图片校验缺陷；抓网络层发现 `POST /api/orders` 实际 201、job success、结果图正常——那句是上一轮失败残留的 toast 文本（只 `hidden` 不 `textContent`），读 DOM 时误判。
- `.picker__item` 的索引与衣橱列表顺序不一致（列表按 `createdAt` 倒序），按索引点会点错件；验收脚本改为按文案匹配。