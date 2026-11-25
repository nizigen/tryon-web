# ComfyUI 试穿 LoRA 接入与 4090 实验手册

当前已提供工作流图生成器、服务端适配器、设置入口和协议测试。尚未在租用的 4090 上出图；24GB 是否足够、延迟、身份保持和服装还原均待实测。此文不代表已经安装了这些模型或向云端部署。

## 选型与边界

基线为原版 **Qwen-Image-Edit + FoxBaze/Try_On_Qwen_Edit_Lora_Alpha**，不是 Qwen-Image-Edit-2509。作者模型卡明确提示五件及以上表现困难；本项目先按作者示例限定 **人物 + 1～3 件服装**，不宣称已经验证三件效果。普通图片 API 路径仍最多五件。

作者的方式是把人物放上方、服装从左到右拼在下方，再给单张合成图做编辑。对应图由 `src/comfy-workflow.mjs` 生成，网页的参考图编号会转换为合成图位置，不把多参考图 API 的编号直接塞进单图模型。

现成 LoRA 无需训练，也不加人脸 LoRA。原版模型与 LoRA 模型卡声明 Apache-2.0；ComfyUI 为 GPL-3.0，GGUF 节点为 Apache-2.0。仓库不分发模型权重；使用及再分发前仍须核对所下载文件的许可证。来源：

- [FoxBaze 模型卡与作者工作流，固定版本](https://huggingface.co/FoxBaze/Try_On_Qwen_Edit_Lora_Alpha/tree/9ddcc92b6d5e85804055d25d97e841f9b4dfc869)
- [Qwen-Image-Edit](https://huggingface.co/Qwen/Qwen-Image-Edit)
- [ComfyUI，核验源码版本](https://github.com/Comfy-Org/ComfyUI/tree/da8bd08e48deee74d9f6c3bc00aed365b00ec209)
- [ComfyUI-GGUF，核验源码版本](https://github.com/city96/ComfyUI-GGUF/tree/6ea2651e7df66d7585f6ffee804b20e92fb38b8a)

## GPU 实例需要准备的内容

先准备可信的 ComfyUI 实例和驱动环境。推荐先试 FP8；24GB 是待验证的实验配置，必要时改 GGUF 或选更大显存卡。不要用 2509 权重替代原版再把兼容当作已验证。

| 内容 | ComfyUI 目录 | 默认文件名 |
| --- | --- | --- |
| 原版编辑模型 FP8 | models/diffusion_models | qwen_image_edit_fp8_e4m3fn.safetensors |
| Qwen VL 文本编码器 FP8 | models/text_encoders | qwen_2.5_vl_7b_fp8_scaled.safetensors |
| Qwen VAE | models/vae | qwen_image_vae.safetensors |
| FoxBaze Alpha LoRA | models/loras | Try_On_Qwen_Edit_Lora.safetensors |

文件名是连接契约，可用服务端环境变量覆盖。节点和模型目录会在连接检查时核对 `/object_info`；不下载权重，也不因模型名存在就承诺出图成功。GGUF 选项只替换 diffusion loader，需事先安装 ComfyUI-GGUF 并自行选择匹配权重，**本 LoRA + GGUF 的兼容性尚未跑图验证**。

图使用核心 LoadImage、ImageStitch、ImageScale、ImageScaleToTotalPixels、VAEEncode、TextEncodeQwenImageEdit、UNETLoader、LoraLoaderModelOnly、ModelSamplingAuraFlow、CFGNorm、CLIPLoader、VAELoader、KSampler、VAEDecode、SaveImage；无需 KJNodes。GGUF 模式多一个 UnetLoaderGGUF。

## 连接到本地网页

不要直接向公网开放未认证的 ComfyUI。最简单的连接是通过你自己的 SSH 隧道把远端 8188 映射为本机端口（实例的 SSH 主机、用户名和端口由租用平台提供）：

```sh
ssh -N -L 8189:127.0.0.1:8188 <user>@<gpu-host> -p <ssh-port>
```

然后在项目已有 `.env` 里增补（不覆盖现有图片 API 配置；文件不入库）：

```ini
COMFYUI_BASE_URL=http://127.0.0.1:8189
COMFYUI_TIMEOUT_MS=900000
COMFYUI_UNET=qwen_image_edit_fp8_e4m3fn.safetensors
COMFYUI_CLIP=qwen_2.5_vl_7b_fp8_scaled.safetensors
COMFYUI_VAE=qwen_image_vae.safetensors
COMFYUI_LORA=Try_On_Qwen_Edit_Lora.safetensors
```

如使用带 Bearer 认证的 HTTPS 反向代理，可设置 `COMFYUI_API_KEY`。本适配器仅发送 Bearer 头，不处理云平台特有的登录页、cookie 或 WebSocket 网关；检查不通过时核对平台真实路由，不把网页登录页当 API 地址。密钥只留服务端。

只检查连接（不上传照片、不采样、仍会访问租用实例）：

```sh
node --env-file-if-exists=.env scripts/comfyui.mjs --check
```

未配置或不就绪会输出 JSON 并退出 1，就绪退出 0。导出可交给 ComfyUI API 使用的示例图（不是编辑器 UI 格式，输入名是占位名；不覆盖已有文件）：

```sh
node --env-file-if-exists=.env scripts/comfyui.mjs --export foxbaze-api.json
```

重启项目现有服务，再到「设置」选择「工作流 · Qwen 试穿 LoRA（实验）」并点击「检查工作流连接」。修改设置沿用原本的模型选择，不增加第二份引擎状态。下单前会再检查节点与模型目录。

## 实际出图验收顺序

1. 先用内置模特 + 一件干净正面商品图。普通图片模型与工作流共用工作台，选择衣服的「叠穿层次」：自动、内层、中层、外层。自动默认袜类在内，上衣/下装/连衣裙中层，外套/鞋/配饰外层；层次优先排序，同层按品类稳定排序，提示词与上传图顺序一致。
2. 点击生成。服务先在应用内完成数量、图片、工作流目录校验，再占位与创建订单；上传 → `/prompt` → 轮询自己的 `/history/{id}` → 仅取固定 `output` 节点 → `/view` → 本地结果。
3. 记录真实 `/history` 中输出尺寸、实际显存峰值与总用时。作者图以 832×1248 拉伸合成图，再做总像素缩放来建 latent，最终尺寸需实测，界面档位尺寸只是名义配置。
4. 单件通过后试三件，检查脸、身材、手、服装印花与层次；分别测内外层互换是否改变遮挡。鞋/袜/配饰精度没有单独验证，不能把整套覆盖视为已通过。
5. 验证断连/显存不足：应用订单应失败，无应用余额损失。工作流实验档应用价格为零，GPU 租金由平台单独收取；失败或超时不意味着云端停止计费。

采样基线遵循作者：steps=30、cfg=2.5、euler/simple、denoise=1、shift=3、CFGNorm=1、LoRA strength=1。**seed 固定用作者的 1088，不做随机化**：2026-11-24 在 RTX 4080 SUPER 上实测，seed=1088 的全部 8 次运行均正常试穿，而随机 seed（如 2099280733）会把结果塌缩成「原图 + 服装平铺」的拼图复刻。代价是同一组输入永远得到同一张图；alpha LoRA 稳定后再评估恢复随机 seed。

对齐句是敏感点：正向提示词第一行必须是作者原句 `Style the person in the top of the image, with every article of clothing on the bottom`（逐字，含 "on the bottom"）。实测把这一句改成 "in the bottom row" 会让模型输出双栏对比图、人物不换衣；正文里出现 "bottom row" 无害。`src/comfy-workflow.mjs` 有守卫测试锁住这句措辞。

「补充要求」的文字会被拼进正向提示词。实测规则：版型/穿搭类补充（如 "make the shirt fit slim"、中文「把下摆塞进裤子里」）结果干净；身份保持类补充（如「按人脸与身形保持人物一致」、"Keep the face and body shape unchanged"）会让原衣服袖口从新衣下露出残影——这类要求本来就被固定提示词覆盖，用户应避免在补充要求里重复。

## 照片与任务清理

普通图片 API 的本地不落人像规则不等于远端 ComfyUI 无存储。ComfyUI 会将上传文件保留在 input/，保存图在 output/，任务历史也可能保留提示词/文件名；本项目不自动删除共享实例中的文件。

默认等待 15 分钟。超时只请求从队列删除本次 prompt_id，**不会调用全局 `/interrupt`**（避免中断别人的任务）；若本任务已运行，远端可能继续执行。用 ComfyUI 界面核对自己的任务，再按租用平台方法清理自己上传的 `tryon-<uuid>-*` 和 `FoxBaze_TryOn*` 输出、对应 history；清理后再停机。不要在共享 GPU 上清空全局队列或删除别人的文件。
