# IMPLEMENTATION_PLAN — 付费试穿产品化增量

## 入口

六规范已按本轮目标更新（PRD / APP_FLOW / TECH_STACK / FRONTEND_GUIDELINES / BACKEND_STRUCTURE）。用户已授权：定价由我按模型成本决定、平台形态由我调研决定、前后端按 vibe-coding 流程优化。

## Step 1 — 服装分类与提示词体系

- 服装子类表：tops（t 恤/衬衫/雪纺衫/毛衣/卫衣/夹克/大衣）、bottoms（牛仔裤/西裤/短裤/半身裙）、dresses（连衣裙）。
- 每个子类给出替换区域语义：普通上装完全替换；外套类替换外层并保留内搭；下装完全替换下装；连衣裙同时替换上下装。
- 结构化提示词分节：任务与输入角色 / 保留项 / 完全替换与无残影 / 服装保真 / 光影与褶皱自然（去 AI 味）/ 严格约束。
- 商品标题作为服装描述进入提示词，提高印花与版型还原度。
- 退出：`buildTryonPrompt` 有行为断言（区域顺序、保留项、无残影条款、用户补充要求受控），`node --test` 通过。

## Step 2 — 后端模块化与商品/定价/订单

- 拆分 `src/`：app / the image service / prompt / pricing / store / tryon / validate；保留 `server.mjs` 入口。
- 定价表按模型 × 档位；`GET /api/config` 返回模型、档位、单价、成本、分类、充值包。
- 商品目录 `data/catalog.json`（含真实可用的示例商品与占位图路径）；`GET /api/products`、`GET /api/products/:id`。
- 会话、订单、充值单与 JSON 原子持久化；下单冻结额度、成功扣减、失败退回。
- 异步任务：POST /api/orders → jobId；GET /api/jobs/:id 返回真实阶段。
- 退出：新增后端断言（价格与模型对应、余额不足拒绝、失败退额、成功扣额、并发 409、非法档位拒绝），`node --test` 全绿。

## Step 3 — 移动优先前端重做

- 橱窗首页（两/三列商品卡、筛选、搜索、骨架与空状态）、试穿表单（档位选择显示价格、上传、补充要求）、结果区（原图/试穿对比、区域热点叠加、下载带 AI 标识）、我的（余额、订单、充值）。
- 去除演示感：真实文案、真实价格、加载骨架、状态机文案、移动底部固定 CTA。
- 退出：Chrome DevTools 在 390/768/1440 实测无横向溢出、热点命中与叠加可见、结果可下载。

## Step 4 — 真实链路验收

- 本机 the image service 真实生成 tops/bottoms/dresses 各一次并人工查看替换完整性、光影自然度。
- 订单→任务→结果→扣费的真实 HTTP 链路走通一次。
- 独立评审：后端契约与安全、前端可访问性与视觉，各自对最终版本复核。

## Step 5 — 文档与交付

- 更新 findings.md / task_plan.md / progress.md / AGENTS.md / README；记录平台决策与定价依据、未验证范围。
- 提交到分支并推送，不直接合并 main。

## 退出标准

自动化测试全绿 + 真实生成与页面证据 + 独立评审无阻断项 + 文档与实现一致。
