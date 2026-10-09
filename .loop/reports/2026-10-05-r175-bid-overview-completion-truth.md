# R175 · 标书生成总览「完成数」纠偏（不再谎称完成，单列「待补小节」）

日期：2026-10-05　轮次：R175　优先级：P2　模块：BidWorkspace

## 与用户核心诉求的关系
用户反馈「标书才 6 页、却像已经生成完了」。R170~R174 已修复生成/续跑链路的实质缺陷；本轮收口**展示端**最后一个误导信号：
生成总览的「完成 x/y」。

## 定位的缺陷
`useBidWorkspace.ts` 5766：
```ts
const doneChapterCount = ... filter(c => !isBizPart(c) && c.gen_status === "done").length
```
分子只认 `gen_status==="done"`，**完全不看小节是否补齐**。历史「整章 blob 追加」把只产出 1/11 小节的残缺章标成 done 后，
这些章全被计入「完成」→ 总览显示「完成 1/1」（R01）或「完成 7/10」（贵港），而正文实际只有几页 → 用户强烈困惑。
R170 早已备好 `isIncompleteSectionChapter`（done && 有未生成小节）判据，却从未接入完成计数。

## 修复
1. 新增纯函数 `isTrulyDoneChapter(ch) = gen_status==="done" && !hasPendingSections(ch)`
   —— done 且小节已补齐才算真正完成；单次生成章（section_stats 空 → hasPendingSections=false）仍算完成，不误伤。
2. `doneChapterCount` 分子改用 `isTrulyDoneChapter`。
3. `ComposeStep.tsx` 总览面板：
   - header 新增「待补小节 N」chip（`text-primary`，N = `isIncompleteSectionChapter` 命中的技术章数）；
   - 每行 done-but-pending 状态标签由「完成」改显「待补」（primary 色），与 header 口径一致；
   - 面板可见条件由 `doneChapterCount > 0` 放宽为 `完成>0 || 失败>0 || 待补>0`，防止全部 done 章都被判残缺时整块面板被隐藏。

## 验证
- 四门：tsc 0 错误；vitest 1160 passed + 2 skipped（chapterCompletion 25→29，净增 4）；eslint 触及文件（chapterCompletion.ts/.test.ts/ComposeStep.tsx）0 problem，净新增 0；vite build 5.31s。
- 浏览器实测（localhost:8000/bid-workspace → 贵港项目 → 投标文件编制 → 生成总览）：
  header 显示 **「完成 3/10，失败 3，偏短 1，待补小节 4」**；项目理解与总体建设方案(1187/7045)、HIS(9634/14090)、
  临床协同(7275/7045)、质量保障(6186/5871) 四章行状态由「完成」改显 **「待补」**，与真实小节进度完全一致。
  截图：`.qoder/r175_overview_panel.png`、`.qoder/r175_overview_daibu_xiaojie.png`。

## 裁定与影响面
- 零提示词改动、零 collection/迁移；纯函数 + 展示口径纠偏。
- 语义等价红线：仅改「完成」的**统计口径与展示标签**，不改任何生成/持久化行为；单次生成章、完整小节章、失败章展示均不变。
- 后续登记：生产端 blob 续写/补足路径不回写 section_stats 仍是脏数据来源（`r175-followup-bid-blob-writer-stats`，P3），
  消费端(R174)+展示端(R175)已双重兜底，生产端根治牵动续写补足语义，独立立项评估。
