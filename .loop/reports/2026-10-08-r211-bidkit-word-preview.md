# R211 报告 · R-004 标书 Word 式分页预览

**轮次**：R211（round 210 → 211）｜**优先级**：P0｜**模块**：/bid-workspace（投标文件编制）

## 需求
- **R-004**（需求记录 L66）：生成结果改为仿 Word 的分页视图——A4 版心、页边距、页眉页脚、页码、三级标题编号（1/1.1/1.1.1）、正文首行缩进 2 字符、图表居中带题注，支持翻页/滚动连续预览，打印/存 PDF 沿用现有纸张设置。
- **O-008**（L174）：现状正文被压到约 60% 宽、右侧常驻侧栏，层级与正文展示不全。

## 关键决策（Q-004）
Q-004 是开放项：仿 Word 要「尽量还原 Word 版式（含分页符/页码/页眉，需引入 docx 渲染）」还是「层级清晰、阅读舒服即可（纯前端 CSS）」。
依用户全权授权，取 **纯 CSS 仿 Word 分页预览**：
- 可交付、零新依赖、零后端改动；
- 直接命中 O-008 的核心痛点（版心宽度 / 排版观感 / 层级可读性）；
- 真·docx 逐页渲染（分页符精确断页）成本高且与既有「打印/存 PDF」通道职责重叠。
后续若需像素级 Word 分页，可在本组件的版心/样式契约上叠加 docx 渲染层，不影响本次接入点。

## 实现
1. **新建 `bidWordPreviewLogic.ts`**：纯逻辑助手 `ff`（中文字体→CSS family）、`pt`（中文字号经 `SIZE_PT`→磅）、`lineHeight`（1.5倍/2倍/固定值N磅）、`paperDims`（A4/A3/16K cm）、`chapterNumber`（titleNumbering：1.1.1→「N 」/ chapter→「第N章 」/ none→空）、`classify`（行→h3/h2/caption/p）。
2. **新建 `BidWordPreview.tsx`**：逐章渲染 A4 `<article>`（width/minHeight 按 paper、padding 按 margins cm），标题走 heading 层级样式，正文走 body（首行缩进 firstIndent em、justify、字号磅、行距），图/表+序号行居中题注，headerFooter 出页眉（项目名）、pageNumber/sealed 出页脚页码；连续滚动预览。
3. **`ComposeStep.tsx`**：新增 `wordPreviewOpen` 状态；在头部工具条「打印/存 PDF」按钮前加「Word 预览」`Button`（Eye 图标）；新增 `Dialog`（h-[92vh] w-[94vw]）承载 `<BidWordPreview format={p.effectiveFormatSettings} chapters={bid_chapters 展平} docTitle={project_name}/>`。
4. **不改动打印通道**：`PrintChapterFlow` 原样保留（守 R-009 导出/打印红线）；Word 预览仅 on-screen。

## 四门验证
| 门禁 | 结果 |
|---|---|
| `tsc -b` | EXIT=0，零类型错误 |
| `eslint`（触及 4 文件） | EXIT=0，零 error/warning（react-refresh 已通过抽取逻辑模块消除） |
| `vitest`（bid-workspace） | 5 files / 41 passed（新增 BidWordPreview.test.ts 10 例：classify/chapterNumber/paperDims/组件导出） |
| `vite build` | EXIT=0，built in 3.34s |

## 证据 / 未尽事项
- 单元级证据覆盖版心尺寸、编号、行分类等纯逻辑；on-screen 截图需一个「已生成正文」的真实项目在场，本轮以自动化验证为准，视觉走查留待有数据环境补拍。
- 后续可叠加分页符精确断页（当章内容超一页时按行数估算翻页），属增强项，不阻塞 R-004 达成。

## 影响文件
- 新增：`src/components/bid-workspace/BidWordPreview.tsx`、`bidWordPreviewLogic.ts`、`BidWordPreview.test.ts`
- 修改：`src/components/bid-workspace/ComposeStep.tsx`
