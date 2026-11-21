# Progress — 2026-11-21

## 当前状态
用户已选 C 分步试衣台。the image service 动态图片模型范围已取代旧 Decart/OpenAI 直接适配与密钥配置；只支持 tops/bottoms/dresses。主代理已完成六规范与最终源码审阅、新鲜测试、真实网关运行、三分类真实生成、桌面/平板/手机页面核验与最后视觉收尾；剩余为提交。

## 原扩展研究
- 加载 canonical reverse-engineer-anything metadata49；按 source_paths=['assets/main-D-b9QqDh.js']、nodes/file2000、unknowns/file1000、analysis_timeout_ms90000、summary 做一次变更重试。
- MCP 宿主 50 秒报错未回答，无新 Evidence ID/coverage；未重试，不声称 REA 成功或后台已停止。
- 本地静态提取：主 bundle 932303 bytes，SHA256 5608fd0a93d376454cf87a778871febb13dabdd47ca2f7e43fa335828f2ad26d；只读原扩展，不运行、不网络调用。
- 纠正 mv 为商品过滤 taxonomy；真正 h6→UC/VF 分类、S/C 状态→/tryon/clothes 字段已追踪。静态提交体没有 prompt/mask，但全文 SDK/直播存在 prompt 字段，实际服务端模板未知。
- 核心 SHA、偏移、完整原分类、REA 错误/旧 Evidence 与 unknown 见 REA_REPORT.md，不以 ignored artifacts 为唯一来源。

## the image service 契约与实现
- live tools/list 的 generate_image.model.enum 四项：codex/gpt-image-2、workbuddy/hunyuan-image-alpha、workbuddy-ai/hy-image-3.5、minimax-code/MiniMax-Image。
- 网关地址：IMAGE_API_BASE_URL 优先，否则读 the configured API base URL 的 addr；仅 ENOENT 回退 3425，畸形/读取失败安全失败。
- generate_image 传 model、prompt、reference_images=[人物 dataURL, 服装 dataURL]；_meta['image-service.local/pending'] 转 generation_result 同 id 轮询，不重提、不切模型。
- 独立评审发现并修复两项 P2：MCP 路径规范化可出站远程地址（现解析后仍须与已验证回环地址同源）；异步终态沿用上一 taskId 导致误报超时（现每轮仅取当前 pending，无图/错误立即失败并释放槽位）。
- 前端独立评审三项 P2 已修：普通 div 承担滚动、字段错误白名单映射并 aria-invalid、aria-busy 移到画布使 live 状态可播报。

## 最终验证证据（主代理直接执行）
- Node v24.17.0；node --check server.mjs / public/app.js 通过；node --test 22/22 pass、0 fail、4276.284 ms（视觉收尾后复跑）。独立后端评审另行执行 22/22 pass。
- 最终哈希：server.mjs 7859AB9BE0411785CB15F8A58029BD0C4C3B8C357D36F455F4D2727EDBA0D099；test/server.test.mjs A2FB96F39FE951FAB37155A18DF11A3056F175017CDD59BEEBA2BC19EA8A9503；public/index.html 8E0D2D3F265C5E310B8618034B4D5349226B6C61CD30BC80779CFB30EC691A7C；public/app.js 7CCE124D50098A4344BD5713B9D8C61FBF133E2ED7C4E7480A9B2CA6BC926052；public/style.css 1EFE24253011E20ACF0058AED48FD203F203FA50229114B6F44A64EEA23B9F66。
- 重启同一 127.0.0.1:43130 后，/api/config 真实返回四模型、defaultEngine=codex/gpt-image-2、gateway.reachable=true。
- 正式 /api/tryon 用合成人物 + 三件服装分别生成：tops 37.5s/1837KB、bottoms 19.9s/1710KB、dresses 31.9s/1700KB，全部成功；逐张查看确认本次样例按区域替换，人物/非目标衣物/白鞋/背景视觉语义保留。
- 对照图 docs/evidence/tryon-comparison.png（SHA256 276667D156CD935D13871FC9741E1E0E980E000D7C56BC1DD8C6D33A2D8B8D89）；原始结果与截图保留在被忽略的 artifacts/ 研究目录。

## 浏览器与未验范围
- OpenCLI 真实页面（1707×876）：四模型选项与默认选择正确，切换混元 3.5 成功；1707 下 generateTop 658.74/bottom 709.67 完整首屏；滚动归属为普通 DIV（client 414 / total 900 / overflow auto）；canvas busy=false、panel busy=null、状态行在画布外。
- 截图：artifacts/final-1440.png、final-768.png、final-375.png 为第一轮；视觉收尾后重拍 artifacts/v4-1440.png、v4-768.png、v4-375.png。收尾内容：结果面板改为纵向 flex、高度 calc(100dvh - 250px)（上限 780px），画布 flex 填充，状态行随面板进入首屏；左卡滚动区底部留白，第 3 步标题不再被切。实测 1707×876 下状态行 bottom 840、生成按钮 bottom 713；768×1024 下状态行 bottom 994、画布 496px；375×900 无横向溢出（scrollWidth 360）。
- OpenCLI 文件上传仍返回 {"code":-32000,"message":"Not allowed"}，原生输入受可见窗口限制；因此浏览器内上传→生成→对比/下载/历史与屏幕阅读器播报仍为未自动验证，不以 API 结果或截图冒充。
- 未验证：两混元模型与其他服装样本的真实生成质量；MiniMax 苹果请求历史 502。不为补齐矩阵自动付费探测。
- 没有安装依赖、部署或更换浏览器驱动；未读取或输出提供方凭据。

## 历史基线（不能替代本轮验收）
- 原 REA 30 秒主 bundle partial ev_b4e1e223d42cd7ce7ec0a42db0b6ae6d6c1d188474c7ed3c594a76794b555609；background/image-picker 聚焦 partial ev_b44c81b86f76ca5ced87da8ab34baf73e76e3cec5fc9cb47fdb9172ab50f6e57。
- 旧 Decart/OpenAI 双引擎 15 项测试及最初 5 项仅为旧路线证据，不能套用 the image service 改动；旧运行 job/配置响应属于旧实例快照。
- 用户 C 选择记录在 direction-approved.md；chrome-extension:// 导航被 OpenCLI HTTP-only 拒绝，无原插件运行截图，不声称像素复刻。
