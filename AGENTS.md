# TryOn Web

> IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning

## 项目与状态
单人本地中文静态试穿工作台，参考 TryItOn 行为，独立实现。
用户已选 C 分步试衣台；本轮 the image service 动态模型范围取代旧 Decart/OpenAI 双引擎环境配置。
只支持 tops/bottoms/dresses，不扩大到原扩展眼镜、配饰、直播。
本轮规范由文档代理编写，主代理须再次审阅六规范与最终实现一致性。

## 架构
Node v24.17.0 原生 http/fetch/AbortController，HTML/CSS/JS，零新增依赖。
仅 127.0.0.1:43130；浏览器 → 本地 API → the image service 图片 MCP → 所选模型。
tools/list 的 generate_image.model.enum 是模型来源，不能把发现成功当成生成能力验证。
网关显式 IMAGE_API_BASE_URL 优先，否则读 the configured API base URL 的 addr，仅 ENOENT 回退3425；源码已核对，最终测试待主代理。
无认证、数据库或应用照片落盘；页面内存历史最近十条，刷新清空。

## 约束
- the image service 持有提供方凭据；不要求旧 DECART/OPENAI key，不输出或提交秘密。
- /api/config 只返回模型与非秘密状态；/api/tryon 遵循 BACKEND_STRUCTURE.md。
- 人物为 reference_images[0]，服装为 [1]，均为已校验 data URL。
- 生成用 generate_image；_meta["image-service.local/pending"] 转 generation_result，不重新提交。
- 单图解码 ≤8MiB、请求 ≤24MiB、输出 ≤16MiB；校验 base64/MIME/magic 与 Host/Origin。
- 单任务、120 秒总时限；不静默重试或切换模型，不自动付费探测。
- 分类提示词为本项目自建，不声称恢复原服务器模板，不保证像素级保真。
- GPT Image 2 有真实双参考上装样例；MiniMax 有 502 失败，不宣称全部可用。
- 最终 node --test、新 UI 上传/生成/对比验证尚待主代理；OpenCLI 上传 Not allowed 与 minimized 限制如实保留。
- 不安装、不部署、不擅自启动其他服务；保留并行代理所有无关改动。

## 工作规则
先核实契约与归属，最小改动；写与审分开。记录观察、推导和未知。
两个同前提失败先重审，不堆重试/延时。当前文档子任务不改实现、不提交。

## 文档索引
- PRD.md / APP_FLOW.md：范围、验收与交互。
- TECH_STACK.md / BACKEND_STRUCTURE.md：平台、网关发现与 API 契约。
- FRONTEND_GUIDELINES.md：已选 C 方向与视觉约束。
- IMPLEMENTATION_PLAN.md：实施与验证检查点。
- REA_REPORT.md：原扩展分类、提示词与 REA 证据边界。
- findings.md / task_plan.md / progress.md：决策、任务与真实验证记录。
