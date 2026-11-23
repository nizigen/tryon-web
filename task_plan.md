# Task Plan — TryOn Web v4

## 当前目标与权限
把本地单人试穿工作台升级为可对外运营的付费试穿产品：抖音穿搭号橱窗选衣 → 上传真人照 → 付费试穿 → 看到上身效果。
平台决策（抖音小程序 + H5，不做 App）与定价（按模型成本分档）由用户授权我调研与决定。
v3 追加：多件搭配（七格）、演示模式（隐藏付费）、模型入口移到设置页、前端仿 flyne 深色工作台。
v4 追加：两级下拉 + 加号条目、扫码登录自动写 cookie、我的衣橱（上传/导入入库/检索/删除）、从衣橱选、AI 今日穿搭出图。
边界：零依赖、不擅自部署、真实支付与真实用户体系未接入；本轮只交付本机可运行的完整链路。

## 阶段与检查点
- [x] 平台调研与决策（抖音虚拟支付规则、AIGC 标识办法、原生 App 成本对比）→ findings.md 第 1 节
- [x] 成本调研与定价表（OpenAI / MiniMax 公开价折算 + 混元保守估值）→ findings.md 第 2 节
- [x] 六规范按 v2 重写（PRD / APP_FLOW / TECH_STACK / FRONTEND_GUIDELINES / BACKEND_STRUCTURE / IMPLEMENTATION_PLAN）
- [x] 提示词与服装分类体系（结构化提示词 + 12 个子类 + 三分类真实生成验证）
- [x] 后端模块化 + 商品目录 + 定价 + 会话/订单/充值 + 异步任务（39 项测试全绿）
- [x] 前端重做（橱窗 / 试穿 / 结果 / 我的，移动优先，去 Demo 味）
- [x] 区域热点叠加（悬停与点击，含按分类限制热区）
- [x] 真实链路验收（三分类真实生成 + 390/768/1440 页面实测 + 订单扣费与退费）
- [x] 商品链接导入（淘宝/天猫、京东、拼多多、抖音商城 + 手机分享短链；真实取图与真实出图）
- [x] 修复「商品图模特被当人物参考」的提示词缺陷（身份约束段 + 测试）
- [x] 独立代码与安全评审结论落地（两 P1 与九项 P2 已修，评审后全量 75 项测试全绿）
- [x] v3：REA 原扩展品类能力 → docs/rea-tryiton-categories.md（结论：只支持单件单分类）
- [x] v3：淘宝类目词表 → docs/taobao-tags.md + data/taxonomy.json + public/lib/garment-taxonomy.js
- [x] v3：多件下单（pieces 七格、accessory ≤2、dress 互斥、≤5 件）与分层提示词
- [x] v3：设置页模型入口（GET/PATCH /api/settings，持久化到 state.json）
- [x] v3：演示模式（DEMO_MODE=1 不扣费、隐藏全部价格与充值入口）
- [x] v3：前端仿 flyne 深色工作台（导航 / 搭配台 / 衣橱 / 设置 / 导入 / 订单）
- [x] v3：真实多件出图（上衣 + 下装 → 35s success）+ 6 路由 × 3 视口截图无溢出
- [x] v3：独立评审落地（1 P1 + 4 P2 已修，全量 96 项测试全绿）
- [x] 提交并推送（`2e304fb` → nizigen/tryon-web master）
- [x] v4：契约 `docs/NEW_FEATURES.md` + 4 个子代理并行（衣橱/登录/工作台/三页前端）
- [x] v4：我的衣橱（`src/wardrobe.mjs`，上传 / 导入结果入库 / BM25 检索 / 删除 / 取图）
- [x] v4：视觉描述（`src/caption.mjs`，the image service `codex/gpt-6.1-sol`，失败不影响入库）
- [x] v4：AI 今日穿搭（`src/outfit.mjs`，模型选搭 + 严格校验 + 规则回退 + 检索为空退回全量衣橱）
- [x] v4：扫码登录（`src/login.mjs`，受控 Chrome + CDP 读全量 cookie，写 `data/cookies.json`）
- [x] v4：工作台两级下拉（`createCascadeSelect`）+ 默认条目 + 加号追加 + 从衣橱选
- [x] v4：真实链路（衣橱 4 件 → AI 选搭 → 下单 → 30s 出图）+ 浏览器全链路实测 + 127/127 测试
- [x] v4：独立评审落地（3 P1 + 9 P2 全修，含衣橱格子错配、cookie 路径统一、演示模式选搭不打上游）
- [ ] v4：真实手机扫码走通并写出 cookie
- [x] v4：提交推送（`fc25c4c` / `6c5a441`，历史重写后为 `3e860a8`）
- [x] 内置模特（`public/model/model-front.png` + `public/lib/person.js`，工作台与今日穿搭默认预填，不传照片可直接出图）

## 决策与约束
- 提示词分层：保留项 / 完全替换与去残影 / 服装保真 / 光影与褶皱自然 / 禁止合成感 / 输出前自检；用户补充要求单独成段且不得覆盖区域与身份规则。
- 多件分层顺序固定为 `top → outer → bottom → dress → hosiery → shoes → accessory`，参考图编号与提示词里的「reference image N」必须一致。
- 资金语义：下单冻结 → 成功实扣 → 失败/超时全额退回；充值与发放分离。
- 商品图必须是真实素材或明确标注的 AI 生成图（界面已标注"AI 生成商品图"）。
- 结果图默认 24 小时后清理；人像照片不落盘。

## 未验与交接
- 真实支付与真实登录（抖音 code2session + 虚拟支付）未接入，充值为本地模拟。
- 混元 / MiniMax 未做真实生成验证；混元成本为估值。
- 隐式 AI 标识与"外套保留内搭"的真实生成未验证。
- 小程序端代码未写（本仓库交付 H5 与后端 API，小程序需另建工程并复用同一套 REST 接口）。
- 商品链接导入：四家全部服务端直连、不开浏览器——淘宝 = 登录 cookie + mtop、抖音 = 分享数据 + ttwid、京东 = 手机版详情页 `window._itemOnly`（免登录）、拼多多 = `goods1.html` 的 `window.rawData`（需 pdd cookie）。OpenCLI 仅作直连失败时的可选兜底（`runCli:null` 可禁用），因此不装 OpenCLI 的机器也能取图。
- 抖音商城商品分享只带一张主图（`goods_detail`）；抖音视频/图文帖能拿封面/图集，但图片 CDN 直链一次性，已在解析时缓存规避。1688 未接。
- 淘宝与拼多多 cookie（`data/cookies.json`）会过期，过期后需用户重新从 DevTools 复制；淘宝无 cookie 且无 OpenCLI 时返回 503，拼多多无 pdd cookie 时返回 503 提示补充 cookie。
- 淘宝详情长图（`descUrl`）被风控挡住，当前只有轮播图、主图与规格图。
- v3 多件搭配只真实验证了「上衣 + 下装」两件；五件满配、外套保留内搭、裙 + 袜的组合未做真实生成对比。
- v3 演示模式只隐藏前端金额，真实计费模式（不设 `DEMO_MODE`）本轮未回归验证。
- 浏览器内文件上传受 OpenCLI `upload` 限制未打通，出图证据走接口链路。
- 容器内安装了 chromium 仅用于本次 UI 验证，用户 Windows 机器上的 OpenCLI 通道可复跑同一流程。
- v4 扫码登录：只验证了「未扫码不误判」「只改当前平台键」「并发 409」「超时 503」；真实手机扫码那一步未验证。登录判据只认 `unb`/`pt_key`/`PASS_ID`（`cookie2` 在访客页也会下发，不能当判据）。
- v4 AI 选搭：依赖 the image service 对话模型（默认 `codex/gpt-6.1-sol`）；模型不可用时按规则回退，此时不理解自然语言需求。只做选搭，不做「生成多套候选」。
- v4 衣橱：单进程 JSON 索引 + 文件，没有多实例并发控制；图片与索引都在 `data/`（git-ignored），不随仓库分发。
- v4 前端：衣橱与今日穿搭的图片刻意不用 `loading="lazy"`（后台会话里 `visibilityState` 为 `hidden`，懒加载永不触发）。
