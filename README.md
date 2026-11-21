# TryOn Web

中文本地静态试穿工作台：上传人物和服装参考图，选择上衣、下装或连衣裙，通过本机 the image service 图片模型生成结果、对比与下载。采用用户已选 C 分步试衣台，独立实现，不依赖原扩展账号或私有后端。

## 运行
已验证平台 Node v24.17.0；无第三方依赖安装或构建步骤。在项目目录执行：

```powershell
node --env-file-if-exists=.env server.mjs
```

正式入口 http://127.0.0.1:43130/，设计参考入口 /design/index.html；仅绑定本机回环地址。测试命令：

```powershell
node --test
```

## the image service 配置与模型
本轮已取代原 Decart/OpenAI 直接连接，不再要求在应用填写旧引擎密钥。提供方凭据和模型由 the image service 管理，先确保 the image service 正在运行。

服务从 tools/list 的 generate_image.model.enum 获取模型。地址优先级：显式 IMAGE_API_BASE_URL 优先，否则读取 the configured API base URL 的 addr（127.0.0.1:端口）；仅文件不存在回退 http://127.0.0.1:3425，畸形或其他读取错误安全失败。IMAGE_API_MCP_PATH 默认 /v1/images；IMAGE_MODEL 为可选首选模型。无需把任何真实密钥贴进聊天或前端。

当前目录四项：GPT Image 2 · Codex、混元图像 Alpha · WorkBuddy、混元图像 3.5 · WorkBuddy AI、MiniMax Image · MiniMax Code。列表会随 the image service 配置变化；被列出不代表健康或额度有效。

生成通过 generate_image，明确传 model、prompt 及两张 data URL，人物在前、服装在后；pending 由 generation_result 查询，不自动重提或切模型。预览留在本机，主动生成后图片进入 the image service 和所选提供方，可能计费。应用历史只在当前页面内存保留十条，刷新清空；the image service 自身的产物保留策略不由本应用控制。

## 当前验证与限制
主代理在真实本地服务上完成三类验证：上衣 37.5 秒、下装 19.9 秒、连衣裙 31.9 秒，均成功；逐张查看确认本次样例按区域替换，人物、非目标衣物、白鞋与背景在视觉语义上保留。对照图见 docs/evidence/tryon-comparison.png。这不保证像素级保真，也不代表其他模型。

MiniMax 苹果请求历史失败 502；两混元模型与其他服装样本未做真实生成。仅支持 tops/bottoms/dresses，提示词为本项目自建，未恢复原服务端模板。

最终 node --test 22/22 通过，独立后端评审另行通过；/api/config 真实返回四模型。OpenCLI 已核验模型选择与 1440/768/375 布局，但文件上传仍返回 Not allowed、原生输入受可见窗口限制，浏览器内完整上传→生成→对比/下载/历史与屏幕阅读器播报未自动验证。没有部署或安装依赖。

研究证据见 REA_REPORT.md，接口契约见 BACKEND_STRUCTURE.md；产品、流程、实现和验证状态见 PRD.md、APP_FLOW.md、IMPLEMENTATION_PLAN.md、task_plan.md、progress.md。
