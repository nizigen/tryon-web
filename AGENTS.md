# TryOn Web

> IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning

## 项目与状态
AI 虚拟试穿产品 v2：抖音穿搭号橱窗选衣 → 上传真人照 → 付费试穿 → 看到上身效果。
主入口决策：抖音小程序（另建工程）+ 移动优先 H5；首版不做原生 App（依据 findings.md 第 1 节）。
范围：七格单品（上衣 / 外套 / 下装 / 连衣裙 / 袜 / 鞋 / 配饰，各带子类），单次最多 5 件；含衣橱、AI 今日穿搭与扫码登录。不含直播、批量任务、原生 App、真实支付接入。
后端与前端为本仓库交付；小程序仅复用同一套 REST 接口。

## 架构
Node v24 零依赖（node:http/fetch/node:test/fs），原生 HTML/CSS/ESM 前端，无构建、无 CDN。
server.mjs 只做入口；`src/` 分模块：app（路由）· imageapi（图片服务与生成）· prompt（分类与提示词）· pricing（定价）· store（JSON 持久化）· tryon（任务编排）· validate/errors。
浏览器 → 本地 API（127.0.0.1:43130）→ OpenAI 兼容图片服务（`/v1/images/*`）→ 所选模型。
商品目录 `data/catalog.json`；会话/订单/充值单 `data/state.json`（原子写）；结果图 `data/results/`（24 小时 TTL）。
模型来源是 `GET /v1/models`（可用 `IMAGE_MODELS` 显式指定），发现成功不等于健康。

## 关键约束
- 图片服务的密钥只从环境变量读；应用不读写、不回传密钥，不记录 base64 与完整上游错误。
- 资金语义：下单冻结 → 成功实扣 → 失败/超时全额退回；充值与发放分离。
- 图片 ≤8MiB、请求 ≤24MiB、输出 ≤16MiB、生成总时限 120 秒、单会话同时一个任务。
- 提示词分节：保留项 / 完全替换无残影 / 服装保真 / 光影褶皱自然 / 禁止合成感 / 输出前自检；用户补充要求不得覆盖区域与身份规则。
- 商品图与结果图必须标注 AI 生成（界面显式标识 + 导出文件名；隐式标识未实现）。
- 人像照片只在请求内流转，不落盘。

## 工作规则
先核实契约与归属，最小改动；写与审分开。记录观察、推导与未知。
两个同前提失败先重审，不堆重试/延时。不擅自安装依赖、部署、登录或付费探测。

## 文档索引
- PRD.md / APP_FLOW.md：范围、验收与交互
- TECH_STACK.md / BACKEND_STRUCTURE.md：运行时、API 契约、数据模型与计费
- FRONTEND_GUIDELINES.md：视觉令牌、布局与可访问性
- IMPLEMENTATION_PLAN.md：阶段与退出标准
- REA_REPORT.md：原扩展分类、提示词与 REA 证据边界
- findings.md / task_plan.md / progress.md：决策、任务与真实验证记录
