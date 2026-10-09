# R213 报告 · R-008 售前素材库（本地优先 · PPT 配图打通）

**轮次**：R213（round 212 → 213）｜**优先级**：P0｜**模块**：/materials（新建）+ /ppt-quote（配图集成）

## 需求
- **R-008**（需求记录 L70 + PptQuote素材库-需求提示词全文）：新建「本地素材库」——本地/内部源素材入库（架构图/系统截图/现场照）、联网抓取落盘（Pixabay 中文直搜 + Pexels/Unsplash）、PPT 生成优先命中本地库、授权链强制留档。

## 关键决策（Q-013 存储选型，用户全权授权）
取「**路 B：PocketBase 集合存储**」，不建本地 materials/ 目录：
- PocketBase 摸不到宿主机任意路径，Vite dev 也没有文件读写接口（§七 Q-A 实测结论）；走集合与 ppt_decks 内嵌 base64 同一通道，导出 PPTX 天然内嵌（Q-B）。
- 记录按 `x_rh_user_id` 隔离（Q-C）；授权链以 `license + source_url` 字段留档（图库来源缺任一项后端 400 拒绝），替代目录版 licenses/ 快照。
- **双集合架构（r213 实测教训）**：JSVM 的 dbx Query 不支持 `.one()/.all()`（Go 侧 panic），count/统计只能 `findRecordsByFilter` 全量捞——会把整行含数 MB image_data 水合进 Goja。故原图拆到 `material_library_data`（单行单字段），`material_library` 只留元数据 + 400px 缩略图，列表/统计/计数只碰小集合。
- **大字段用 json 类型不用 text**：PB text 字段默认 max=5000 字符（实测 413 报错证实）；json 无此限（ppt_decks.slides 同款先例）。且 json 字段读取必须 `getString()` 后 `JSON.parse` 剥外层引号（`get()` 返回非字符串，实测）。

## 实现（新增 9 文件 / 修改 12 文件）
1. **后端** `pocketbase/pb_hooks/material_library.pb.js`（新建）：`material_library`（元数据+缩略图）+ `material_library_data`（原图）双集合 onBootstrap 建表；8 条路由——列表（分页/筛选/q 检索/mode=meta|thumbs + hasMore）、GET {id} 全量（拼回 image_data）、POST 入库（sha256 去重 / 图库授权链硬校验 / 6MB 上限 / 原图行写失败回滚元数据）、PATCH 元数据、usage+1、restore、DELETE（软删回收站，hard=1 连带原图行）、purge、stats 聚合。全部 handler 内联 helper（JSVM 独立 VM 纪律）、`x_rh_user_id` 401 契约与 format_templates 一致。
2. **页面** `src/pages/MaterialLibrary/`（新建四件套）：`materialTypes.ts`（类型/分类/来源标签）、`materialCore.ts`（文件名解析命名规范「来源_内容_日期」、sha256、Canvas 压缩+400px 缩略图、PPT 本地命中打分 matchMaterials）、`materialCore.test.ts`（15 用例）、`useMaterialLibrary.ts`（列表/统计/联网抓取入库/批量本地导入带进度可取消/内部源/回收站/导出索引）、`MaterialLibraryPage.tsx` + `index.tsx`（四 Tab：素材总览/联网抓取/本地导入/库设置；未配 Key 弱提示不崩；Pexels 条款 7B 禁 AI 生成内容 vs Pixabay 允许的差异在 UI 明示）。
3. **PPT 集成**：`imageSearch.ts` 新增 pixabay provider（中文直搜不翻词）+ CN2EN 补 25 个医疗信息化词（按词长降序替换，顺手修掉「互联网医院」被「医院」抢先替换的存量隐患）+ hits 带授权链字段（pageUrl/photographer/width/height）；`usePptQuote.ts` 素材库元数据缓存（ref+在飞 promise 防并发重拉）+ `tryAttachFromLibrary` 打分命中 + **searchAndAttachImage / runAutoFigure 取图顺序改为①素材库本地命中 → ②联网搜图 → ③AI 生图兜底**（需求提示词 §4）+ `attachImageFromLibrary`（原图 dataURL 内嵌 deck，usage+1）；`MaterialPickerDialog.tsx`（新建）选图弹窗；`SlideEditor.tsx`「素材库选图」按钮 + Pixabay 选项；`DeckEditorWorkspace.tsx` 工具栏「素材库」入口 + 弹窗接线；`NewDeckWizard.tsx` provider 加 Pixabay；`deckLint.ts` no_image 文案指向素材库。
4. **导航接线**：`App.tsx` /materials 懒加载路由、`routePreload.ts`、`SidebarNav.tsx`（制胜组「素材库」）、`WorkbenchShell/TopBarShell/useGlobalSearch/GlobalCommandPalette` 四处映射。

## 四门验证
| 门禁 | 结果 |
|---|---|
| `tsc -b` | EXIT=0，零类型错误 |
| `eslint`（触及 16 文件） | 新建文件 0 error；触及的存量文件（usePptQuote/imageSearch/SlideEditor/WorkbenchShell/useGlobalSearch）报错集与 HEAD 基线**逐条一致**（HEAD 副本对照法），零新增 |
| `vitest` | 134 files / **1599 passed**（基线 1584 + 新增 materialCore 15 例）/ 2 skipped |
| `vite build` | EXIT=0，built in 5.59s（chunk 体积 warning 为存量） |

## 实机验证（curl + 浏览器，PocketBase 重启加载新 hook）
- **API 层**：401 契约 ✓；入库（manual，中文名）✓；同 sha256 重复入库返回 duplicated:true+已有记录 ✓；图库来源缺 license/source_url 400 license_required ✓；GET {id} 拼回 image_data（解码 139109 字节=源文件，PNG 签名 ✓）；usage+1 ✓；软删→列表消失+回收站统计/视图可见→restore ✓；purge 空回收站 purged:0 ✓；stats 聚合（分类/来源/bytes）✓。
- **UI 层（1600×1000 实机截图）**：/materials 四 Tab 全渲染；左侧导航「素材库」入制胜组；统计卡/网格缩略图/详情弹窗（大图+编辑+授权链展示）正常；联网抓取未配 Key 显示提示不白屏；库设置 Key/内部源「未配置」态/导出/清空回收站齐备。
- **PPT 打通**：deck 编辑器工具栏「素材库」入口跳转 ✓；「素材库选图」弹窗网格/搜索/分类筛选 ✓；点击素材 → toast「已插入素材库图片」+ 配图区显示「来源：素材库 · …」+ 版式自动切图文 → usage=1 落库 ✓；随即「移除本页图片」+ SQL 重置 usage=0，用户 deck（安中医规划方案）**零残留**。
- **回归**：/bid-workspace（10 项目流水线正常）、/format-tool、/ 全部加载，控制台 error/unhandledrejection = 0。

## 诚实说明 / 未尽事项
- **存储形态与原提示词目录版不同**（Q-013 路 B）：无 materials/ 目录与磁盘目录扫描，「本地导入」= 浏览器多选文件批量入库（sha256 去重/压缩/缩略图等价保留）；「授权页快照」以 license+source_url 字段留档等价实现；missing:true 灰显概念不适用于库内存储，未实现。
- 内部源 http-list 走浏览器直连清单地址，跨域受限时 toast 明确提示「改走同源地址」（Q-014 地址未配置显示「未配置」，不阻塞）。
- Pixabay 检索需用户自配 Key（Q-015）；「万张图量级」未实测（单用户软上限 10000 条，分页 60/页懒加载）；三张种子素材（医院走廊/HIS 架构图/智慧病房截图，均项目内截图）留在库中供用户体验，可自行删除。
- 需求文档中的 R-001~R-007/R-009 已由 r203~r212 各轮落地（本轮核对代码+实机确认在位），本轮仅实现 R-008。

## 影响文件
- 新增：`pocketbase/pb_hooks/material_library.pb.js`、`src/pages/MaterialLibrary/`（materialTypes/materialCore/materialCore.test/useMaterialLibrary/MaterialLibraryPage/index）、`src/components/ppt-quote/MaterialPickerDialog.tsx`
- 修改：`src/pages/PptQuote/{imageSearch,usePptQuote,deckLint}.ts`、`src/pages/PptQuote/PptQuotePage.tsx`、`src/components/ppt-quote/{SlideEditor,DeckEditorWorkspace,NewDeckWizard}.tsx`、`src/App.tsx`、`src/lib/routePreload.ts`、`src/components/shell/{SidebarNav,WorkbenchShell,TopBarShell,useGlobalSearch,GlobalCommandPalette}.tsx`
