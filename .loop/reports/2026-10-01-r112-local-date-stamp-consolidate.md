# R112 全站本地日期戳单一来源 + 修正 UTC 时区缺陷

日期：2026-10-01　轮次：R112　类型：A 类（代码重构/缺陷修复，非提示词、非数据模型）

## 背景与选题
承接 R105（错误码中文表）、R106（唯一 buildCsv）、R108（relativeTime）、R109（pbJson）、
R110（download.ts）、R111（clipboard）的「单一来源收敛」主线，脚本扫描全站日期产出，坐实
一个真实缺陷 + 一处重复实现：

### 问题 1（真实缺陷）：UTC 日期戳导致跨零点少一天
全站 12 处 `new Date().toISOString().slice(0, 10)`：
- 10 处导出文件名日期戳（方案/知识库文档/客户/报价/PPT/问答弹药/投标项目/竞品对比列表 CSV，
  售前周报 docx，资质台账 CSV）
- 2 处写入用户可见内容并回写 PocketBase：ChatStream 写入竞品 `threat_notes` 的
  「【AI 深度分析 YYYY-MM-DD】」、写入标书项目 `ref_materials_text` 的「【招标要点梳理 YYYY-MM-DD】」

`toISOString()` 序列化为 UTC。本机部署于中国（UTC+8），凡在本地 00:00–07:59 之间导出/写入，
文件名日期与内容日期戳都会变成**前一天**——用户可见的跨天错一天。

### 问题 2（重复实现）：各写各的本地 YYYY-MM-DD / YYYYMMDD
5 处内联手写本地日期格式化（KanbanBoard、OpportunityDetailPanel 的「今天」IIFE，
DocListPanel formatTime 的 afterDay 分支，intelExports 的紧凑 YYYYMMDD，QaGapPanel 的日期+时分）。

## 方案
新增唯一入口 `src/lib/dateStamp.ts`：
- `localDateStamp(d = new Date()): string` → 本地 `YYYY-MM-DD`
- `localDateCompact(d = new Date()): string` → 本地 `YYYYMMDD`

收敛落地（共 11 文件）：
- 9 处导出文件名 + 2 处内容戳的 UTC 调用 → `localDateStamp()`（修复时区缺陷）
- DocListPanel formatTime 内联 `YYYY-MM-DD` → `localDateStamp(d)`（完全等价）
- KanbanBoard / OpportunityDetailPanel「今天」IIFE → `localDateStamp()`（完全等价）
- intelExports 紧凑 `YYYYMMDD`（并删随之失效的局部 pad）→ `localDateCompact(now)`

## 有意绕开 / 不做（记录）
- **QualCertsPage.tsx 的 1 处文件名 UTC 站点未改**：该文件为 R88 之后新增（git 未跟踪），
  R94 报告证实含用户未提交在途改动（qualAlertCount 等）。按「命中在途新功能则绕开并记录」，
  本轮不动，留待该功能收口后统一清扫（届时替换为 `localDateStamp()` 即可）。
- **QaGapPanel.tsx 未纳入**：其产出为 `YYYY-MM-DD HH:MM`（含时分），属日期+时间另一维度，
  不并入纯日期戳单一来源，避免功能外溢。
- 维持既有裁定：不动提示词（非 B 类）、零 collection / 零 pb_hooks / 零数据模型、
  编造嫌疑硬门禁「只报不拦」、lint-debt-01 残余不重构。

## 四道门禁（目标项目目录）
- `npx tsc -b`：exit 0，零错误
- `npx vitest run`：696 passed / 2 skipped（基线 R111 692 passed，增量 +4＝dateStamp.test.ts）
- `npx eslint <14 触及文件>`：exit 0，零 error
- `npx vite build`：exit 0（3.21s）

## 用户可感知结果
UTC+8 用户在任意时刻导出，文件名日期与写回竞品/标书内容的日期戳均为**当天本地日期**，
不再出现凌晨导出少一天。列表/看板「今天」判定、情报导出紧凑文件名行为逐字不变（等价重构）。
