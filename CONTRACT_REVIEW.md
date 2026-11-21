# 契约与实现独立审阅 — 2026-11-21

## 当前范围与六规范审阅
本轮用户要求自动识别并选择 the image service 图片模型，取代此前 Decart/OpenAI 直接适配。用户已选择 C 分步试衣台；只支持 tops/bottoms/dresses，不扩展直播、配饰或原站账号。

主代理重新逐份读取 PRD.md、APP_FLOW.md、TECH_STACK.md、FRONTEND_GUIDELINES.md、BACKEND_STRUCTURE.md、IMPLEMENTATION_PLAN.md，并核对最终源码与 findings.md。当前文档作者为独立子代理 898c30a3-2821-4491-8882-f7f982a545fa，生产实现作者为 d20b4a04-99a6-4af9-96be-22b22ad9e49b；写与审分处不同上下文。六规范与现有 the image service 架构、已批准 C 视觉方向一致，批准继续最终验证。

接口唯一来源为 BACKEND_STRUCTURE.md：/api/config 动态读取图片工具的 model.enum，/api/tryon 接受 model/person/garment/category/prompt；人物参考在前、服装参考在后。the image service 管理提供方凭据，应用不存储或回传密钥。发现模型不等于验证其健康。

## 最终后端代码与安全复核
主代理完整读取最终 server.mjs，并亲自执行 Node v24.17.0 的语法检查与 node --test：22 项通过，0 失败，4244.9413 ms。

独立只读评审者 a2be8b17-c992-4b44-985b-8685c0462a92 核对同一版本，独立执行 22 项测试通过，0 失败，约4.26秒。两项 P2 已修并有回归：
- MCP 路径拒绝 ASCII 控制字符、空格、DEL；解析后仍须与已验证回环地址同源，不能规范化成远程地址。
- 每轮仅取当前响应的 pending ID；无图且无 pending 或明确错误立即失败，及时释放槽位，不误报超时。

核对范围包含动态模型白名单、配置发现优先级、8MiB 输入/24MiB 请求/16MiB 输出、总120秒时限、取消传播、单任务409、精确 Host/Origin、静态白名单与 CSP、不跟随重定向、不抓取远程结果 URL。没有其他 P0/P1 或需阻断问题的证据。

最终后端 SHA256：
- server.mjs：7859AB9BE0411785CB15F8A58029BD0C4C3B8C357D36F455F4D2727EDBA0D099
- test/server.test.mjs：A2FB96F39FE951FAB37155A18DF11A3056F175017CDD59BEEBA2BC19EA8A9503

## 前端与运行验收
独立前端评审者 b0901a52-4a2b-4fc4-836c-c38cc38ee610 发现滚动归属、字段错误关联与等待播报三项 P2。作者已修复：普通 div 承担滚动、字段白名单映射、busy 仅标画布。最终版本的聚焦复审、真实页面截图和三分类生成验收由主代理继续执行；结果更新到 progress.md，不将代码审阅冒充真实全流程。

主代理已重启同一 127.0.0.1:43130 工作台，实际 /api/config 返回四个图片模型，默认 codex/gpt-image-2，gateway.reachable=true。未安装依赖或部署，未改变 DSH GUI 服务。

## 历史偏差与已取代方案
初始实现早于六规范齐全审阅，且旧契约不符，曾按规范重写。初稿5项、旧路线15项测试仅为历史证据。此前 Lucy Image 2 是独立选型，不是原扩展服务端模型逆向结论；原服务器提示词仍未知，当前三分类提示词为本项目自建。旧密钥缺失与双引擎结论不再定义当前配置。当前真实生成、质量与浏览器操作须以新鲜运行证据为准。
