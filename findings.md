# findings — 研究、决策与证据

## 1. 平台形态：抖音小程序 + H5，不做原生 App（决策：2025-11-22）

**依据（已核实来源）**

- 抖音开放平台《小程序 iOS 虚拟支付规范》：小程序内提供"功能解锁、订阅内容、付费功能"等非实物虚拟服务，购买与支付须接入小程序虚拟支付（含苹果支付/钻石支付）；非平台渠道交易或引导用户前往其他渠道支付均属违规。
  来源：https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/operation/management/specification/ios-virtual-payment
- 国家网信办等四部门《人工智能生成合成内容标识办法》（2025-03-14 印发）：AI 生成图片属"生成合成内容"，服务提供者须做显式标识与隐式标识。
  来源：http://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
- 本机图片网关 `tools/list` 实测模型目录（2025-11-22；当时用的是本机 MCP 网关，现已换成 OpenAI 兼容的图片 API）：`codex/gpt-image-2`、`workbuddy/hunyuan-image-alpha`、`workbuddy-ai/hy-image-3.5`、`minimax-code/MiniMax-Image`；`generate_image` 支持 `quality`(low/medium/high/xhigh/max)、`complexity`、`size`、`reference_images`。

**推论**

- 流量在抖音：用户从视频/直播/商品页进入，短视频与直播挂载小程序是原生链路，无需下载安装，转化摩擦最低；橱窗（抖音小店）负责实物售卖，小程序负责付费试穿这种虚拟服务，两者分工与平台规则一致。
- 原生 App 在此场景无优势：需要 App 备案、应用商店上架、软著、支付通道、生成式 AI 与深度合成备案、版本审核，且抖音生态内 App 导流路径更差；虚拟支付在 iOS 端本来就受平台虚拟支付规则约束，App 并不能绕开。
- 结论：v1 做**抖音小程序（主）+ 移动优先 H5（PC 与其它入口）**，不做 App。本仓库实现 H5 与后端 API，小程序侧直接复用同一套 REST 接口（登录与支付留桩）。

**未验证**

- 抖音虚拟支付具体费率、结算周期、小程序类目与资质清单：需以开放平台实际政策与账号状态为准，本轮未取得公开明确数值，不写进定价假设。
- 橱窗商品详情页/直播间挂载小程序的具体配置路径：未验证。设计上不依赖该跳转——小程序内自带橱窗目录，商品 ID 可由外部带入。

## 2. 定价（决策：2025-11-22）

**成本基线（公开价，2025-11 观测）**

- OpenAI 定价页：`gpt-image-2` 输出 $30 / 1M image tokens，批量 $15 / 1M；`gpt-image-1-mini` 输出 $8 / 1M。
  来源：https://platform.openai.com/docs/pricing
- MiniMax 定价页：图片编辑（1 参考图，1K）¥0.2978/张，3 参考图 1K ¥0.3982/张；历史 `image-01` ¥0.025/张。
  来源：https://platform.minimaxi.com/document/price
- 混元两个模型（workbuddy/*）未取得公开单价，按 ¥0.40 保守估算并在代码中标注待核。

**折算**：gpt-image-2 medium 1024² 约 4096 image tokens ≈ $0.123 ≈ ¥0.9；high 档 token 数更高，按 ¥3.5 估算。

**零售价（单次，分）**：MiniMax 190 / 混元 Alpha 290 / 混元 3.5 390 / GPT Image 2 standard 690 / GPT Image 2 premium 1390；充值包 ¥1.9×1、¥9.9×5、¥29.9×15。

**理由**：快档价格贴近"顺手试一件"的心理门槛（≤¥2），精档 ¥6.9 覆盖 ¥0.9 成本仍有量级利润，尊档覆盖 high 档成本。价格表集中在 `src/pricing.mjs`，改价不需改逻辑。

**未知**：抖音虚拟支付抽成比例未取得，会直接影响净收入；模型实际账单口径（订阅额度 vs API 计费）在本机无法核对，因此零售价按 API 等价成本定价，保守。

## 3. 提示词：残留衣物与"AI 味"（实证：2025-11-22）

**问题**：原扩展在实操中会出现"衣服替换不到位、原衣服留一半"；生成结果偏 AI 味（光影、褶皱不真实）。原扩展服务端模板不可得（见 REA_REPORT.md，本项目自建提示词）。

**实验**：用图片服务 `codex/gpt-image-2`（quality=medium, size=1024x1536）以同一组合成素材（人物：白 T 恤 + 牛仔裤 + 白鞋；服装：红底白色小花短袖衬衫平铺图）对比三版提示词：

- V0 = 仓库现有 `buildPrompt`；
- V1 = 结构化分节（任务/输入角色、保留项、完全替换与去残影、服装保真、光影与褶皱自然、严格约束）；
- V2 = V1 + 禁止合成感（不贴图、边缘不规则、颗粒与色彩一致）与输出前自检条款。

**观察**：三版在该样例上都完成了整件替换，无白色残影；V2 的衣服轮廓更贴合腰身、花纹尺度更接近商品图、整体更像同一张照片里拍的而不是贴上去的。结构化提示词对"换装完整度"和"去 AI 味"的正向作用是明确的，且 V2 优于 V0/V1。

**落地**：生产提示词采用 V2 结构，并按服装子类替换"替换区域/保留项"段落；把商品标题作为服装描述写进提示词，提升印花与版型还原；用户补充要求单独成段且声明不得覆盖区域与身份规则。

**真实链路复验（2025-11-22，本机网关 gpt-image-2 / medium / 1024x1536）**：用同一组合成人物跑通三个分类并逐张人工查看：

| 分类 | 服装 | 结果 |
| --- | --- | --- |
| tops | 红底白色小花短袖衬衫 | 白 T 恤完全消失，花纹与领型还原，人物/牛仔裤/白鞋/背景保持 |
| bottoms | 黑色高腰直筒牛仔裤 | 蓝牛仔裤被完整替换，腰头与口袋结构自然，白 T 恤与白鞋保持 |
| dresses | 黑色吊带缎面连衣裙 | 上下装同时被一条裙子替换，鞋、发型、皮肤与背景保持 |

提示词对照实验做了三版：旧提示词、结构化、结构化 + 禁合成感，生产采用第三版结构。**对照图已删除**——它们含模特本人照片，不再随仓库分发。

**未验证**：V0/V1/V2 的差异仅由一次三图对比得出，未做盲评或多次重复；样本为合成素材，未覆盖真实用户照片（逆光、侧身、多人同框）；"外套保留内搭"等子类语义尚未生成验证；隐式标识（文件元数据）未实现。

## 4. 区域热点叠加（对标原扩展的 hover 显示服装）

原扩展的"鼠标移到人物身上就显示对应服装"在网页形态下等价于：**人物照与结果图共用一套身体区域热区（上身/下身/全身），悬停或点击热区即在该区域叠加当前服装图**。这是显示层能力，不需要模型支持，也不产生额外计费。

## 5. 现有实现的可复用与需改造

- 可复用：网关发现与 `generate_image` + pending 轮询、base64/MIME/magic 校验、限额与超时、Host/Origin 与 CSP、node --test 断言风格。
- 需改造：`server.mjs` 单文件（~400 行）要承载商品/定价/订单/会话，必须按模块拆分；`buildPrompt` 升级为分类 + 子类驱动的结构化提示词；前端从"表单工作台"改为"橱窗 + 试穿 + 结果"的产品结构，并去掉演示感文案与占位布局。
- 保持：零依赖、不安装、不部署、仅本机运行与真实上游验证。

## 6. 区域热点的真实交互（复验）

- 桌面端 hover、移动端 click 命中上身/下身/全身热区时，在该区域叠加显示当前商品图（不触发新的生成，也不产生费用）。
- 修正过一次真实缺陷：初版对所有分类都开放三个热区，导致上衣商品在下半身也叠加出上衣；现按商品分类限制热区（上衣→上身/全身，下装→下身/全身，连衣裙→全部）。
- 证据：热区叠加在 390 宽度下实测通过（截图含模特照片，已从仓库删除）。

## 7. 本机 ComfyUI / FASHN VTON v1.5 实测（2025-11-22）

**环境**：`D:\AI\ComfyUI`（ComfyUI 0.46.0，独立 venv，torch 2.11.0+cu128），RTX 5060 Laptop 8GB（Blackwell sm_120）。节点插件 `ComfyUI-FASHN-VTON` v1.1.0。权重 `models/fashn-vton/`（model.safetensors 1.94GB + DWPose 两个 ONNX），人体解析器 `fashn-ai/fashn-human-parser` 已预热到 HF 缓存。

**实测数据**：tops / bottoms / one-pieces 三类各跑通一次，30 步、cfg 1.5，单张 55–79s，稳定 1.65–1.88 s/步，显存峰值 4915MB / 8151MB，输出固定 576×864。同 seed 可复现。

**两个必须记住的约束**

1. **bottoms 是"叠加"不是"替换"**：给穿牛仔裤的人像 + 短裙平铺图，模型把裙子画在牛仔裤外侧（裙摆下仍露牛仔腿）。像素差分证明"已穿长裤的人像 + 同款裙子重跑"输出与上一次逐像素相同（max diff 11，改动像素 0）——模型判定裙子已存在，直接不改。换成穿短裤的底图后正常替换。连衣裙（one-pieces）同理：不脱原下装。
2. **`ALL_PROXY=socks5://…` 会让 huggingface_hub 抛 `ImportError: Using SOCKS proxy, but the 'socksio' package is not installed`**；跑 python 前清掉 `ALL_PROXY`（保留 HTTP(S)_PROXY）即可。

**与图片服务 `codex/gpt-image-2` 的分工**：FASHN 本地零边际成本、版型/褶皱/印花还原更接近实拍、确定性可复现，但分辨率 576×864、手部细节弱、下装只能叠加；图片服务一次多参考即可同时换上下装并保持人物，1024×1536，但按次计费。**结论：多件搭配（整套 JK、连衣裙换长裤）走图片服务；单件替换走 FASHN 更划算。**

**证据**：单件三分类对比图、原图 / FASHN 两件套 / 图片服务一次成图的对比图均实测产出，因含模特照片已从仓库删除。

**未验证**：DWPose 因 onnxruntime 缺 `cublasLt64_13.dll`（需 CUDA 13）回落 CPU 推理，姿态估计未走 GPU；真实用户照片（侧身、逆光、多人）未测；显存上限只在 8GB 卡验证。

## 8. 真实商品来源：火星institute JK 上身实测（2025-11-22）

**数据来源已打通**：淘宝登录态下 `s.taobao.com/search?q=火星institute+jk` 可正常渲染（127 张图），商品卡片在 `a[href*="item"]` 上带 item id 与标题，可直接取到真实在售价与店铺（火星institute JK制服馆，appUid `RAzN8HWK1fi1WBpJVjZufon4eefDRQVLGH4Kv55DY7y2fJyJbdc`，广东汕尾）。同款商品图从 1688 同源 CDN（`cbu01.alicdn.com/img/ibank/...-cib.jpg`）可直接下载，需带浏览器 UA 与 Referer，无需登录。

**上身效果**：以用户模特的正面裁图（870×1306）+ 火星家商品图作双参考，`codex/gpt-image-2` 一次成图（1024×1536），脸/发型/身材/站姿/房间背景全部保持，衬衫领型、格纹领结、格纹百褶裙、过膝袜与乐福鞋按参考替换。该结果图含模特照片，已从仓库删除。

**结论**：多件套装（上衣+下装+袜子+鞋）只有多图参考的图片模型能一次完成；FASHN 的叠加式下装约束决定了它做不了整套搭配。这条链路（真实商品图 → 上身图）就是"衣橱 + 搭配生成"的最小闭环，商品数据与图像都是真实抓取，不是合成素材。

**未验证**：淘宝商品图版权与商用授权未核（仅本地实验用途）；模特为虚构人物设定图，非真人；商品页价格随活动浮动，未做定时同步。

## 9. libreget 能否解析电商商品图（实测：2025-11-22，结论：不能）

**结论：libreget 不是电商图片解析器，无法从淘宝/拼多多/抖音商城/1688/JD 的商品链接直接抽出商品图。** 它的价值仅在于「已经拿到直链之后能正确下载」。

实测全部返回 `{"type":"error","code":1,"message":"Unsupported URL. Check that the link is correct."}`：

| 链接类型 | 实测 URL | 结果 |
|---|---|---|
| 淘宝商品 | `item.taobao.com/item.htm?id=862667630822` | Unsupported URL（`info` 与 `download` 均失败） |
| 淘宝短链 | `m.tb.cn/h.abcdefg` | Unsupported URL |
| 拼多多商品 | `mobile.yangkeduo.com/goods.html?goods_id=...` | Unsupported URL |
| 拼多多短链 | `p.pinduoduo.com/abcdefg` | Unsupported URL |
| 抖音商城 | `haohuo.jinritemai.com/views/product/item2?id=...` | Unsupported URL |
| 1688 | `detail.1688.com/offer/123456789.html` | Unsupported URL |
| 京东 | `item.jd.com/100012043978.html` | Unsupported URL |

**根因（源码级，`C:\GitHub\libreget`）**：
- `src-tauri\libreget-core\src\platforms\mod.rs:151-217` 的域名分发只覆盖 hotmart/youtube/instagram/threads/tiktok/twitter/reddit/twitch/pinterest/bluesky/telegram/vimeo/udemy/bilibili/kiwify/gumroad/teachable/kajabi/skool/greatcourses/thinkific/rocketseat/douyin/kuaishou/xiaohongshu/tencentvideo/iqiyi/mgtv/youku，**没有任何电商域名分支**，最后落到 `is_direct_file_url`，否则返回 `None`。
- `platforms/` 目录只有 19 个模块（bluesky、cookie_provider、direct_file、douyin、generic_ytdlp、instagram、magnet、p2p、p2p_words、pinterest、reddit、threads、tiktok、twitch、twitter、vimeo、youtube），**无 taobao/pinduoduo/jd/1688**。
- `douyin.rs:82-92` 只认 `share/video|note|slides`、`video|note`、`modal_id` 三种路径，是短视频/图文流，**不是商品**。
- `mod.rs:41-63` 的 `is_direct_file_url` 是**纯扩展名判定**（`DIRECT_FILE_EXTENSIONS` 含 jpg/jpeg/png/gif/webp/bmp/tiff/svg/heic/avif），不看内容也不解析页面。
- 浏览器扩展同样无电商权限：`browser-extension\chrome\manifest.json` 的 `host_permissions` 全是海外内容平台，`content_scripts` 为空。
- 底层 yt-dlp 2026.10.21 也打不动：直接跑 `yt-dlp --force-generic-extractor "https://item.taobao.com/item.htm?id=..."` 同样 `ERROR: Unsupported URL`。

**能力边界（已实测可用的部分）**：
- 图片直链可以正确下载。`cbu01.alicdn.com/img/ibank/O1CN01uUgzvA2EWvm7uxcYX_!!2217481378753-0-cib.jpg` → `info` 返回 `media_type: File, file_size_bytes: 174820`，`download` 落地字节 sha256 `E7586B58…EB6141` 与原始文件完全一致。
- 抖音视频封面 webp 同样能下（540×719 WEBP，23672B）。
- `MediaType` 枚举含 `Photo`/`Carousel`/`Gif`，但图片抽取绑在具体平台解析器上（bluesky/instagram/pinterest/reddit/threads/tiktok/twitter），**不是通用的「给页面就抽图」**。reddit 与 pinterest 实测还分别因 403 与 404 失败，需 cookies。
- `douyin.com/note/<id>` 实测下载得到 **6.4MB mp4（h264 1920×1080 / aac / 46.3s）**，即图文路径也走视频流，拿不到图集。

**对项目的意义**：电商商品图的可行路径仍是「登录态浏览器抓 DOM 取 CDN 直链」或「1688 同源图 + UA/Referer」，libreget 只适合做拿到直链后的下载器。若要让 libreget 直接支持，需新增 Rust 平台模块并解决登录态/反爬，成本远高于现有方案。

## 10. 商品链接取图：四平台实测可用（实测：2025-11-22）

**做法：借本机已登录的 OpenCLI 浏览器读页面内嵌数据，不自己造登录态、不逆向接口。** 裸 HTTP 全部失败（淘宝返回 5KB 反爬空壳、1688 返回滑块页、京东与拼多多需要登录），这是走浏览器路线的直接依据。

| 平台 | 入口 | 数据位置 | 实测图数 | 原图归一 |
|---|---|---|---|---|
| 淘宝 / 天猫 | `item.taobao.com/item.htm?id=`、`detail.tmall.com` | `window.__ICE_APP_CONTEXT__.loaderData.home.data.res`：`res.item.images` 主图 + `res.skuBase.props[].values[].image` 规格图 | 13（main 3 + sku 10） | 截到第一个图片扩展名，去掉 `_760x760q30.jpg_.webp` 这类尺寸后缀 |
| 京东 | `item.jd.com/<sku>.html` | `opencli jd item <sku> -f json` 的 `mainImages` / `detailImages` | 17 | 剥 `.avif`/`.webp`，`/s\d+x\d+_jfs/` → `/jfs/` |
| 拼多多 | `mobile.yangkeduo.com/goods1.html?goods_id=`（**goods.html 会 302 到安全验证页**） | `window.rawData.store.initDataObj.goods` 的 `topGallery`/`detailGallery`/`skus` | 29（main 1 + detail 28） | 剥 `?` 之后全部查询参数 |
| 抖音商城 | 分享短链 `v.douyin.com/xxx` → `haohuo.jinritemai.com/ecommerce/trade/detail?...` | 跳转地址 query 里的 `goods_detail`（URL 编码的 JSON）：`title`、`min_price`、`img.url_list` | 2 | 直链本身就是原图（1440×1440） |

- 手机分享文案可以整段粘贴：`extractLink` 用 `/https?:\/\/[^\s"'<>「」]+/` 抠链，`e.tb.cn` / `m.tb.cn` / `p.pinduoduo.com` / `v.douyin.com` 先跟随跳转；**e.tb.cn 返回 200 且没有 Location，商品地址直接写在正文 HTML 里**，所以必须「先看 Location，再从正文兜底抓 itemId / goods_id / haohuo 地址」。
- **淘宝必须读内嵌数据，不能读 DOM**：规格图是懒加载的，未滚进视口的 `img.src` 是 `...-2-tps-2-2.png`（2×2、67 字节占位图），从 DOM 抓只能拿到 4 张（轮播 3 + 主图 1）；内嵌数据一次拿全 13 张，与滚动无关。DOM 路径保留为兜底（页面结构变化时）。
- 淘宝详情长图（`descUrl`）拿不到：页面出现风控文案「系统检测到当前访问存在异常…商品详情页将在一段时间后自动恢复」，`descUrl` 在 HTML 里 `indexOf` 返回 -1；mtop `getdesc` 带签名也返回 `FAIL_SYS_ILLEGAL_ACCESS::非法请求`。这是已知缺口。
- **抖音商城只出主图**：H5 详情页对浏览器一律风控（「请使用抖音APP扫码…检测到环境存在安全风险」），手机 App 内虽能看「视频 / 图集」6 张，但那是 App 私有数据；`aweme/v1/oec/product/detail` 返回 502/504，`meta_params`（base64+gzip，解码前要把 `+` 被编码成的空格还原）解开后也没有图片字段。分享链接里的 `goods_detail` 是唯一免登录来源。
- 淘宝未加载完的 img 会给占位图，下载后按 `MIN_IMAGE_BYTES = 4096` 兜底（先 sniff 再判下限，否则 HTML 错误页会误报「占位图」）。
- **1688 跳过**（用户明确不需要）：适配器要求 `__cn_logon__` cookie，未登录时 `item/assets/search` 全返回 `AUTH_REQUIRED`（exitCode 77）。其 `assets` 命令本身是最完整的商品图抽取器（main/sku/detail/video 分组、穿透 shadowRoot、自动滚动），登录后可直接复用。

**实现落点**：`src/source.mjs`（平台表、短链解析、内嵌数据脚本、TTL 缓存、串行队列、下载校验）、`src/app.mjs` 的 `POST /api/sources` 与 `GET /api/sources/:id/:index`（**列表不暴露原图直链**）、`public/views/import.js` 与 `#/source-tryon` 路由。

**两个真实运行才暴露的问题**：
- 服务以 Electron 方式启动时 `process.execPath` 是 `DSH Desktop.exe`，`execFile(process.execPath, [opencliEntry])` 会把宿主 exe 当 node 跑。修法是 `locateNode()` 从 opencli 入口上溯与 PATH 里找真正的 `node.exe`，并支持 `OPENCLI_NODE` 覆盖。
- **商品图是模特实拍，模型会把参考图 2 里的人当成人物参考**（首跑结果直接换成了商品图模特的脸和车站背景）。修法是在提示词里加 `IDENTITY SOURCE (critical)` 段：明确「参考图 2 里可能有模特，完全忽略她，只取衣服」，约束段补「输出只能有一个人，就是参考图 1 的人」。修复后同一输入出的图身份正确。

## 11. 不走 OpenCLI 的直连解析：四家全部直连（实测：2025-11-22）

**动机**：用户指出「既然小程序不登录也能出图，我们按理也能」，并要求「不要用 OpenCLI，别人机器不一定有」。实测确认四家都能服务端直连，OpenCLI 仅作直连失败时的兜底（可传 `runCli:null` 彻底禁用）。

| 平台 | 直连方式 | 关键点 | 实测 |
|---|---|---|---|
| 淘宝 | 登录 cookie + mtop `mtop.taobao.pcdetail.data.get` | 匿名握手**不下发** `_m_h5_tk`、返回 `RGV587_ERROR::SM`；带 cookie 先握手拿 token，再按 `md5(token&t&12574478&data)` 签名重发 | 13 张（main 3 + sku 10），首图 391634B |
| 抖音商品 | 分享链接 `goods_detail` | 免登录，`img.url_list` 即主图，`ecombdimg.com` 直链稳定可重复下载 | 2 张，2142895B |
| 抖音视频/图文帖 | `ttwid.bytedance.com/ttwid/union/register/` 取 ttwid → iesdouyin 分享页解析 `window._ROUTER_DATA` 的 `item_list` | **`douyinpic.com` / `sign` 直链基本一次性：同一地址第二次请求直接 403** | 封面 23672B（解析时即取回缓存） |
| 京东 | `item.m.jd.com/product/<sku>.html` 内嵌 `window._itemOnly` | **完全免登录**；图片前缀必须 `https://img14.360buyimg.com/n0/`（`/jfs/` 直拼 404）；`window._itemInfo` 返回 `bizRetCode 30020` 不可用 | 10 图，0.4s，首图 107439B |
| 拼多多 | `goods1.html?goods_id=` 的 `window.rawData.store.initDataObj` | **需要 pdd 登录 cookie**；无 cookie 时只有 `needLogin:true`，返回 503 提示把 pdd cookie 放进 `data/cookies.json`；`goods.html` 会 302 到安全验证页 | 带 cookie 时 topGallery/detailGallery（真实值本机无 pdd cookie，未实测） |

- Cookie 来源：Chrome 的 `Network\Cookies` 被 Chrome 独占（`esentutl` 报 `JET_errFileAccessDenied -1032`），本机非管理员无法 VSS；改为用户从 DevTools 复制。淘宝 38 项（无 `_m_h5_tk`，握手时现取）、抖音沿用 `C:\Note\video_pipeline\cookies\douyin.netscape.txt`（含 `sessionid`/`ttwid`）。合并写 `data/cookies.json`（已 gitignore），`src/cookies.mjs` 的 `loadCookies` 读取，`TRYON_COOKIE_FILE` 可覆盖。
- **一次性直链的处理**：抖音视频/图文帖的图片在 `extractDouyinShare` 里就逐个 fetch 取回字节并入内存（UA_M + referer `https://www.douyin.com/`，`content-type` 必须 `image/*`，单张 4KiB–8MiB，一次最多 9 张、累计 24MiB），`download()` 命中 `image.buffer` 时直接返回缓存，不再回源。全部取不到才抛 422「受抖音 CDN 保护…请粘贴商品分享链接」。
- 抖音图片 CDN 认手机 UA：`download()` 用 `platform.ua ?? UA`，抖音平台表带 `ua: UA_M`。
- 端到端实测（真实 HTTP）：淘宝分享文案 → 13 图 → 下单 690 分 → 25s success → 结果 1781282B；抖音商品 → 2 图 → 25s success → 1746258B；抖音视频帖 → 1 图 23672B；京东 `https://item.jd.com/100012043978.html`（`runCli:null` 完全禁用 OpenCLI）→ 10 图 0.4s，完整链路下单 690 分 → 25s success → 结果 1500318B。`node --test` 81/81 通过。

## 12. 多件穿搭与演示模式（实测：2025-11-23）

**动机**：用户要求「上衣和下装同时选择」「里衣 + 外套」「裙子下面搭丝袜」「鞋子单独一栏」，并且先做演示不要露出付费。

| 问题 | 结论 | 依据 |
|---|---|---|
| 原扩展能不能叠穿 | **不能**：只支持单件单分类（clothing=tops/bottoms/dresses、jewelry、accessories 等），Live 模式是「≤12 look 逐个 switch」 | `docs/rea-tryiton-categories.md`（REA 静态分析） |
| 叠穿怎么实现 | **一次多参考图生成**：人物图 + 按 `SLOT_ORDER` 排序的各件单品图，提示词按格分层描述 | `src/prompt.mjs` 的 `buildOutfitPrompt`；`codex/gpt-image-2` 支持多张参考图 |
| 为什么不用 FASHN 逐件叠 | FASHN 的 `bottoms` 是**叠加式**：裙子会画在裤子外侧而不是替换；两件套需先换底装再叠 | 本机 ComfyUI 实测（第 7 节） |
| 七格怎么定 | `top/outer/bottom/dress/hosiery/shoes/accessory`；accessory ≤2；dress 与 top/bottom 互斥；总数 ≤5 | `docs/OUTFIT_MODEL.md` |
| 品类词表哪来 | 淘宝搜索页的类目 facets 抓取，落 `data/taxonomy.json`，前端 `public/lib/garment-taxonomy.js` 由它程序化生成 | `docs/taobao-tags.md` |
| 下拉一致性怎么保证 | 自制胶囊下拉，收起/展开复用同一 trigger 节点，只切描边与浮层显隐；trigger 与 item 同 height/padding/font | 实测均为 40px 高、`padding 0 14px`、14px、文字左边缘对齐 |
| 演示模式怎么关掉付费 | 服务端 `DEMO_MODE=1` → `priceCents/costCents` 为 0、跳过余额校验、支付接口 403；前端 `applyDemoMode()` 隐藏余额、价格、充值 | `run-demo.cmd`；`GET /api/config` 的 `demoMode` |

- 真实出图：上衣（红底白花短袖衬衫）+ 下装（黑色高腰直筒牛仔裤）→ `priceCents:0` → 25s success，结果 `artifacts/test/studio-result.png`，人物身份保留、上下装同时替换。
- 已知短板：件数越多越容易串味；本轮只验证两件，五件满配未做真实对比。
- 设计参考：`https://flyne.ai/cn/` 的令牌（`#0a0a0a` 底、`#111/#161616` 面板、白 10% 描边、卡片 20px/控件 8px/胶囊 999px、紫 `#7c3aed→#a855f7`、PingFang 字体栈）记录在 `docs/frontend-design-reference.md`，证据截图 `docs/evidence/flyne-*.png`。

## 13. 衣橱、扫码登录与 AI 选搭（实测：2025-11-23）

**动机**：用户要求「两级下拉代替一长串选项」「默认一条 + 加号追加」「扫码登录自动写 cookie」「导入的商品图能加进衣橱」「上传处也能从衣橱选」「衣橱支持上传」「衣橱做轻量图文 RAG」「一句话让 AI 选今日穿搭并出试穿图」。

| 问题 | 结论 | 依据 |
|---|---|---|
| 扫码登录能不能拿到 cookie | **能，但不能走 OpenCLI**：`opencli browser eval 'document.cookie'` 只给非 HttpOnly；`browser chrome call Network.getAllCookies` 返回 `unsupported_chrome_method`。自起 Chrome（`--user-data-dir` + `--remote-debugging-port`）+ CDP `Target.createTarget` / `attachToTarget` / `Network.getAllCookies` 实测拿到 31 条**含 HttpOnly** 的 cookie | `src/login.mjs`；探针 `cdp-probe.mjs` 输出含 `.taobao.com cookie2 [H]`、`_m_h5_tk`、`_tb_token_` |
| 登录成功判据怎么定 | **只认真正的登录标识**：淘宝 `unb`、京东 `pt_key`、拼多多 `PASS_ID`。`cookie2` 在未登录访客页也会下发，用它当判据会误判成功并覆盖真实 cookie（实测踩到） | `src/login.mjs` 的 `isAuth`；`test/login.test.mjs` 新增「只有访客 cookie 不算登录成功」 |
| 同名 cookie 取哪个 | 按 `domainRank`（带前导点 > 标签数 > 长度）取，`.taobao.com` 必须胜过 host-only 的 `login.taobao.com`——后者不会随商品页请求发出 | `src/login.mjs` 的 `domainRank` |
| 衣橱检索怎么做 | 轻量 BM25：中文按单字 + 二元组切分，索引 name/description/subtype/category/tags，只回 score>0；入库时视觉模型自动写一句描述 | `src/wardrobe.mjs`；`src/caption.mjs` |
| 视觉模型用哪个 | 网关 `/v1/chat/completions` + `image_url` data URL 实测可用：`codex/gpt-6.1-sol` 200/5283ms 正确描述；`kiro/claude-sonnet-4-6` 429 月度额度用尽 | 网关实测；可用 `CAPTION_MODEL` 覆盖 |
| AI 选搭为什么不能只用检索 | 用户需求句往往不含单品关键词（「今天去逛街，想穿得清爽一点」BM25 零命中 → 直接回「衣橱里还没有可用的单品」）。必须**检索为空时退回全量衣橱** | 真实跑通前的失败现场；修在 `src/outfit.mjs` |
| 模型返回怎么防错 | 严格校验：id 必须存在于候选、category 必须与格子匹配、accessory ≤2、dress 与 top/bottom 互斥；任一非法整体判不可用，退回 `rulePick` | `src/outfit.mjs`；`test/outfit.test.mjs` 6 条 |
| 为什么衣橱图不能用 lazy | OpenCLI 会话里 `document.visibilityState` 恒为 `hidden`，`loading="lazy"` 的图永不加载（`complete:false`、`naturalWidth:0`），页面表现为空白卡片 | 实测：手动改 `loading='eager'` 后 4 张全 `complete:true` |

- 真实链路：衣橱入库 4 件（视觉模型自动写描述）→ 今日穿搭需求「今天去逛街，想穿得清爽又有精神，帮我配一套」→ 模型选出上衣+下装并给理由、`missing:['shoes']` → 下单 → 30s 出图 → `artifacts/test/v4-ai-outfit.png`（887x1774），逐张目视确认身份与服装正确。
- 浏览器实测：两级下拉展开七项、加号 1→2 条、「从衣橱选」把类目与图片填进条目、导入页 13 张缩略图「加入衣橱」使衣橱 4→5、衣橱页上传 5→6、工作台用真实正面全身照下单 201 并出图。
- 顺带修掉的真实视觉问题：`.canvas img` 原为 `width:100%`，竖版结果图在 1440 视口被拉到 896×1792（两屏多）；改为 `width:auto; max-height:min(72vh,720px); margin-inline:auto` 后 270×541 一屏可见。
- **未验证**：真实手机扫码走通并写出 cookie（只验了「未扫码不误判」「只改当前平台键」「并发 409」）；五件满配真实出图；裙 + 丝袜组合。

## 14. 内置模特：开箱即用的正面全身照

- 需求来自「新用户不传照片就没法试穿」。做法是把一张正面全身照放进 `public/model/model-front.png`，工作台与今日穿搭进页面时读一次、缓存成 dataURL 填进人物照状态，按钮文案变「换成我的照片」，用户上传即覆盖。`public/lib/person.js` 负责取图与缓存（`loadDefaultPerson()`，同一页面只发一次请求）。
- 原图来自稿定三视图（1024×1024，正面/侧面/背面并排，底部带中文标签）。用白色分隔带定位切成正面格（`x 343–349`、`x 676–681` 是竖分隔，`y 956–974` 是底部横带），裁出 337×956。
- **左上角没有水印**：median-filter 残差在左上区唯一高残差块是头发与脸（`x 72–349, y 0–259`），四边背景残差 mean 0.17–0.18；页面 DOM 里 `watermark|水印|preview-mask` 匹配 0 个节点。稿定 i18n 的「AI 水印偏好」说明水印是下载时按账号偏好叠加的，服务端原图不带。
- 抓稿定页面需要先过它的 JS 挑战：直接 `curl` 只得到 985 字节挑战页，带 Chrome UA 且 cookie 设 `__tst_status=478775533#; EO_Bot_Ssid=3847553024` 才拿到真页面（947844 字节）。
- 验收：CDP 无头实测两页进页面即预填（`naturalWidth` 337）；不传照片直接 `/#/tryon/shirt-floral` 下单 → 201 → 744×2114 结果图，模特换穿红底白花短袖衬衫、脸与站姿保持。

## 15. 支付与身份的边界

- 本轮充值为本地模拟（POST /api/payments + /confirm），真实支付未接入：抖音小程序虚拟支付需要主体资质与 AppID，且虚拟服务支付必须走平台虚拟支付能力，不得引导站外支付。
- 会话为本地设备标识派生的匿名会话，不是真实鉴权；对外署形态必须换成抖音/微信登录（code2session → openid）并把订单归属绑定到平台用户。
- 这两项是"能收钱"之前的硬前置，已写入 PRD 非目标与 BACKEND_STRUCTURE.md 的未验证说明。

## 16. 图片服务的接口形状与模型可达性（实测：2025-11-23）

**为什么要单独记**：把私有网关换成「任何 OpenAI 兼容图片服务」之后，真正决定能不能出图的不是我们的代码，而是对端三个端点的具体行为。这一节记的是实测到的形状差异，避免下次又按「OpenAI 文档怎么写就怎么是」去猜。

| 观察 | 实测结果 | 影响 |
| --- | --- | --- |
| 生成端点 | `POST /v1/images/generations` 收 JSON `{model,prompt,size,quality,n,response_format}`，回 `{created,data:[{b64_json,mime_type}],model,usage}` | 无参考图时走这条 |
| 编辑端点 | `POST /v1/images/edits` **只认 multipart**；同一请求改成 JSON 带 `image_url` 回 400「an edit needs the image to edit」 | 有参考图必须用 `FormData`，字段名单图 `image`、多图 `image[]` |
| 回包字段 | 同一个服务里，有的模型回 `b64_json`，有的只回 `url`（`workbuddy/hunyuan-image-alpha` 的 edits 就回 url） | 取图逻辑要两者都认，不能只读 b64 |
| 模型目录 | `GET /v1/models` 不需要密钥；93 条里只有 1 条标了 `modalities.output=["image"]`，而默认模型根本不在目录里 | 目录结果必须 ∪ `IMAGE_MODEL`，否则默认模型凭空消失 |
| 未知模型 | 404，message 里带模型名 | 不能当成网络错误重试 |
| 出口可达性 | 同一时刻：混元 200（16.4s）/ codex 502（`chatgpt.com` 连接超时）/ MiniMax 502「returned no images」/ hy-image-3.5 429 额度用尽 | 「模型列出来」≠「能出图」；失败原因必须原样转述给用户 |

**教训**：上游 502 先读它自己的 `error.message`。我第一次看到 502 就怀疑 multipart 拼错，实际是上游出口网络不通——本地代理（`127.0.0.1:10808`）通，但网关进程不走代理。

**顺带修的真实缺陷**：`state.json` 里存的模型名在换服务或模型下线后会变成孤儿，原逻辑让每次下单都报 `MODEL_UNAVAILABLE`，而下单页没有切换模型入口，用户无从修复。改为：存的模型不在当前目录时退回默认模型，`GET /api/settings` 报告的也是真正会用的那个。
