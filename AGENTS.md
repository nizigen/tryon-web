# 照花（TryOn Web）

> IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning

## 项目与状态
测试期虚拟试穿：衣橱选衣 → 自有模特或上传人物照 → 直接试拍 → 查看成片。
主入口决策：抖音小程序（另建工程）+ 移动优先 H5；首版不做原生 App（依据 findings.md 第 1 节）。
范围：七格单品（上衣 / 外套 / 下装 / 连衣裙 / 袜 / 鞋 / 配饰，各带子类），单次最多 5 件；含衣橱、AI 今日穿搭与扫码登录。不含直播、批量任务、原生 App、真实支付接入。
后端与前端为本仓库交付；小程序仅复用同一套 REST 接口。

## 架构
Node v24 原生后端；`frontend/App.jsx` 挂载 React/React DOM 19.2.7，esbuild 0.28.2 生成同源 `public/dist/app.js`。`npm ci` 后 `npm start` 构建并启动。
server.mjs 只做入口；`src/` 分模块：app（路由）· imageapi（图片服务与生成）· prompt（分类与提示词）· pricing（模型档位与尺寸）· store（JSON 持久化）· tryon（任务编排）· validate/errors。
浏览器 → 本地 API（127.0.0.1:43130）→ OpenAI 兼容图片服务（`/v1/images/*`）→ 所选模型。
商品目录 `data/catalog.json`；会话/订单/充值单 `data/state.json`（原子写）；结果图 `data/results/`（24 小时 TTL）。
模型来源是 `GET /v1/models`（可用 `IMAGE_MODELS` 显式指定），发现成功不等于健康。

## 关键约束
- 图片服务的密钥只从环境变量读；应用不读写、不回传密钥，不记录 base64 与完整上游错误。
- 测试期所有新订单零分，历史余额不作下单条件，保留历史已扣金额的恢复。应用内费用与图片服务自身的用量分别核对。
- 图片 ≤8MiB、请求 ≤24MiB、输出 ≤16MiB、生成总时限 120 秒、单会话同时一个任务。
- 提示词分节：保留项 / 完全替换无残影 / 服装保真 / 光影褶皱自然 / 禁止合成感 / 输出前自检；用户补充要求不得覆盖区域与身份规则。
- 无影棚成片固定 `1024x1536`（2:3）、选定的无缝棚背景；默认连拍三个不重复的 PoseWear 姿势，可单独试拍第一个，每个姿势一笔订单。PoseWear 图固定为最后一张且只取骨架，来源和哈希见 `public/posewear/README.md`。
- 商品图与结果图必须标注 AI 生成（界面显式标识 + 导出文件名；隐式标识未实现）。
- 人像照片只在请求内流转，不落盘。
- 内置身图由 R5 三视图正面原像素导出（身材基于 11-26 校准图）；棚拍图 2 `face-studio-makeup.png` 定五官、脸型、分缝与妆面，再接衣图和骨架。自传不附内置脸。Blender 仅校比例；寝室几何归人物库。
- 工作台按人物、搭配、试拍、结果组织。生成只走通用图片服务；已退役的两个实验引擎不得通过设置、环境或模型发现重新启用。保留历史订单和衣橱，不清用户数据。

## 工作规则
先核实契约与归属，最小改动；写与审分开。记录观察、推导与未知。
两个同前提失败先重审，不堆重试/延时。不擅自安装依赖、部署、登录或付费探测。
当前视觉：在正式 React 站延续原 HTML 的 B 衣橱 + A 工作台，首页先于工具；真实衣图和人物是视觉主角，见 `brand-spec.md`。系统字体与原生 dialog；覆盖隐藏深链接、异步弹层和底栏菜单遮挡。
新视觉方向先按 `/vibe-coding` 核验参考、再交可点预览；用户指定原版布局时保留它的功能和信息结构，在正式运行页面上迭代，不用孤立预览替代。
CLI 验证：`node --test`；`test/frontend.test.mjs` 使用已有 Chromium/临时真实后端，断言落盘与焦点；浏览器缺失须明示 skip。

## 文档索引
- PRD.md / APP_FLOW.md：范围、验收与交互
- TECH_STACK.md / BACKEND_STRUCTURE.md：运行时、API 契约、数据模型与计费
- FRONTEND_GUIDELINES.md：视觉令牌、布局与可访问性
- IMPLEMENTATION_PLAN.md：阶段与退出标准
- REA_REPORT.md：原扩展分类、提示词与 REA 证据边界
- findings.md / task_plan.md / progress.md：决策、任务与真实验证记录
