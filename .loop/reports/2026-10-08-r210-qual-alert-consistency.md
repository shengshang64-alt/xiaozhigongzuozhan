# R210 · 资质证书预警口径统一（O-006）

## 选题依据
- 账本 bidkit-plan-slice5-observations-misc（P1）中 **O-006**：驾驶舱「资质临期 4」与台账页「已过期 1、30 天内 0」数字口径对不上。
- 根因（代码级）：三处对同一「临期/风险」概念口径漂移——
  1. 驾驶舱 `useHome` 用 `summary.alerts.length`，而 `alerts` 含 **expired + critical(≤30) + warning(≤90)** 三档；
  2. 台账 `QualCertsPage` 按 expired/critical/warning **三档分别**成卡展示；
  3. 导出硬拦截 `useBidWorkspace.warnExpiredQuals` 只认 **expired + critical(≤30)**（90 天不算风险）。
  于是 1 个已过期 + 0 个 30 天内 + 3 个 90 天内 → 驾驶舱显示「4」，台账只强调「已过期 1 / 30 天内 0」，用户觉得对不上。

## 变更内容
- **新增唯一真源纯函数** `qualsCore.qualRiskView(buckets)`：
  - `urgent = 已过期 + 30 天内`（与导出硬拦截同口径）；`watch = 90 天内`（观察项）；`total = urgent + watch`；
  - `line` = 逐档明细串（仅列非零档），标签复用台账 `BUCKET_LABEL`（「已过期 / 30 天内到期 / 90 天内到期」）逐字一致。
- `useHome`：改为读 `summary.buckets` 走 `qualRiskView`；「今日必看」overdue 置顶只认 `urgent`（90 天观察项不再上置顶条）；返回对象 `qualAlertCount` → `qualRisk`。
- `HomePage`：欢迎语按档展示 `资质{line}（投标核验）`，与台账三档预警条一一对应。
- `qualsCore.test.ts`：新增 3 条 `qualRiskView` 单测锁死口径。
- **数据模型零改动**：仍读既有 `/api/qual_certs/summary`，无新字段/collection/pb_hooks 变更。

## 变更文件
- `src/pages/QualCerts/qualsCore.ts`
- `src/pages/QualCerts/qualsCore.test.ts`
- `src/pages/Home/useHome.ts`
- `src/pages/Home/HomePage.tsx`
- 补丁脚本 `d:/KFDXCX/MedPreSales/scripts/r210_qual_consistency.py`、账本 `r210_ledger.py`

## 四门验证
- `npx tsc -b`：**0 error**
- `npx vitest run`：**1565 passed / 2 skipped（1567），0 fail**（基线 1562 → **+3** 来自 qualRiskView 用例）
- `npx eslint`（触及文件）：**0 新增 error**；useHome 报出的 3 条 `react-hooks/set-state-in-effect` 位于 todo/intel/recentDoneAt 效果（322/543/744），均为**既有 lint-debt-01 保留残余**，非本轮引入，且不在本轮编辑行。
- `npx vite build`：**成功 3.02s**，5983 modules，`qualsCore`/`Home` chunk 正常产出。

## 账本回写
- `round` 209 → **210**；`closed` 追加 `r210-qual-alert-consistency`（共 189 条）；
- slice5 `plan` 标注 O-006 已闭环（O-001..O-005 仍待排期）；`lastRoundSummary` 更新。

## 维持裁定（未触碰）
- 编造嫌疑未清零禁导出「只报告不拦截」硬门禁：维持。
- lint-debt-01 有意保留残余：维持（本轮未重构 set-state-in-effect）。
