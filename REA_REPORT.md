# TryItOn 9.0.0 研究与独立实现边界

## 本地对象与身份
扩展 ohfkhalfafkomanjkgghbdlcinhdpmko，版本 9.0.0，位于本机 Chrome 用户数据目录下的 `<user-data>\Default\Extensions\ohfkhalfafkomanjkgghbdlcinhdpmko\9.0.0_0`。

本轮直接读取 assets/main-D-b9QqDh.js 静态字节：932303 bytes，932186 Python Unicode codepoints，SHA256 `5608fd0a93d376454cf87a778871febb13dabdd47ca2f7e43fa335828f2ad26d`，末次复核一致。以下 char offset 是零起始 Python Unicode codepoint，byte offset 为零起始 UTF-8 字节，非 JS UTF-16。

前序研究：Manifest V3，React，popup/side panel 共用 index.html；background 负责右键图片与侧栏投递，image-picker 负责网页图片选择。未复制私有代码或资产。

## 静态图片调用链
前序静态调用点：POST /gallery 上传人物 file，取得 photo._id；POST /tryon/clothes 上传服装 file、photoId、category、可选 subcategory、origin=extension、可选 productUrl/regeneratedFrom；jobId 后 GET /status/{jobId}，成功读 tryon.imageUrl；GET /history/{id} 下载。未调用原私有服务，原静态模型未知。

本轮 /tryon/clothes 唯一字面调用 char668404/byte668457：

```js
const Pe=new FormData;
Pe.append("category",S),C&&Pe.append("subcategory",C),Pe.append("photoId",n._id),Pe.append("file",l),Pe.append("origin","extension"),p&&Pe.append("productUrl",p),typeof fe=="string"&&fe&&Pe.append("regeneratedFrom",fe);
const _t=await Qe.post("/tryon/clothes",Pe,{headers:{"Content-Type":"multipart/form-data"}}),wt=await q8(_t.data.jobId,7e3)
```

## 原试穿分类与商品过滤器不同
VF 定义 char542300/byte542315；UC 构造 char542929/byte542944：

```js
VF={clothing:["auto","tops","bottoms","dresses"],eyewear:[],footwear:[],headwear:[],jewelry:["rings","earrings","necklaces","bracelets","anklets"],accessories:["watches","belts","scarves","bags","gloves","ties"],others:[]}
UC=[{value:"auto",label:av.auto,subs:[]},...Object.entries(VF).filter(([e])=>e!=="others").map(([e,t])=>({value:e,label:av[e],subs:t.map(n=>({value:n,label:qF[n]}))}))]
fx="auto",px=null
```

| category / 显示名 | subcategory / 原显示名 |
| --- | --- |
| auto / Auto | 无；区别于 clothing/auto |
| clothing / Clothing | auto/Auto，tops/Tops，bottoms/Bottoms，dresses/Dresses |
| eyewear / Eyewear | 无 |
| footwear / Footwear | 无 |
| headwear / Headwear | 无 |
| jewelry / Jewelry | rings/Rings，earrings/Earrings，necklaces/Necklaces，bracelets/Bracelets，anklets/Anklets |
| accessories / Accessories | watches/Watches，belts/Belts，scarves/Scarves，bags/Bags，gloves/Gloves，ties/Ties |

others 存在于定义但被 UC 显式过滤。h6 选择器 char555611/byte555626：`d=(m,_)=>{n({category:m,subcategory:_||null}),s(!1)}`，二级项点击 `d(m.value,E.value)`，无二级项直接 `d(m.value,null)`。RU char664725/byte664778 初始化 `[S,k]=x.useState(fx),[C,T]=x.useState(px)`；char677867/byte677920附近调用 `h6` 的 onChange 是 `({category:fe,subcategory:Pe})=>{k(fe),T(Pe)}`，再由上述 S/C 提交。

`const mv=` char627750/byte627795 是商品搜索过滤 taxonomy，后接颜色/人群/季节等与 dR 商品查询参数，不是 UC 数据源。其 shirts、knitwear、jackets、jeans 等细项不能当作原试穿选择器证据。

## 提示词观察与未知
静态图片 sr 提交的 FormData 中没有 prompt/mask 字段或文字模板构造。不能据此断言整个扩展不存在提示词：全文不区分大小写字面 prompt 匹配93次，首次char791939/byte791992；negative_prompt 匹配0次仅是有界文本结果。

char791939..827208包含 Lucy 模型/SDK schema、setPrompt/sendPrompt/initialPrompt 与信令，SDK 包含不能证明静态图片实际模型。直播明确有 `oE=e=>({prompt:e.prompt,image:e.referenceImage,enhance:!!e.enhancePrompt})`（char870219/byte870280），开始/切换使用 oE(V)。准备函数 Wt 在char915200..917300向 /tryon/live/garment 上传 file 或 productId/wardrobeItemId/wishlistItemId，随后 spread `yn.garment`。由此可见服务端返回对象可携带直播 prompt/referenceImage/enhancePrompt；实际内容未取得。

原服务器分类到 prompt/分割/模型参数的映射、完整模板、负向提示、蒙版和运行效果均未知。未执行扩展、登录原站、调用私有网络或生成图片。

## REA 实际调用与限制
前序证据（本轮沿用引用）：

- 主 bundle 30秒分析超时的 partial evidence：`ev_b4e1e223d42cd7ce7ec0a42db0b6ae6d6c1d188474c7ed3c594a76794b555609`。
- manifest/background/image-picker 聚焦 evidence：`ev_b44c81b86f76ca5ced87da8ab34baf73e76e3cec5fc9cb47fdb9172ab50f6e57`；前序摘要2份JS、1818 AST节点、14未选文件、537未知，整体partial，不能证明主bundle或后台模型。

本轮已加载 canonical reverse-engineer-anything（metadata49），唯一变更重试 analyze_javascript_application：source_paths=["assets/main-D-b9QqDh.js"]、max_semantic_nodes_per_file=2000、max_semantic_unknowns_per_file=1000、analysis_timeout_ms=90000、detail=summary。

错误原文：`The MCP server rea couldn't run analyze_javascript_application: it didn't answer in 50s`。这是宿主等待截止，非返回provider_timeout；未取得新Evidence ID/graph/coverage，未重复调用，不能断言后台已停止。本轮分类/提示词证据为本地静态文本补证，不冒充REA成功解析。

OpenCLI拒绝chrome-extension://导航（HTTP/HTTPS限制），无原插件运行截图，不声称像素复刻。

## 当前独立实现与效果证据
本轮动态图片模型发现（当时通过本机 MCP 网关，现已换成 OpenAI 兼容的图片 API）取代旧 Decart/OpenAI 直接适配。tools/list 的 generate_image.model.enum 当前四项：codex/gpt-image-2、workbuddy/hunyuan-image-alpha、workbuddy-ai/hy-image-3.5、minimax-code/MiniMax-Image。generate_image 明确 model/prompt/reference_images=[人物dataURL,服装dataURL]；pending由generation_result查询。此协议不证明原扩展静态后端采用同一模型。

本项目仅保留已批准服装 tops/bottoms/dresses，语义对应原 clothing 二级项，不复制原 auto 与其他类别。buildPrompt 是本项目自建：分别限定替换上装/下装/连衣裙，保留非目标衣物、人物、鞋和背景，允许新服装自然轮廓。未恢复原服务器模板，不保证像素级保真。

主代理报告 GPT Image 2 苹果生成成功及双参考上装成功，红花衬衫替换后牛仔裤、白鞋、人物、背景在视觉语义上保留；MiniMax 苹果 502 失败。两混元、其他服装分类与样本未验证。文档代理未重发生成，不能声称四模型全可用。gateway.json 读取优先级已由主代理结合源码、测试与真实 /api/config 返回四项模型确认。

主代理随后通过正式本地 API 用同一合成人物与三件独立服装完成 tops/bottoms/dresses 真实生成：37.5/19.9/31.9 秒，均成功，逐张查看确认区域替换与人物保留；证据结论记在 progress.md，对比图因含模特照片已从仓库删除。该结果只代表 GPT Image 2 的本次样例，不证明其他模型或像素级保真。最终 node --test 22/22 通过；浏览器内上传受 OpenCLI Not allowed 限制，完整界面生成链仍未自动验收。本报告保留关键证据，不以被忽略的 artifacts 研究文件作为唯一来源。
