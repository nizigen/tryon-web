# 视觉方向批准记录

## W14 · 衣橱与试衣间（待选择）

用户否定 W13 并要求不看旧画面、重新找参考。新原型入口为 `public/design-demos/w14/index.html#closet`，第二页是 `#fitting`；按 Taste 应用轨道制作，不套用 Huashu 样式。选源和取舍见 `findings.md` W14，验证见 `progress.md` W14。没有新方向的正式批准，不替换正式视觉。

## W13 · 照花 Taste 三版预览（已被否定）

用户要求先实际找参考，再「按照taste给我几个页面」，不严格使用 Huashu 的风格。已提供独立原型：`public/design-demos/w13/a.html`（衣橱图鉴）、`b.html`（镜前选搭）、`c.html`（搭配桌）。原站与借鉴边界见 `findings.md` W13；各版桌面和手机截图见 `progress.md`。用户后续要求重做，不从 W13 落地新视觉。

## W12 · 照花（2026-11-27）

用户对实站反馈「但是现在demo味还是很强啊」，并要求按 Huashu Design 与 Taste 改进、将产品命名为「照花」、制作图标。使用 Huashu「同一项目内已选定方向后的迭代」例外：保留已批准的 A 左照片右操作、B 左衣橱右搭配，以及手机底部导航。只调整版式层级、材质、文案和识别标记，不把本轮视觉细节记成用户已验收。

从 W11 的[衣橱](artifacts/shots/w11-wardrobe-desktop-final.png)和[工作台](artifacts/shots/w11-studio-desktop-final.png)截图出发。新表面规则见 `FRONTEND_GUIDELINES.md` W12，名称和图标登记在 `brand-spec.md`。

## 当前选择（2026-11-23）

用户在三版可点击预览之后回复：**「按你说的来即可」**。
对应紧邻建议：**「B 的衣橱 + A 的工作台」**。
这是本轮全站前端改版的明确批准，取代旧 C 分步试衣台与后续暖石画框视觉。

- 对比入口：`public/design-demos/index.html`。
- 衣橱参考：`public/design-demos/b.html`，证据 `public/design-demos/shots/b-desktop.png`。
- 工作台参考：`public/design-demos/a.html`，证据 `public/design-demos/shots/a-desktop.png`。
- 统一系统：浅灰绿背景、白色面板、墨绿主操作、原生系统字体、细线图标；桌面顶部导航，手机四入口底部导航。
- 工作台：左侧人物/结果画布，右侧人物来源、单品搭配、版型、补充要求与生成操作。
- 衣橱：主区真实单品网格，右侧人物与当前搭配；编辑/删除归单品更多菜单，链接导入保留衣橱内弹窗。
- 设置、试穿记录、隐藏橱窗深链接、下拉与弹窗沿用同一视觉系统。

## 选型时的实施边界（2026-11-23）

正式实现仍用 Node v24.22.3、原生 HTML/CSS/ESM，不新增依赖、账号登录、付费探测或部署。
预览内存样例不进入正式页面；正式 UI 使用现有 REST 接口和真实持久化数据。
完整规则以 `FRONTEND_GUIDELINES.md` 为准；步骤与检查以 `IMPLEMENTATION_PLAN.md` 本轮章节为准。

## W11 迭代（2026-11-27）

沿用本页批准的 A 工作台和 B 衣橱。此轮在现有视觉上用 React 组织四步试拍，仍使用浅灰绿、墨绿主操作与真实人物和单品图；复用上述 A/B 预览和截图。生产技术栈以当前 `TECH_STACK.md` 的 React 19.2.7 和 esbuild 0.28.2 为准。

## 历史

2026-11-21 用户选择旧稿 C 分步试衣台，后续暖石画框版本已被本轮明确选择取代；历史截图保留在原路径作设计证据。
