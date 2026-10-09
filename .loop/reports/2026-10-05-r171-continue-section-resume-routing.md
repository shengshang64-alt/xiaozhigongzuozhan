# R171 · 单章「继续生成」对小节残缺章改走小节断点续跑（承接 R170）

## 选题：巡检新角度（R170 的后续缺口）
R170 修好了「中断误标 done + 批量重跑自愈」。本轮巡检同一 bug 家族的另一条恢复入口——
**单章「继续生成」按钮**——发现它对「小节残缺章」的处理是错的。

## 缺陷
`continueChapter` → `runContinueChapter`（useBidWorkspace.ts）把整章当一坨正文：
以现有正文为上下文，`remain = budget - content.length`，调 `llmGenerate(buildBidContinueMessages(...))`
往末尾**追加**，然后**无条件 `gen_status="done"`**，且**不更新 section_stats**。

对 R170 那种「1 章 11 小节、只生成了第 1 小节」的残缺章：
- 它不会去生成缺失的第 2–11 个**具名小节**，只会把第 1 小节往长了续写；
- 续完再标 done，section_stats 仍是陈旧的 1 条 → 与正文不一致，可能再次误导。

正确恢复应是**小节断点续跑**：`runGenerateChapter(nodeId)`（非 fresh）——它复位 `cancelBulkRef`、
经 `resumeFrom` 跳过已产出小节、只补剩余小节（循环 6 A2 既有能力，R170 批量自愈也依赖它）。

## 修复
### `chapterCompletion.ts` 新增纯函数 `hasPendingSections`（+6 单测）
- `hasPendingSections(ch)` = `section_stats 非空 && sections.length > section_stats.length`（与 gen_status 无关，
  历史误标 done 或本轮新标 failed 的残缺小节章都命中；单次章 stats 空、完整小节章 stats==secs 不误伤）。
- `isIncompleteSectionChapter` 重构为 `gen_status==="done" && hasPendingSections(ch)`（复用，语义不变）。

### `useBidWorkspace.ts` `continueChapter` 路由
```
const ch = activeProjectRef.current?.bid_chapters.find(c => c.node_id === nodeId)
if (hasPendingSections(ch)) {
  // 走小节断点续跑（runGenerateChapter 非 fresh），费用确认文案改为「从断点续跑补足剩余小节」
  costConfirm.runWithCostConfirm(() => void runGenerateChapter(nodeId), `本章尚有未生成的小节，将从断点续跑补足剩余小节（已生成小节不重复付费）…`)
  return
}
// 否则维持原整章续写补足
costConfirm.runWithCostConfirm(() => void runContinueChapter(nodeId), `将从本章正文断点续写补足篇幅预算…`)
```
deps 补 `runGenerateChapter`。全部小节已生成、仅总长未达预算的章（hasPendingSections=false）行为不变。

## 四门验证
- `npx tsc -b`：exit 0
- `npx vitest run`：1144 passed + 2 skipped（chapterCompletion 7→13，+6）
- `npx eslint`（触及文件）：useBidWorkspace.ts 5 errors/13 warnings == HEAD 基线，**净新增 0**
  （既有 setState-in-effect×4 + no-useless-assignment×1，后者行号 7316→7327 系本轮在其上方 +11 行所致）；
  chapterCompletion.ts / .test.ts 各 exit 0
- `npx vite build`：成功（built in 4.04s）

## 浏览器验证（localhost:8000/bid-workspace）
进入卡住的「【演练】R01-bid-20261004」→ 技术部分（3131/59500 · 完成 1/1）→ 编辑态 →
点单章「继续生成」：截图显示 **「AI 正在撰写本章…」+「小节 2/11」**。
「小节 X/Y」进度仅由 `generateChapterContent` 小节循环内的 `setSectionGenState` 设置——
**证明路由命中小节断点续跑分支（runGenerateChapter），而非整章 blob 续写**；且从第 2 小节起、
保留第 1 小节 3131 字，符合断点续跑预期。

## 维持裁定
零 AI 提示词改动（不适用 B 类流程）；未动 pb_hooks / collection（纯前端路由 + 既有落库字段）；
编造嫌疑「只报不拦」、lint-debt-01 有意残余——均不触碰。
