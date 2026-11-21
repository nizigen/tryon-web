# TECH_STACK — 本地 the image service 图片 MCP

## 平台与契约
| 层 | 版本/契约 | 用途 |
| --- | --- | --- |
| Node.js | v24.17.0（前序实测） | node:http、fetch、Buffer、AbortController、node:test、文件读取；无外部包 |
| 前端 | 原生 HTML/CSS/ECMAScript 浏览器 API | C 分步试衣台，无框架/构建器；标准 API 不虚构包版本 |
| 网关 | 本机 the image service MCP，JSON-RPC 2.0 | tools/list、tools/call；JSON 或 SSE 返回；不直接接 Decart/OpenAI API |
| 生成 | generate_image / model / prompt / reference_images | 人物 dataURL 第一、服装 dataURL 第二 |
| 异步 | _meta["image-service.local/pending"] → generation_result({id}) | 查询同一任务，不能重新生成 |
| 测试 | Node v24.17.0 自带 node --test | 最终 22 项通过；注入 fetchImpl，不依赖真实上游 |
| 页面驱动 | 已安装 OpenCLI 2.0.3 | extension 1.0.27；实际验证四模型选择与响应式；不安装、不静默切换驱动 |

## 本轮取代的旧契约
旧 DECART_API_KEY、OPENAI_API_KEY、OPENAI_BASE_URL、OPENAI_IMAGE_MODEL 以及 /images/edits、Lucy 直接适配已被本轮 the image service 范围取代，不再作为当前运行前提。上游提供方凭据由 the image service 管理，浏览器与本地配置响应不接触凭据。

## 网关地址与模型发现
收尾复读已核对 server.mjs 的 gatewayEndpoint：显式 IMAGE_API_BASE_URL 优先，否则每次读取 homedir() 下 .config/the image service/gateway.json 的 addr，仅接受 127.0.0.1:端口并补 http://。仅 ENOENT 回退 http://127.0.0.1:3425；文件畸形或其他读取错误安全失败。IMAGE_API_MCP_PATH 默认 /v1/images；IMAGE_MODEL 为可选首选模型。最终源码、22 项测试与真实 /api/config 返回四项模型已相互印证；不公开 gateway.json 全文，不读取提供方凭据。

GET /api/config 读取 tools/list 中 generate_image.inputSchema.properties.model.enum，不从固定标签表创造可用模型。当前默认顺序为 enum 内的首选配置、codex/gpt-image-2、首项。友好名只作显示。

本轮 live schema 观测值（后续可变化）：

| 精确 ID | 显示名 |
| --- | --- |
| codex/gpt-image-2 | GPT Image 2 · Codex |
| workbuddy/hunyuan-image-alpha | 混元图像 Alpha · WorkBuddy |
| workbuddy-ai/hy-image-3.5 | 混元图像 3.5 · WorkBuddy AI |
| minimax-code/MiniMax-Image | MiniMax Image · MiniMax Code |

工具 schema 的 reference_images 描述为路径或 URL；主代理真实双参考试穿已观察 data URL 成功，这是具体实测证据，不泛化为每个模型均支持。

## 运行与资源边界
启动命令保留 node --env-file-if-exists=.env server.mjs；有网关自动发现后无需复制旧引擎密钥。真实业务入口 http://127.0.0.1:43130/；设计方向保留 /design/index.html。仅回环监听，端口占用报错，不自动换端口。源码直接运行，无编译产物；最终以源码/进程/真实 URL 对齐验收。

the image service 出站是本机 HTTP loopback，外部提供方连接归 the image service；Host/Origin、静态白名单、CSP、拒绝重定向仍保留。输入每图 ≤8MiB、请求/上游原始响应 ≤24MiB、输出图 ≤16MiB。120 秒共享时限覆盖模型发现、生成与异步查询；浏览器断开不保证上游取消。the image service 自身可能保存工具产物，本应用不承诺清除其缓存或文件。

## 复用决策与验证
复用内建网络、JSON、字节校验、超时取消与现有 Node 测试；薄适配 the image service 已有生成能力，避免重复管理提供方协议、凭据和模型目录。无 SDK、新依赖、安装、部署或私有 bundle 复制。GPT Image 2 已有三分类真实成功样例；MiniMax 苹果历史失败 502，两项混元未实测；模型目录不是健康检查。最终 22 项测试通过，真实网关发现与三分类 API 生成已确认，浏览器上传链仍受 OpenCLI Not allowed 限制。
