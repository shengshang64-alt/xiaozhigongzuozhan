# R270 · 标书检查五期 · 标注版 docx（Word 批注引擎）导出

## 选题依据
延续 R266/R267/R268/R269 的 BidCheck 中枢期次链：`r261-bidcheck-followons` 伞项里明确写「五期 标注版 docx（Word 批注引擎）+ PB 集合 anbid_checks + 分工流转」。
本轮挑出其中的「标注版 docx」子项：PB 集合 / 分工流转触发数据模型改动（零 collection 原则），按裁定不做；
标注版 docx 是纯前端产物、且是**用户从三栏阅读视图带走检查结论到手边 Word 里的最短路径**（Word 审阅面板逐条看批注、原文定位、不改动任何原文件）。
其他 open 项：`quote-history-01` 已 done、`prompt-fabscan-03` 已 closed（objective 点名的两项均已闭合），`lint-debt-01`/`bidkit-global-opt-p0`/`ui-redesign-phase3` 按裁定或伞项性质不动，其他 P3 无实质增量。

## 设计
- **导出四件套**：Excel 整改清单 / HTML 只读归档 / **标注版 Word（新增）** / 三栏阅读视图（本地）；`exportAnnotatedDocx` 与既有 `exportChecklistToExcel`/`exportHtmlReport` 平级同层。
- **批注锚点**：`CheckHit.paragraphIndex` 是 R262 三栏中栏已解析的定位锚点（元数据/包级命中无该字段）。
  有锚点的命中挂 Word `CommentRangeStart/End` 到 `result.paragraphs[idx]` 对应段落，`CommentReference` 挂在段末；
  无锚点的（`docProps/core.xml` 类）走尾章「无正文定位命中」清单，**不丢条**。
- **批注正文五要素齐全**（与 Excel/HTML 口径对齐）：编号+标题 / 级别+严重度+状态 / 原文 / 依据（+ 命中依据当二者不同时） / 建议。
  建议段落用 `#2A7D5A` 色文本呈现，Word 右侧批注气泡一眼可辨。
- **正文重建**：`result.paragraphs`（三栏中栏同源）逐段落 docx；`heading=true` 段用 `HeadingLevel.HEADING_2`。封面 5 段元信息 + 一条只读说明。
- **id 分配**：全局 0..N-1 递增、按 items 原序 → hits 原序；批注数 = fail/warn 命中总数（一命中一批注），pass/unconfigured/skipped 不入。
- **门禁一致**：ReadingView 顶部按钮组加「标注版 Word」，与 Excel/HTML 同享 `hardFatal` 置灰 / `blocked` 二次确认（`doExport("docx")` 走异步 `void exportAnnotatedDocx(result)`）。

## 依赖核查
- 直接依赖：`docx@^9.7.1`（已在 bidFiles.ts 用于标书 Word 生成，无新增第三方）。
- docx v9 的 Comments API 完整可用：`Document({ comments: { children: [{ id, author, initials, date, children: Paragraph[] }] }, sections })`；
  `CommentRangeStart/End/CommentReference` 为 `ParagraphChild`，可塞进 `Paragraph.children`。
- Node Buffer → Blob：`buf.buffer` 在 TS 严格模式下是 `ArrayBufferLike`（含 SharedArrayBuffer），不匹配 `BlobPart`。
  走 `new Uint8Array(buf.byteLength)` + `bytes.set(buf)` 让 TS 推 `Uint8Array<ArrayBuffer>`（新分配、非共享），一次通过四门。

## 变更文件
- 新增 `src/pages/BidCheck/report/toAnnotatedDocx.ts`：
  - `collectCommentEntries(result): CommentEntry[]` — 从 items 抽 fail/warn 命中，赋 id、拆锚定/无锚。
  - `buildAnnotatedDocx(result): Document` — 组装封面段+正文段+尾章清单+comments.children。
  - `buildAnnotatedDocxBlob(result): Promise<Blob>` — Packer.toBuffer → Uint8Array → Blob（正确 MIME）。
  - `exportAnnotatedDocx(result): Promise<void>` — 触发下载（复用 `buildSafeFileName`/`triggerBlobDownload`）。
- 新增 `src/pages/BidCheck/report/toAnnotatedDocx.test.ts`：8 用例
  - collectCommentEntries：pass/unconfigured/skipped 不入；空 items 空数组；fail 但 hits=[] 不入；id 单调不重。
  - buildAnnotatedDocx：有正文锚点/无锚点/零命中三种构造均成功。
  - Blob：正确 MIME + `PK\x03\x04` zip 头 + 长度 > 500；零命中仍产合法 zip。
- 改 `src/pages/BidCheck/ReadingView.tsx`：Props 加 `onExportDocx`；destructure；导出条 HTML 按钮后加「标注版 Word」按钮 + `MessageSquareText` 图标。
- 改 `src/pages/BidCheck/BidCheckPage.tsx`：
  - `pendingExport` 联合类型扩至 `"excel" | "html" | "docx"`；
  - `doExport(kind)` 增 `else void exportAnnotatedDocx(result)` 分支；
  - `tryExport(kind)` 类型同步扩；
  - 副标题文案「三件套」→「四件套」。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0。
- `npx vitest run`：**174 files passed / 1955 passed + 2 skipped**（R269 基线 173/1947+2 → 新增 1 个 test 文件 / +8 用例）。
- `npx eslint` 触及 4 文件：exit 0，零 error/warn。
- `npx vite build`：成功，built in 3.91s。

## 数据模型 / 提示词
零 PocketBase collection schema 变更、零 pb_hooks 变更、零提示词改动（未触 B 类流程）。
产物为一次性 Blob，不入库、不入 localStorage。

## 维持裁定不动
- 「编造嫌疑未清零禁止导出」硬门禁仍**只报不拦**：本轮新按钮沿用既有 `hardFatal`/`blocked` 门禁逻辑，未加任何新拦截条件。
- `lint-debt-01` 有意保留残余不重构。

## 挂账
- `r261-bidcheck-followons` 伞项剩余：L5-D 语义 AI 类（会破「纯规则零 AI」口径，需产品决策）+ PB 集合 anbid_checks + 分工流转（触发数据模型改动）。伞项仍 open。
- 端到端复核：真实投标 docx 上传 → 检查 → 导出标注版 → Word 打开审阅面板，待真项目场景补测（本地无上传原文；vitest 已验构造与 zip 头）。
- 段落保真度：当前正文用纯文本重建，未保留原文档字号/字体/表格结构（Word 批注是核心目的，正文只作锚点载体；深度格式保留需另立期次）。
