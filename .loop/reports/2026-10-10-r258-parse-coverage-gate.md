# R258 报告 — 长文档解析覆盖率可见性 + 生成门禁（全局优化汇总·第一优先 R-038③ Slice A）

日期：2026-10-10 ｜ 轮次：R258 ｜ 模块：标书工作台/BidWorkspace ｜ 优先级：P0（废标风险）

## 背景与缺口
《小智工作站-全局优化汇总》八份材料合并 40 条需求（R-001~R-040，13 个 P0），「三句话结论」第 1 条点名
**R-038 为最高优先（长文档不可用 / 漏废标条款即废标）**。侦查发现：
- 分片解析链路**已存在**（`parseSectionViaSegments` + `tenderSplit.splitTenderText`），非缺失；
- 真正的缺口在**上限与回落**：`WHOLE_FILE_LIMIT=60000`、`PARSE_SEGMENT_CHARS=45000`、`PARSE_MAX_SEGMENTS=6`、
  检索通道 `MAX_TENDER_CHARS=14000` —— 天坛 41.7 万字超段数上限后**回落检索**，仅读约 1.8 万字（覆盖率 **4.4%**）；
- 系统对「解析覆盖率极低」**完全无感知、无拦截**：用 4% 的信息生成标书，一旦漏掉否决/废标条款直接废标，却全程静默。

本轮先落**「可见 + 拦截」安全网**（R-038③ Slice A）：零成本、零迁移、不改解析链路，把静默风险转为显式门禁。
（提高段数上限 / 跨块评分废标汇总以真正拉高覆盖率，涉额外 AI 成本，作 Slice B 单独拍板。）

## 落地内容
1. **新建 `parseCoverage.ts`**（纯函数、零模型、零 DOM，可脱离浏览器单测；type-only import 避环依赖）：
   - 口径：**覆盖率 = 各解析项正文非空白字符合计 / 招标文件原文非空白字符**（严格对齐汇总文档 4.4%/10.7%/30.8% 实测口径）。
   - `parsedContentChars / parseCoverageRatio`（原文为空返回 null，超 1 截断到 1）。
   - `coverageLevel(ratio, sourceText)`：`block`（<30% **且原文非空白≥8000**）/ `warn`（<50%）/ `ok`；
     短原文精简输出占比天然偏低≠漏内容，故**阻断仅在原文足够大时生效**，防误伤。
   - `coveragePercent`（整数百分比）。
2. **`useBidWorkspace.ts` runGenerateOutline 生成前硬门禁**：覆盖率 `block` → `toast.error` + **return 阻止生成**，
   指引「完整档 / 分段覆盖全文 / 扫描件先 OCR」；`warn` → `toast.info` 告警但放行。插在既有 `hasBidComposition` 门禁之前，
   属**生成侧硬拦**（对齐汇总文档「<30% 阻止生成」，非导航锁）。
3. **`ParseReportPanel.tsx` 覆盖率可见**：`useMemo` 实时派生覆盖率（面板已有 `tenderText` prop）→
   - 顶部 `coverageBanner`（红=阻断 / 琥珀=偏低，附成因与补救指引），插在 `requiredFailuresBanner` 之后、`lotsChips` 之前；
   - 头部进度块新增「解析覆盖率 XX%（过低/偏低）」着色行（hover 释义=产出/原文字数）。

## 兼容与边界
- **零新增 ParseReport 字段**：覆盖率由 `report.sections` + `tenderText` 实时派生，天然免迁移、免 normalizeParseReport 改动。
- 阈值（告警 50% / 阻断 30% / 阻断原文下限 8000 字）取汇总文档明确口径；阻断只对「长文档」生效，短文件最多告警。
- 与 R-029 parse_quality（扫描件）、R-030 requiredWarn（必选失败）、R-026③ voidFloorWarn（废标偏少）四提示同屏叠加，互不重复。

## 四门禁（WIP 基线对照，全绿）
- `npx tsc -b` exit 0（首跑 TS6133 未用 `type CoverageLevel` 导入，已由 r258_fix_test.py 移除）。
- `npx eslint`：新 2 文件（parseCoverage.ts / .test.ts）0 problem；useBidWorkspace.ts + ParseReportPanel.tsx
  .bak-r258 前后均 **6 errors · 13 warnings**（计数一致 → 零新增在途既有问题）。
- `npx vitest run`：**161 files / 1863 passed / 2 skipped**（基线 160/1858，+1 文件 parseCoverage.test.ts +5 用例；
  首跑分级用例数学误——400/10000=4% 落 block 非 warn，已修正为 2000/4000/6000 三档）。
- `npx vite build` exit 0（3.32s）。

## 补丁
`scripts/r258_parse_coverage.py`（新建 2 文件 + useBidWorkspace 2 锚点 + ParseReportPanel 4 锚点，全部 count==1；改前 .bak-r258）；
`scripts/r258_fix_test.py`（重写测试：去 TS6133 导入 + 修正分级用例占比数学）。未 commit。

## 后续（同伞项 R-038 Slice B / 下一优先 R-039）
- **R-038 Slice B**：提高 `PARSE_MAX_SEGMENTS` 段数上限 + 跨块评分/废标条款汇总，真正把长文档覆盖率从 4.4% 拉高（涉额外 AI token 成本，需汇报后拍板）。
- **R-039**：mustWrite 落库 + 兜底自愈 + 大纲「必写」标识 + 存量重跑（判定链 judgeMustWrite/applyMustWrite 已在库，需验证持久化点与「批量重跑=白跑17次」的护栏）。
