# R208 · modelGateway 个人配置坏 → 先换个人备用通道（fallback_to_platform 改判）

- 轮次：R208（接续 R207=207）
- 来源：backlog `r203-fallback-to-platform-branch`（P3，R203 遗留观察）
- 类别：A 类纯前端代码改判（无提示词、无 schema、无 pb_hooks 红线）

## 问题
`chatViaGatewayUncached` 中，当 pb_hooks 网关返回 `res.code === "fallback_to_platform"`
（个人配置被删 / 缺 API Key / 无启用模型 / 默认模型是平台内置）时，旧逻辑在**回退内核之前**
就 `return callLlmWithFallback(PLATFORM_MODEL_ID, ...)` 直接落平台。后果：
1. 本地自用域平台令牌恒空 ⇒ 实际把「配置坏了」导成 412 死路，用户看不到可操作提示；
2. 绕过了 R203 引入的候选挑选（`tryFailoverCall`），明明有其他已启用的个人通道却不去试。

## 改判（新旧口径）
旧：配置坏 → 立即落平台（本地域死路 / 云端绕过候选）。
新：配置坏 → 归为可回退失败类 `config_broken` → 先走候选挑选换健康个人通道 →
    无任何健康个人候选时才落平台兜底（云端）/ 给出可操作提示（本地域）。

- `modelFailover.ts`：`CallFailureClass` 增 `config_broken`；`CONFIG_BROKEN_RE=/personal_config_unavailable|fallback_to_platform/i`
  在 login_required 之后归类；`FAILOVER_ELIGIBLE` 纳入 `config_broken`；`coolingKeysForFailure` 复用账号级
  冷却（整配置 + 该模型），把坏配置从后续候选中剔除。
- `modelGateway.ts`：新增哨兵 `PERSONAL_CONFIG_UNAVAILABLE_ERR` 与用户可读提示 `PERSONAL_CONFIG_UNAVAILABLE_HINT`；
  uncached 的 `fallback_to_platform` 分支改为返回 `{ok:false, error: PERSONAL_CONFIG_UNAVAILABLE_ERR}`（进入回退流程而非直连平台）；
  `chatViaGatewayWithFailover` 尾部：候选耗尽后，若首个失败为该哨兵——非本地域落平台兜底、本地域返回可操作提示。

## 接线级/口径单测（+4）
- `modelFailover.test.ts`：config_broken 归类 + isFailoverEligible；coolingKeysForFailure 剔除坏配置。
- `modelGatewayFailover.test.ts`：c1 报 fallback_to_platform 且 c2 健康 → 换 c2、不调平台、toast 1 次；
  c1/c2 全坏 → 云端落平台兜底（callLlmWithFallback 1 次）。

## 在途核账
改前 `git status` 确认 `modelGateway.ts`(M)/`modelFailover.ts`(??) 为本轮锚点，未触碰他人在途文件。
首跑 tsc 的 8 处 error 全在 `src/pages/FormatTool/refreshDocx.ts`（并发在途任务 churn，行号已漂移），
与 R208 无关；复跑该任务收敛后 tsc -b EXIT=0。

## 四门（目标项目目录）
- tsc -b：EXIT=0，零错误。
- vitest run：131 files passed，1558 passed（R207 基线 1554 → **+4**），0 failed。
- eslint 触及 4 文件（modelGateway/modelFailover 及其 test）：零输出（新增 error 0）。
- vite build：EXIT=0，built in 3.46s。
