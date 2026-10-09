# R156 方案侧断点续跑内联横幅 + defer-on-WIP 三项清偿（2026-10-05）

## 选题依据
- 用户点名两优先项经账本核实均已 closed：quote-history-01 二期（R102 r102-quote-history-phase2）、prompt-fabscan-03 残余「按章聚合回注」（R103 r103-chapter-audit-reflow）。
- 勘察发现 4 个 defer-on-WIP 挂账项锚点文件已全部 git CLEAN（用户已提交在途改动）：
  QualCertsPage / ComposeStep / FolderTree / r119 清单 9 文件 —— 具备集中清偿条件。
- 方案主链路实质项 r148-solution-resume-banner-defer（EditorWorkspace 内联恢复横幅，对齐标书 ComposeStep D1）按既定 plan 落地。

## 变更明细
### 1) 断点续跑内联横幅（旗舰项，方案编制域）
- `src/pages/SolutionStudio/bulkResume.ts`：新增纯函数 `resumeBannerVisible(done, total, bulkGenerating)`，
  口径 = `!bulkGenerating && bulkResumeNotice(done, total) !== null`（有文案即有横幅，与打开方案 toast 同源，不漂移）。
- `src/components/solution-studio/EditorWorkspace.tsx`：header 下方挂 warning 版式横幅（与标书 D1 同 token：
  `border-warning/40 bg-warning/10`），文案 `bulkResumeNotice(...)` + `（已生成 X/Y 章）`，
  按钮「继续生成正文」直调 `p.startBulkGenerate`（runBulkGenerate 天然 skip done 章，零重复付费）。
  批量进行中不显示（由既有进度条播报）；零 done / 全 done 不显示。
- `src/pages/SolutionStudio/bulkResume.test.ts`：+5 用例——可见性 3（部分/批量中/边界零全空）、
  文案含「继续生成正文」指引 1、EditorWorkspace 接线源码防回流哨兵 1。

### 2) defer-on-WIP 清偿（在途改动提交后解锁）
- r112：`QualCertsPage.tsx` 导出文件名 `new Date().toISOString().slice(0,10)` → `localDateStamp()`；
  全站真实 UTC 日期戳站点清零（R112 收敛工程最后一片）。
- r118：`ComposeStep.tsx` 「已载 N 字」裸 `toLocaleString()` → `formatCount()`（@/lib/money 单一口径）。
- r136：`FolderTree.tsx` 树节点展开 toggle 补 `aria-expanded={expanded}`（WCAG 4.1.2）；
  `disclosureA11y.test.ts` 将其并入 SITES 五站点哨兵，撤「暂不纳入」临时用例，头注补解除记录。

### 3) 附带复核（不改代码）
- r119 死导出清单 9 文件（aigc.ts / kbCore.ts / kbAssemble.ts / rhLogin.ts / bidFiles.ts /
  competitorScores.ts / deckExports.ts / pptQuoteTypes.ts / CompetitorCharts.tsx）git status 全部 CLEAN，
  在途保护前提解除；账本记 note，删除动作留待专项轮按 BFS import-graph 复核后逐删（本轮不混做，控制爆炸半径）。

## 四门验证
| 门禁 | 结果 |
|---|---|
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 95 files，1022 passed / 2 skipped（基线 1017+2，+5 全为本轮新增，零回退） |
| npx eslint 触及 7 文件 | exit 0，输出为空（0 error 0 warning） |
| npx vite build | exit 0，3.59s（chunk >500kB 告警为既有基线，与本轮无关） |

## 红线与裁定遵守
- 跨工作区改动全部经 `d:\KFDXCX\MedPreSales\scripts\r156_solution_resume_banner.py` Python 补丁落地，
  每个 str.replace 前 assert 锚点唯一（count==1），按文件主换行风格（CRLF/LF 混合逐一探测）保真回写。
- 补丁前 7 触及文件逐一 git status 复核 CLEAN，无在途 WIP hunk 误伤。
- 零 collection / 零 pb_hooks / 零提示词改动（非 B 类，无 PROMPT_VERSION 变更）/ 未 git commit。
- 维持裁定不动：编造嫌疑未清零导出「只报告不拦截」（R89）、lint-debt-01 残余有意保留不重构。

## 遗留
- r119 死导出删除：前提已解除，专项轮执行。
- r149-deck-pagecount-unenforced（P2·PPT 侧）仍 open，为下轮标书/方案项之外的最高优先级候选。
- r147-native-confirm-dialog-01（竞品采纳确认弹窗组件化）仍 open。
