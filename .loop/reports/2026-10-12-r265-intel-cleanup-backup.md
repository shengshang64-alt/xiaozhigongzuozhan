# R265 情报「清理不相关」数据安全——删除前先导出本地备份、数量对齐才放行

- 轮次：R265（接续 round 264 → 265）
- 选题：账本 P0 伞项 `bidkit-global-opt-p0` 待续清单首项 **R-033 cleanup-irrelevant 数据安全**（零 AI 成本优先）
- 类别：A 类（纯逻辑/交互层）+ 一处 pb_hook 加法分支；零 collection schema、零提示词、零新依赖、未 commit

## 一、选题依据与根因

`POST /api/intel/cleanup-irrelevant` 的删除分支用 `$app.delete` **批量物理删除**采集条目（命中即不可恢复），
与两条既定规范相悖：
1. AGENTS.md §7「任何删除操作先移入 trash/，禁止物理删除」；
2. 同项目标书侧（`useBidWorkspace.softDeleteProject` / BidProjectList 回收站）已确立「软删 + 30 天回收站」范式。

情报清理是全站唯一「一键即永久销毁存量数据」的入口，误点即丢失，数据安全缺口明确。

## 二、方案

无法在 Goja 分支里跑真实端到端（本机情报库为空，与历轮同口径：真实数据到位后补测），
故把**可门禁验证的核心不变式**放在前端纯逻辑层，pb_hook 只做**加法**（不改动既有 preview/delete 分支）：

1. **新增纯函数模块 `src/pages/IntelCenter/intelCleanupBackup.ts`**
   - `serializeCleanupBackup(items, meta)`：全量命中记录 → 带版本/元信息的 JSON 文本，无损 round-trip，中文不转义。
   - `cleanupBackupFileName(stamp)` / `formatBackupStamp(d)`：本地日历时间戳文件名（非 UTC，复用 dateStamp 口径精神）。
   - `canProceedToDelete({backupOk, backupCount, expectedCount})`：**删除前安全闸**——未取得备份 / 命中数为 0 / 备份条数与命中数漂移，一律拒绝删除。
2. **`useIntelCenter.confirmCleanup` 重写为四步编排**
   取 `backup:true` 全量命中 → 安全闸校验 → `triggerBlobDownload` 落本地 JSON（复用 R110 全站下载唯一入口）→ 才发 `confirm:true` 删除。
   删除被拒绝时 `toast` 明确「未删除任何条目」。
3. **`CleanupIrrelevantDialog`** 文案与按钮：「删除不可恢复 / 确认清理」→「先导出本地备份再删除 / 导出备份并清理」。
4. **`intel_center.pb.js`** cleanup-irrelevant 内新增 `body.backup===true` 分支：按 Goja 回调自持约定序列化返回 `bad` 全集合（不删除）；
   既有 `if (!doDelete)` 预览分支与 `$app.delete` 删除分支逐字未动。

## 三、变更文件

| 文件 | 变更 |
|---|---|
| src/pages/IntelCenter/intelCleanupBackup.ts | 新增（纯函数，零网络/零 DOM/零时间源） |
| src/pages/IntelCenter/intelCleanupBackup.test.ts | 新增 9 用例 |
| src/pages/IntelCenter/useIntelCenter.ts | 顶部 imports + confirmCleanup 四步编排（deps 加 cleanupInfo） |
| src/components/intel-center/CleanupIrrelevantDialog.tsx | 说明文案 + 确认按钮口径 |
| pocketbase/pb_hooks/intel_center.pb.js | cleanup-irrelevant 新增 backup 分支（加法） |

## 四、四门验证

- **tsc -b**：exit 0，零错误。
- **vitest run**：170 files / 1920 passed + 2 skipped。基线 169/1911 → **增量 +1 文件 / +9 用例**（intelCleanupBackup.test.ts）。
- **eslint**（触及 4 文件）：useIntelCenter.ts 改前(HEAD 副本)与改后**同为 27 problems（25 errors / 2 warnings）**，
  均为存量 `react-hooks/set-state-in-effect`、`immutability`、`preserve-manual-memoization` 债（lint-debt 有意保留范畴）；
  新增两文件与 Dialog **零 error** → **净新增 error = 0**。
- **vite build**：exit 0，built in 4.74s。

## 五、维持裁定（不推翻）

- 编造嫌疑未清零禁止导出硬门禁：维持「只报告不拦截」。
- lint-debt-01：useIntelCenter.ts / bidTypes.ts 存量 react-hooks 债有意保留，本轮不重构、不清理。
- 全程未 git commit。

## 六、挂账 / 待办

- pb_hook `backup` 分支的真实数据端到端复核待有真采集数据后补（本机库为空）。
- 后续可将备份 JSON 做成「一键再导入」闭环（本期先保证删除前数据不丢失，符合 §7 底线）。
