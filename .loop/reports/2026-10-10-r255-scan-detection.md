# R255 报告 — 扫描件/图片型文档检测 parse_quality + UI 提示（易标 R-029 Slice3）

日期：2026-10-10 ｜ 轮次：R255 ｜ 模块：标书工作台/BidWorkspace ｜ 优先级：P0

## 背景与缺口
易标《可复用能力分析》R-029 要求招标文件导入时对「扫描件/图片型 PDF」做质量检测，避免用户在文字层缺失的
文件上盲跑解析、得到残缺结果。现状：6 个导入点仅 `if (!text)` 拦全空文本——扫描版 PDF 常带零星文字（页码/页眉），
绕过该判空，导致后续解析大面积 miss，用户不知其所以然。真实缺口 = 无「提取质量分级」、无 OCR/粘贴指引、报告无持久提示。

## 落地内容
1. **新建 `parseQuality.ts`**（纯函数、零模型、零 DOM，可脱离浏览器单测）：
   `assessTenderParseQuality(text, { bytes? })` → `{ level: "ok"|"low"|"suspect_scanned", reason, hint }`。
   判据（阈值集中便于调参）：非空字符数 len=0 或 <30 → suspect_scanned；文件 ≥200KB 且 len/bytes<0.02（文字层密度极低）
   → suspect_scanned（图片型）；30≤len<200 → low；否则 ok。scan/low 各带中文指引（OCR 转文字 / 粘贴文本导入）。
2. **`bidTypes.ts`**：新增 `TenderParseQuality` 联合类型（与 ParseReport 同处，单一真源）、`asTenderQuality` 安全收窄；
   `ParseReport.parse_quality?`（PocketBase JSON 字段，零 schema 迁移）；`normalizeParseReport` 读出即保留 parse_quality
   （沿用 Slice1 needs_reparse 的 withMeta 范式，老数据无字段不受影响、ok 不写键）。
3. **`useBidWorkspace.ts`**：招标文件导入 `handleTenderFile` 与外部投标文件 `handleBidExternalFile` 的 `if (!text)` 粗判
   升级为 `assessTenderParseQuality(text, { bytes: file.size })`——suspect_scanned 红字阻断并返回、low 琥珀警告但继续；
   批量解析 finalReport 落 `parse_quality`（文本口径，供刷新后横幅恢复）。
4. **`ParseReportPanel.tsx`**：报告顶部新增解析质量横幅（suspect_scanned 红 / low 琥珀），复用既有 warningBanner 位置与
   配色范式，提示「OCR/粘贴文本重导 + 核对关键分区」。

## 兼容与边界
- 类型单一真源在 bidTypes，parseQuality 仅 type-only 依赖（运行时零边），无环依赖。
- 6 个导入点中重点改造招标文件主通道与外部投标文件两处（R-029 语义核心）；范本/资料/知识库/快捷工具通道沿用既有 !text 判空，
  未纳入本轮以控范围（可后续统一到同款守卫）。
- suspect_scanned 阻断避免在残缺文本上浪费解析 AI 费用；low 不阻断（尊重可能有效的短文件）。

## 四门禁（WIP 基线对照，全绿）
- `npx tsc -b` exit 0。
- `npx eslint`：新 2 文件（parseQuality.ts / .test.ts）0 problem；bidTypes.ts + useBidWorkspace.ts + ParseReportPanel.tsx
  .bak-r255 前后均 8 errors · 13 warnings（计数一致 → 零新增在途既有问题）。
- `npx vitest run`：158 files / 1850 passed / 2 skipped（基线 157/1844，+1 文件 parseQuality.test.ts +6 用例均本轮）。
- `npx vite build` exit 0（3.16s）。

## 补丁
`scripts/r255_parse_quality.py`（bidTypes 2 + useBidWorkspace 4 + ParseReportPanel 2 锚点，全部 count==1；
新建 2 文件；改前 .bak-r255）。未 commit。

## 后续
Slice4（R-030 required 分级阻断）、Slice5（R-026③ 条数下限报警 + 建阳区样例端到端回归，含 needs_reparse/parse_quality UI 复核）待做。
