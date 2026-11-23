# FRONTEND_GUIDELINES — 暖石画框工作台（framed-sheet）

> 历史：v1 浅色电商橱窗 → v3 深色仿 flyne（紫色渐变）→ **v6 重做为 framed-sheet**。
> v3 的深色与紫色已被用户明确否掉（「组件太丑、紫色 AI 味太重、弱化边界」）。v6 方向由
> `design-taste-frontend` 技能的样式库用 `draw.mjs --app` 抽出（seed 1470960127，light，`framed-sheet`），
> 并遵循该技能 `references/app-screens.md` 的 app 屏规则（23 个真实产品实测）。方向存 `.taste-skill/direction.json`。

## 方向与边界

一层**暖石色调的 L 形画框**（侧栏 + 顶栏同底色、中间没有竖线），主区是一张**白色纸面**
（右、下各内缩 8px、16px 圆角、无阴影）。靠**色调差**分层：卡片比纸面深一档、不用描边围框。
颜色只服务数据与状态，全屏彩色像素约 3%，**主操作用近黑墨色**而不是彩色按钮。

硬规则（沿用 app-screens 实测）：不用渐变、不用紫/靛、不用釉面玻璃与 backdrop-blur、不用光晕、
不用图标色块、不用 pill 徽章压在标题上、不用小号大写加字距标签、不用 emoji、不做 hero 大标题（标题是名词，22–24px）。
强调色只留给「选中态 + 小标记 + 数据」，且只用青灰一种。

## 视觉令牌

| Token | 值 | 用途 |
| --- | --- | --- |
| bg | #efece6 | 画框（侧栏 + 顶栏 + 页面底） |
| surface | #ffffff | 纸面（主区） |
| panel | #f8f6f2 | 卡片底（比纸面深一档，不描边） |
| panel-2 | #ffffff | 输入框底色 |
| panel-3 | #efece5 | 缩略图槽、结果画布 |
| hover | #efece5 | 悬停底 |
| ink | #1c1a17 | 主文字、主按钮实底 |
| muted | #6f6a62 | 辅助文字 |
| disabled | #a8a29a | 占位、禁用 |
| line | #e7e2da | 极浅分隔线（仅在确需线条时） |
| line-strong | #d8d1c6 | 悬停/聚焦、虚线框 |
| accent-1 / accent-2 | #1b6c80 | 青灰强调色（选中、标记、数据） |
| accent-soft | #e6eef0 | 选中底、已填格子底、舞台底 |
| positive / negative | #1e7b4f / #b42318 | 成功 / 失败 |
| radius-card / radius-panel | 10px | 卡片、面板 |
| radius-ctl | 8px | 输入框、按钮、下拉触发器 |
| radius-pill | 8px | **不再用 999px 药丸** |
| control-h | 40px | 控件高度 |

字体：`"IBM Plex Sans"`（Google Fonts，`preconnect` + 一次样式表）＋ CJK 回退
`-apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`。
金额、计数、ID 用 `IBM Plex Mono` + `font-variant-numeric: tabular-nums`。最多两种字体。

## 排版与间距

4px 基准（4/8/12/16/20/24/32/56）。页面主标题 22px/600（字距 -0.01em），卡片标题 15px/600，
正文 14px，辅助 12–13px。行高 1.5。侧栏 248px（含内边距），桌面分区间距 16–20px，页底 padding 56px。

## 布局

- 画框：`.app-shell` 铺 `bg`；`.sidebar` 透明、无右边框；`.view-root` 是白纸（`margin:8px 8px 8px 0; border-radius:16px; min-height:calc(100vh-16px); padding:26px clamp(20px,3.4vw,44px) 56px`），≥1500px 左右 padding 到 `clamp(24px,9vw,180px)` 防止超宽屏一行过长。
- 搭配工作台（≥1080px）：两列——左 `studio__controls`（人物照片 / 单品搭配 / 版型与补充要求 / 提交，400–460px）＋ 右 `studio__preview`（试穿结果，`position:sticky; top:84px` 吸顶）；左栏多长右栏都可见。
- 设置页（≥900px）：卡片两列网格。
- 卡片标题统一走 `.card__head`（`.card__heading` 标题在上、`<p class="section__hint">` 在下，右侧 `.push-end` 放操作）。
- 移动（<768px）：画框消失、纸面即屏幕——`.sidebar` 变成顶部横条（`bg` 底 + 1px `line` 下边），`.view-root` `margin:0; border-radius:0; padding:18px 14px`；导航项变白底 8px 角小块。

## 组件语言

- **胶囊下拉**（`createCapsuleSelect`）：自制，不用原生 `<select>`。白纸 + 1px `line` + 8px 角；展开面白底 + 1px 线 + `0 10px 28px rgba(28,26,23,.12)`；触发器与选项同度量，选中对勾绝对定位 `left:1px` 不挤占文字。
- **两级下拉**（`createCascadeSelect`）：一级七大类、二级子类；一级变更清空二级；无子类时二级置灰；两级同一套度量。
- **卡片**：`panel` 底、**无边框、无阴影**、10px 角，靠与白纸的色调差分层。
- **主按钮**：近黑墨色实底 + 白字 + 8px 角、无渐变无阴影，hover 纯黑；次按钮白底 1px `line`。
- **分段 / 筛选 / 标签**：分段选中用灰底墨字（不彩色）；筛选选中用淡青底 + 青字；标签透明底 1px 线或淡青。
- **状态**：成功/失败用语义色**淡底**（不带描边）；状态胶囊在线状态用绿字淡绿底。
- **图片**：衣橱、今日穿搭、结果区一律**不用 `loading="lazy"`**（后台会话 `visibilityState` 可能为 `hidden`，懒加载永不触发会显示空白）。
- **结果画布**：竖版长图（约 1:2）用 `width:auto; max-height:min(72vh,720px); margin-inline:auto`，一屏可见、不裁切不变形。
- **弹层**：遮罩 `rgba(28,26,23,.45)`；对话框白底无边框 + `0 24px 60px rgba(28,26,23,.22)`。

## 行为与可访问性

原生 `button/input`；下拉 `role="listbox"` + `aria-expanded`，键盘 ↑↓ Enter Esc 可达；状态区 `aria-live="polite"`；
错误同时给颜色与文字；触控目标 ≥44px（视觉高度 40px + 内边距）；`prefers-reduced-motion` 时关闭过渡与骨架动画。
正文对比度 ≥ 4.5（实测全路由 0 处低于 3.0）。

## 资源与合规

只用用户上传素材、商品目录图与真实上游结果；目录图必须来自真实素材或明确标注 AI 生成。CSS/JS 外置，遵守正式 CSP（`img-src 'self' blob: data:`）。所有 AI 生成结果在界面与导出文件名标注「AI 生成」。

## 验证

`artifacts/shot-cdp-all.mjs`（6 路由 × 3 视口 1440/768/390，CDP `Emulation.setDeviceMetricsOverride` 真改布局宽度）：横向溢出、卡片排布、底部操作条、下拉展开收起、结果图尺寸，18 组全部无溢出。
`artifacts/audit-contrast.mjs`：逐元素算前景/背景对比度；`artifacts/audit-design.mjs`：统计阴影/渐变/可见边框/圆角/字号；`artifacts/img-stats.py`：整图平均亮度与彩色/紫色像素占比。

**坑**：
1. `browser screenshot --width/--height` 只改截图视口，`eval` 读到的仍是真实窗口，断点是否生效以 `eval` 的 `innerWidth` 为准。
2. `style.css` 带 `max-age=300`，改完要换查询串，或让下一次审计用**全新 `--user-data-dir`**（审计脚本已改成每次带时间戳的 profile），否则读到的是浏览器缓存里的旧 CSS，审计结果会假阴/假阳。
