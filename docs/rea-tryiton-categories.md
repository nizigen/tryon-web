# TryItOn 扩展逆向分析：分类标签体系 / 多选分层 / 试穿流程 UI

- 分析对象：Chrome 扩展「TryItOn: Virtual Try-On for Fashion」（listing 名）v9.0.0，未改动的解包目录
  `C:\Users\l1234\AppData\Local\Google\Chrome\User Data\Default\Extensions\ohfkhalfafkomanjkgghbdlcinhdpmko\9.0.0_0`
- 分析方法：只读静态分析。用 grep 定位关键词，再用字符偏移窗口读取上下文核对原文。
- 证据标注约定：主 bundle 是**压缩后的超长行**，全文件仅 315 行；同一个逻辑片段常落在同一物理行。因此每条证据同时给出 `文件:行号` 与 `字符偏移 @NNNNNN` 并附**引号原文**，便于按偏移二次定位。
- 主证据文件：`assets/main-D-b9QqDh.js`（932KB，下文简写 **main**）。

> 重要区分（贯穿全文）：bundle 里**出现**某个分类词，只说明该词属于「某套前端分类/筛选/模型目录」；**不等于**后端一定接受它。下文凡由前端数据推断后端行为的，均标注「推断」。

---

## 一、分类与标签

扩展里存在**三套互不相同**的分类数据，必须分开看，否则会把「商品浏览筛选项」误当「试穿提交分类」。

### 1.1 服装分类（试穿提交用，真·提交字典）—— `UC`

来源：**main:253 @542362** 起。
原文（连续片段）：

```
const VF={clothing:["auto","tops","bottoms","dresses"],eyewear:[],footwear:[],headwear:[],jewelry:["rings","earrings","necklaces","bracelets","anklets"],accessories:["watches","belts","scarves","bags","gloves","ties"],others:[]},
av={auto:"Auto",clothing:"Clothing",eyewear:"Eyewear",footwear:"Footwear",headwear:"Headwear",jewelry:"Jewelry",accessories:"Accessories",others:"Others"},
qF={auto:"Auto",tops:"Tops",bottoms:"Bottoms",dresses:"Dresses",rings:"Rings",earrings:"Earrings",necklaces:"Necklaces",bracelets:"Bracelets",anklets:"Anklets",watches:"Watches",belts:"Belts",scarves:"Scarves",bags:"Bags",gloves:"Gloves",ties:"Ties"}
```
`UC`（下拉实际使用的数组）由上面三者拼装，并**排除 `others`**：
```
UC=[{value:"auto",label:av.auto,subs:[]},...Object.entries(VF).filter(([e])=>e!=="others").map(...)]
```
（同段 **main:253**；`fx="auto"`（@543100）是默认分类，`px=null`（@543110）是默认子分类。）

| 内部代码 (category / subcategory) | 显示文案 | 证据（file:line @offset 原文） |
| --- | --- | --- |
| `auto` | Auto | main:253 @542362 `av={auto:"Auto",...}`；`fx="auto"` @543100 |
| `clothing` | Clothing | main:253 @542362 `clothing:"Clothing"` |
| `clothing / auto` | Auto（子项） | main:253 @542362 `qF={auto:"Auto",...}` |
| `clothing / tops` | Tops | main:253 @542362 `tops:"Tops"` |
| `clothing / bottoms` | Bottoms | main:253 @542362 `bottoms:"Bottoms"` |
| `clothing / dresses` | Dresses | main:253 @542362 `dresses:"Dresses"` |
| `eyewear` | Eyewear | main:253 @542362 `eyewear:"Eyewear"`，**subs 为空 `[]`** |
| `footwear` | Footwear | main:253 @542362 `footwear:"Footwear"`，**subs 为空 `[]`** |
| `headwear` | Headwear | main:253 @542362 `headwear:"Headwear"`，**subs 为空 `[]`** |
| `jewelry` | Jewelry | main:253 @542362 `jewelry:"Jewelry"` |
| `jewelry / rings` | Rings | main:253 @542362 `rings:"Rings"` |
| `jewelry / earrings` | Earrings | main:253 @542362 `earrings:"Earrings"` |
| `jewelry / necklaces` | Necklaces | main:253 @542362 `necklaces:"Necklaces"` |
| `jewelry / bracelets` | Bracelets | main:253 @542362 `bracelets:"Bracelets"` |
| `jewelry / anklets` | Anklets | main:253 @542362 `anklets:"Anklets"` |
| `accessories` | Accessories | main:253 @542362 `accessories:"Accessories"` |
| `accessories / watches` | Watches | main:253 @542362 `watches:"Watches"` |
| `accessories / belts` | Belts | main:253 @542362 `belts:"Belts"` |
| `accessories / scarves` | Scarves | main:253 @542362 `scarves:"Scarves"` |
| `accessories / bags` | Bags | main:253 @542362 `bags:"Bags"` |
| `accessories / gloves` | Gloves | main:253 @542362 `gloves:"Gloves"` |
| `accessories / ties` | Ties | main:253 @542362 `ties:"Ties"` |
| `others` | Others | main:253 @542362 `others:"Others"`，**被 `filter(e!=="others")` 从下拉中排除**，UI 不可选 |

要点：
- 这是**扁平两级**结构：一级 category + 二级 subcategory（可空）。`auto` 是「自动识别」的占位分类。
- `eyewear / footwear / headwear` 三个一级分类**存在但没有任何子类**；点击它们只会提交 `category` 而 `subcategory=null`。
- 显示文案**只有英文**，未见 i18n/中文映射（见第四节）。
- 图标映射 `KF(e,t)` 也印证这套值：`{auto:"sparkles",tops:"tshirt",bottoms:"pants",dresses:"dress"}`、`jewelry→gem`、`accessories→watch`，以及一级 `{clothing:"tshirt",eyewear:"glasses",footwear:"shoe",headwear:"hat",jewelry:"gem",accessories:"watch"}`（main:253 @543365）。

### 1.2 商品浏览/筛选分类（不是试穿提交字典）—— `mv` + 颜色/人群/季节/场合/风格

来源：**main:258 @627780** 起。原文：

```
const mv=[
 {value:"clothing",label:"Clothing",subs:[
   {value:"dresses",label:"Dresses"},{value:"tops",label:"Tops & T-shirts"},
   {value:"shirts",label:"Shirts & Blouses"},{value:"knitwear",label:"Sweaters & Hoodies"},
   {value:"jackets",label:"Jackets & Coats"},{value:"blazers",label:"Blazers"},
   {value:"trousers",label:"Trousers"},{value:"jeans",label:"Jeans"},
   {value:"shorts",label:"Shorts"},{value:"skirts",label:"Skirts"},
   {value:"activewear",label:"Activewear"},{value:"swimwear",label:"Swimwear"},
   {value:"underwear",label:"Lingerie & Underwear"}]},
 {value:"shoes",label:"Shoes",subs:[
   {value:"sneakers",label:"Sneakers"},{value:"boots",label:"Boots"},{value:"heels",label:"Heels"},
   {value:"sandals",label:"Sandals"},{value:"flats",label:"Flats"},{value:"loafers",label:"Loafers"},
   {value:"sport_shoes",label:"Sport shoes"}]},
 {value:"bags",label:"Bags",subs:[
   {value:"handbags",label:"Handbags"},{value:"backpacks",label:"Backpacks"},
   {value:"totes",label:"Totes"},{value:"wallets",label:"Wallets"}]},
 {value:"accessories",label:"Accessories",subs:[
   {value:"sunglasses",label:"Sunglasses"},{value:"hats",label:"Hats & Caps"},
   {value:"belts",label:"Belts"},{value:"scarves",label:"Scarves"},
   {value:"watches",label:"Watches"},{value:"gloves",label:"Gloves"}]},
 {value:"jewelry",label:"Jewelry",subs:[
   {value:"rings",label:"Rings"},{value:"earrings",label:"Earrings"},
   {value:"necklaces",label:"Necklaces"},{value:"bracelets",label:"Bracelets"}]},
 {value:"beauty",label:"Beauty",subs:[]}
]
```
紧接着是属性字典（同段 **main:258 @628230–@631200**）：
- 颜色 `cU`：black/white/gray/beige/brown/red/pink/orange/yellow/green/blue/purple/gold/silver/multicolor（黑白灰米棕红粉橙黄绿蓝紫金银多色，带 hex）。
- 人群 `uU`：women / men / unisex / kids。
- 季节 `dU`：spring / summer / autumn / winter / all-season。
- 场合 `fU`：daywear / work / date / party / wedding / formal-event / travel / gym / beach / casual-outing / interview / brunch / concert / vacation。
- 风格 `pU`：relaxed / romantic / confident / playful / edgy / cozy / powerful / mysterious / cheerful / elegant / rebellious / minimalist。

**这套 `mv` 属于「商品目录搜索/筛选」而非试穿提交**，证据是它被筛选状态 `uo` 和查询构造器 `dR` 使用：
```
uo={minPrice:null,maxPrice:null,inStock:!1,brands:[],categories:[],subcategories:[],colors:[],audience:[],occasions:[],seasons:[],moods:[]}
...
o.categories.join(",") ... o.subcategories ... o.colors ... o.audience ... o.occasions ... o.seasons ... o.moods ...
```
（main:258 @630750 / @631150）；并用于 `facetsUrl:"/products/facets"` 的筛选面板（main:258 @663064）。推荐子类标签 `Bx` 也直接由 `mv` 的 clothing subs 生成（main:258 @644453 `Bx=Object.fromEntries(mv.find(e=>e.value==="clothing").subs.map(...))`，配合 `vU={categories:"clothing"}`）。

> 结论：`1.2` 的分类**更丰富（含鞋/包/美妆/更多服装子类）**，但它是**商品浏览**的筛选项，不能据此认为试穿提交接口支持这些值。试穿提交只认 `1.1` 的 `UC`。

### 1.3 官方文案里的品类描述（仅营销措辞，非代码枚举）

`manifest.json:15` 原文：
> "Virtually try on outfits, shoes, headwear, jewelry and accessories to see how they look on you before buying — and avoid returns!"

这是扩展商店描述，提到鞋/头饰/珠宝/配饰，但**只是宣传语**，无法作为接口枚举证据。

---

## 二、多选与分层（结论 + 证据 + 置信度）

### 结论（先给判断）

| 场景 | 是否支持一件以上同时试穿 | 是否支持分层叠穿 | 置信度 |
| --- | --- | --- | --- |
| **Photo try-on（照片试穿，主流程）** | **否，严格单件单分类** | **否** | 高（直接读提交代码） |
| **Live（实时试穿，摄像头）** | **是「队列」多件，但每次只穿一件**（"Up next" 最多 12 个 look，逐件切换） | **否**（切换不是叠加） | 高（读 lineup 逻辑） |
| 后端是否可能自行支持多图/分层 | **未知** | **未知** | 低（前端请求体只有单张 file） |

### 2.1 Photo try-on 是单件：提交体只 append 一个 file

提交函数（main:258 @668197 原文）：
```
const Pe=new FormData;
Pe.append("category",S),C&&Pe.append("subcategory",C),
Pe.append("photoId",n._id),Pe.append("file",l),
Pe.append("origin","extension"),
p&&Pe.append("productUrl",p),
typeof fe=="string"&&fe&&Pe.append("regeneratedFrom",fe);
...
await Qe.post("/tryon/clothes",Pe,{headers:{"Content-Type":"multipart/form-data"}})
```
- 只有一个 `"file"`（`l` 是单个 File），一个 `category`（`S`），至多一个 `subcategory`（`C`）。**没有任何数组 / plural 字段 / 多个 file**。
- 前端全局搜 `garments`（复数）计数 = 0；`combo` = 0（`bundle` 的 10 次均与打包器/webpack 相关，非服装）。
- `S`/`C` 的 state 声明：`[S,k]=x.useState(fx)`（fx="auto"，main:258 @664930）、`[C,T]=x.useState(px)`（px=null，@664951），均属于 `function RU(`（@664727）组件；且选择器 `h6` 是**单选**（点一项即 `d(m.value,E.value)` 并 `s(!1)` 关闭，main:253 @555787）。
- 因此照片试穿**只可能提交一件**。这是「前端行为」的直接事实，置信度高。
- 「后端是否接受多 file / 多 category」在客户端无从证明——**推断**即使后端支持，扩展 UI 也不会发出多件请求。

### 2.2 Live 模式是「队列逐件切换」，不是叠穿

- 顶部模式只有两个：`DF=[{key:"photo",label:"Photo try-on",path:"/"},{key:"live",label:"Live",path:"/live"}]`（main:253 @534431）。
- Live 的 `lineup`（"Up next"）是一个**待穿列表**，可切换加入/移除，`wE=12` 上限：
  ```
  toggle:T=>{ ... if(l.some(L=>L.key===P))return c(l.filter(L=>L.key!==P));
    ... if(l.length>=wE)return We(`Up next holds up to ${wE} looks.`); c([...l,{...}]) }
  goNext:S=()=>l[0]&&s(l[0].source), goBack:k=()=>{ ... s(T.source) }   // 逐件换上/换回
  ```
  （main:314 @912245）
- 每次「穿」只发送**单个** garment 对象：`aE=e=>({category:e.category,subcategory:e.subcategory||null,productId:...,source,...,title,thumbnailUrl})`，`POST /tryon/live/start {origin:"extension",garment:aE(V)}` 与 `POST /tryon/live/{id}/switch {garment:aE(V)}`（main:314 @870351 / @873084 / @874004）。
- 结论：Live 的「多件」是**时序队列**（一个 look 一个 look 换），**不是同一帧内上衣+下装+外套叠穿**。置信度高。

### 2.3 与「多件/分层」相关但无关的词

- `layer` / `layers` 仅出现 2 次，全部在 LiveKit 视频编码配置（`simulcastLowerLayersBitrateBps` 等，main:253 @800915），**与服装分层无关**。
- `outfit` 出现 3 次，是分享文案（"Look at my new outfit!" 等），非数据结构。
- `wardrobe` 是另一处「衣橱/收藏」功能（`/wardrobe`、`/wishlist`，main:314 @878222），每个条目仍是**单件**（`productId`/`wardrobeItemId`/`wishlistItemId`/`uploadId` 之一），不构成叠穿。

### 2.4 一句话对照（给本项目）

原始扩展**本身不支持**「上衣+下装同时选 / 内搭+外套叠穿 / 裙子+丝袜」这类多槽位一次成图（photo 模式单件；live 模式逐件切换）。本项目 `docs/OUTFIT_MODEL.md` 里的七格多选叠穿是**在原始能力之上的自建增强**，不是复刻扩展已有行为。

---

## 三、试穿流程 UI 结构

（以 Photo try-on 为主；入口为扩展 popup / 侧边栏 `index.html`，`manifest.json:31` `side_panel.default_path = index.html?surface=panel`。）

### 3.1 顶部模式切换
`jC` 组件渲染两个 tab：**Photo try-on** / **Live**（main:253 @534519，`DF` 定义见 2.2）。

### 3.2 Photo try-on 的页面步骤（`RU` 组件，main:258）

1) **标题 "Select Model"（选模特照）**
   - 原文 `children:"Select Model"`（main:258 @670650）。
   - 控件：`I6` 照片相册（`photos:z, selectedPhoto:n`）+ 上传；4 个占位骨架卡（loading 时显示 `[0,1,2,3]`）。**单选：选中一张 `n`**。
2) **标题 "Select item"（选单品图）**
   - 原文 `children:"Select item"`（main:258 @671281），旁边显示来源 `from {host}`。
   - 控件（横向缩略卡 `qx`/`Kx`）：
     - **"Pick from page"**（调用 content script 在网页上框选图片；进行中变 **"Cancel picking"**）；
     - **"Upload"**（`<input id="clothImageInput" type="file" accept=图片类型>`）；
     - 页面识别到的商品项 `he.items`（点选/取消）；
     - 已选单品卡（"Tap to remove"）；
     - 支持**拖拽图片**（"Drop your image here"）。
   - **单选：`l` 为单个 File**（见 2.1）。
3) **分类下拉（`h6` 组件，自定义单选下拉）**
   - 按钮显示「一级文案 + 二级文案」（`hx(e)` + `GF(e,t)`；`h6` 定义 main:253 @555613，`GF` 定义 main:253 @543683）。
   - 展开后：一级项；有子类的一级项再展开二级子项（`clothing` 子项额外带小图标）。**单选**，选中即关闭。
   - 默认值 `auto`（Auto）。
4) **"Try It On" 按钮**（`function M8`，main:258 @611409；默认文案 `text:n="Try It On"` @611443）。
   - 禁用条件（原文）：`disabled:!n||!l||A||ae===0`（main:258 @677961）→ 未选模特照 `n` / 未选单品 `l` / 正在处理 `A` / 余额为 0 `ae===0`。
5) **处理中（`A`）**
   - 模特图放大模糊 `blur` + 呼吸动画；底部悬浮处理徽标 `tU`。
   - 进度文案随分类轮播（`Dx.fashion=["Analyzing your fit…","Draping the look…","Refining the details…","Almost ready…"]`，main:258 @621116）；文案 "This usually takes about 10 seconds"。
6) **结果（`P`）**
   - 上方两个缩略：**"Model"**（原图）与 **"Item"**（单品图）。
   - 中间为对比滑块（`react-compare-slider`，`HF` 的 `setPosition` 先 98 再 10 做动画）。
   - 操作：刷结果、分享、下载、**"Report this result"**；结果下方仍显示 `h6` 分类下拉可改分类重试（`!A&&!P` 分支之外）。
7) 生成后接口轮询：`q8(_t.data.jobId,7e3)`（7 秒间隔轮询 jobId），成功后从 `data.tryon` 取 `imageUrl/_id/owner`（main:258 @668197）。

### 3.3 请求体字段（照片试穿，最终确认）
`POST /tryon/clothes`，`multipart/form-data`：

| 字段 | 是否必填 | 来源 | 证据 |
| --- | --- | --- | --- |
| `category` | 必填 | 分类下拉一级（默认 `auto`） | main:258 @668197 |
| `subcategory` | 可选（空则不发） | 分类下拉二级 | 同上 `C&&Pe.append("subcategory",C)` |
| `photoId` | 必填 | 选中的模特照 id `n._id` | 同上 |
| `file` | 必填 | 单个单品图 File `l` | 同上 |
| `origin` | 必填 | 固定 `"extension"` | 同上 |
| `productUrl` | 可选 | 从网页/右键识别到的商品链接 `p` | 同上 |
| `regeneratedFrom` | 可选 | 「重新生成」时传上一版 id | 同上 |

与既有线索一致：`category=S、subcategory=C、photoId、file、origin=extension` 均被证实，且**均为单值**。

### 3.4 Live（实时）模式 UI 概要
- 摄像头会话：`/tryon/live/config` → `/tryon/live/start`（`{origin:"extension",garment}`）→ `/tryon/live/tick` → `/tryon/live/end`（main:314 @8715xx–8730xx）。
- garment 来源同上（product / wardrobe / wishlist / upload 之一，单件）；`/tryon/live/garment` 上传或引用。
- "Up next" 队列：最多 12 个 look，逐件 `switch`；有 `goNext/goBack`、history。会话状态提示语含 `out_of_credits / time_limit / hidden / superseded / stale / user / unload`（main:314 @912245 起 `bE={...}`）。

---

## 四、未确认 / 拿不到的项（明确列出）

1. **后端真实接受范围未证实**：`/tryon/clothes` 服务端是否接受数组、多 file、或 1.2 里的丰富子类值，**无法从客户端 bundle 得到**。客户端只发单件、且只发 `UC` 值 → 前端行为确定，后端行为「未验证/推断」。
2. **`others` 分类**：`VF` 里保留 `others:[]` 但被 UI `filter(e!=="others")` 排除；后端是否处理 `others` 未知。
3. **`eyewear/footwear/headwear` 无子类**：这三级在提交字典里有、subs 为空；是否后端会用「自动识别」补全子类，**未确认**（推断：仅提交 category、subcategory 为空）。
4. **i18n / 中文文案**：全 bundle 未见中文本地化资源；`main` 中 65 个「CJK 字符」经核对是 **emoji 被按错误编码显示产生的乱码**（如 `馃捒 Hey developer 馃憢`），**不是中文文案**。`index-DHLAfN5L.js`、`index.html` CJK 计数为 0。→ 结论：**未找到中文分类映射，界面为英文**（置信度高）。
5. **`models / SDK 目录（lucy-* 等）与后端关系**：未在本次范围内发现 `lucy-*` 之类模型目录字符串影响分类；如后续要核实模型侧能力，需另查网关/后端，不在扩展静态分析可证范围。
6. **`1.2` 的 `mv` 完整属性字典**（颜色/人群/季节/场合/风格）已抓到枚举与文案，但其对应的 `/products/facets` 后端是否与前端枚举一一对应，**未验证**。
7. **未拿到的文件**：`assets/frame-metadata-worker-*.js`、`livekit-client.esm-*.js`、`live/*.js` 等为播放器/摄像头/媒体相关，未发现服装分类逻辑（已按关键词 `category/subcategory/garment` 全量计数为 0 于这些文件，属「未找到」而非遗漏）。

---

### 附：本次定位到的关键偏移一览（main = assets/main-D-b9QqDh.js）

| 内容 | 位置 | 偏移 |
| --- | --- | --- |
| 提交字典 `VF/av/qF/UC`、`GF`、默认 `fx/px` | main:253 | @542362–@543683 |
| 分类下拉 `h6`（单选、二级展开） | main:253 | @555613 / @555787 |
| 图标映射 `KF` / 分类名 `hx` | main:253 | @543118 / @543446 |
| 模式 tab `DF` + `jC` | main:253 | @534431 / @534519 |
| 商品筛选分类 `mv` + 颜色/人群/季节/场合/风格 | main:258 | @627780–@631200 |
| 筛选状态 `uo` + 查询构造 `dR` | main:258 | @630750 / @631150 |
| 推荐标签 `Bx` / `vU` | main:258 | @644453 / @644546 |
| Photo 组件 `RU` 定义与 `S/C` 状态 | main:258 | @664727 / @664930 / @664951 |
| Photo 提交 `sr`（FormData） | main:258 | @668197 |
| Photo UI 渲染（Select Model / Select item / Try It On） | main:258 | @670650–@677961 |
| 进度文案 `Dx` + 徽标 `tU` | main:258 | @621116 / @621403 |
| garment 映射 `aE` / live start·switch | main:314 | @870351 / @873084 / @874004 |
| Live lineup `Yq`（"Up next" ≤12，逐件切换） | main:314 | @912245 |
