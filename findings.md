# Findings — 当前决策与证据边界

## 当前范围替代旧方案
本轮按主代理传达的用户范围改为 the image service 图片 MCP 自动发现，取代旧 Decart/OpenAI 直接API及 DECART/OPENAI 环境密钥约定。保持用户已选 C 分步试衣台、Node v24.17.0/原生Web、仅127.0.0.1:43130、tops/bottoms/dresses、十条页面内存历史。无新依赖/安装/部署。旧双引擎15项测试属历史，不能证明本轮代码。

## 复用/适配选择
复用现有server.mjs中的decodeImage、readUpstream、deadline/abortable、HTTP边界与Node测试面。工具schema明确已有generate_image、generation_result及模型enum；只写薄MCP适配，避免应用重复管理提供方凭据、原生协议和静态模型目录。无需SDK、框架、数据库或独立任务队列，无第三方代码复制/许可证引入。数据归属：浏览器拥有输入/快照/十条历史，本地API校验与编排，the image service持有凭据并调用所选提供方，提供方决定输出与计费。the image service自身产物可能落盘，不等于应用建立照片库。

## 本轮直接核实
文档代理只读server.mjs（同步期间仍由另一代理修改），观察到：

- listModels从tools/list的generate_image.inputSchema.properties.model.enum读取；getConfig输出engines/defaultEngine/gateway状态，友好名不是模型白名单。
- generateWithSignal先校验model/person/garment/category/prompt，再重新发现并校验模型；generate_image参数reference_images=[person,garment]，均保留data URL。
- 异步读取result._meta?.['image-service.local/pending']，轮询generation_result({id})，共享时限，不重新生成。
- buildPrompt三分类保留规则和服装自然轮廓约束已可见；这是自建提示词，不是恢复原服务端模板。
- 首次读取时gatewayEndpoint仍只有显式地址/固定默认；收尾复读已观察实现代理更新：显式IMAGE_API_BASE_URL优先，否则每次读homedir()/.config/the image service/gateway.json的addr（127.0.0.1:端口）；仅ENOENT回退3425，畸形/其他读取错误安全失败，路径默认/v1/images。已通知主代理；这是源码观察，最终测试/运行待验。

本轮再次通过the image service工具发现读取live schema（未生成）：codex/gpt-image-2、workbuddy/hunyuan-image-alpha、workbuddy-ai/hy-image-3.5、minimax-code/MiniMax-Image；schema的reference_images描述为路径/URL。data URL支持以主代理实际双参考成功为依据，不声称每模型通用。

## 真实生成与页面证据（主代理报告，未由文档代理重跑）
| 场景 | 观察 | 边界 |
| --- | --- | --- |
| GPT Image 2 苹果 | 生成成功 | 文生图基本连通，不等于全试穿验收 |
| GPT Image 2 双参考上装 | 红花衬衫替换成功，牛仔裤/白鞋/人物/背景视觉保留 | 语义视觉判断，非像素保证；其他分类未验 |
| MiniMax 苹果 | 502失败 | 不宣称全模型可用，不静默切换 |
| 两混元模型 | 已出现在enum | 真实生成未验 |
| OpenCLI设计页 | 前序1440/375px截图、引擎切换有观察 | 旧设计页不等于最终新UI |
| 最终上传/点击 | 上传Not allowed；原生点击受minimized影响 | 最终新UI上传到结果/下载/历史链仍缺验证 |
| 单测 | 旧实现15项通过 | 最终node --test待主代理执行 |

## 扩展研究纠正与持久证据
本轮直接读取原主bundle，SHA256 5608fd0a93d376454cf87a778871febb13dabdd47ca2f7e43fa335828f2ad26d、932303 bytes。真正试穿分类为UC/VF（char542300/byte542315）：auto；clothing→auto/tops/bottoms/dresses；eyewear、footwear、headwear；jewelry、accessories及各子项。others被过滤。const mv（char627750）是商品筛选taxonomy，不是试穿选区；不可据shirts/jeans等细项扩展范围。完整原分类、选择器状态和提交偏移见REA_REPORT.md。

静态图片/tryon/clothes（char668404/byte668457）只在该提交体中传category与可选subcategory、人物photoId、服装file等，没传prompt/mask；全文有93处prompt字面，SDK/直播链路明确读取garment.prompt/referenceImage/enhancePrompt。没有恢复原后台模板或分割策略。

前序REA主bundle30秒partial ev_b4e1e223d42cd7ce7ec0a42db0b6ae6d6c1d188474c7ed3c594a76794b555609；background/image-picker聚焦partial ev_b44c81b86f76ca5ced87da8ab34baf73e76e3cec5fc9cb47fdb9172ab50f6e57（2JS/1818AST/14未选文件/537未知）。本轮指定90秒预算/2000nodes/1000unknowns单次重试被宿主50秒截止，无新Evidence ID；停止重试。本轮分类结论来自本地静态补证，非REA图谱。原扩展运行画面/后端模型仍未知，不复制私有资产。

## 历史与审阅归属
前序零依赖双引擎方案查过Decart Lucy Image 2官方文档并完成旧HTTP/资源边界测试；该事实保留为旧路线背景，不再定义当前配置。最初server在最终规范审阅前实现且契约不符的偏差，曾由主代理承认并按旧最终契约修正；不把初始5项或后续15项旧测试冒充本轮验收。用户视觉选择C已记录direction-approved.md。

上述文档同步阶段的待验状态已由主代理继续核实：六规范重新逐份审阅，与 the image service 最终实现一致；主代理与独立后端评审分别执行22项测试，全部通过。server SHA256 为7859AB9BE0411785CB15F8A58029BD0C4C3B8C357D36F455F4D2727EDBA0D099，test SHA256 为A2FB96F39FE951FAB37155A18DF11A3056F175017CDD59BEEBA2BC19EA8A9503。独立评审发现的路径规范化/异步终态两项P2已修复并有回归。

## 最终运行验收进行中
主代理重启同一43130服务，实际/api/config返回四模型与默认codex/gpt-image-2、gateway.reachable=true，证明网关文件自动发现和新后端加载成功。OpenCLI实际页面显示四模型选择项及正确默认。前端三项评审问题（fieldset滚动、字段错误关联、busy覆盖live区）已修，正在聚焦复审和响应式截图；三分类真实API生成使用合成素材进行中，不读取私人照片，不自动重试或切换模型。Chrome原生输入仍报可见窗口限制，实际上传/点击/下载流程不能用截图或API结果冒充。文档子代理不启动服务/提交的限制仅是其子任务边界，不限制主任务正常本地验收与最终提交。
