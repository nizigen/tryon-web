# Task Plan — TryOn Web

## 当前目标与权限
C:\GitHub\tryon-web：中文静态双图试穿，the image service 模型自动发现取代旧 Decart/OpenAI 环境配置。零依赖 Node v24.17.0 与原生 Web，仅 127.0.0.1:43130。只支持 tops/bottoms/dresses；不扩展原扩展眼镜配饰/直播。无安装、部署或私有扩展修改。

## 阶段与检查点
- [x] 原扩展静态研究与 REA partial，分类/提示词补证合入 REA_REPORT.md；原服务端模板仍未知。
- [x] 用户选择 C 分步试衣台，保留已选视觉方向。
- [x] live 工具 schema 核实四模型 enum，generate_image 及 generation_result 契约明确。
- [x] 文档同步十份文档，旧双引擎契约由本轮取代。
- [x] 实现代理完成 server/test/public 与契约文档；网关地址自动读取落地。
- [x] 主代理重新审阅六规范与最终代码，核对地址路径/字段/覆盖顺序。
- [x] 主代理运行最终 node --test（22/22 pass）与真实 HTTP 检查，记录源码/进程/URL 身份。
- [x] 正式 API 三分类真实生成成功并逐张查看替换范围。
- [x] OpenCLI 验证四模型发现、默认选择、切换与 1440/768/375 布局；Not allowed 上传缺口如实保留。
- [x] 视觉收尾：结果面板纵向 flex 使状态行进首屏，左卡滚动区留白，1440/768/375 重拍复核无溢出。
- [ ] 文档最终同步与 git 提交。

## 决策与约束
模型目录来源为 tools/list 的 generate_image.model.enum；可见不等于健康。生成 reference_images 固定人物 dataURL 在前、服装在后；pending 同 id 查询，不重新提交/切模型。服务单任务、120 秒总时限、资源边界不变。浏览器仅页面内存十条成功历史，应用不建持久照片库。自建分类 prompt 不是恢复的服务器模板，也不保证像素保真。

## 当前未验与交接
浏览器内文件上传受 OpenCLI Not allowed 与原生输入可见窗口限制，完整上传→生成→对比/下载/历史与屏幕阅读器播报仍缺自动证据。两混元模型与其他服装样本真实生成未验；MiniMax 苹果历史 502。OpenCLI 是唯一交互驱动，不切换 Playwright。
