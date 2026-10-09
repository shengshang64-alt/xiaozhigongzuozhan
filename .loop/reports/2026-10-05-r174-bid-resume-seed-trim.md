# R174 · 标书小节断点续跑「种子裁剪」修复（继续生成不再重复膨胀）

日期：2026-10-05　轮次：R174　优先级：P2　模块：BidWorkspace

## 用户诉求根因链（承接 R170~R173）
用户反馈「生成的标书才 6 页、和要求相差甚远」。**不是模型问题**——模型产出正常，问题在代码：技术部分等「1 章多小节」
的章走小节级串行生成，早期被中断后只产出了开头 1 个小节却被标记 done（R170 已修误标），且历史「整章 blob 续写 / 补足」
只更新正文不回写 section_stats，留下大面积「done 但 section_stats 只覆盖 1 小节、content 却远超」的不一致数据。

## 本轮定位的持久化异常（R173 follow-up 结项）
实测勘察 PocketBase（`/__pb/api/bid_projects`）多个章：
- 【演练】R01 · 技术部分：secs=11 / stats=[3131] / gen=done / content=17548
- 贵港项目 · HIS：secs=9 / stats=[1284] / gen=done / content=9634
- 贵港项目 · 临床协同：secs=3 / stats=[1097] / gen=done / content=7275
共性签名：content 远超 Σ(section_stats.chars)，但 stats 仅 1 条、gen=done → **整章 blob 追加未回写小节统计**。

## 危害：继续生成 → 重复膨胀
R171 的 `hasPendingSections(11,1)=true`，点「继续生成」走 `runGenerateChapter` 小节断点续跑。
`generateChapterContent` 续跑种子（旧代码 useBidWorkspace 4805~4808）在 `firstEmpty===-1` 时直接取**整段 content**（含
14417 未跟踪 blob 尾巴），`resumeFrom=已统计数=1`，于是把小节 2..11 追加到 17548 之后 → 重复膨胀，正文越来越乱、页数虚高。

## 修复
新增纯函数 `trackedPrefixLength(stats, resumeFrom, sectionCount, separator=2)`：
- `resumeFrom >= sectionCount`（小节已全部跟踪）→ 返回 `Infinity`，沿用整章正文，**行为不变**；
- 否则返回「前 resumeFrom 个已跟踪小节正文字符数 + 分隔符」上限。
续跑种子改为：仅当 `resumeFrom >= k` 用整段 content，否则把 content 裁到该上限后再 `sliceSectionPieces` 取前缀，
**丢弃未跟踪尾巴**。健康中断章（content≈Σchars）上限≈全长 → 无副作用；仅残缺章触发裁剪。

## 验证
- 四门：tsc 0 错误；vitest 1156 passed + 2 skipped（chapterCompletion 19→25，净增 6）；eslint 触及文件净新增 0（18=基线，
  5 error 全为 useBidWorkspace 既有 setState-in-effect / no-useless-assignment，两个新文件 0 problem）；vite build 4.00s。
- 浏览器实测（localhost:8000/bid-workspace，R01 技术部分 done+stats=[3131]+content17548）：点「继续生成」→
  「小节 2/11」进入小节续跑；第一个新小节落库时 **content 由 17548 骤降到 5651（3131+2518+分隔）**、
  section_stats 同步涨到 [3131,2518] 并随小节递增。旧代码此处只会 17548→20000+ 膨胀。截图存证
  `.qoder/r174_section_resume_running.png`、`.qoder/r174_seed_trimmed_proof.png`。

## 裁定与影响面
- 零提示词改动（不涉 B 类流程）；零 collection/迁移；纯函数 + 局部种子逻辑。
- 对健康章零行为变化；仅修复 done 但 section_stats 残缺章的续跑重复膨胀，直接服务用户「标书不对」核心诉求。
- 遗留观察（非本轮引入、不阻塞）：blob 续写/补足路径（runContinueChapter 5490 / runSupplementLoop 3913）仍不回写
  section_stats，是历史脏数据来源。本轮从「消费端」（续跑种子）彻底切断危害；如需从「生产端」根治（blob 路径回写/失效
  section_stats），可另立项评估——但会牵动续写/补足语义与已有数据，需谨慎，故本轮采保守消费端修复。
