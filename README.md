# TryOn Web · AI 虚拟试穿

抖音穿搭橱窗用的虚拟试穿工作台：挑衣服、上传一张本人照片，几十秒后看到穿在自己身上的效果。
**支持一次搭配多件**（上衣 + 外套 + 下装 + 袜 + 鞋 + 配饰），也可以只试一件。手机优先，PC 同一套页面。

## 能做什么

- **橱窗**：商品网格、分类筛选、搜索。
- **搭配工作台**：七个格子（上衣 / 外套 / 下装 / 连衣裙 / 袜 / 鞋 / 配饰），每个格子可从目录商品、链接导入、本地上传里挑；单次最多 5 件，连衣裙与上衣/下装互斥。选完一次性生成整套穿搭。
- **导入商品链接**：粘贴淘宝 / 天猫、京东、拼多多、抖音商城的商品链接，**手机分享出来的整段文案也能直接粘**，读出商品图后直接放进格子。
- **我的衣橱**：按淘宝类目词表浏览可选品类（上衣 12 类、外套 10 类、下装 12 类、连体 8 类、袜 10 类、鞋 12 类、配饰 12 类，共 7 组属性）。
- **设置**：选图片模型（列出 the image service 当前可用的全部模型）、看取图来源是否就绪、看网关连通性。**模型入口只在这里**，不在下单页。
- **结果**：原图与效果图对比；区域热点（上身/下身/全身叠加商品图）；可下载（文件名带 AI 标识）。
- **演示模式**：`DEMO_MODE=1` 时全站隐藏价格与充值入口，下单不扣费。

## 运行

```bash
node --env-file-if-exists=.env server.mjs
# http://127.0.0.1:43130
```

演示（隐藏所有付费入口，不扣费）：

```bash
run-demo.cmd
```

需要本机 the image service 在运行（提供图片模型与凭据）。导入商品链接**四家都直连 HTTP，不需要浏览器**：淘宝用粘贴进来的登录 cookie 调 mtop；抖音用分享链接里的数据与 ttwid；京东读手机版详情页内嵌数据（免登录）；拼多多读 `goods1.html` 的内嵌数据（需要拼多多登录 cookie）。cookie 放在 `data/cookies.json`（JSON：`{"taobao":"...","douyin":"...","pdd":"..."}`，已被 `.gitignore` 忽略），也可以直接用 `TRYON_COOKIE_FILE` 指到别处。**本机若装有 OpenCLI，只在直连失败时作为兜底**，没有 OpenCLI 也能正常取图。可用环境变量：

| 变量 | 作用 |
| --- | --- |
| `IMAGE_API_BASE_URL` | 覆盖 the image service 网关地址（默认读 `the configured API base URL`，文件不存在时回退 3425） |
| `IMAGE_API_MCP_PATH` | 图片 MCP 路径，默认 `/v1/images` |
| `PUBLIC_ORIGIN` | 对外部署形态下允许的站点来源；本机默认只允许回环 |
| `TRYON_COOKIE_FILE` | 淘宝 / 抖音 / 拼多多 cookie 文件路径（默认 `data/cookies.json`） |
| `OPENCLI_ENTRY` | 覆盖 OpenCLI 入口脚本路径（默认在 PATH 里找 `node_modules/@jackwener/opencli/dist/src/main.js`），仅作为直连失败时的兜底 |
| `OPENCLI_NODE` | 覆盖执行 OpenCLI 的 node 可执行文件（默认自动探测，用于避开 Electron 宿主 exe），仅作为直连失败时的兜底 |
| `DEMO_MODE` | `1` 时进入演示模式：全站隐藏余额、价格、充值入口与订单金额，下单不扣费、不校验余额 |

## 目录

```text
server.mjs          入口
src/                app 路由 · the image service 网关 · prompt 提示词 · pricing 定价 · source 商品链接取图 · store 存储 · tryon 任务
public/             前端（index.html / style.css / app.js / lib / views）与商品图
data/catalog.json   商品目录（可编辑）
data/taxonomy.json  淘宝类目词表（前端衣橱与格子选项的来源）
data/state.json     会话、订单、充值单、设置（自动生成）
test/               node --test 用例
docs/evidence/      真实生成与页面验收证据
```

## 测试

```bash
node --test
```

覆盖：提示词区域、身份约束与多件分层顺序、定价与成本、目录与会话/订单/充值语义、API 契约（扣费、失败退额、并发 409、跨站拒绝、目录穿越拒绝）、多件下单与设置读写、商品链接解析（四平台归一化、短链跟随、占位图与超限拒绝、缓存过期）。

## 边界（当前未做）

- 真实支付与真实登录：充值为本地模拟，会话是匿名设备标识。抖音小程序虚拟支付需要主体资质与 AppID，接入前不能对外收款。
- 平台形态：抖音小程序（另建工程，复用本仓库 REST 接口）+ H5；首版不做原生 App。
- **抖音商城只出主图**：分享链接的 `goods_detail` 只带一张主图（1440×1440），H5 详情页对浏览器一律风控，App 内的图集拿不到。抖音视频/图文帖走 ttwid + `_ROUTER_DATA`，能拿到封面/图集（一次性的 CDN 直链在解析时即取回缓存）。1688 需登录态，当前未接。
- 四家取图都是服务端直连，不依赖浏览器、也不依赖本机 OpenCLI：京东免登录即可；淘宝需要 `data/cookies.json` 里的登录 cookie，拼多多需要 `pdd` 字段的登录 cookie（过期后需重新粘贴），抖音商品链接免登录。
- 多件穿搭靠一次多参考图生成，件数越多越容易串味；单件换装更稳。
- 提示词为本项目自建（原扩展服务端模板不可得），不保证像素级保真。
- 结果图默认 24 小时后清理；人像照片不落盘。

详细决策与验证记录见 `findings.md`、`progress.md`。
