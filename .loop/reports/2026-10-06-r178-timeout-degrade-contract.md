# R178 · 超时降级重试恢复契约抽为可测纯函数 + 单测（防回归加固）

日期：2026-10-06　优先级：P2（质量加固，护住 R177 用户核心修复）

## 动机
R177 修好了「标书生成不出来 / 才 6 页」——用户最在意的链路。但降级判定（`是否超时`、`单次预算怎么折半`）
内联在 8000 行 `useBidWorkspace.ts` 的 `llmGenerate` 里，**无法单测**；未来任何重构都可能悄悄改坏恢复节奏，
却没有测试能拦截。本轮把该契约抽到可测的 `modelGateway` 纯函数，并用单测锁死。

## 改动（纯 refactor，行为完全等价）
`src/lib/modelGateway.ts`（新增导出）：
- `TIMEOUT_RETRY_MIN_TOKENS = 2048`：降级重试单次输出预算下限。
- `nextDegradedBudget(prev)`：折半但不低于下限——锁死恢复节奏。
- `shouldDegradeRetry(ok, error)`：仅「请求失败（ok=false）且命中超时」为真；用户取消 / 需登录 /
  内容审核 / 余额等非超时一律假，避免无谓重试计费。

`src/pages/BidWorkspace/useBidWorkspace.ts`：
- `llmGenerate` 超时块 `if (!r.ok && personalTimeoutError(r.error))` → `if (shouldDegradeRetry(r.ok, r.error))`；
- 预算折半 `Math.max(Math.floor(budget/2), TIMEOUT_RETRY_MIN_TOKENS)` → `nextDegradedBudget(budget)`；
- 删除本地重复 `TIMEOUT_RETRY_MIN_TOKENS` 常量（改由 modelGateway 导出）。

`src/lib/modelGateway.test.ts`：+3 单测——折半节奏 / 超时判定为真 / 非超时·成功·取消不触发降级。

## 四门验证
- `npx tsc -b`：exit 0
- `npx vitest run`：**1172 passed | 2 skipped**（R177 基线 1169 → +3，无回归）
- `npx eslint`（触及文件）：exit 0
- `npx vite build`：exit 0

## 关于一次全量 vitest 的红（已排除）
首跑全量出现 `pdfLineRebuild.test.ts` 的 **Vitest worker 崩溃**（exit code 1，"Worker exited unexpectedly"）。
- 定向 `modelGateway.test.ts` 单跑 exit 0；`pdfLineRebuild.test.ts` 单跑 **7 passed**；全量重跑 **1172 passed**。
- 结论：并行 worker 资源 flaky，**与本轮 modelGateway 契约改动无关、非回归**（本轮未触碰 pdf 行重建逻辑）。

## 边界
零红线 / 零提示词 / 零数据模型；未 commit。护住 R177 用户核心修复的可测契约，降低后续重构回退风险。
