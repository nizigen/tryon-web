# PoseWear 本地参考归档

归档和试穿预设分开维护。`data/posewear-archive/` 不在 `public/` 下，Git 忽略该目录；静态页面、订单 API 和图片生成服务不读取归档。不因文件已下载而开放成人模式或将姿势加入推荐。

来源是 [衣姿 PoseWear](https://posewear.pages.dev/) 的 `poses.2383bf449f.json` 快照。仅保存索引实际列出的姿势原图；不抓服装、人像和独立深度图库，也不把第三方原图库作为站点静态资源发布。

| 命令（在项目根运行） | 作用 |
| --- | --- |
| `node scripts/fetch-posewear-library.mjs --metadata` | 保存该版本索引，按完整系列 ID 区分重号，保留原站 18+ 标记、每个视角及其原图 URL。 |
| `node scripts/fetch-posewear-library.mjs --archive-pairs` | 只下载双人系列各视角到 `restricted/`，写 `pair-checksums.json`。 |
| `node scripts/fetch-posewear-library.mjs --archive-all` | 归档全部系列，在已有完整文件上续传，写 `checksums.json`。其余单人图在 `library/`，其中也含原站标为 18+ 的姿势。 |
| `node scripts/fetch-posewear-library.mjs --verify` | 不联网；逐图与全量清单比对 SHA-256、尺寸和字节数。入库完整性不是内容审核或启用许可。 |

归档清单默认只增不减：若新索引比旧清单少图，脚本会拒绝写入；确认要丢弃旧摘要时才附加 `--prune`。需要重新归档时先删除对应清单或显式 `--prune`。

六个原有公开预设仍由 `public/posewear/README.md` 记录。后续是否使用归档中的任一组，另行决定。
