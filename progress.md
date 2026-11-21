# progress — 会话日志（操作、变更、验证、错误）

## 2025-11-22 · v2 改造：从本地工作台到付费试穿产品

### 输入与决策
- 用户诉求：把 GitHub 上的 tryon-web（照 Chrome TryItOn 扩展实现）拉到本机；补充服饰选项与提示词，解决"衣服替换不到位、原衣留一半"与"AI 味光影褶皱"；补齐插件式的"鼠标移到身体就显示对应服装"；做抖音穿搭号的橱窗选衣 + 付费试穿；前端去 Demo 味；平台形态（抖音小程序 vs App）由我调研决定；定价由我按模型成本决定。
- 仓库已克隆到 `/root/pi-work/tryon-web`（原仓库在 `C:\GitHub\tryon-web`，本机为 Linux 容器副本）。
- 平台决策与定价依据见 findings.md 第 1、2 节。

### 变更
- 后端按模块拆分：`server.mjs`（入口）+ `src/{app,store,tryon,pricing,prompt,the image service,validate,errors}.mjs`。
- 提示词：结构化分节 + 服装子类（tops 7 类 / bottoms 4 类 / dresses 1 类），外套类走"替换外层、保留内搭"语义；商品标题进入提示词。
- 新增商品目录（`data/catalog.json`，6 件商品，商品图为 AI 生成并在界面标注）、按模型 × 档位定价（`src/pricing.mjs`）、会话/订单/充值单 JSON 持久化（`data/state.json`，原子写）、异步试穿任务（下单冻结额度 → 生成 → 成功扣减 / 失败退回）。
- 前端重做：橱窗（商品网格 + 分类筛选 + 搜索）→ 试穿页（模型/档位/上传/版型/补充要求）→ 结果页（原图对比、区域热点叠加、下载带 AI 标识）→ 我的（余额、充值、订单历史）。移动优先，底部固定 CTA。
- 文档：六份规范（PRD / APP_FLOW / TECH_STACK / FRONTEND_GUIDELINES / BACKEND_STRUCTURE / IMPLEMENTATION_PLAN）按 v2 重写；`design/` 预览移入 `public/design/`（仍可访问）。
- 测试：删除旧的 `test/server.test.mjs`，新增 `test/{api,pricing,prompt,store}.test.mjs`，共 39 项。

### 验证（真实执行）
- `node --test` → 39/39 通过（含扣费、失败退额、并发 409、pending 轮询、跨站拒绝、目录穿越拒绝）。
- 本机 the image service 真实生成（gpt-image-2 / medium / 1024x1536）：
  - tops（红花衬衫）→ 整件替换，无白色残影，证据 `docs/evidence/ui-result-390.png`、`ui-result-1440.png`；
  - bottoms（黑牛仔裤）→ 下装完整替换，证据 `docs/evidence/tryon-bottoms.jpg`；
  - dresses（黑缎面吊带裙）→ 上下装同时替换、保留鞋，证据 `docs/evidence/tryon-dresses.jpg`；
  - 提示词对照实验 `docs/evidence/prompt-lab-v0/v1/v2.jpg`。
- 页面真实交互（Chromium headless + CDP 驱动，容器内）：390/768/1440 三档均无横向溢出；上传人物照 → 提交 → 排队 → 生成 → 结果图加载 → 悬停/点击热区叠加服装图 → 下载按钮 → "我的"订单记录，均实测通过，截图见 `docs/evidence/ui-*.png`。
- 真实 HTTP：/api/config 返回 4 个模型与定价；/api/products 返回 6 件商品；下单扣费 ¥6.90 → 余额 ¥0；失败场景由自动化测试覆盖（退费）。

### 独立评审与修复（2025-11-22）

由独立评审代理（只读，不改代码）复核最终实现，报出 3 个 P0、5 个 P1 与 18 个 P2。已修：

| 编号 | 问题 | 处理 |
| --- | --- | --- |
| P0-1 | 人像 base64 落盘到 `data/state.json` | 订单不再保存人物图/服装图，改为随任务只在内存中流转；`data/state.json` 与 `data/results/` 加入 .gitignore；新增断言"落盘文件不含 base64" |
| P0-2 | 扣费与入队之间的 TOCTOU：409 会吞掉余额并留下永久 pending 订单 | 先占位（`tryon.reserve`）再扣费建单，占位后任何异常都释放占位并全额退款 |
| P0-3 | 进程重启后 pending 订单永久漏退 | 启动时 `reconcileInterruptedOrders()` 把 pending 订单置为 failed 并退款；订单记录 jobId |
| P1-1 | 目录商品图以本机绝对路径下发且绕过图片校验 | 服务端读盘并转成已校验的 data URL，与上传路径同一套校验 |
| P1-2 | 非法档位静默回落到首档（扣费与展示价可能不一致） | 非法档位直接 400；新增 API 层用例 |
| P1-3 | "全身"热区盖住上身/下身，移动端点不到 | 热区按 z-index 分层，上身/下身在上；补 `aria-pressed` 同步 |
| P1-4 | `/api/tryon` 不计量、会话可无限注册领额度 | 部署形态（设置 `PUBLIC_ORIGIN`）默认关闭直连与模拟充值，需显式开关 |
| P1-5 | 模拟充值无闸门 | 同上；充值幂等已有测试覆盖 |
| P2 | 提示词语法错误（"The the ..."）、目录文案注入面、外套语义冲突、提示词字数不一致、CSP 拦内联样式、套餐文案、刷新丢任务、写盘错误静默、任务表不清理、TTL 不改订单、limit 参数、文档与实现不一致、结果 URL 带会话标识 | 逐条修复：提示词去冠词、商品文案单行化限长并加引号、外套改条件式表述、补充要求统一 500 字、骨架改用 class、套餐按最低档折算、进入试穿页接管未完成订单、写盘失败落日志、任务终态 30 分钟清理、TTL 同步把订单置 expired、`limit` 参数透传、文档按实现回填、结果图改为带时效的 HMAC 票据 |

修复后：`node --test` 46/46 通过（含新增的"落盘无 base64""目录图 data URL""结果票据""重启对账""非法档位"用例）。

### 环境说明
- 本容器为 Linux，无 Chrome/预装浏览器；为做真实 UI 验证，在容器内安装了系统包 `chromium`（EPEL），仅用于本次验证，不是项目依赖，仓库未记录任何 Chromium 相关依赖。

### 未验证 / 已知缺口
- 真实支付（抖音虚拟支付）与真实登录未接入，当前充值为本地模拟，会话为匿名设备标识。
- 隐式 AI 标识（图片元数据）未实现；界面与导出文件名有显式标识。
- 混元两个模型与 MiniMax 未做真实生成验证；价格表中的成本估算对混元为保守估值（公开价未取得）。
- "外套保留内搭"未做真实生成验证。
- 提示词对比仅一次三图，未做盲评与多样本统计。

### 错误与修正记录
- 初版 `createStore` 用 `tiersFor('MiniMax')` 计算体验额度，导致默认精档（¥6.90）下单即余额不足 → 改为固定一次标准档额度（690 分）。
- 初版并发检查排在余额检查之后，同会话第二次下单返回 402 而非 409 → 调整为先判并发再判余额；独立评审进一步指出扣费与入队之间的 TOCTOU，改为"先占位再扣费"。
- 初版区域热区对所有分类开放，下半身会叠加上衣 → 按商品分类限制热区；独立评审指出"全身"热区会盖住上身/下身 → 加 z-index 分层。
- CSS 中 `img { display:block }` 覆盖了 `hidden` 属性，导致未上传时露出预览占位图 → 加 `[hidden]{display:none!important}`。
- `createApp` 复杂度 83 → 拆成路由表 + 具名 handler。
- 验证脚本自身的问题：CDP 复用旧标签页（同一 URL 不触发重载）+ 浏览器实例端口冲突导致复用了上一个浏览器，表现为"订单不落盘、订单列表为空"。改为每次使用独立调试端口、独立 profile 并强制 reload 后，浏览器链路与 curl 链路结果一致。
