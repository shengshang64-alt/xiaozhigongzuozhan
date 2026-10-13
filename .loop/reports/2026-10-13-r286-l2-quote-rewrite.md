# R286 · 标书 L2 逐字审计第一刀：引文级改写核对（bid-l2-verbatim-compare 切片1）

日期：2026-10-13 · 执行：Qoder 自主轮 · 优先级：P0 伞项首切片

## 选题依据
- 指派候选 `quote-history-01`（账本核验：R102 二期已 closed「全链路交付完成」）与
  `prompt-fabscan-03`（R103 已 closed，「按章聚合回注」即 r103-chapter-audit-reflow）均已收口，不再重复。
- 用户 2026-10-13 总指令「报价先不管，先把业务跑通，特别是标书，重点中的重点」→ 转 P0
  `bid-l2-verbatim-compare`（零折扣铁律 2/3/4：改写/编造/漏答三类硬指标）。
- 现状盘点：漏答有 ★ 条款正文核对（complianceCoverage R195）、条款级保真有 R277
  starQuoteFidelityHits（只管 ★/▲ 条款引用面）、编造有 consistencyGuard AI 复核轨（存量仅 1 项目跑过）；
  **引文级改写（正文其它位置直接引语 vs 招标原文）是空白**——本刀补上。

## 变更
| 文件 | 变更 |
| --- | --- |
| src/pages/BidWorkspace/quoteFidelity.ts | 新增：quoteRewriteHits 引文级改写核对（本地零 AI） |
| src/pages/BidWorkspace/quoteFidelity.test.ts | 新增：10 例单测 |
| src/pages/BidWorkspace/bidTypes.ts | FormatCheckRule 联合 + FORMAT_RULE_LABEL 注册 `quote_rewrite`（+2 行） |
| src/pages/BidWorkspace/useBidWorkspace.ts | buildFormatReportFor 接线（随交卷体检白拿，+4 行） |
| scripts/bid-l2-verbatim-scan.mjs | 新增：全库 L2 三类硬指标摸底脚本（只读零 AI，node:sqlite） |

判据设计（保守、只报不拦）：只核对「疑似引自招标文件」的引号——引号前 24 字内有提示词
（要求/规定/招标文件/评分办法…）或引号 ★▲ 起头；归一长度 ≥14；`normalizeFidelity` 与 R277
同一把尺子（空白/半角标点/括号差异不算改写）；命中带「原文该处」定位；跨章去重、封顶 16 条；
tender_text 缺失＝无基准静默跳过。**不进 GATE_FATAL_RULES**：引号内未必真是原文，误报由人核对，
与「只报告不拦截」维持裁定一致。零 schema / 零 collection / 零提示词改动。

## 真实数据 L2 摸底（scripts/bid-l2-verbatim-scan.mjs，19 项目 / 有正文 11 个）
| 口径 | 全库合计（有正文项目） |
| --- | --- |
| 改写·引文级（本轮新刀） | **34** 处 |
| 改写·条款级（R277 存量体检） | 0 |
| 漏答·★未逐字引用 | **76** 条 |
| 编造（AI 复核存量） | 仅贵港项目 1 条命中，其余项目「未复核」 |

典型：建阳（正文 11.1 万字）改写 2 / 漏答 9；「13」项目改写 19（正文 15 万字）；
三明市中西医结合医院（招标 52,631 字）改写 1 / 漏答 4/4 / 正文 4.5 万字。
漏答大头在未写齐章节（如贵港 28 条但 0 正文不参与合计口径已扣除）与设备参数表条款。
结论：**「改写=0/漏答=0」距达标仍有实差**，本 P0 伞项保持 open，后续切片=生成侧改写抑制、
漏答清零推进、编造 AI 复核轨全量铺开。

## 四门验证
- `npx tsc -b` exit 0
- `npx vitest run` 194 files / **2219 passed + 2 skipped**（基线 2209+2，增量 +10）
- `npx eslint`（quoteFidelity.ts/.test.ts、bidTypes.ts、useBidWorkspace.ts、mjs）：**20 problems (7 errors/13 warnings)
  与 HEAD 基线逐条同数同形**（基线=git show HEAD 导出 lintbase 对照后已删）；本轮触及文件零新增 error；
  7 error 全为既有裁定项（bidTypes no-control-regex 2 = lint-debt-01 有意保留；useBidWorkspace set-state-in-effect 4 +
  unused-assign 1 = 存量）。quoteFidelity 两文件与 mjs 自身零问题。
- `npx vite build` exit 0（5.6s）

## 在途避让
git status 显示 ppt-quote 六文件 + ledger 为用户/上轮在途未提交（R285 折扣改动），本轮全部锚点落在
BidWorkspace 链路与新建文件，未触碰在途文件。禁止 commit 裁定维持，未提交任何内容。
