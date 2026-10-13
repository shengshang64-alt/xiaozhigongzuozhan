# R293 标书主链路：四处「一键补入」的假绿缺陷（补入即同步章节清单）

- 轮次：**R293**（账本 round 291 → 293。轮次号 292 让位并发工作流：取证与实施期间该工作流已以 `scripts/recalc-{coverage,diff,selfcover}-r292.test.ts` 占用 292 号并在同一问题上推进，沿用 R290 因 289 被占而顺延的先例，本轮直接登记 R293 以避免入账冲突）
- 日期：2026-10-13
- 模块：`/bid-workspace`（标书工作台 · 第 3 步 投标文件编制）
- 类型：**实质性缺陷修复**（非零风险小改）· 零 AI 调用 · 零 collection · 零 pb_hooks · **零提示词改动**（不需走 B 类流程）
- 起点：backlog `r291-outline-coverage-gap`（P1「一键补入 43 条未覆盖条款能否真落进大纲」本轮未点，留给下一轮验证）

---

## 1. 缺陷：补入瞬间转绿，交付物里一个字都没有

标书工作台的**正文生成与导出的唯一真源是章节清单 `bid_chapters`**，而不是大纲 `bid_outline`：

| 环节 | 取数口径（代码真源） |
|---|---|
| 确认大纲 → 成章 | 顶层节点 1:1 成一章；`sections` **只取顶层节点的直接子层标题**（`useBidWorkspace.ts` 确认大纲处） |
| 批量生成候选 | `startBulkGenerate` / `runBulkGenerate` / `runGenerateChapter` 全部遍历 `bid_chapters` |
| 导出正文 | `chaptersToText(bid_chapters)` |
| 断点续跑 | `hasPendingSections`（`sections.length > section_stats.length`）+ `planSectionResume`（R276，按 `section_stats` **下标对齐**） |
| 覆盖核验 | `uncoveredClauses` 用 `collectLeafTitles(techOutlineNodes(...))`，**统计大纲全深度叶子** |

于是四处「一键补入」（条款 / 评分项 / 招标目录 / 技术参数）存在**双重假绿**：

1. **只写大纲不写清单**：`addClausesToOutline` 等只 PATCH `bid_outline`（评分项/招标目录/技术参数路径甚至只刷新既有章的 `sections`）。补入后覆盖核验按大纲叶子统计 → 立刻转绿，但 `bid_chapters` 没有对应章/节 → **生成候选里没有它、导出正文里没有它**。
2. **落点可以低到孙层或高到树尾**：旧 `insertClauseIntoOutline` 对**全深度**节点打分取最优，命中孙层节点就把新节点挂进孙层（`sections` 只取直接子层 → 生成永远看不见）；无命中则 `return [...nodes, child]` 追加到树尾（不成章 → 同样进不了生成与导出）。
3. **重复补入可无限叠加同名小节**（旧实现无去重）。

### 真实库摸底（只读 sqlite，`scripts/r292_drift_scan.py`）

扫 `pocketbase/pb_data/data.db` 全部 **21** 个 `bid_projects`：

- 大纲顶层技术章未进入章节清单的 **id 级漂移合计 81 个**（4 个项目）；
- 其中**标题也不在清单里的「真缺章」75 个**（补入/成章流程确实丢了整章，正文必缺）：
  - `20ahne54mpozls6` 中国农业银行股份有限公司贵港分行 **21**
  - `7vco3jzj6abz8p0`（无医院名，E2E 遗留） **31**
  - `8e2haaxl3d2rsq5` 南平市建阳区总医院 **22**
  - `69gzo840vy1b7wn` 厦门市杏林医院 **1**（验收要求）
- 本轮上线后复测（`scripts/r292_drift_scan.py` 重跑，留档 `d:\KFDXCX\MedPreSales\.qoder	mp
293_drift_recheck.txt`）：**id 级漂移 80 / 真缺章 74** —— 差的恰好是杏林那 1 章，已被本轮实测的「同步章节清单」修掉，其余三个项目仍待用户进面板点一次同步。
- `b3h7w7nw9ap6gxs` 安庆二院 **6 个纯 id 漂移**（标题已有章 —— 这类**绝不能**新建重复章，否则重复付费 + 正文重复），另清单里有 14 个大纲已无对应的孤立章（含已有正文，**绝不能删**）。

结论：这不是理论风险，存量数据已经踩中；而且用户完全看不出来（覆盖是绿的）。

---

## 2. 修复

### 2.1 `bidTypes.ts`（纯函数层，可单测）

- 新增 `findTopLevelAncestorId(nodes, targetId)`：任意深度节点 → 所属顶层章 id（顶层节点返回自身）。
- **重写 `insertClauseIntoOutline`**：命中节点先归一到顶层章，新小节只落「章 → 节」的**节层**（生成唯一可见层）；**同名小节去重**；无任何相似命中时**新建顶层技术章**，插在最后一个技术章之后（不打乱商务章顺序，`part: "tech"`）。
- 新增 `alignChaptersWithOutline(nodes, chapters)` —— 大纲与章节清单对齐，四条硬约束：
  1. **只增不删**：清单里大纲已无对应的章原样保留在尾部（宁多一章也不删任何已有正文）；
  2. **缺节只追加到 `sections` 尾部**，绝不重排 —— `section_stats` 按下标对齐，重排会把已生成成品判成「待补」而**重复付费**；
  3. **id 优先、标题唯一兜底**：id 对不上但标题在清单里唯一命中 → 认作同一章（**不新建重复章**）；
  4. 新建章一律 `gen_status: "pending"`、`sections: []`，**不动** `content` / `gen_status` / `section_stats`；对齐幂等（可重复点同步）。
- 新增只读诊断 `diagnoseOutlineChapterDrift(nodes, chapters) → { missingTitles, relinkTitles }`（真缺章 vs id 漂移两态；商务骨架章与空标题不参与）。
- 新增诚实回执 `describeOutlineSync(headline, { addedTitles, refreshedCount })`：分别报「新建 N 个章节（…）已列入待生成清单」「M 个已有章节补入新小节，继续生成只写新小节、不重复付费」，无改动时如实说明「无需重新生成」。**不再把进不了正文的补入写成已完成。**

### 2.2 `useBidWorkspace.ts`（四处补入统一收口）

- 新增 `applyOutlineWithChapters(nextOutline)`：唯一出口，**同一次 PATCH 同写 `bid_outline` + `bid_chapters`**；`bulkGeneratingRef.current` 为真时**拒写并 toast**（避开 `bid_chapters` 整数组写入与单章 PATCH 的既有竞态裁定）。
- `addClausesToOutline` / `addUncoveredScoringToOutline` / `addMissingCatalogToOutline` / `addUncoveredTechParamsToOutline` 四处全部改为走该收口，回执统一用 `describeOutlineSync`。
- 新增 `outlineChapterDrift`（useMemo 只读诊断）与 `syncOutlineChapters`（存量修复入口），一并导出。

### 2.3 UI 接线

- `OutlineCoverage.tsx`（整文件重写）：覆盖面板底部新增**漂移提示条** + **「同步章节清单」按钮**；条件改为 `!outlineClauseTotal && !driftMissing.length` 才不渲染 —— **即使一条条款都没提取到，只要清单缺章也必须显式告警**（旧实现在 `outlineClauseTotal === 0` 时整个面板消失，缺章完全不可见）。
- `ComposeStep.tsx` Pick + 2 处透传、`BidWorkspacePage.tsx` 1 处透传。

---

## 3. 四门验证

| 门 | 命令 | 结果 |
|---|---|---|
| 1 类型 | `npx tsc -b` | **exit 0** |
| 2 单测 | `npx vitest run` | **exit 0 · Test Files 198 passed · Tests 2312 passed / 2 skipped（2314）**；新增 `clauseOutlineAlignment.test.ts` **18 例**（单文件单跑 18/18 绿），本轮增量 = **+18 passed** |
| 3 lint | `npx eslint` 触及 6 文件 | **E8 / W13，与 HEAD 基线逐条同数 → 零新增**（取证方式见下） |
| 4 构建 | `npx vite build` | **exit 0**，built in 4.29s |

**门 2 过程记录（最终全绿）**：中途一次全量跑曾出现 `Test Files 3 failed | 198 passed (201)`，失败的三个是**并发工作流当时的在途未跟踪文件** `scripts/recalc-coverage-r292.test.ts` / `recalc-diff-r292.test.ts` / `recalc-selfcover-r292.test.ts`，报 `Error: No test suite found in file`（其顶层直接执行、无 `describe/it`）。本轮**全程未触碰、未修改**这三个文件；从其内容可见它们正在独立调查同一个「补入假绿」问题（安庆项目 `0feqc18hkk3j07e`）。收轮前该三文件已被其自身工作流移除，**复测 `npx vitest run` exit 0、198 文件全绿、2312 passed / 2 skipped**，本轮结束时门禁无任何非绿项。

**门 3 基线取证（两种方式互相印证，脚本 `scripts/r293_eslint_baseline.py`）**：
1. **按 diff hunk 定位**：把 8 条 error 的行号与 `git diff -U0` 的新文件行区间比对 → 8/8 全部落在**未改动区域**（bidTypes L4084/4086 `no-control-regex`；useBidWorkspace L687 `preserve-caught-error`、L1209/1273/1359/3087 `react-hooks/set-state-in-effect`、L8412 `no-useless-assignment`）。
2. **按 HEAD 副本对lint**：把 `git show HEAD:` 的两个文件临时落盘为 `*.r293base.ts` 跑 eslint，跑完立即删除（`git status` 已确认无残留）→ `bidTypes E2/W0`、`useBidWorkspace E6/W13`，与当前**完全同数**。

其中 `bidTypes` 的 2 条 `no-control-regex` 属 **`lint-debt-01` 有意保留、不重构**的维持裁定项，按规则不处理。整文件重写的 `OutlineCoverage.tsx` 与新增测试文件均 0 error / 0 warning。

---

## 4. 浏览器端到端实测（真实 PocketBase + 真实项目）

环境：PocketBase `127.0.0.1:7000`（`vibex-local/bin/windows/pocketbase.exe serve`，未新建任何 collection）+ vite dev `127.0.0.1:8000`（`vibex-local/vite.local.config.ts`），身份 `rh_user_id=local-user`（无准入闸，直进「作战驾驶舱」）。路由实测为 **`/bid-workspace`**（`/bid` 是 404）。被测项目：**厦门市杏林医院省内异地医保自费传送改造**（`69gzo840vy1b7wn`，卡片显示 `1/14 章成稿`）。

1. 进入「第 3 步 投标文件编制」→「需求响应覆盖（43/57）」面板，**漂移提示条原文**：
   > 章节清单缺 1 个大纲顶层技术章（验收要求）：它们不会进入正文生成与导出，覆盖转绿也不代表交付物已响应。
2. 同步前左侧章节清单实数 **14** 条（不含「验收要求」）。点「同步章节清单」，**toast 原文**：
   > 章节清单已与大纲同步（新增章待生成、新小节可断点续跑）：新建 1 个章节（验收要求），已列入待生成清单
3. 同步后章节清单 **14 → 15**，新增「第 15 章 验收要求」（pending）；**提示条与按钮随之消失**。
4. 幂等/持久化：提示条消失后已无第二次可点的同步按钮，改为**整页 reload 重进项目** → 章节数仍为 **15**、「验收要求」仍在、提示条不再出现（结果已落库且重复触发不二次建章）。
5. **单条「补入」**（未覆盖条款「质保期内未按约定时限履行售后及维保服务，每逾期 1 小时支付 1000 元违约金…」），**toast 原文**：
   > 已把 1 条未响应条款补入大纲并同步章节清单：新建 1 个章节（质保期内未按约定时限履行售后），已列入待生成清单
   
   补入后：待响应 **14 → 13**，章节清单 **15 → 16**（新增「第 16 章 质保期内未按约定时限履行售后」）—— **补入即进生成与导出真源，假绿消除**。
6. 落库只读复核（`scripts/r293_db_proof.py`，输出留档 `d:\KFDXCX\MedPreSales\.qoder\tmp\r293_db_proof.txt`）：
   ```
   大纲顶层节点数 16 / 章节清单条数 16
   生成状态分布 {"pending": 15, "done": 1}
   有正文的章 [("服务方案", 13194)]   ← 唯一成稿章正文未被覆盖
   node_id 重复条数 0 / 剩余真缺章 []
   末尾三章 [("服务方案","done",9), ("验收要求","pending",0), ("质保期内未按约定时限履行售后","pending",0)]
   ```
   注：清单里存在两章同名「服务方案」，系**本轮修复前的既有数据**（`node_id` 不重复），「只增不删」策略原样保留，已登记为 backlog `r293-duplicate-titled-top-nodes`（P3）。
7. **截图未产出（如实记录）**：本环境 `take_screenshot` 对**所有页面**（含首页与空白 404 页）均 15s 超时（png/jpeg/低质量/元素级/fullPage 全试），判定为浏览器窗口未处于可渲染前台状态导致 CDP 无法取帧，与页面内容无关。替代证据为浏览器工具的 a11y 快照文本（含面板 / 章节 / toast 原文）：
   - `C:\Users\ADMINI~1\AppData\Local\Temp\browser-tool-yTF3Oq\snapshot-2026-10-13T03-03-19-430Z.log`
   - `C:\Users\ADMINI~1\AppData\Local\Temp\browser-tool-w6rpHI\snapshot-2026-10-13T03-05-45-394Z.log`（第 481 行为补入 toast 原文）

**实测造成的数据变更（透明披露）**：为完成端到端验证，对 `69gzo840vy1b7wn` 做了两次**纯追加**写入（章节清单 +2 个 pending 章、大纲 +1 个小节）；未删除/覆盖任何既有正文，未触发任何 AI 生成与付费调用（新章为 pending，需用户显式点生成）。这两次追加本身就是本轮期望的修复效果（缺失的「验收要求」章本就该在清单里），故不回滚。

---

## 5. 维持裁定与不动项

- **编造嫌疑未清零禁止导出的硬门禁**：维持「只报告不拦截」，本轮未触碰。
- **`lint-debt-01`**：bidTypes 的 `no-control-regex` 等残余有意保留，不重构（仅确认零新增）。
- **数据模型**：零 collection、零 `pb_hooks`、零迁移；仍复用既有 `bid_outline` / `bid_chapters` 两个 JSON 字段。
- **提示词**：本轮无任何 prompt YAML/常量改动，故不走 B 类对比流程。
- 并发在途文件（3 个 `recalc-*-r292.test.ts`）与本轮锚点区域无重叠，全程未编辑。

## 6. 新增单测（`src/pages/BidWorkspace/clauseOutlineAlignment.test.ts`，18 例，纯 node fs、无 jsdom）

- 落点归一 4 例：命中孙层 → 归一到所属顶层章的直接子层且孙层不被改写；重复补入不累加同名小节；无命中新建顶层技术章且插在最后一个技术章之后（商务章顺序不乱）；`findTopLevelAncestorId` 三态。
- 对齐 6 例：缺章补 pending、缺节追加尾部（`content`/`gen_status`/`section_stats` 不动）；新增小节后 `hasPendingSections` 认出待补（接上既有断点续跑通道）；id 漂移标题唯一命中不新建重复章；孤立章原样保留；两次对齐幂等；端到端两分支断言（无命中 → `addedTitles`；命中 → `sections` 且 `hasPendingSections` 为真）。
- 漂移诊断 2 例 + 诚实回执 2 例。
- **接线守卫 4 例（源码扫描，防回归的关键）**：按大括号配对提取 `useBidWorkspace.ts` 所有 `updateProject({...})` 字面量，断言**出现 `bid_outline` 必同时出现 `bid_chapters`**；`applyOutlineWithChapters(next)` 恰好出现 4 次（对应四处一键补入）；批量生成中拒写分支存在；`outlineChapterDrift` / `syncOutlineChapters` 已导出并接到 `OutlineCoverage` / `ComposeStep`（2 处）/ `BidWorkspacePage`。

## 7. 后续（已入账）

- `r293-drift-autosync-on-confirm`（P2）：把 `alignChaptersWithOutline` 接到「确认大纲」「大纲重生成成功」两处落库出口，让漂移从源头不再产生（提示条只用于历史脏数据）。
- `r293-duplicate-titled-top-nodes`（P3）：同名顶层节点成章口径。
- 存量修复：贵港 21 / 7vco 31 / 建阳 22 三个项目（共 74 处真缺章）各打开覆盖面板点一次「同步章节清单」即可（纯前端操作，零成本）；安庆 6 个 id 漂移会被识别为 relink，不会重复建章。

## 8. 改动文件

| 文件 | 变化 |
|---|---|
| `src/pages/BidWorkspace/bidTypes.ts` | 重写 `insertClauseIntoOutline`；新增 `findTopLevelAncestorId` / `alignChaptersWithOutline` / `diagnoseOutlineChapterDrift` / `describeOutlineSync`（7014 → 7138 行） |
| `src/pages/BidWorkspace/useBidWorkspace.ts` | 新增 `applyOutlineWithChapters` / `outlineChapterDrift` / `syncOutlineChapters`；四处一键补入收口改写（9206 → 9254 行） |
| `src/components/bid-workspace/OutlineCoverage.tsx` | 整文件重写：漂移提示条 + 同步按钮 + 渲染条件修正（91 → 135 行） |
| `src/components/bid-workspace/ComposeStep.tsx` | Pick 加 2 键 + 2 处透传 |
| `src/pages/BidWorkspace/BidWorkspacePage.tsx` | 1 处透传 |
| `src/pages/BidWorkspace/clauseOutlineAlignment.test.ts` | 新增（18 例） |

补丁脚本（本工作区，按序）：`scripts/r292_drift_scan.py`（只读取证）、`r292_patch1_btypes.py`、`r292_patch1b_desc.py`、`r292_patch2_hook.py`、`r292_patch3_ui.py`、`r292_patch4_tests.py`、`r292_patch4b_test.py`、`r292_patch4c_children.py`、`r293_eslint_baseline.py`、`r293_db_proof.py`、`r293_ledger.py`。

**未提交**：遵守禁令，全程未 `git commit`；收轮时 `git status` 为本轮 5 改 + 2 新增（测试文件与本报告），并发的 3 个 `recalc-*-r292.test.ts` 已不在工作区（由其自身移除）。
