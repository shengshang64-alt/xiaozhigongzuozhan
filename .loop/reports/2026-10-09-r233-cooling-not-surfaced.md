# R233 — r203-cooling-not-surfaced：模型通道冷却状态在模型选择器里可视化

## 选题依据
账本 open 项 `r203-cooling-not-surfaced`（P3，/model-config,/assistant）。R203 已落通道级
自动回退内核（modelFailover.ts），账号级失败会给通道打会话内冷却戳，但冷却状态此前只在生成
链路里以「接口暂时不可用」一次性提示，用户在模型选择器里看不到「是哪一路 / 何时恢复」，容易把
某一路的暂时不可用误判成全局故障、或反复手动切模型。属实质性交互断链补全，非零风险小改。

选题时另注意：bid-workspace / solution-studio / BidWorkspace / QualCerts / Knowledge 全域被
R220–R232 连续 13 轮改动、当前 git 在途（16 files changed, +1227/-47），本轮刻意避开以免误伤；
本项触及的 modelFailover.ts / ModelSelect.tsx / modelFailover.test.ts 均为 git-clean。

## 变更
- `src/lib/modelFailover.ts`
  - 新增 `channelCoolingRemainingMs(key, now)`：只读返回冷却剩余毫秒（不剪枝、不归零连击），
    供 UI 渲染恢复倒计时；与 `isChannelCooling`（会顺带清过期条目）分工明确。
  - 新增会话内订阅 `onCoolingChange(cb) -> unsubscribe` 与内部 `notifyCoolingChange()`：
    `markChannelCooling` / 命中的 `clearChannelCooling` / `resetChannelCooling` 时通知，UI 无需轮询。
    回调异常一律吞掉，绝不影响回退主流程。纯内存监听器集合。
- `src/components/model-config/ModelSelect.tsx`
  - 新增 `useCoolingKeys` 只读 hook：合并「模型级 + 配置级」冷却（429/欠费按账号滚动，同账号
    换模型同样撞窗），冷却刚被戳上时经订阅即时刷新，冷却存续期间逐秒自续做倒计时、到期自动隐徽；
    冷却清空即停表，无常驻定时器。
  - 为当前所选通道渲染只读 `badge-warning` 徽标（Clock 图标 + 「冷却中 · 约 Ns」+ 连击 ×N），
    `role=status / aria-live=polite / title` 说明会自动改走其它可用通道、无需手动切换。
  - 下拉里给冷却中的备选通道补「 · 冷却中」状态后缀。
  - 不改变回退与选择口径：冷却中的通道仍可选、仍先如实尝试，故只提示、禁用逻辑一律不动。
- `src/lib/modelFailover.test.ts`
  - +2 单测：剩余倒计时语义（窗内/窗外/显式清除、纯读不剪枝）与 onCoolingChange 通知/退订/幂等清除。

## 口径与边界
- 纯会话内存：零持久化 / 零 collection / 零 pb_hooks / 零提示词，不涉及数据模型与 B 类流程。
- 用户可见文案不含内部字段名与阶段编号（「冷却中/约 Ns/会自动改走其它可用通道」均为人话）。

## 四门验证
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：全绿 1705 passed / 2 skipped（较上轮基线 +2，modelFailover.test.ts 由 28 → 30）。
- `npx eslint`（3 个触及文件）：exit 0，零新增 error/warning。
- `npx vite build`：exit 0（>500kB chunk 提示为既有全局告警，非本次引入的错误）。

## 未做 / 维持裁定
- 未 commit；未触碰任何在途文件。
- 编造嫌疑硬门禁维持「只报告不拦截」；lint-debt-01 残余不重构——均与本项无关，未涉及。
