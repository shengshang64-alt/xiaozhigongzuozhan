# R257 报告 — 废标条数下限报警 voidClauseFloor（易标 R-026③ Slice5，收尾）

日期：2026-10-10 ｜ 轮次：R257 ｜ 模块：标书工作台/BidWorkspace ｜ 优先级：P0

## 背景与缺口
易标《可复用能力分析》R-026 结构化解析含三项自检：① 评分项 JSON Schema、② 评分合计=声明总分（均 Slice1/R253 已落地
selfCheckScoringTotal）、③ **废标条款条数下限**。真实三甲医院招标文件几乎必含多条否决/废标条款（未密封、未盖章、超预算、
资质不符、串通投标……）。现状：若「无效标与废标项」解析项仅抽到 1~2 条，往往是漏解析（假阴），下游废标检查会漏判，但系统
不报警。真实缺口 = 无「废标条数下限」自检。

## 落地内容
1. **新建 `voidClauseFloor.ts`**（纯函数、零模型、零 DOM，可脱离浏览器单测）：
   - `splitVoidClauses(content)`：与 `runVoidCheck` **完全同口径**（`split(/\n+/)` + 去行首 `/^\d+[.、]\s*/` + 去空行）切条款行。
   - `voidClauseFloorWarning(content, floor = MIN_VOID_CLAUSES=3)`：解析到条款数在 1~(floor-1) 区间→返回人话报警（含条数与下限）；
     0 条 / 「原文未提及」/「〔系统降级」占位→返回 null（正常缺席不报，防误伤废标条款极少的小项目、不与既有失败提示重复）。
2. **`useBidWorkspace.ts`**：批量解析完成后对 `void_items` 解析结果做条数下限自检，命中则并入既有 `warnings`
   （→ 持久化横幅 + toast），与 Slice1 scoringSelfCheck / Slice3 parse_quality / Slice4 requiredWarn 同一 warnings 通道，
   零新增 ParseReport 字段（由 void_items 内容实时派生、天然免迁移）。

## 兼容与边界
- 「条数下限」只在「抽到了但明显偏少」时报警，与「解析失败(缺席)」正交：失败/缺席由 requiredParseFailures(必选项) 或解析降级提示覆盖，
  本自检不重复报。void_items 属可选解析项（parseSectionTier=optional），缺席不阻断，仅偏少才提示核对。
- 正则口径严格对齐 runVoidCheck，避免「同一份内容两处切出不同条数」的隐性偏差（全角括号 `3）` 等非 `[.、]` 编号不剥离，与生产一致）。

## 四门禁（WIP 基线对照，全绿）
- `npx tsc -b` exit 0。
- `npx eslint`：新 2 文件（voidClauseFloor.ts / .test.ts）0 problem；useBidWorkspace.ts .bak-r257 前后均 5 errors · 13 warnings
  （计数一致 → 零新增在途既有问题）。
- `npx vitest run`：160 files / 1858 passed / 2 skipped（基线 159/1854，+1 文件 voidClauseFloor.test.ts +4 用例均本轮）。
- `npx vite build` exit 0。

## 补丁
`scripts/r257_void_floor.py`（useBidWorkspace 3 锚点，全部 count==1；新建 2 文件；改前 .bak-r257）；
`scripts/r257_fix_test.py`（splitVoidClauses 用例对齐 runVoidCheck 正则口径）。未 commit。

## 伞项收口
bidkit-yibiao-parse-p0（易标 R-026~R-031）五个切片全部落地：Slice1 R-026 结构化存储(R253) / Slice2 R-028 废标三轮(R254) /
Slice3 R-029 扫描件检测(R255) / Slice4 R-030 required 分级(R256) / Slice5 R-026③ 废标条数下限(R257)。
