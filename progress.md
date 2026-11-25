# progress — 会话日志（操作、变更、验证、错误）

## 2026-11-25 · W6 无影棚三姿势成片

- 参考 `https://www.douyin.com/user/MS4wLjABAAAA3RFCRkYH-WnsUHFSmHOl2XZR53gMQ66mCEZxtkIqxV5H56ySFFQqOdmhno0g9XF-?...modal_id=7692413820165265856`，下载 10 张图文证据到 `evidence/reference-sicii-studio/`。提炼固定无缝背景、全身留白、略低机位、柔光与极淡鞋底影，仅改变姿势。
- 后端 `src/prompt.mjs` 增加 3 个棚拍背景、6 个姿势和按搭配推荐三姿势；普通提示词保留原姿势与背景，无影棚提示词允许重建摄影层，继续锁定身份、身体比例和所有服装。`src/app.mjs` 在取图/扣费前校验并持久化 `photographyMode/studioPreset/posePreset`，旧请求缺省 `preserve`。
- 前端工作台增加普通/无影棚切换、背景下拉、三姿势预览、三张顺序订单与结果卡；衣橱 AI 选搭增加“去无影棚拍 3 张”。复用现有单任务并发、逐单扣费退款、结果票据，没有新增批量状态机。
- 修复：三张完成后 `batchIndex` 未推进到总数，按钮会停在“正在生成 3/3”；现在完成后恢复。真实运行又发现空失败摘要被渲染为可见 `null`，改为过滤空节点，并补 Chromium 断言。
- 验证：`test/frontend.test.mjs` 11/11 通过，覆盖三姿势真实临时订单、三个姿势字段、按钮恢复和不存在 `null` 文本；语法检查通过。
- 真实页面：OpenCLI/Chrome 在 390×844 走通“衣橱选两件 → 当前搭配 → 去试穿 → 无影棚”；真实图片服务 GPT Image 2.5 顺序完成 3/3，三张均为 744×2114 PNG。逐张与 PoseWear 对照后确认：手位和重心对应，人物身份、黑长直、身体比例及米色针织衫/灰色百褶裙保持一致，固定白棚机位连续。第三张鞋底保留极淡接触影，视觉上仍有自然接地且没有明显投影。真实图属用户人物资产，未纳入仓库。
- PoseWear 固定素材补齐来源和 CC0 1.0 授权说明；六个本地文件与人物资产工程中的原始文件 SHA-256 逐一相等。README 已增加“衣橱/AI 选搭 → 三个姿势 → 三张独立无影棚成片”的产品入口。
- 最终复核：提示词/API 与前端/可访问性两条独立审查均未发现仍可复现的 P1/P2；全量 `node --test` 214/214、四项语法检查通过。重启 `127.0.0.1:43130` 后，OpenCLI 实测无影棚切换、三姿势参考图、禁止重复与恢复推荐入口，浏览器控制台无报错。
- 真实 AI 选搭：绕过当前演示模式的规则分支，以当前 22 件衣橱连续请求 `codex/gpt-6.1-sol` 三组不同场景，均返回合法搭配，耗时 4.7–8.7 秒；完整证据落 `evidence/ai-stylist-live-20261125.json`。目视与语义复核发现选搭仅基于商品文字，舒适度与不露腿约束判断仍不可靠，未将其误记为验收通过。
- 文档同步 PRD / APP_FLOW / BACKEND_STRUCTURE / FRONTEND_GUIDELINES / IMPLEMENTATION_PLAN / TECH_STACK。`git diff --check` 仍只报既有 `lessons.md:18 new blank line at EOF`，未混入本轮修改。

## 2026-11-25 · FASHN v1.5 调研与 IDM app 接入收尾

- 用户改选 FASHN v1.5：经 OpenCLI `web read` + GitHub MCP 双源核验官方 repo（HEAD `7c0f10af3f91ad4048fe9729c470a13ef905d25a`）与 HF 卡。结论：972M 像素空间 MMDiT（源码头注释自认 adapted from FLUX.1），无 VAE、576×864、tops/bottoms/one-pieces 三类、DWPose 条件、bf16/Ampere+、~8GB VRAM、H100 5s。官方**无** LoRA/训练代码（全仓 0 命中、issues #1-7 无关、HF 仓只有 model.safetensors）；独立核验子代理确认 forward 全部走 `module(x)` 调用、无绕权重写法，`get_peft_model`+显式 target_modules（qkv/proj/linear1/linear2）可注入，DoubleStreamBlock 绕过 SelfAttention.forward 不影响 PEFT；第三方有自建训练管线痕迹（haat-studio、vton-custom），非官方。证据与边界记 findings.md "FASHN v1.5"。
- IDM app 接入完成并两轮独立复审：无 P1。修掉测试暴露的 7 项契约问题（纯 base64、后段输入预检、返回 sniff、非 data URL 等）；`src/idm.mjs`、generation/app/tryon/pricing 接线、settings.js/studio.js 能力提示、`.env` 加 `IDM_BASE_URL=http://127.0.0.1:8190`、`IDM_TIMEOUT_MS=600000`。全量 `node --test` **193 pass / 0 fail / 1 skip**（Chromium 未安装时跳过，据实记录）。远端服务子代理独立修掉 5 项（letterbox+crop 保比例 361×1024、DensePose 官方 setup_config+create_context 缓存、busy 门禁前置、坏图/EXIF 400、契约测试 13/13），本地=远端 SHA256 `35308857…edea6e19`，真实 HTTP 15.23s 输出 aspect_delta 0.00004，服务 PID 21463 监听远端 loopback:8190。
- 复审遗留 P2：①IDM 选中时 studio 鞋/饰入口仍在（后端 400 兜底，符合规范字面）；②Node 无返回图比例断言；③IDM 选中已禁用 fit/extra（本轮新增）。OpenCLI 真机验收进行中：设置页已见 IDM 选项与健康态，但本机 Chrome 全部窗口 `state:minimized` → `visibilityState=hidden` → 原生点击被拒（`Native input requires a visible browser page`）；`browser chrome call windows.update` 参数契约已核实为 `<method> [argsJSON]` 两段式，恢复窗口后继续。FASHN 页面验收与 IDM 页面下单均未完成，目标保持 active。


## 2026-11-24 · goal round2：主UNet正式校验通过

- clean下载主UNet分段账本已覆盖0..11965769774完整区间后，单独计算整件SHA；结果为官方 `046b775cb9bbc67635fc3b148bb03bfe00496ce2f9ce8488a82fdb388669a521`，正式匹配。未再以st_size当完成判据。
- 第二个UNet继续下载，记录时完整段约71.2%；最终核验/首图门禁PID17989保持等待。没有IDM diffusion成品图，未接app。
- 基于官方契约的常驻HTTP服务草稿artifacts/idm_server_v2.py已准备，包含请求大小/参数范围、GPU互斥与启动权重SHA校验；尚未部署，先等官方CLI单件质量验证。语法检查通过，已送独立只读审查。
- 阅读vibe-coding与现有六规范相关章节，为后续W5接入准备；不改app原提示词链和图片比例，尚未进行新业务代码改动。

## 2026-11-24 · goal round1：下载及官方源码版本对齐

- 预处理仍已完成并有mask/DensePose图片证据。官方pipeline加载前新增导入检查：diffusers0.27.2缺PositionNet，与官方源码不配套；将隔离venv对齐diffusers0.25.0后，官方SDXL pipeline与双自定义UNet三个类导入成功。未改变base环境。
- 一次提前SHA检查在并发下载尚未全部完成时执行：text_encoder_2匹配，unet不匹配。因为文件含未完成的稀疏区，这不能证明旧前缀损坏；已明确纠正该推断。为避免继续信任旧hf_hub前缀，主动清空两个UNet未验证partial并从零下载，确实增加了下载量。
- 当前下载PID17914（idm-fresh-download.py），日志/root/autodl-tmp/idm-fresh-download.log，按完成账本idm-fresh-ledger.jsonl统计进度，不用st_size代替；记录时unet完成区间约2.52GB/11.97GB（21%）。text_encoder_2完整partial仍保留，等待最终SHA复核。
- 旧门禁已替换：PID17989运行idm-finish-and-run.py，日志idm-finish-and-run.log；等待新下载结束后逐件重新SHA核验、转正全部十件、原子写receipt，再启动一次官方单件上衣推理。若任何文件或SHA失败则停止，不会把失败/等待冒充出图。
- 尚待真实diffusion推理、两段串联、视觉检查与app接入，目标保持active。

## 2026-11-24 · 用户选2删除旧权重，IDM-VTON部署检查点

- 用户明确选择删除Qwen四件权重；已核对精确绝对路径并删除目标文件与4个软链、停止ComfyUI。磁盘当时由14G空闲恢复至43G；IDM权重和本地衣橱未动。
- app构图补白实验已回退；src中无image-size/sizes/pad_person；未落地精简prompt。重启了本地服务（host job `pwsh-1434c3cd4eaa43c5`），43130/api/config HTTP200。27项聚焦工作流测试通过。旧8189 SSH隧道已停止。
- 安装问题实证：3个遗留pip同时装同一venv且重复拉CUDA；已按精确argv/PID停止。复用系统torch与CUDA目录和对应dist-info，venv独立安装diffusers0.27.2/transformers4.40.2/numpy1.26.4，核心import实际通过。scikit-image0.24.0等图像模块也通过导入。
- 官方源码固定commit `06ad89ba2f78d77a5ba21d7f7fd392254971fda2`。独立只读审查核实自定义SDXL双UNet、mask方向、OpenPose关键点与DensePose图像之区别；修正了草稿中的不存在模块与错误pipeline。当前执行入口是artifacts/idm-infer-official.py；artifacts/idm_server.py仍为旧未部署草稿，不应使用。
- 官方实际支持入口为upper_body/lower_body/dresses，无鞋category。同部位两层保留没有官方保证，只能实测，撤回此前训练分布等过度推断；findings与lessons已更正。
- 真实预处理：服务器执行`--prepare-only`用时7.95秒完成，mask与DensePose图已取回并查看（artifacts/test/idm-shirt-mask.png、idm-shirt-dense.png）。未加载diffusion权重，未假称已试穿。
- 下载：hf-mirror慢，切到ModelScope `AI-ModelScope/IDM-VTON`；十件模型的Size/Sha256与官方逐项一致，固定MS revision `740677aa0027fe4640e2b619a83a57d9be23e321`，1MiB请求206正确/0.54秒。16路32MiB分段，Content-Range和长度校验、pwrite后fsync再记账、最终整文件SHA通过才转正。服务器PID17037，日志/root/autodl-tmp/idm-ms-download.log，账本idm-parallel-ledger.jsonl。部分文件为稀疏写入，不使用st_size当进度。
- 已启动门禁等待任务PID17687（日志idm-first-stage.log），只在idm-receipt.json出现后运行单件官方CLI，下载进程若退出且无收据则失败停下；不自动宣布视觉通过。最新主UNet已写到10.6GB范围，仍须全部分段与SHA过门。
- 未完成：双UNet最终校验、真实单件出图、两段串联的视觉质量与本地app接入。目标保持进行中，无git提交。

## 2025-11-22 · v2 改造：从本地工作台到付费试穿产品

### 输入与决策
- 用户诉求：把 GitHub 上的 tryon-web（照 Chrome TryItOn 扩展实现）拉到本机；补充服饰选项与提示词，解决"衣服替换不到位、原衣留一半"与"AI 味光影褶皱"；补齐插件式的"鼠标移到身体就显示对应服装"；做抖音穿搭号的橱窗选衣 + 付费试穿；前端去 Demo 味；平台形态（抖音小程序 vs App）由我调研决定；定价由我按模型成本决定。
- 仓库已克隆到 `/root/pi-work/tryon-web`（原仓库在 `C:\GitHub\tryon-web`，本机为 Linux 容器副本）。
- 平台决策与定价依据见 findings.md 第 1、2 节。

### 变更
- 后端按模块拆分：`server.mjs`（入口）+ `src/{app,store,tryon,pricing,prompt,imageapi,validate,errors}.mjs`（v5 起由 imageapi 模块取代原网关模块）。
- 提示词：结构化分节 + 服装子类（tops 7 类 / bottoms 4 类 / dresses 1 类），外套类走"替换外层、保留内搭"语义；商品标题进入提示词。
- 新增商品目录（`data/catalog.json`，6 件商品，商品图为 AI 生成并在界面标注）、按模型 × 档位定价（`src/pricing.mjs`）、会话/订单/充值单 JSON 持久化（`data/state.json`，原子写）、异步试穿任务（下单冻结额度 → 生成 → 成功扣减 / 失败退回）。
- 前端重做：橱窗（商品网格 + 分类筛选 + 搜索）→ 试穿页（模型/档位/上传/版型/补充要求）→ 结果页（原图对比、区域热点叠加、下载带 AI 标识）→ 我的（余额、充值、订单历史）。移动优先，底部固定 CTA。
- 文档：六份规范（PRD / APP_FLOW / TECH_STACK / FRONTEND_GUIDELINES / BACKEND_STRUCTURE / IMPLEMENTATION_PLAN）按 v2 重写；`design/` 预览移入 `public/design/`（仍可访问）。
- 测试：删除旧的 `test/server.test.mjs`，新增 `test/{api,pricing,prompt,store}.test.mjs`，共 39 项。

### 验证（真实执行）
- `node --test` → 39/39 通过（含扣费、失败退额、并发 409、pending 轮询、跨站拒绝、目录穿越拒绝）。
- 本机图片服务真实生成（gpt-image-2 / medium / 1024x1536）：
  - tops（红花衬衫）→ 整件替换，无白色残影；
  - bottoms（黑牛仔裤）→ 下装完整替换；
  - dresses（黑缎面吊带裙）→ 上下装同时替换、保留鞋；
  - 提示词对照实验做了旧提示词 / 结构化 / 结构化 + 禁合成感三版。
  - 上述结果图与对照图都含模特照片，**已从仓库删除**，只保留文字结论。
- 页面真实交互（Chromium headless + CDP 驱动，容器内）：390/768/1440 三档均无横向溢出；上传人物照 → 提交 → 排队 → 生成 → 结果图加载 → 悬停/点击热区叠加服装图 → 下载按钮 → "我的"订单记录，均实测通过；不含人像的界面截图见 `docs/evidence/ui-*.png`。
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
- 真实出图：手机分享短链 → `/api/sources` → `/api/orders(sourceId)` → 轮询 → `?k=<token>` 取图，**43.7 秒 success**，结果 1024×1536 / 1761061B（结果图含模特照片，已从仓库删除）。
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
- 真实多件出图（`DEMO_MODE=1`，`artifacts/probe/probe-studio.mjs`）：上衣 + 下装 → 201、`priceCents:0`、35s success、结果 1846617B，人物身份保留且上下装同时替换（结果图含模特照片，已从仓库删除）。
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
- AI 选搭依赖 OpenAI 兼容的对话模型；模型不可用时按规则回退，此时不理解自然语言需求。
- 衣橱索引与图片是本机单进程 JSON + 文件，没有多实例并发控制。

**错误与修正**
- 工作台点「开始试穿」后读到 toast「图片编码、格式或内容无效」，一度以为是图片校验缺陷；抓网络层发现 `POST /api/orders` 实际 201、job success、结果图正常——那句是上一轮失败残留的 toast 文本（只 `hidden` 不 `textContent`），读 DOM 时误判。
- `.picker__item` 的索引与衣橱列表顺序不一致（列表按 `createdAt` 倒序），按索引点会点错件；验收脚本改为按文案匹配。
## 2025-11-23 · 内置模特：不传照片也能直接试穿

**输入与决策**
- 用户给出稿定作品链接，要求「去掉左上角水印，用这个正面照作为模特图」。
- 取证后确认原图没有水印（残差、DOM、稿定自身文案三路），不做任何涂抹；改为从三视图里切出正面那一格。

**变更**
- 新增 `public/model/model-front.png`（337×956，206817 字节，sha256 `5da42398279fe5f3ad1d26de31964aa49e37921bcef816ed0293d36ced245c4c`）与 `public/lib/person.js`（`loadDefaultPerson()`：fetch 静态图 → dataURL，页面级缓存，失败返回空串）。
- `public/views/studio.js`：`state.personIsDefault`；人物照按钮改为 `personBtn` 常量并在 `paintPerson()` 里改文案；进页面 `void loadDefaultPerson().then(...)` 预填；dropzone 标题与提示同步。
- `public/views/wardrobe.js`：同样新增 `personIsDefault` 与 `paintPerson()`；今日穿搭「生成试穿图」在没照片时先尝试内置模特，再退回原来的「请先上传」提示。
- `public/style-wardrobe.css`：`.stylist__person` 加 `flex-wrap`，新增 `.stylist__person-note`。
- 文档：README（标题段、工作台能力、目录）、APP_FLOW（v4 变更两条）、PRD（P0 第 9 条 + 验收）、findings（新增第 14 节）。

**验证**
- `node --test` **127/127 pass**（3038ms）；`node --check` 对三个前端文件 exit 0；全仓 U+FFFD 0 命中。
- `artifacts/probe-default-person.mjs`（CDP 无头）：工作台 `previewHidden:false / naturalWidth:337 / submitDisabled:true（还没选单品）/ 按钮「换成我的照片」`；衣橱 `naturalWidth:337 / note「当前用的是内置模特…」`。
- `artifacts/probe-default-person-tryon.mjs`：不传照片，直接 `/#/tryon/shirt-floral` 点「开始试穿」→ `POST /api/orders` **201**、`slots:["top"]`、`priceCents:0`、约 25s success → 结果图 744×2114（`artifacts/test/default-person-result.png`，sha256 `2f181d2949ed0159e9a40343a1a05c61f9b81b493f20ff614f94b58a38539ff6`），目视确认模特换穿红底白花短袖衬衫、脸与站姿保持。

**未验证**
- 内置模特是真人风格照片，用于对外演示前需确认肖像来源合规（当前来自用户提供的稿定作品）。
- 只验证了单件；多件与内置模特的组合未单独复测。

## 2025-11-23 · v5：把私有网关换成通用 OpenAI 兼容图片 API

**输入与决策**
- 用户要求：readme 里不要再出现那个私有网关的名字，改成正常的 API 填法，仓库他自己手动删。目标是把品牌与私有 MCP 协议整体换成通用写法，删库由用户自己动手。
- 实测本机网关的 HTTP 形状（决定改法）：`POST /v1/images/generations` 收 JSON、`POST /v1/images/edits` **只认 multipart**（JSON `image_url` 写法回 400「an edit needs the image to edit」）、`GET /v1/models` 不需要密钥、未知模型回 404。
- 模型目录不能只按 `modalities.output` 过滤：93 个模型里只有 `minimax-code/MiniMax-Image` 标了图片输出，默认模型 `codex/gpt-image-2` 根本不在目录里却照样能出图。做法是目录结果 ∪ `IMAGE_MODEL`，或由 `IMAGE_MODELS` 直接给定。

**变更**
- 新增 `src/imageapi.mjs`（取代并删除原来的私有网关模块）：`apiBaseUrl/apiKey`（支持 `IMAGE_*` 与 `CHAT_*` 两套前缀）、`listModels`、`generateImage`（有参考图走 multipart `image[]`，无图走 JSON）、`deadline`。删掉 JSON-RPC、SSE 兼容与 pending 轮询全部逻辑。
- `src/caption.mjs`、`src/outfit.mjs` 改用 `apiBaseUrl(env,'CHAT')` + `apiKey(env,'CHAT')`；`src/app.mjs`、`src/tryon.mjs` 的 import 指向新模块。
- `src/app.mjs` 新增两处兜底：下单时若 `state.json` 里存的模型已不在目录中，退回默认模型而不是每次报 `MODEL_UNAVAILABLE`；`GET /api/settings` 对外报告的也是真正会用的那个模型。
- 测试：`test/api.test.mjs` 与 `test/wardrobe-api.test.mjs` 的假上游整体重写为 OpenAI 兼容服务（`/models`、multipart `/images/edits`、JSON `/images/generations`），新增「存下来的模型已不在目录里时退回默认模型」。
- 文档：README（运行前提、14 行环境变量表、目录、模型可达性边界）、`.env.example`（整份重写）、AGENTS（架构与模型来源）、TECH_STACK（表格与模型目录小节）、BACKEND_STRUCTURE（模块表与校验条）、PRD / IMPLEMENTATION_PLAN / task_plan / docs/NEW_FEATURES。历史记录类文档（findings / progress / CONTRACT_REVIEW / REA_REPORT / douyin 可行性）保留当时事实，只把品牌名换成「本机图片网关」。

**验证**
- `node --test` **128/128 pass**（4.3s）；`node --check` 对 imageapi / caption / outfit / app / tryon / server 全部 exit 0。
- 补 `test/errors.test.mjs` 5 条（OpenAI 形状 message、裸 message 与纯文本、抹凭据压一行、超长截断、有无原因两种文案）后全量 **133/133 pass**（4.4s）。
- 又补 `test/imageapi.test.mjs` 4 条（服务只回 url 时同源取回、第三方 url 拒绝代取、上游 429 原因透传、目录不可达退回 `IMAGE_MODEL`），并修掉 `abortable` 在无 signal 时泄漏 rejection 的真实缺陷，全量 **137/137 pass**（4.6s）。
- 全仓扫描（59 个 `.mjs/.js/.json/.md`，排除 .git/artifacts/data）：私有网关的名字 **0 命中**，原模块文件已不存在；15 个文档 U+FFFD 0。
- 真实网关：`workbuddy/hunyuan-image-alpha` 生成 200（16.4s）、编辑 200（9.7s）；`codex/gpt-image-2` 两条通道都 502（`chatgpt.com` 出口连接超时，本机代理 10808 通但网关进程不走它）；`minimax-code/MiniMax-Image` 502「returned no images」；`workbuddy-ai/hy-image-3.5` 429 额度用尽。
- 真实端到端（`artifacts/probe-v5-real.mjs`）：演示模式、`IMAGE_MODELS=workbuddy/hunyuan-image-alpha` → 会话 690 分 → 多件下单（上衣 + 下装）201 `slots:["top","bottom"]` `priceCents:0` → 轮询 15s success → 结果 1627042 字节 PNG，目视确认模特换上红底白花短袖衬衫与浅蓝直筒牛仔裤、脸与站姿保持。

**未验证**
- 除混元外的模型在真实环境能否出图取决于部署方的出口网络与额度，本项目只负责如实转述上游错误。
- 演示模式之外的计费链路本轮未再回归（v4 已验，v5 只改了上游协议层）。

**错误与修正**
- 第一次跑真实探针报 `502 UPSTREAM_ERROR`，一度怀疑 multipart 拼错；用 `artifacts/probe-edits-debug.mjs` 打出上游原文才发现是 `chatgpt.com` 连接超时，与代码无关。教训：上游 502 先看它自己的 error.message，不要先怀疑本地拼装。
- 用 `node -e` 内联脚本改中文文档时，双引号与反斜杠被 PowerShell 吞掉导致语法错误；改为把脚本写成 `artifacts/*.mjs` 文件再执行，稳定可靠。

## 2025-11-23 · v5 补丁：加载态修复 + 默认模型升到 2.5

**输入与决策**
- 用户：「你这开始生成怎么完全不转呢？还有先把本地的模型换成 image-2.5」。
- 决策：不猜「转圈没转」，先用 CDP 采样 `getAnimations()` 与元素几何区分「动画没跑 / 动画在视口外 / 根本没有 spinner」三种情况，再对症修。

**变更**
- `public/views/wardrobe.js`：新增 `setStatus(text, spinning)`（`orderSpinner` + `orderStatusText` 同进同出），替换 10 处零散的 `orderStatus.textContent = ...`；`paintResult()` 补 `pending` 等待卡片（`.stage` + `.spinner` + 阶段文案）；提交后 `orderStatus.scrollIntoView({block:'center'})`；轮询里阶段变化同步 `paintResult()`。
- `public/views/studio.js`：提交按钮旁新增 `.studio__busy`（`submitSpinner` + `submitStatusText`），`updateSubmit()` 里与 `busy` 一起显隐；轮询的 pending 分支补 `updateSubmit()` 让阶段文案跟着走；结果区滚动改 `block:'center'`。
- `public/style.css`：新增 `.studio__busy`（inline-flex、gap 8px、13px、muted）。
- `public/style-wardrobe.css`：`.stylist__status` 改 flex + gap，让转圈与文案同一行。
- `src/imageapi.mjs`：`DEFAULT_MODEL` → `codex/gpt-image-2.5`。
- `src/pricing.mjs`：`MODEL_LABELS` 与 `TIERS` 增 `codex/gpt-image-2.5`（沿用 690/1390 与 medium/high），保留 `codex/gpt-image-2` 条目；`priceCatalog` 的 `preferred` 优先 2.5、再退 2、再取首个。
- 测试：`test/api.test.mjs`、`test/wardrobe-api.test.mjs`、`test/pricing.test.mjs` 里的模型名与 defaultModel 断言同步为 2.5。
- 文档：`.env.example`、`README.md`、`BACKEND_STRUCTURE.md`、`TECH_STACK.md` 的默认模型与价格表同步；README 里「`codex/gpt-image-2` 返回 502」是实测记录，保留原样。

**验证**
- 全仓 `node --test` **137/137 通过**（约 4.4s）。
- 真实网关（`DEMO_MODE=1`，服务 PID 163300）：`/api/config` → `defaultModel codex/gpt-image-2.5`、slots 7；`/api/settings" → model 2.5、gateway true；下单 201 → 轮询 3–33s `running generating` → **33s success** → 2138410 字节 PNG（`artifacts/test/v5-model25-order.png`，订单 `model: codex/gpt-image-2.5`）。
- 衣橱页 CDP 实测（`artifacts/probe-busy-visible.mjs`）：`.spinner` `hidden:false`、`getAnimations().length===1`、`spinnerRect.y≈667`（1440×900 视口内）、`statusText` 从「排队中，马上轮到你」→「正在生成，请稍候」、`btnText` 「生成中…」、结果区 `.stage` 存在、页面自动滚到 `scrollY 372`。
- 工作台 CDP 实测（`artifacts/probe-studio-busy.mjs`）：`.studio__busy` `hidden:false`、spinner `getAnimations().length===1`、`spinnerRect.y≈566`、`btnText`「生成中…」、`stageText`「排队中，马上轮到你」、`stageVisible:true`。
- 证据图：`artifacts/shots/busy-studio-1440.png`、`artifacts/shots/busy-wardrobe-1440.png`。

**未验证**
- 只在 1440×900 视口实测了加载态位置；390 窄屏未单独量（v4 已验窄屏无横向溢出，本轮未改布局结构）。
- 2.5 的真实出图只跑了一次单件；多件满配未回归。

**错误与修正**
- 第一版探针忘了给「今日穿搭需求」输入框填值，`帮我选` 直接返回 0 个搭配，误以为衣橱是空的；补上输入值后 suggestion 正常给出 2 个格子。
- 下单探针第一次漏传 `person`，返回 `400 INVALID_IMAGE field=person`；补 `public/model/model-front.png` 的 dataURL 后 201。

## 2025-11-23 · 前端布局重做：工作台两栏 + 设置多列

**输入与决策**
- 用户反馈「现在布局和交互太难看」，要求按 vibe-coding 前端轨道优化。
- 沿用已批准的 flyne 深色方向（frontend-track §3「对已批准方向的迭代」不重开选型门），只调结构与间距，不换视觉语言。

**变更**
- `public/views/studio.js`：`root.append` 由单列堆叠改为 `studio` 两栏——左 `studio__controls`（人物照片 / 单品搭配 / 版型与补充要求 / 提交）+ 右 `studio__preview`（试穿结果）。标题统一用 `.card__head > .card__heading`（标题在上、`.section__hint` 在下）+ 右侧 `.push-end` 放「＋ 添加单品」；提交卡内层拆 `.studio__submit-info`（已选件数 + 演示提示）与 `.push-end`（状态 + 按钮）。
- `public/style.css`：`.studio` ≥1080px 两列 `minmax(400px,460px) minmax(0,1fr)`，`.studio__preview position:sticky; top:84px`；新增 `.card__head/.card__heading/.studio__submit-info`；`.studio__preview > .card` 最小高 440px、空态垂直居中；`.settings` ≥900px 两列网格；收紧 `.dropzone` 内边距（20/16→16/14）与预览高度（240→200）。
- `FRONTEND_GUIDELINES.md`：布局段补「工作台两栏 + 结果区吸顶」「设置两列」「`.card__head` 标题上下排」三条规则。

**验证**
- `node --test` 137/137 通过（4070ms）。
- `artifacts/shot-cdp-all.mjs`：6 路由 × 1440/768/390 = 18 组，`scrollWidth === clientWidth`、越界元素全空，无横向溢出。
- 真实出图（`artifacts/probe-default-person-tryon.mjs`，内置模特 + 预填 shirt-floral）：下单 201、`slots ["top"]`、`priceCents 0`、约 24s success，结果图 744×2114 在右栏正常显示（截图 `artifacts/shots/cdp-studio-result-1440.png`）。

**错误与修正**
- 首次 `edit` 报「file changed since it was read」——因为我先前只用 `node -e` 读过 studio.js，不算 read 工具观测；改用 read/edit 后正常。

**未验证**
- 多件（外套/下装/鞋）在新两栏布局下的结果展示未单独截图；结构上与单件一致。


## 2025-11-23 · v6：视觉重做（framed-sheet，去紫色 + 弱化边界 + 组件重做）

用户原话："你这都没找其他参考啊，我觉得你这些组件太丑了，还有不要用紫色好吧，AI味太重了，你按vibe-coding前端流程来做啊，组件都改一下，不要按照原来demo哪些组件了，记得弱化边界"

**做法（vibe-coding 前端轨道）**
- 参考：读 design-taste-frontend 的 references/app-screens.md（23 个真实产品实测规则）；用它自己的 \scripts/draw.mjs --app\ 从站点样式库抽出方向 \ramed-sheet\（seed 1470960127），令牌与结构记进 FRONTEND_GUIDELINES.md。
- 只换视觉层、不动布局骨架：重定义 :root 令牌 + 覆盖全部组件形状，追加在 style.css 末尾（约 480 行）；style-wardrobe.css 的暗色残留（#b91c1c / rgba(255,255,255,…) / #fbbf24 / 深色模态阴影）逐条换成令牌。
- 去紫色：accent 由 #7c3aed/#a855f7 换青灰 #1b6c80；主按钮由紫色渐变胶囊改为近黑墨色 8px 方角；999px 药丸全部改 8px。
- 弱化边界：卡片改"无边框无阴影、靠色调差分层"（白纸 #fff 上放 #f8f6f2 卡片）；仅在确需线条处保留 1px #e7e2da 极浅线。
- 字体：引入 IBM Plex Sans（+ Mono 管数字/ID），配 CJK 回退。
- index.html：theme-color 改 #efece6、加 Google Fonts preconnect 与样式表。

**验证（全部实测）**
- \
ode --test\ 137/137 通过。
- 18 组截图（6 路由 × 1440/768/390）无横向溢出。
- 对比度审计：全路由 0 处低于 3.0（先前 .sidebar__note 2.15 已修）。
- 设计审计：全路由阴影 0、渐变 0；可见边框只剩极浅 line/line-strong。
- 整图像素统计：平均亮度 226–247（浅色确认），彩色 0.3–4.4%，紫色 ≈0.005%（紫已清除）。
- 几何：1440 下 controls 460px + preview 609px 真两列、preview sticky；390 下侧栏变 59px 顶条、单列。
- 真实出图：预设商品真跑一次，\生成中\ 转圈可见（animations=1、spinner hidden=false），结果 744×2114。

**坑**
- 审计读的是浏览器缓存旧 CSS（\max-age=300\）→ 审计/截图脚本改成每次带时间戳的 \--user-data-dir\，否则结论失真。
- PowerShell 5.1 没有 \-Encoding utf8NoBOM\，批量改文件用 \[System.IO.File]::WriteAllText\ + \UTF8Encoding(\False)\。

**未验**
- 只在 1440/768/390 三档验过；平板横屏 1024/1180 未逐页复核；深色系统偏好下的表现未测（当前是固定浅色）。

## 2025-11-23 · v6 补丁：橱窗隐藏 + 衣橱可编辑 + 人物照去常驻虚线框

用户原话："现在单品标签为什么不能改呢？还有橱窗先步展示吧……然后是图片能不能不要一直有那个虚线框？你要有的话就吧模特图先换到一边啊"

**判断**
- 「单品标签不能改」：工作台每条的大类/子类是两级胶囊，可改；真正改不了的是「我的衣橱」卡片——只有删除。→ 补衣橱编辑。
- 「橱窗先不展示」：把侧栏「橱窗」入口隐藏，默认路由改工作台；同时告知抖音博主橱窗/主页链接无法解析（无公开接口，需精选联盟授权），导入页明确只支持单件商品链接。
- 「一直有虚线框」：`.dropzone` 无论有没有照片都是虚线。→ 空态才虚线；有图换左侧 72×96 小缩略图 + 右侧文字的一行。

**变更**
- `src/wardrobe.mjs` 新增 `update(id, patch)`：只改传入字段（name/category/subtype/tags/description），图片与 createdAt 不变；名称空/类目非法抛 400，找不到返回 null；原子写 + 串行队列。
- `src/app.mjs` 新增 `handleWardrobeUpdate` 与 `PATCH /api/wardrobe/:id` 路由。
- `public/views/wardrobe.js`：卡片加 `.wardrobe-card__edit`「✎」按钮 + `openEditModal(item)`（名称输入 + 两级类目，PATCH 后提示「已保存」刷新）；空态按钮「去橱窗逛逛」→「去搭配工作台」。
- `public/style-wardrobe.css`：新增 `.wardrobe-card__edit`（左上角圆形深底，hover 青色）。
- `public/index.html`：shop 导航项加 `hidden`；`public/app.js`：默认路由 `shop→studio`、import 高亮归 `wardrobe`；`public/views/tryon.js`：「回到橱窗」→「回到工作台」。
- `public/views/import.js`：商品链接字段下加说明（支持单件商品/抖音商城分享；博主橱窗/主页需授权，暂不支持）。
- `public/views/studio.js`：dropzone 拆成 `uploadPreview + .dropzone__meta`；`paintPerson()` 里 `dropzone.classList.toggle('has-image', Boolean(state.person))`。
- `public/style.css`：v6 `.dropzone` 改 flex 行、空态虚线；`.dropzone.has-image` 无边框无内边距；`.dropzone__preview` 72×96 object-fit cover；`.dropzone__title` 的 `rgba(255,255,255,.8)`→`var(--muted)`（暗色残留）。

**验证**
- `node --test` **139/139 pass**（新增 `test/wardrobe.test.mjs` 的 update 持久化/边界用例、`test/wardrobe-api.test.mjs` 的 PATCH 用例）。
- 一次全量跑出现 `test/api.test.mjs` 单条 `bad port`（`app.listen(0)` 撞上 undici 禁用端口的偶发），单跑该文件 39/39、全量重跑 139/139 均通过。
- 真实 43130 演示服务（demoMode=true、gateway reachable）重启后，PATCH `/api/wardrobe/nope` 带 Origin 返 404 `WARDROBE_NOT_FOUND`（新路由生效）。
- `artifacts/probe-ui12449.mjs`（CDP 真视口）：默认路由空 hash → studio；studio 1440/768/390 的 `.dropzone` 均 `dropzone has-image`、`border-style:none`、缩略图 72×96、shop 导航隐藏、无横向溢出；wardrobe 16 卡片 / 16 编辑按钮、无溢出；1440 打开编辑弹窗 title「编辑单品」、名称已预填、两级胶囊存在。
- `artifacts/probe-edit-save.mjs`：打开第一件编辑弹窗→原值保存→弹窗关闭、toast「已保存」（非破坏性，仅回写同值）。
- 截图存 `artifacts/shots/ui12449-studio-*.png`、`ui12449-wardrobe-*.png`、`ui12449-edit-modal-1440.png`。

**未验**
- 编辑弹窗改「大类」后二级子类的联动表现只按代码路径核对（未逐个类目点）；真实手机端未复测（仅 390 视口模拟）。
- 抖音博主橱窗解析确认无公开接口，本轮未做（能力边界，非缺陷）。

## 2025-11-23 · 链接导入搬进「我的衣橱」弹窗（m12752）
**变更**
- `public/views/wardrobe.js`：头部 `.wardrobe-head__actions` 放「链接导入」+「上传图片」；新增 `openImportModal()`（粘贴 → `POST /api/sources` 解析 → 选缩略图 → 填名称/两级类目 → `POST /api/wardrobe {sourceId, sourceIndex, name, category, subtype}` → toast「已加入衣橱」+ 刷新）。空态「从商品链接导入」指向同一弹窗。
- 删除 `public/views/import.js` 与 `#/import` 路由；`public/app.js` 移除 `renderImport` 导入、`onOpenImport`、`importedSource/importedItems`、路由白名单与 `setActiveNav` 里的 `import`。
- `public/views/shop.js`：CTA 改为跳「我的衣橱」，文案改「粘贴淘宝 / 京东 / 拼多多 / 抖音商品链接，抓图入橱」。
- `public/style-wardrobe.css`：`.wardrobe-head__actions`；`.modal--wide` 560px；`.modal--wide .import__grid` 内滚 260px（初版 320px 会让弹窗整体外滚、按钮被切）；`.modal__actions` sticky 到底部，长内容时按钮常驻。

**验证**
- `node --check` app.js / wardrobe.js / shop.js 全 exit 0；`node --test` **139/139 pass**。
- `artifacts/probe-import-modal.mjs`（CDP 9468）：头部按钮 `["链接导入","上传图片"]` 无溢出；解析拼多多 `goods.html?ps=…` → 29 张 / 705ms、名称预填；选第 2 张 → 加入后弹窗关闭、卡片 16→17、探针自行 DELETE 回收 `cleaned:1`；390 头部无溢出。
- `artifacts/probe-import-shot.mjs`（CDP 9469）：1440 modal 560×800 `scrollable:false`；390 modal 350×760，按钮 sticky 后始终可见。截图 `artifacts/shots/ui-import-modal-clip-1440.png`、`ui-import-modal-clip-390.png`、`ui-import-modal-empty-1440.png`、`ui-import-modal-parsed-1440.png`、`ui-wardrobe-head-390.png`。

**未验**
- 只实测了拼多多一条真实链接的解析入橱；淘宝/京东/抖音走同一 `/api/sources` 路径但本轮未逐平台点。
- 真实手机未复测（仅 390 视口模拟）。

## 2026-11-23 全站重构：三方向选择稿

- 用户授权后应用服务重启成功，PID 1238993，`127.0.0.1:43130/` 返回 200；随后又快进远端到 `e54b6f1`，该次仅前端与文档变更，运行实例读取最新静态源码。
- `/root/github/设计参考.zip` 解压为 `/root/github/设计参考/` 五份索引笔记；按 vibe-coding / design-reference / design-taste-frontend / huashu-design / UI/UX Pro Max 流程准备本轮选择稿。
- 新增 `public/design-demos/`：A 摄影工作台、B 衣橱搭配室、C 轻量分步试穿，含四视图、今日穿搭入口与编辑/删除/导入弹窗示例；编辑/删除收进更多菜单。`index.html` 可直接横向比较三版，并查看 D/E/F 轻量构图。素材复用本地图片，所有交互仅影响样例内存。
- 方向与参考证据追加到 `design/directions.md`；生产 FRONTEND_GUIDELINES 尚未改写，等待本轮用户选版。
- `node --check public/design-demos/preview.js` 通过；13 个最终 Chromium 渲染场景：三版各 1440/768/390，加 A/C 桌面衣橱、A 桌面设置、A 手机衣橱。均 `scrollWidth === innerWidth`、破图 0、人物越界 false、Runtime 异常 0；证据 `public/design-demos/shots/`。截图脚本使用已有 CDP 渲染方法，仅导航、截图和读取布局，没有调用真实业务接口。
- 发现并修复人物图被 Grid 固有尺寸撑大，以及手机主操作在首屏外的问题；重跑截图确认。首次渲染脚本清理临时浏览器目录遇到 ENOTEMPTY，改为等待进程退出后清理；复跑退出 0。
- 未验证项：OpenCLI bridge 未连接，browser open 返回 BROWSER_CONNECT，未做点击/键盘/上传的自动浏览器验收；Huashu lint 因缺 Python Playwright 跳过；LSP 所需默认服务不可用。没有安装工具、添加依赖或把渲染结果当业务端到端成功。
- 本轮交付为用户要求的设计选择，不是正式页面重构完成；选定后继续实施和验收。

## 2026-11-24 已批准 B 衣橱 + A 工作台：正式实现与验收

**批准与范围**：用户「按你说的来即可」批准 B 衣橱 + A 工作台。已更新 direction-approved、六规范的相关章节与实施 R1–R4；零新增依赖、账号登录或部署。

**正式实现**
- `public/index.html` / `app.js`：桌面顶栏、手机四入口底栏、自有 SVG；每次路由创建独立视图根节点，菜单/原生弹窗统一清理，旧轮询不再误用常驻 main 的连接状态。
- `style.css` / `style-wardrobe.css`：移除旧主题叠加，统一浅灰绿、白面板、墨绿操作与原生字体；工作台左侧完整人物/结果、右侧紧凑单品与表单；衣橱主网格 + 当前搭配，手机固定操作条。
- `wardrobe.js` / `lib/wardrobe-dialogs.js`：真实 ID 多选至五件、整套与人物交接、类别+语义搜索、更多菜单、原生上传/编辑/删除确认/链接导入弹窗；保留真实今日穿搭和生成路径。
- `studio.js`：默认显示明确标识的人物原图；已填单品用原生 details 紧凑行；从衣橱选择改为原生 dialog，异步更新保留弹窗；成功才展示 AI 结果与下载。
- 设置、记录与旧商品深链接统一层级；记录读取失败不再冒充空列表，有刷新与工作台入口。
- `src/app.mjs` 仅修改静态缓存：HTML/JS/CSS no-cache，图片保留 300 秒；避免原生 ESM 导入链混合旧版。聚焦静态测试先 RED（/app.js 仍缓存）再 GREEN，CSP 未放宽。

**验证与纠正**
- 改动前基线 139 项中 138 通过，唯一失败是 Windows 假 PATH 与 Linux path.join 前提冲突。`test/source.test.mjs` 改为宿主平台的 join/delimiter 假目录，生产定位函数未改。
- 新增 `test/frontend.test.mjs` 与 `test/helpers/browser.mjs`，复用本项目已有 Chromium/CDP 回归方法、真实临时 Node 服务/衣橱与订单 JSON。外部模型服务用注入 fetch 模拟，不写运行实例数据、不产生付费生成。
- 八个行为子用例 + 主测试共 9/9：原生键盘菜单/焦点/背景隔离、五件上限、搜索中编辑与删除落盘、手机搭配弹窗与整套交接、真实订单成功与 AI 结果、原生衣橱选择、导入失败保留输入、五路由 × 1440/1024/768/390 无溢出与脚本异常。
- 调试期间识别测试驱动缺少原生 Enter 字符序列、导航错误地等旧 h1，以及未带会话头的记录查询；纠正测试前提，没有给业务按钮补重复 Enter 处理或用加延时掩盖问题。
- 最终 `node --test`：**149/149 pass，0 fail，0 skipped**，约 16.5 秒。`node --test test/frontend.test.mjs` 最终 9/9 pass。
- 独立 reviewer 初审发现 P1 原生衣橱选择未迁移，以及搜索命中失效、菜单被手机底条遮挡、刷新后焦点丢失三项 P2；均修复。复审 `21f8dcac` 无剩余阻断；最终紧凑 details/图片卡片增量复核 `7d5215fc` verdict OK。评审为独立只读源码/CSS/截图检查，未假称评审者重复执行了测试。
- 最终运行实例 PID 1359937，`http://127.0.0.1:43130/` 200；18 份实际 HTTP 前端文件逐字节匹配本地源码并确认 no-cache。综合代码 SHA256：`f917ab2603e074d134bab001424cea5a74bdea88de3475a0ecf0c8ff2c63113f`，清单在 `public/design-demos/shots/final-verification.json`。
- 最终运行截图：`public/design-demos/shots/prod-*.png`；12 个运行场景无横向溢出、破图、Runtime 异常，手机操作条与导航间有 10px 空隙，菜单向上展开并完整可达。截图里的三件单品是本次自行创建的 API 验收数据，已仅按自有 ID 回收 3/3，运行衣橱恢复原来的 0 件；清理后空态截图为 `final-wardrobe-1440.png` / `final-wardrobe-390.png`。
- 对比度数值检查覆盖五个实际视图；非禁用文本无低于阈值项。原本只剩一条单品时禁用的删除 × 对比度 1.91，为非操作性禁用控件，保留豁免记录，未冒充所有文本均 ≥4.5。

**边界**：默认 LSP 的 Biome 等命令不可用，未声称类型/LSP 检查通过；需要该能力时应安装配置对应服务或更新 pi-lsp.json。真实付费图片上游、手机扫码登录、四平台真实解析及物理手机未重跑；不把模拟上游成功冒充这些链路已验证。

## 2026-11-24 · OpenCLI 专项复跑（补齐上一轮遗留）

上一轮把「OpenCLI 专项实时验收」列为未通过，原因是扩展桥接未连接。本轮查清：扩展本身已装（`C:\Users\l1234\AppData\Local\Google\Chrome\User Data\Default\Extensions\ildkmabpimmkaediidaifkhjpohdnifk`，OpenCLI v1.0.27，等于最新版），**只是 Chrome 没在运行**。启动 Chrome 默认 profile 后 `opencli doctor` 返回 `extensionConnected:true`，无需安装或换驱动。

- 快进远端 `e54b6f1` → `114ceb3`（`4903b99` 设计方向文档 + `114ceb3` 全站前端重构），工作区干净。
- `node --test`：**140 pass / 1 skip / 0 fail**。skip 是 `test/helpers/browser.mjs` 的 `chromePath` 只探 Linux/macOS 路径；用 `TRYON_TEST_CHROME='C:\Program Files\Google\Chrome\Application\chrome.exe'` 单跑 `test/frontend.test.mjs` **9/9 pass**（真实 Chromium + 真实临时后端），未改测试代码。
- 演示服务 `DEMO_MODE=1` 起在 43130（后台 job `pwsh-e0c40e5074834071`），`GET /api/config` 200，`demoMode:true reachable:true`。
- OpenCLI 实跑（`--session tryon`）：工作台、衣橱、设置、记录四页；衣橱 **16 张卡**、点选后出现「已选 1 / 5 件」操作条、点「去试穿这一套」跳到 `#/studio` 且单品带入；1440/768/390 三档 `scrollWidth <= innerWidth` 无横向溢出；`console --level error` **0 条**。截图 `artifacts/shots/live-*.png`（git-ignored）。
- 未验：真实付费上游生成、扫码登录、四平台解析、物理手机——与上一轮同一批边界，本轮未扩大范围。

## 2026-11-24 · 叠穿层次 + ComfyUI 试穿 LoRA 接入基础

**输入与决策**：用户要求理清 LoRA 方案与接入代码、加衣服时设置内外层并进入提示词、模型设置里增加工作流选项、先把基础搭好（4090 由用户之后租用）。研究代理实际读取 HF 模型卡原版 Qwen-Image-Edit（非 2509）与作者工作流、官方 ComfyUI/GGUF 源码，结论与不确定项见 findings.md 顶部。未下载权重、未部署、无 GPU 真实出图。

**变更**
- 领域层：`src/prompt.mjs` 新增 `normalizeLayer/effectiveLayer`，`orderPieces` 按有效层→格子→原序稳定排序；提示词逐件写明「穿在哪些内层参考图之外」，取消固定上衣贴肤与外套露领口的旧规则。`src/wardrobe.mjs` 上传/导入/编辑持久化 `layer`，旧条目缺字段默认 `auto`。
- 后端：新增 `src/comfyui.mjs`（零依赖 HTTP 适配：只读预检 object_info、上传、提交、轮询自己的 history、只取固定 output 节点、限字节、总超时只删自己队列）、`src/comfy-workflow.mjs`（原版 LoRA 拼图 API 图生成，core 节点替代 KJ resize）、`src/generation.mjs`（模型目录并入工作流 ID、下单前预检）、`scripts/comfyui.mjs`（`--check` / `--export`）。`src/app.mjs` 接入目录/设置/下单预检与 `GET /api/workflows/status`；`src/pricing.mjs` 新增零价实验档。
- 前端：上传/导入/编辑弹窗与工作台逐件增加原生层级下拉；设置页出现「ComfyUI 工作流（实验）」卡片与检查按钮；两页轮询改为跟随任务真实终态（后端 deadline 为权威，离开页面停止）。
- 文档：新增 `docs/COMFYUI.md`（权重清单、SSH 隧道、`.env`、检查/导出、验收顺序、远端隐私与清理）；README、六规范、`.env.example` 同步。

**验证**
- `node --test`（`TRYON_TEST_CHROME` 指向本机 Chrome）：**183/183 pass，0 fail，0 skipped**，含既有真实 Chromium 回归、真实 HTTP 假 ComfyUI 全协议、层次落盘与前端保存/继承/覆盖。
- 独立只读审查：发现「Reference images 2-N 范围改写损坏」与「前端固定 16 分钟轮询短于后端可配超时」两项 P2，均已修复并补断言；上传返回非空 subfolder 时在提交前 502 拒绝。复审最终版无阻断项。
- 真实服务（43130 演示模式）`/api/config` 模型目录含 `comfyui/foxbaze-tryon`；`/api/workflows/status` 未配置时如实返回 `configured:false ready:false`；设置页渲染工作流卡片与检查按钮；`scripts/comfyui.mjs --export` 成功导出 API 图，`--check` 未配置时退出 1。

**未验（明确边界）**：4090/ComfyUI 真实出图、显存峰值与耗时、两三件真人保真度、GGUF 精度与 LoRA 兼容、海外实例路由；基础轮没有部署、下载权重或付费探测。远端 ComfyUI 会保留上传与历史，与应用「人像不落盘」承诺不同，手册已单列。

## 2026-11-24 · 已授权云端真实部署（17:51 检查点，尚未出图）

- 用户随后提供其已租实例并授权SSH部署，目标是原版Qwen+FoxBaze真实单件试穿并接回本地。实例报告RTX4080SUPER/32760MiB、驱动595.71.05、Python3.12.3、torch2.8.0+cu128；与初始4090选型不同，按真实硬件记录。
- ComfyUI固定commit `da8bd08e48deee74d9f6c3bc00aed365b00ec209`，启动成功；15类核心节点object_info通过。依赖安装INSTALL_OK；未装示例模板/内嵌文档包不影响已检查API节点。启动对CUDA12.8给出性能警告，真实耗时尚未验证，没有据警告自动升级镜像。
- 旧并发下载恢复只看st_size，实测最大.part有780140544B稀疏空洞，且读取超时后进程已退出。已停止使用错误恢复路径，按完整成功段日志的字节区间与SEEK_DATA求交恢复；保留约7872MiB已证实数据，需补约21367MiB。
- 已核对官方固定commit/LFS SHA；ModelScope三个工件的Sha256/Size与目标完全相等，并钉定具体文件提交，LoRA仍钉HF提交。恢复工具8项测试通过（含错位网格、稀疏洞、错误内容不转正、全文件校验后才转正）；独立只读审查的SHA失败重跑陷阱已加显式整件重下选项，Python3.12满足file_digest要求。
- 新下载使用云端既有requests2.31 Session、16并发/HF2并发；完成段fsync后记录成功账本，最终必须官方SHA一致。17:51启动云端恢复进程5136；仍在下载，不把排队/端口/文件大小冒充真实出图。
- 本机.env已配置SSH隧道地址（不含密钥、gitignored），应用尚待权重完成后重启接入；真实GPU任务尚未提交，后续耗时/显存/最终结果待追加。

## 2026-11-24 · 云端真实试穿出图完成 + 「不换衣」根因修复

**接续上一检查点**：17:51 启动的 download-repair 已跑完，四件权重全部通过官方 SHA 校验（`ALL_MODELS_VERIFIED 2556.2`，云端 `model-receipt.json` 的 `verifiedSha256` 与目标逐一相等），ComfyUI 0.46.0 在实例 `127.0.0.1:8188` 运行，torch 2.8.0+cu128、CUDA 可用。

**本地接入**
- 私钥 `artifacts/autodl-key` 在 Windows 上权限过宽被 ssh 拒载（UNPROTECTED PRIVATE KEY FILE），用 `icacls /inheritance:r /grant:r <user>:F` 收紧后隧道建立成功。
- SSH 隧道 `127.0.0.1:8189 → 远端 8188`，`GET /system_stats` 与 `/object_info`（1087 个节点类）经隧道可达。
- 本地 `DEMO_MODE=1` 服务跑在 43130；`/api/workflows/status` 返回 `configured:true ready:true`。

**真实出图与发现的两个真 bug**

第一次端到端（`artifacts/probe-workflow.mjs`）成功但结果错：模型把「人物原样 + 服装平铺」的拼图复刻了一遍，人物没有换衣。逐项隔离（全部为真实 GPU 出图，832×1248，单次约 160–177s）：

| 变量 | 结果 |
| --- | --- |
| 作者工作流 JSON 与本实现的参数（UNET/CLIP/VAE、LoRA strength=1、shift=3、CFGNorm=1、30 步/cfg2.5/euler/simple/denoise1、832×1248） | 完全一致，排除接线问题；远端日志 `840 patches attached` 证明 LoRA 已生效 |
| 对齐句改回作者原句 `...every article of clothing on the bottom` | ✅ 正常换衣 |
| 对齐句写成本项目的 `...in the bottom row` | ❌ 输出「原图 \| 换衣图」双栏对比图，人物不换衣 |
| 作者原句 + 完整长英文提示词（含 "bottom row" 正文） | ✅ 正常换衣（证明正文措辞无害，敏感点只在首句） |
| seed=1088（作者默认） | ✅ 全部 8 次运行正常 |
| 随机 seed（如 2099280733） | ❌ 塌缩成拼图复刻，且字节级可复现 |
| 补充要求为版型类（"make the shirt fit slim" / 中文「把下摆塞进裤子里」） | ✅ 干净 |
| 补充要求为身份保持类（「按人脸与身形保持人物一致」/ "Keep the face and body shape unchanged"） | ⚠️ 原衣袖子从新衣下露出残影 |

**修复**
- `src/comfy-workflow.mjs`：`ALIGNMENT` 恢复作者原句（只把 woman 换成性别中立的 person），并在注释里写下实测依据；`mapReferencePrompt` 不动（正文里 "bottom row" 已验证无害）。
- `src/comfyui.mjs`：去掉随机 seed，固定用作者推荐的 1088，注释说明随机种子的塌缩现象。
- `test/comfy-workflow.test.mjs`：新增守卫测试断言对齐句与作者原句逐字一致且不含 "bottom row"。
- `docs/COMFYUI.md`：写入 seed 固定理由、对齐句敏感点、补充要求的两类效果边界。

**验证**
- `node --test`（`TRYON_TEST_CHROME` 指向本机 Chrome）：**184 pass / 0 fail / 0 skipped**。
- 重启 43130 服务后完整端到端复跑 3 次，均 `WORKFLOW_FLOW_OK`（160.3s / 162.5s / 162.2s），结果经 `/api/results` 正常取回并落盘 `artifacts/test/workflow-result.png`。
- 远端实测显存：常驻 28072 MiB / 32760 MiB（约占 85%），GPU 利用率任务间回落 0%。

**未验 / 边界**
- 未测三件套装、内外层互换、鞋袜配饰的保真度；alpha LoRA 质量本身有波动（同一提示词不同 seed 表现差异大，最终那张无附加文案的图下摆与原衣有渐变混合）。
- 显存只记录了任务间与常驻值，未取采样峰值；未验证 24GB 以下显卡能否跑 fp8 全链路。
- 云端 `ComfyUI/input`（1.9M）与 `output`（13M，14 张 `FoxBaze_TryOn_*.png`）仍保留本次上传件与出图，实例停机前需按租用平台方式清理。
- 隧道进程随本机 ssh 会话存在，会话断开即失效；服务本身未做开机自启。

## 2026-11-24 · 三层上装叠穿实测：alpha LoRA 分布外，已放开格子规则并记录边界

**背景**：用户要求「本地接入远端工作流跑一个上装的三层叠穿」。为支持叠穿场景放开了产品规则，随后用 8 次真实出图证明 alpha LoRA 不支持同部位叠穿。

**产品规则变更（src/app.mjs）**
- 旧规则「每个格子最多一件」与叠穿语义矛盾：`layer` 字段、`orderPieces` 的层级排序、提示词的「wear outside …」都是为同格多层设计的。改为**同一格子允许跨穿着层级多件，同格同层仍只能一件**；配饰沿用 2 件上限不参与层级去重（修复了「两件配饰默认同为 outer 层被误伤」的测试失败）。
- 错误信息改为「同一格子的同一穿着层级最多一件（格子·层级）」。
- 新增测试「同一格子跨穿着层级可以叠穿，同层重复仍被拒绝」：top/inner + top/middle + top/outer 三件成功下单（slots 顺序 ['top','top','outer']），同层重复 400。全量 `node --test` **185 pass / 0 fail**。

**叠穿真实出图证据（全部走本地 43130 → 隧道 → 远端 ComfyUI，164s 上下）**
- 3 件（衬衫 inner + 毛衣 middle + 斗篷 outer，生活照图）：复刻拼图 ❌
- 3 件全白底图（衬衫 + 毛衣 + 黑呢大衣）：复刻拼图 ❌（排除参考图质量因素）
- 2 件同格跨层（衬衫 inner + 毛衣 middle）：复刻拼图 ❌
- 两段式第二段（已穿衬衫的 AI 成品当人物 + 毛衣）：输出「人物 + 服装平铺」双栏 ❌
- 2 件跨格（衬衫 top/middle + 黑呢大衣 top/outer）：半成功 ⚠️ 衬衫领子作为内层出现在领口，但外层大衣未上身（`artifacts/test/top-outer-result.png`）
- 对照：作者训练分布是「不同部位组合」（上衣+裤子+帽子，官方示例一次 3 件成功）。

**结论与教训（findings.md 顶部已记）**：alpha LoRA 的「多件」= 不同身体部位各一件；同部位多层叠穿是训练分布外。调研阶段未把这两个场景分开评估，属调研盲区，已记入 lessons。

**淘宝找图过程**：淘宝搜索页（Chrome 有登录态）筛了 20+ 商品，下载了候选商品主图与相册图，白色呢大衣类目下全部是模特生活照、无白底平铺图；白底假设被后续「3 件全白底图仍失败」排除，图不再是变量。

**改动的文件**：src/app.mjs（格子×层级校验）、test/api.test.mjs（叠穿规则测试）、findings.md、progress.md、lessons.md；artifacts/ 下新增 probe-layer3.mjs、probe-layer3-white.mjs、probe-layer2.mjs、probe-stack2.mjs、probe-top-outer.mjs 与对应结果图（git-ignored）。

**未验 / 边界**：叠穿替代方案（Qwen-Image-Edit-2509 多参考、IDM-VTON、强编辑模型提示词叠穿）未实测；「上装+外套」半成功组合的稳定性未多采样；格子规则放开后前端多选交互未逐一复核（工作台选择器允许多件同格，服务端已放行）。
