# R172 — 一键补齐跳过小节残缺章（标书恢复链路同族第三入口收口）

- 日期：2026-10-05
- 优先级：P2
- 关联：R170（cancel 误标 done 修复）、R171（单章「继续生成」小节断点续跑路由）

## 背景与根因

用户反馈「生成的标书才 6 页，与要求相差甚远」。诊断确认**非模型问题**：技术部分是「1 章 11 小节」结构，
小节级串行生成被中断后，多个恢复入口把残缺章当整章正文 blob 处理，导致卡在约 6 页。

R170 修复了「小节串行生成被中断误标 done」，R171 修复了「单章继续生成把残缺章当整章 blob 续写」。
本轮收口同族**第三入口——「一键补齐」runFillPages**：

- 候选技术章（`content>0` 且非商务骨架章）用 `buildBidContinueMessages` 做**整章 blob 扩写**；
- `updateChapter(..., { gen_status: "done" })` **无条件标 done**；
- **不更新 section_stats**。

对「小节残缺章」（`section_stats` 数 < `sections` 数）同样错误：只会把已生成小节续长，**产不出缺失的具名小节**，
还会误标 done、留下陈旧小节统计，使残缺章被后续批量/补齐按 done 永久跳过。

## 方案取舍

`generateChapterContent` 定义在 `runFillPages` 之后（4694 > 4307），受 useCallback deps TDZ 顺序限制
（文件注释 4035 已警告），**不在补齐循环内联小节续跑**。采用「跳过 + 汇总提示」：

1. 声明 `const pendingSectionTitles: string[] = []`；
2. 循环内命中 `hasPendingSections(ch)`（R171 已导入的纯谓词）→ 记入 `pendingSectionTitles` 并 `continue`，不做整章扩写；
3. 结尾 toast 追加 `pendingNote`，引导对这些章点「继续生成」（R171 已让其正确走小节断点续跑）补足剩余小节。

语义正确：一键补齐的职责是补全**已有完整章**的篇幅缺口；缺小节的章应交「继续生成」断点续跑。

## 改动文件

- `src/pages/BidWorkspace/useBidWorkspace.ts`（runFillPages 三处：声明 + 跳过 + 结尾提示）

## 四门验证

| 门 | 结果 |
|---|---|
| npx tsc -b | 0 错误 |
| npx vitest run | 1144 passed + 2 skipped（无回归；hasPendingSections 单测已在 R171 覆盖 6 例） |
| npx eslint（触及文件） | useBidWorkspace 18 problems(5err13warn) == HEAD，净新增 0 |
| npx vite build | 成功（3.48s） |

## 浏览器决定性验证

进入【演练】R01-bid-20261004 → 第 3 步投标文件编制。补齐前实时数据：技术部分 `secs=11 / stats=1 / gen=failed / len=3131`。

点「一键补齐」→ toast：

> 页数补齐完成，新增约 0 字，请查看正文页数是否达标；「技术部分」章仍有未生成小节，已跳过整章扩写（避免只把已有小节续长），请对这些章点「继续生成」断点续跑补足小节

补齐后实时数据：技术部分 `len` 仍 **3131**、`stats` 仍 **1**、`gen` 仍 **failed**。

证明：
1. `pendingNote` 触发 → `hasPendingSections` 跳过分支命中；
2. 「新增约 0 字」+ 数据未变 → **零 LLM 调用**、未做 blob 扩写；
3. `gen` 仍 failed、`stats` 仍 1 → **未误标 done、section_stats 未陈旧**（旧缺陷被阻断）。

## 结论

至此，标书「1 章多小节」残缺章的**三个恢复入口**（批量生成 / 单章继续生成 / 一键补齐）全部收口：
残缺小节章不再被当整章 blob 处理或误标 done，用户可通过「继续生成」断点续跑补足剩余小节，最终达到目标页数。
