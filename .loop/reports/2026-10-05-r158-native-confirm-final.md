# R158 全站末位原生 window.confirm 收敛（闭环 r147-native-confirm-dialog-01）

日期：2026-10-05 · 类型：A 类（零 schema / 零 pb_hooks / 零提示词改动，PROMPT_VERSION 不变）· 未 commit

## 选题依据
- 用户点名的两优先项 quote-history-01、prompt-fabscan-03 在账本中均已 closed（R102/R103/R131 收口），无可选空间。
- open 项中择优 r147-native-confirm-dialog-01（P3）：R147 已挂账并给出既定方案（仿 SkillsPanel/MemoryPanel 接 ConfirmDialog），
  且这是全站**最后一处**原生 window.confirm——收敛后原生确认对话框真实调用清零，属交互一致性的收口项而非零风险文案小改。
- 目标三文件（useCompetitorAnalysis.ts / CompetitorsPage.tsx / useCompetitorAnalysis.test.ts）补丁前 git CLEAN，
  与用户全部在途 WIP（PptQuote/SolutionStudio/BidWorkspace/QualCerts 等）零交集，无误伤风险。

## 变更内容
### src/pages/Competitors/useCompetitorAnalysis.ts
- 新增导出纯函数 `suggestionsNeedingConfirm(accepted)`：需二次确认 = 无 evidence_refs 且 confidence !== "low"
  （与原 window.confirm 判据逐字一致，防降级未生效的语义不变）；hook 挂起判定与页面计数共用这一处单一真源。
- `applyUpdates` 拆双层：
  - `commitApply`：原白名单过滤 + `updateCompetitor` 写回 + toast，R145 纵深防御注释与逻辑逐字保留；
  - `applyUpdates`：空批次直接返回；命中确认判据则把 `{rowId, accepted}` 挂起进 `pendingApply` state 并返回（不再弹原生框）；
    否则直接 `commitApply`。
- 新增 `confirmApply`（提交挂起批次并清空 state）/ `cancelApply`（丢弃挂起）/ `pendingNoEvidenceCount`（外显计数，驱动弹窗开关）。
- `reset` 一并 `setPendingApply(null)`（换厂商重挂载/复位时不留悬挂批次）。

### src/pages/Competitors/CompetitorsPage.tsx
- `AIAnalysisSection` 末尾挂全站统一 `ConfirmDialog`（default 态，非 danger——采纳是写入不是删除）：
  标题「采纳无事实依据的建议？」，描述含实时计数与后果说明（写入厂商档案），按钮「仍要采纳/返回检查」。
- 新增 import ConfirmDialog。

### src/pages/Competitors/useCompetitorAnalysis.test.ts
- 新增 describe「suggestionsNeedingConfirm · 采纳二次确认口径」4 用例：
  high/medium 空 refs 需确认；low（解析阶段已降级）不二次打扰；带 refs 不触发且 evidence_refs 字段缺失按空处理仍触发；空输入得空数组。

## 行为等价性
- 无事实依据建议默认不勾选、需手动确认的既有交互语义完全保留，只是确认载体从原生框换成设计系统弹窗（遮罩/焦点环/键盘 Esc 取消均免费获得）。
- 全部建议均有事实依据时路径不变：点击即直接写回，不出现弹窗。
- 确认后的写回仍走 R145 ANALYZABLE_FIELDS 白名单单一真源，运行时越权写回的兜底不受影响。

## 四门验证（目标项目目录实跑）
| 门禁 | 结果 |
| --- | --- |
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 95 文件全过：1033 passed / 2 skipped（基线 1029 + 4，新增全为本轮 suggestionsNeedingConfirm 用例，零回退） |
| npx eslint 触及三文件 | 零输出：0 error / 0 warning |
| npx vite build | exit 0，3.72s（chunk>500kB 提示为既有基线告警） |

全站复查：`window.confirm` 真实调用 0 处（grep 剩余 10 命中全部为注释/文档性提及，含 intelBodyClean.test.ts 的 XSS 清洗用例字符串）。

## 维持裁定核对（未推翻）
- 编造嫌疑未清零禁导出硬门禁：维持「只报告不拦截」，本轮未触碰。
- lint-debt-01：bidTypes.ts 有意保留残余，未重构。
- r119-dead-export-mwip-defer / r130-price-preview-404：分别在途文件与环境缺口，继续绕开。

## 挂账
- 无新增挂账。r147-native-confirm-dialog-01 关闭后，open backlog 剩：r152-star-symbol-loss（P3 观察）、
  ui-redesign-phase3（P2/P3 长期）、quote-history-3-mining（P3 待立项）、r119-dead-export-mwip-defer（待用户提交在途）、
  r130-price-preview-404（环境缺口）。

## 实机验证补记（browser-use，收轮后追加）
- http://127.0.0.1:8000 为 vite dev server（网络日志见 /src/main.tsx + @vite/client HMR），浏览器实测加载的即本轮补丁后的源码模块，非陈旧产物。
- /competitors 页面经侧栏导航进入并直达「厂商档案」：被改动的 AIAnalysisSection 组件树实机渲染正常（「AI 深度分析」按钮 + 关联情报区在档），reload 后两轮 console 均零 error / 零 warn。
- 端到端「采纳无依据建议」路径需真实 AI 分析返回非确定性结果，不在本轮实机触发（避免消耗用户接口账户额度）；该路径已由 4 项单测锁死判据 + tsc/eslint/build 覆盖接线。
- 产物级甄别（scripts/r158_dist_scan.py，dist 233 个 asset 全量扫描）：旧原生 `window.confirm(` 调用与旧文案「条建议未附事实依据，确认采纳」均为 NONE；新弹窗标题「采纳无事实依据的建议」与描述「采纳后将直接写入厂商档案」均命中 Competitors-DYIKfg0s.js。
- 截图：MedPreSales/.qoder/tmp_r158_competitors_page.png、tmp_r158_competitors_reload.png。
