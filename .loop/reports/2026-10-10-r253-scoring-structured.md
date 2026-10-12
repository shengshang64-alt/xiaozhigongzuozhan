# R253 — 评分项 JSON Schema 结构化存储（易标 R-026 Slice1）

日期：2026-10-10 ｜ 轮次：R253 ｜ 优先级：P0 ｜ 选题来源：易标可复用能力分析 R-026（用户拍板：评分项改回 JSON 结构化存储，推翻 T12「弃 JSON」旧决策）

## 成果摘要
1. **新建 parseSchemas.ts**：定义 `ScoringItemJSON` / `ScoringBlockJSON`（kind/score_composition/declared_total/items），
   提供 `buildScoringStructured`（从整文 JSON 原对象构建结构化，丢弃缺名项）、`parseDeclaredTotal`
   （只抄「总分 N 分」原文声明值、禁止自算）、`scoringItemsFromStructured`（结构化 → 下游 ScoringItem[]，
   criteria 合并出处对齐行文本口径）、`selfCheckScoringTotal`（评分项合计 vs 声明总分的 schema 级自检）。
2. **structured 线程贯通**（useBidWorkspace）：T14 整文通道的 tech_score/biz_score 走 JSON 契约后，
   此前 `materializeWholeParseResult` 只摊平成行式文本落库、**丢弃结构**。本轮在保留摊平（下游
   extractScoringFromText/大纲/覆盖矩阵/评标零改动）的同时，把 JSON 原对象写入 `ParseSection.structured`。
   新增 `ParsePayload={text,structured?}` 承载，贯通 parseSectionViaRetrieval/WholeFile/Segments/
   materializeWholeParseResult/parseSectionItem → 批量落库 / 限流重试 / 空项自动重跑 / 单项重解析 4 个调用点。
3. **numberScoringItems 结构化优先 + 文本回退**（bidTypes）：`scoringItemsFromSection` 优先读
   section.structured（分值/出处不再依赖行正则），无结构时回退 `extractScoringFromText(sectionText)` —
   **老文本报告行为零变化**（关键向后兼容保证）。
4. **schema 自检并入 warnings**：批量解析对每个评分块跑 `selfCheckScoringTotal`，「合计≠声明总分」
   作为一条 warning 并入既有 warnings（随 finalReport 落库、刷新后横幅可恢复），复用既有链路零新机制。
5. **老数据 needs_reparse 标记**：`ParseReport.needs_reparse?` + `reportNeedsReparse(sections)`（有评分文本
   但无 structured = 17 个存量项目 / 检索通道产物）。`normalizeParseReport` 读出即重算标记；
   `finalReport` 落库时对缺结构的评分报告写 needs_reparse=true。纯结构化口径，不做双存回推。

## 关键决策 / 兼容性
- **零破坏**：新增字段全部可选；numberScoringItems 无 structured 时走原文本路径 → 存量 1800+ 用例与
  17 个老项目报告行为不变（vitest 全绿印证）；wholeParse.ts 提示词与 JSON 任务口径一字未改
  （promptsSnapshot 锁不受影响）。
- 环依赖规避：parseSchemas 仅 `import type { ScoringItem }`（类型擦除、无运行时环）；bidTypes 侧按结构
  类型内联读 structured、**不 import parseSchemas**。
- 本轮只做存储/读取/自检标记的**数据层落地**，UI 显式提示「建议整文重解析」与建阳区样例端到端回归
  留待 Slice5（R-026③ 同批）。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/pages/BidWorkspace/parseSchemas.ts | 新建：结构化类型 + buildScoringStructured/parseDeclaredTotal/scoringItemsFromStructured/selfCheckScoringTotal |
| src/pages/BidWorkspace/parseSchemas.test.ts | 新建：真实评分表 JSON → 结构化 → 编号 / 自检 / 老数据回退 场景自测（5 用例） |
| src/pages/BidWorkspace/bidTypes.ts | ParseSection.structured?、ParseReport.needs_reparse?、reportNeedsReparse、numberScoringItems 结构化优先、normalizeParseReport 保结构+重算标记 |
| src/pages/BidWorkspace/useBidWorkspace.ts | ParsePayload 线程 structured、materialize 建 structured、4 调用点透传、评分自检并入 warnings、finalReport 标 needs_reparse |

补丁脚本：scripts/r253_parse_schemas.py（20 处锚点全 count==1 断言一次通过；含 .bak-r253 前后对照复验 lint 计数零增）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| eslint | npx eslint（bidTypes/useBidWorkspace + 新 2 文件） | 新 2 文件 0 problem；bidTypes+useBidWorkspace 前后均 **7 errors / 13 warnings 计数一致**（全为在途 WIP 既有项：no-control-regex \\x00、setState-in-effect、Unused eslint-disable），本轮零新增 |
| vitest | npx vitest run | **156 files / 1839 passed / 2 skipped**（基线 155/1834，+1 文件 +5 用例均为本轮 parseSchemas.test.ts，全绿） |
| build | npx vite build | exit 0，built in 3.39s（chunk>500kB 为既有信息级提示） |

## 挂账（易标 R-026~R-032 标书解析层 P0 程序）
- **R-026③**：废标/评分条数下限报警 + 建阳区样例端到端回归（Slice5）。
- **R-028**：废标检查真三轮递进（voidCheckRounds 三轮提示词 + 编排 + invalidBid/rejectionItem 分类，用户已授权 3 次调用 AI 成本）。
- **R-029**：扫描件检测 parse_quality{is_scanned,text_ratio,warning} + UI 提示。
- **R-030**：ParseSectionDef.required 分级 + 解析失败阻断 + 必选/可选标识。
