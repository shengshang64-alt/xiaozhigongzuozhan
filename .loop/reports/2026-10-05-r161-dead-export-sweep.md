# R161 死导出清偿与孤儿文件移除（闭环 r119-dead-export-mwip-defer）

日期：2026-10-05 | 类别：A 类（零 schema / 零 pb_hooks / 零提示词 / 零 AI 费用）| 未 commit

## 选题依据
- 用户提示词中的两个优先项经账本核实已在既往轮次关闭：quote-history-01 二期 R102 closed（r102-quote-history-phase2）、prompt-fabscan-03 残余切片 R103 closed（r103-chapter-audit-reflow）。
- 现役 open 实质项中，r119-dead-export-mwip-defer 账本 note_r156 明确：9 个所在文件 git 已全部 CLEAN，在途保护前提解除，「下轮可按 plan 做 BFS import-graph 复核后逐删」。本轮即按该 plan 执行清偿。

## 复核证据（删除前置条件）
1. src 全域符号扫描（tmp_r161_dead）：13 个死导出每个全 src 仅 1 处命中＝定义行本身，0 外部引用。
2. src 外全仓终验（tmp_r161_dead2）：仅 _qa/lint-before/after*.json（eslint 历史快照产物，非代码）提及；pb_hooks、server、scripts 零引用。
3. 级联分析（tmp_r161_casc/casc2）：uploadRefImage(单数) 仅被 uploadRefImages 消费；COMPARE_COLORS 唯一消费者是 compareColor；aigc.ts 的 triggerBlobDownload import 仅被 downloadAigcResult 使用；bidFiles.ts 的 displayStageLabel import 仅被 stageOf 使用。
4. CompetitorCharts.tsx：全 src 除自身外 0 引用（R118 编辑历史属既往在途，R156 起已 CLEAN）。

## 变更清单
| 文件 | 删除内容 |
|---|---|
| src/lib/aigc.ts | 9 死导出 + uploadRefImage + triggerBlobDownload import（-123 行，1190→1066） |
| src/lib/kbCore.ts | scoreKbDoc |
| src/lib/kbAssemble.ts | formatAssembleHits |
| src/lib/rhLogin.ts | openRhRechargeWindow |
| src/pages/BidWorkspace/bidFiles.ts | stageOf + 孤儿 import displayStageLabel |
| src/pages/Competitors/competitorScores.ts | compareColor、COMPARE_COLORS、saveScoreOverride + 头注释去掉「对比配色」（184→156） |
| src/pages/PptQuote/deckExports.ts | DOCX_TABLE_HEADER_FILL |
| src/pages/PptQuote/pptQuoteTypes.ts | DEFAULT_TAX_NOTE、parseMaterialRef |
| src/components/competitors/CompetitorCharts.tsx | 整文件 197 行 → .loop/trash_r161/（可回退） |

补丁脚本：d:/KFDXCX/MedPreSales/scripts/r161_dead_export_sweep.py（签名行唯一定位 assert、幂等重跑、删后全 src 终验 0 残留）。

## 四门验证
- tsc -b：exit 0（首轮暴露 bidFiles.ts displayStageLabel 孤儿 import TS6133，级联删除后过）。
- vitest run：96 文件全绿，1044 passed | 2 skipped（基线 1044+2skip 持平，本轮纯删除无新增用例，由既有用例背书零回归）。
- eslint 触及 8 文件：2 error 均在 aigc.ts L379/L719（no-useless-assignment 既有存量；本轮该文件 diff 块仅位于 L3 与 L966 之后，行未触碰），净新增 0。
- vite build：exit 0，4.00s（chunk>500kB 警告为既有）。

## 维持裁定
- 编造嫌疑未清零禁导出硬门禁：维持「只报告不拦截」，未触碰。
- lint-debt-01：bidTypes.ts 残余 5 项有意保留，未重构。
- 数据模型/PocketBase collection/pb_hooks：零改动。

## 挂账
- quote-history-3-mining（P3，需用户立项）；r130-price-preview-404（P3，pb_hooks 红线约束）；ui-redesign-phase3 视觉密度（P3 自然迭代收敛）。
- aigc.ts L379/L719 两处 no-useless-assignment：属 lint-debt 同类存量，未列入 r119 清单，留待后续轮顺手清。
## 浏览器实机验证
/competitors、/knowledge、/ppt-quote、/bid-workspace、/assistant 五路由逐页加载：console 0 error/0 warn；竞品页能力矩阵(六维评分+对比图+软著明细)、知识库(1424 份文档列表+三栏)、报价编辑器、标书工作台(项目流水线)、小智助手会话均正常渲染。截图：MedPreSales/.qoder/tmp/r161_proof_{competitors,knowledge,pptquote,bidworkspace,assistant}.png
