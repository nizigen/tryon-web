# BACKEND_STRUCTURE — the image service 动态图片模型契约

## 状态、结构与归属
本轮按用户提供且已实测的 the image service MCP 契约替换原双引擎。server.mjs 负责静态白名单、HTTP 路由、安全边界和薄 MCP 适配；public/ 为零依赖原生工作台；test/server.test.mjs 使用注入 fetchImpl 验证协议。复用已有 decodeImage、readUpstream、deadline 与原生 fetch/AbortController，无新依赖，不重新探测网关。不保存照片、提示词或成功结果到磁盘；历史仅页面内存最近十条。

## 网络与信任边界
仅监听 127.0.0.1:43130；Host 必须精确匹配实际监听端口的 127.0.0.1。显式 Origin 必须匹配同源，POST 必须有精确 Origin。无 CORS；cross-site 请求仅豁免白名单 HTML 的 GET/HEAD 顶层导航，不能绕过 Host/Origin。静态白名单、路径穿越防护、CSP、nosniff 与 API no-store 保留。禁止静态访问 .env、server.mjs、测试与文档。网关配置仅服务器持有，不回传地址、认证、环境全文或原始错误。

## 配置
IMAGE_API_BASE_URL 显式设置优先，否则每次读取 the configured API base URL 的 addr（仅接受 127.0.0.1:端口）；只在文件不存在时回退 http://127.0.0.1:3425，文件畸形或读取失败则安全失败。不读取提供方凭据。IMAGE_API_MCP_PATH 默认 /v1/images；IMAGE_MODEL 为首选模型。网关只允许 HTTP loopback 127.0.0.1，不允许 userinfo/query/fragment，路径必须为绝对路径且无 query/fragment。所有出站请求 redirect:error。无需 Decart/OpenAI 密钥。

## GET /api/config
服务器 POST 网关 MCP，headers 为 content-type:application/json、accept:application/json, text/event-stream。请求为 JSON-RPC 2.0 tools/list，params:{}；从 result.tools 的 generate_image.inputSchema.properties.model.enum 读取当前模型。

200 application/json：
```json
{"engines":[{"id":"codex/gpt-image-2","label":"GPT Image 2 · Codex","available":true,"default":true}],"defaultEngine":"codex/gpt-image-2","gateway":{"reachable":true},"limits":{"imageBytes":8388608,"requestBytes":25165824,"promptChars":2000},"categories":["tops","bottoms","dresses"]}
```
友好名映射另含混元图像 Alpha · WorkBuddy、混元图像 3.5 · WorkBuddy AI、MiniMax Image · MiniMax Code；未知模型原样显示 id。默认依次选择 enum 内 IMAGE_MODEL、codex/gpt-image-2、首项；空列表为 null。发现调用有独立不超过 10 秒的超时与客户端断开取消。网关失败仍 HTTP 200，engines:[]、defaultEngine:null、gateway:{reachable:false}，error 为安全短说明。无 gateway.baseUrl。available 仅表示模型已配置，不代表其上游健康或额度有效。前端空状态提示确认 the image service 正在运行，禁用生成。

## POST /api/tryon
仅接受 application/json（可带 charset=utf-8），不接受 query。请求对象只接受 model、person、garment、category、prompt：
```json
{"model":"codex/gpt-image-2","person":"data:image/png;base64,...","garment":"data:image/jpeg;base64,...","category":"tops","prompt":"可选补充要求"}
```
model 必须是字符串并在此次 tools/list 的 enum 内，失效或未知模型返回 400。category 严格为 tops/bottoms/dresses；prompt 可省略，trim 后至多 2000 Unicode 码点。先校验本地字段和图片，再发现模型，防止非法输入引发上游生成。

图片沿用规范 base64 与 MIME/magic 一致性校验，只允许 PNG/JPEG/WebP，拒绝 SVG、URL、空载荷、错误填充或空白。每图解码后 ≤8MiB（8388608），超限 413。请求流累计 ≤24MiB（25165824），同时检查 Content-Length。magic 识别不代表完整像素解码。

### 提示词与 MCP 适配
内置 buildPrompt 固定模板：第一张为人物、第二张为服装，保留面容、头发、肤色、比例、姿势、手和背景，真实复现服装颜色、纹理、领口、袖子与长度。tops 替换 upper body，bottoms 替换 lower body，dresses 为 full-body dress covering the torso and legs。用户提示仅附加为文字。

JSON-RPC tools/call params 为：
```json
{"name":"generate_image","arguments":{"model":"codex/gpt-image-2","prompt":"组合提示词","reference_images":["人物 data URL","服装 data URL"]}}
```
人物始终为 reference_images[0]，服装为 [1]。读取 result.content 中 type:image 的裸 base64 与 mimeType；严格解码、magic/MIME 一致并限制输出图 ≤16MiB。原始 JSON 或 SSE 响应逐块限制 ≤24MiB。Content-Type 含 text/event-stream 时解析最后一条 data: JSON，其余按 JSON。禁止抓取远程 URL 图片。

若 result._meta["image-service.local/pending"] 返回明确任务 id，精确读取该元数据（不从自然语言猜测），调用 tools/call name:generation_result、arguments:{id} 轮询（间隔 1 秒），不重新提交生成、不切换模型。轮询与模型发现共享 120 秒总时限（HTTP 还含上传读取）。isError 或无图片且无可轮询 id、网络错误、格式错误与超时均失败。单实例只允许一个生成请求，其余 409；断开客户端中止本地请求，但不保证取消上游或费用。

### 结果与错误
200：
```json
{"engine":"codex/gpt-image-2","image":{"mimeType":"image/png","dataURL":"data:image/png;base64,..."},"createdAt":"2026-11-21T13:00:00.000Z"}
```
createdAt 为本地成功时 ISO UTC；不持久化结果。

错误格式：`{"error":{"code":"INVALID_IMAGE","message":"图片编码、格式或内容无效","field":"person"}}`，field 可省略。

| 状态 | code | 含义 |
| --- | --- | --- |
| 400 | INVALID_JSON / INVALID_REQUEST / INVALID_IMAGE | JSON、字段、当前模型、分类、提示或图片无效 |
| 403 | FORBIDDEN_ORIGIN / FORBIDDEN_HOST | 本地安全边界不符 |
| 404 / 405 | NOT_FOUND / METHOD_NOT_ALLOWED | 路由或方法错误 |
| 409 | BUSY | 已有生成请求 |
| 413 | REQUEST_TOO_LARGE / IMAGE_TOO_LARGE | 输入超限 |
| 415 | UNSUPPORTED_MEDIA_TYPE | 非 JSON |
| 502 | UPSTREAM_ERROR / UPSTREAM_FORMAT | 网关/上游失败、超时、无图片或输出格式/资源超限 |
| 500 | INTERNAL_ERROR | 未预期内部错误 |

只返回安全中文摘要；允许白名单短原因 MiniMax Image returned no images，不回传任意原始文本、base64、URL、密钥、堆栈。失败不增加历史记录。

## 验证与范围
主代理与独立后端评审分别执行 node --test：22项通过，0失败；server.mjs 和 public/app.js 语法检查通过。注入 fetchImpl 覆盖 tools/list、tools/call、双图顺序、默认选择、动态模型校验、JSON/SSE、轮询、错误脱敏、限额、Host/Origin、静态白名单、并发、时限与取消；测试替身只证明适配协议。

主代理重启同一本地43130服务后，/api/config真实返回四项图片模型。正式/api/tryon用合成照片与三件服装分别生成tops/bottoms/dresses：37.5/19.9/31.9秒成功；逐张查看确认本次样例按区域替换、人物/非目标衣物/鞋/背景在视觉语义上保留。不保证像素级保真或其他模型效果。OpenCLI已核验真实模型选择与页面布局；CDP文件上传仍返回Not allowed，完整浏览器上传→生成→下载/历史链未自动验收。前序不启动/提交仅是子代理子任务边界，非用户对主任务的禁令；没有安装依赖、部署或更换浏览器驱动。
