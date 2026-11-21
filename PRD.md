# PRD — TryOn Web

## 状态与范围
用户已批准本地静态图片试穿，并选择 C 分步试衣台（direction-approved.md）。本轮采用 the image service 图片 MCP 自动发现模型，明确取代旧 Decart/OpenAI 双引擎和对应环境密钥配置。主代理已重新审阅六规范与最终实现，确认当前范围一致。

## 用户与结果
单人中文工作台上传人物、服装两图，选择上衣、下装或连衣裙及 the image service 模型，生成试穿图、对比和下载。应用无账号、数据库、持久照片库或部署。仅监听 127.0.0.1:43130。

## P0 功能与可观察验收
| 功能 | 验收 |
| --- | --- |
| 网关发现 | 显式 IMAGE_API_BASE_URL 优先，否则读取 the configured API base URL 的 addr；仅文件不存在回退3425，畸形/读取失败安全失败；不假定端口永久固定 |
| 模型目录 | GET /api/config 通过 tools/list 的 generate_image.inputSchema.properties.model.enum 自动列出当前模型；失联/空目录禁用生成并可重新加载 |
| 模型状态 | available 表示目录发现成功，不代表上游、余额、多图能力全部可用；不发自动付费健康探测 |
| 输入 | 人物/服装各一张 JPEG/PNG/WebP，解码每图 ≤8MiB；预览、替换与字段错误可恢复 |
| 分类 | 白名单仅 tops/bottoms/dresses；后端映射自建提示词，不扩展到眼镜、鞋履、帽饰或配饰 |
| 生成 | generate_image 带所选 model、组合 prompt、reference_images=[人物 dataURL,服装 dataURL]；两端防重复提交，不重试、不切模型 |
| 异步 | 收到 _meta["image-service.local/pending"] 时以 generation_result 查询同一 id；不重提生成；遵守同一总时限 |
| 结果 | 成功显示原人物与输出，可切换/并排对比、按实际 MIME 下载；失败保留输入和已有成功结果 |
| 历史 | 页面内存最近十次成功，刷新/关页清空；不写 localStorage、IndexedDB 或应用服务端照片库 |
| 隐私 | 预览不上传；主动生成才发送本地 API、the image service 与所选提供方；不记录照片/base64/凭据/完整上游错误 |

## 提示词与质量边界
自建 prompt 明确人物第一、服装第二，tops 保留下装与鞋，bottoms 保留上装与鞋，dresses 替换躯干和腿部衣物并保留鞋；保留人物、姿势、身体、背景，允许新服装自然轮廓、袖摆延展。补充要求只细化服装，不能覆盖替换区域和保留规则。没有恢复原服务端模板；语义编辑不构成像素蒙版或像素级保真保证。

## 失败与退出标准
单实例单任务；请求 ≤24MiB，输出解码 ≤16MiB；120 秒总时限。缺配置、非法模型/分类/图片、上游失败/无图、格式异常、超时均给出安全中文错误。异步查询不是重新生成；断开/超时只结束本地等待，不承诺撤销上游或费用。失败不增加成功历史。

## 证据与验证
本轮 live schema 发现四项：codex/gpt-image-2、workbuddy/hunyuan-image-alpha、workbuddy-ai/hy-image-3.5、minimax-code/MiniMax-Image。此列表是当次观测，运行时仍动态读取。

主代理报告 GPT Image 2 苹果生成和双参考上装成功，红花衬衫替换后人物、牛仔裤、白鞋及背景在视觉语义上保留；MiniMax 苹果生成失败 502。前者不证明其他分类、模型或像素保真；后者不得标为全可用。

主代理已通过正式本地 API 完成三分类真实生成：tops 37.5 秒、bottoms 19.9 秒、dresses 31.9 秒，全部成功，逐张查看确认本次样例按区域替换并保留人物与非目标衣物。对照图见 docs/evidence/tryon-comparison.png。该证据只覆盖 GPT Image 2 与这组样例。

最终 node --test 已由主代理和独立后端评审分别对最终源码执行：22/22 通过。OpenCLI 已核验四模型发现、默认选择与 1440/768/375 布局；上传仍返回 Not allowed、原生输入受可见窗口限制，浏览器内上传→生成→对比/下载/历史/刷新与屏幕阅读器播报尚缺自动验证。只对实际观察场景作结论。

## 非目标
直播/摄像头/视频、原扩展账号积分商城或私有后端、商品抓取、批量任务、后台任务数据库、照片库、支付、安装依赖与部署。原扩展更多分类仅作研究，不能扩大本项目范围。
