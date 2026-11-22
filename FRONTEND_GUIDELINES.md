# FRONTEND_GUIDELINES — 深色工作台（仿 flyne）

> v1 的浅色「电商橱窗 + 试衣间」方向已被 v3 的深色工作台取代（用户明确要求照 `https://flyne.ai/cn/` 做）。
> 本节令牌取自 flyne 的 computed style 实测，记录在 `docs/frontend-design-reference.md`，证据截图 `docs/evidence/flyne-*.png`。

## 方向与边界

深色 AI 工作台：近黑底、分层深灰面板、极细描边、紫色渐变主按钮、胶囊控件、大圆角卡片。目标观感是「专业工具」而不是「电商落地页」——信息密度高、留白克制、不用装饰性插画、不用占位方块。

## 视觉令牌

| Token | 值 | 用途 |
| --- | --- | --- |
| canvas | #0a0a0a | 页面底 |
| panel | #111111 | 主面板 |
| panel-2 | #161616 | 卡片、输入框底 |
| line | rgba(255,255,255,.10) | 1px 描边 |
| line-strong | rgba(255,255,255,.18) | 悬停/聚焦描边 |
| ink | #ffffff | 主文字 |
| muted | rgba(255,255,255,.62) | 辅助文字 |
| accent | #7c3aed → #a855f7 | 主按钮渐变、选中态 |
| accent-soft | rgba(124,58,237,.14) | 选中底、胶囊高亮 |
| radius-card | 20px | 卡片 |
| radius-control | 8px | 输入框、按钮 |
| radius-pill | 999px | 胶囊（导航、下拉触发器、分段控件） |
| control-h | 36–48px | 控件高度（sm 36 / md 40 / lg 48） |

字体：`"PingFang SC", arial, tahoma, "Hiragino Sans GB", "Microsoft YaHei", sans-serif`（与 flyne 一致），不加载外部字体。金额与计数用 `font-variant-numeric: tabular-nums`。

## 排版与间距

4px 基准（4/8/12/16/20/24/32）。正文 14px，辅助 13px，卡片标题 16px，区块标题 18px，页面主标题 24px。行高 1.5。

## 布局

- 桌面（≥1024px）：左侧固定导航（可折叠分组：选衣 / 工作台 / 我的）+ 主区两列（表单卡 + 结果卡）。
- 768–1023px：导航收为顶栏胶囊，主区单列。
- 移动（<768px）：顶栏胶囊 + 单列；主操作在底部常驻条。

## 组件语言

- **胶囊下拉**（`createCapsuleSelect`）：自制，不用原生 `<select>`。触发器收起/展开是同一个节点，只改描边与浮层显隐；触发器与选项同 `height/line-height/padding(0 14px)/font-size(14px)`，选中对勾绝对定位在 `left:1px` 不挤占文字。
- **两级下拉**（`createCascadeSelect`）：一级七大类、二级子类；一级变更清空二级；无子类时二级置灰。两级复用同一套胶囊样式，保证「未选择态」与「展开态」度量一致。
- 卡片：`panel-2` 底 + 1px `line` 描边 + 20px 圆角；悬停只提亮描边，不做位移。
- 主按钮：紫色渐变 + 999px 胶囊；禁用时降透明度并保留文案（不换成「…」以外的假状态）。
- 图片：**衣橱、今日穿搭、结果区一律不用 `loading="lazy"`**——后台会话里 `visibilityState` 可能是 `hidden`，懒加载永不触发，会呈现空白卡片。
- 结果画布：竖版长图（约 1:2）用 `width:auto; max-height:min(72vh,720px); margin-inline:auto`，一屏可见、不裁切不变形。

## 行为与可访问性

原生 `button/input`；下拉是 `role="listbox"` + `aria-expanded`，键盘 ↑↓ Enter Esc 可达；状态区 `aria-live="polite"`；错误同时给颜色与文字；触控目标 ≥44px；`prefers-reduced-motion` 时关闭过渡。

## 资源与合规

只用用户上传素材、商品目录图与真实上游结果；商品目录图必须来自真实素材或明确标注 AI 生成。CSS/JS 外置，遵守正式 CSP（`img-src 'self' blob: data:`）。所有 AI 生成结果在界面与导出文件名标注「AI 生成」。

## 验证

OpenCLI 在 390/768/1440 三档实测（`artifacts/shoot-all.mjs`，6 路由 × 3 视口）：横向溢出、卡片排布、底部操作条、下拉展开与收起、结果图尺寸。

**坑**：`browser screenshot --width/--height` 只改截图视口，`eval` 读到的仍是真实窗口，判断断点是否生效必须以 `eval` 的 `innerWidth` 为准；`style.css` 带 `max-age=300`，改完要换查询串或用 `link.href='/style.css?b='+Date.now()` 手动换链。
