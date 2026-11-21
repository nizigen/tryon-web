# TryOn Web · AI 虚拟试穿

抖音穿搭橱窗用的虚拟试穿工作台：橱窗里挑一件衣服，上传一张本人照片，几十秒后看到穿在自己身上的效果。
面向手机优先设计，PC 同一套页面双列工作台。

## 能做什么

- **橱窗**：商品网格、分类筛选、搜索；每件商品标注售价与"试穿 ¥1.90 起"。
- **试穿**：选模型与档位（显示单次价格）、上传全身照、选版型、写补充要求，付费提交。
- **结果**：原图与试穿效果图对比；**区域热点**——鼠标移到（手机点按）人物的上身/下身/全身，即在该区域叠加显示这件衣服的商品图；结果可下载（文件名带 AI 标识）。
- **我的**：试穿余额、充值（本地模拟）、订单历史。

## 运行

```bash
node --env-file-if-exists=.env server.mjs
# http://127.0.0.1:43130
```

需要本机 the image service 在运行（提供图片模型与凭据）。可用环境变量：

| 变量 | 作用 |
| --- | --- |
| `IMAGE_API_BASE_URL` | 覆盖 the image service 网关地址（默认读 `the configured API base URL`，文件不存在时回退 3425） |
| `IMAGE_API_MCP_PATH` | 图片 MCP 路径，默认 `/v1/images` |
| `PUBLIC_ORIGIN` | 对外部署形态下允许的站点来源；本机默认只允许回环 |

## 目录

```text
server.mjs          入口
src/                app 路由 · the image service 网关 · prompt 提示词 · pricing 定价 · store 存储 · tryon 任务
public/             前端（index.html / style.css / app.js / lib / views）与商品图
data/catalog.json   商品目录（可编辑）
data/state.json     会话、订单、充值单（自动生成）
test/               node --test 用例
docs/evidence/      真实生成与页面验收证据
```

## 测试

```bash
node --test
```

覆盖：提示词区域与约束、定价与成本、目录与会话/订单/充值语义、API 契约（扣费、失败退额、并发 409、跨站拒绝、目录穿越拒绝）。

## 边界（当前未做）

- 真实支付与真实登录：充值为本地模拟，会话是匿名设备标识。抖音小程序虚拟支付需要主体资质与 AppID，接入前不能对外收款。
- 平台形态：抖音小程序（另建工程，复用本仓库 REST 接口）+ H5；首版不做原生 App。
- 提示词为本项目自建（原扩展服务端模板不可得），不保证像素级保真。
- 结果图默认 24 小时后清理；人像照片不落盘。

详细决策与验证记录见 `findings.md`、`progress.md`。
