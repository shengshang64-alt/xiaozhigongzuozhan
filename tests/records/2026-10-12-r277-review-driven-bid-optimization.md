# 2026-10-12 r277 评审报告驱动投标链路优化（切片1-4 + 建阳P0修复）

## 背景
两份外部评审报告（建阳项目投标文件）诊断：A1 ★13 引文三处删节、A2 工期 180/240 矛盾、
A3 ▲项截图全占位；B 级客观项零证据仅复读评分标准；C 级 118 项笼统"完全满足"、Markdown 残留、
期号重复、占位符未填、日期倒签嫌疑。一句话诊断：缺三个内容维度检查器 + 闸门只验"检查做过"不验"结果干净"。

## 切片1 三个新本地检查器（零 AI）
- starClauseFidelity.ts：extractStarParagraphs（无上限原文条款段）/ normalizeFidelity /
  upgradeClausesWithTender（生成侧找回逐字全文）/ starQuoteFidelityHits（删节/漏引 → warn）。
  根因确诊：条款库入库截断（600字/4行）而非 LLM 改述。
- placeholderLedger.ts：交付前占位未填台账（章×形态聚合，签章下划线不误报）。
- formQualityHits.ts：Markdown 残留 / 期号连续（中文数字）/ 日期截止核对（倒签嫌疑）。
- 接线：useBidWorkspace buildFormatReportFor 统一装配；bidTypes FormatCheckRule +6 key。
- 真机：建阳实弹抓出 7 条真实删节（★13 与评审报告完全吻合）、10 处真实【待填写】。

## 切片2 工期时序 + 质量闸
- scheduleConsistencyHits：承诺面最短工期（月×30 平折）vs 计划面里程碑（T+N 日 / 第N个月终验），
  超承诺 → warn。建阳当前库零命中为真零（正文已按 180 天口径统一）。
- GATE_FATAL_RULES 6 条废标级黑名单；gateCondition("check")  fatal 计数>0 → 不满足（真机：17 条拦截）；
  处置=修复数据或既有强制放行留痕。markdown/编号/日期为形式项不进黑名单（防过度阻断）。

## 建阳 P0 数据修复
- 承诺函用保真管道浏览器内重生成：splitStarClauses(9条) → upgradeClausesWithTender(tender_text 10.5万字)
  → buildCommitmentLetter：3849→5161 字，★13 找回 382 字全文（含源码开放承诺），保真命中 7→0。
- read-modify-write 全套 bid_chapters 一次 PATCH + reload 防竞态；旧内容备份 localStorage。

## 切片3 逐项深度响应引擎
- clauseResponsePromptBlock（starClauseFidelity.ts 追加）：①招标原文找回逐字全文；②三要素硬约束
  （逐字复述→结论+偏离值→实现依据，篇幅与原文相称，拿不准【待填写】）；③证据挂载铁律（禁止复读评分标准）。
- 替换正文生成两处注入点（章级/小节级，gen_options.clause_response 开启生效）；
  老 starClausesPromptBlock（体检/废标检查）与 bidChapter.ts 快照锁字不动。
- 真机：建阳注入段 4474 字、9 条、has13full=true、空数据稳定空串。

## 切片4 评分策略建议卡 + 演示骨架
- scoringStrategyCard.ts（新，纯本地零 AI 零新字段）：
  scoringStrategySuggestions = 承诺维度库（质保/维保/时效/驻场）加分建议 + 客观项证据挂载提醒，≤8 条按分值降序；
  buildDemoSkeleton = 演示准备骨架（环境/脚本/录屏/问答/得分对照，环节一律【待填写】）。
- BidWorkspacePage：评分覆盖体检卡后追加「评分策略建议」details 卡 + 「一键插入演示准备骨架」按钮
  （useMemo 派生 + insertDemoSkeleton 幂等追加）。
- 真机（建阳）：按钮渲染「1 个演示节点」、点击后「功能演示组织与真实系统现场演示方案」章插入 239 字骨架，
  二次点击 occurrences=1（幂等）；建议卡零建议为正确负例——建阳正文已含延长质保/7×24 承诺、
  4 个客观项已有【待填写】挂载占位。

## 验证
- 四门每切片独立：tsc -b=0 / eslint 新文件 0 error（useBidWorkspace 存量 7 条基线对照零新增）/
  vitest 全仓 183 文件 2072 passed 2 skipped / vite build=0。
- promptsSnapshot 锁字测试 12 文件 156 用例全过（bidChapter 未动）。
- 控制台零错误。

## 发现问题（已在过程中修复）
1. 投(?:标文件)?截止 正则匹配不到「投标截止」→ 改 投标(?:文件)?截止。
2. 行中出现★的说明行误建条 → STAR_HEAD_RE 行首收紧。
3. 占位台账章×形态聚合语义与测试期望不一致 → 修期望并锁聚合文案。
4. 承诺函找回验证短语须逐字取自原文（「无条件开放源代码」≠原文「无条件开放本项目全部定制化源代码」）。

## 遗留
- 建阳「功能演示」章骨架已插入（239 字占位），演示脚本环节需售前线下填实后交卷。
- 10 处【待填写】证据/商务条件占位需人工挂载真实截图与材料（质量闸已拦截带病交卷）。
