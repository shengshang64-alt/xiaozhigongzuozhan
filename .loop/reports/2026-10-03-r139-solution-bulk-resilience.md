# R139 方案编制生成韧性对齐标书侧既定口径（批量补重试 + 空产出防穿透 + 续写抖动保留）

- 日期：2026-10-03
- round：139
- 优先级：P2（实质性可靠性项，方案编制主链路——用户选题权重第一）
- 分类：纯前端逻辑，零提示词（非 B 类，PROMPT_VERSION 不变）、零 collection、零 pb_hooks、零新依赖

## 1. 选题背景

用户指定的两个优先项均已收口（quote-history-01 二期 R102/R131、prompt-fabscan-03 按章聚合回注 R103），
本轮按流程择优巡检新角度。对比方案编制（SolutionStudio）与标书（BidWorkspace）两条生成链路，
坐实标书侧历轮已修故障簇在方案侧**原样存在**：

| 缺陷 | 标书侧状态 | 方案侧状态（本轮前） |
| --- | --- | --- |
| 模型空产出被标 `done`，空章被后续批量按「已生成」永久跳过 | 已修（循环 8 A2 保底：`!out.content.trim()` 一律 failed） | **未防**（单章与批量两条路径均无条件标 done） |
| 批量单趟循环，偶发失败/空返回无自动补跑 | 已修（R126：收口前对失败章串行补跑一遍，逐章点名真实原因） | **未做**（失败即标 failed 留给手动，toast 只报首个错误） |
| 自动续写轮抖动 throw 连正文一起作废 | ——（标书侧走 runSupplementLoop 独立容错） | **未防**（续写 llmGenerate 抛错冒泡，整章 failed，主调用已付费正文丢弃） |

与既有记忆口径吻合：「推理型模型占满 token 预算致正文返空」「从未完整生成/静默失败」是实测坐实的故障类，
方案侧同样暴露在该风险下。

## 2. 变更内容

### 新增 `src/pages/SolutionStudio/chapterGenGuard.ts`（纯函数，独立可单测）
- `isBlankChapterOutput(content)`：空产出口径（纯空白即空；undefined/null 兼容）。
- `formatFailedChapterList(failed, opts?)`：失败章逐章点名「章名（原因）」，默认 top3 + 章名 10 字截断 +
  「等 N 章」溢出收敛；空清单回退 fallback 文案。

### `src/pages/SolutionStudio/useSolutionStudio.ts` 六处
1. import 新模块。
2. `generateChapterContent` 续写 for 循环包 try/catch：续写轮偶发失败 `break` 保留当前稿
   （主调用已成功付费，整章不再连坐 failed；underlength 标记与提示链路原有，不丢失诚实性）。
3. `runGenerateChapter`（单章）：空产出 → 标 failed + toast「模型返回空正文，本章未标记完成，可重新生成」，
   不写空 content、不推进 done。
4. 批量 `runBulkGenerate`：新增 `failedNodes` 登记（nodeId/idx/title/reason）。
5. 批量主循环：空产出拦截（同标书侧口径）+ catch 登记真实原因；循环后**串行补跑一遍**——
   成功转 done、`okCount+1`、`failedCount-1`；仍失败落回 failed 并保留原因；尊重取消（cancelBulkRef）。
6. 收口 toast：`failedCount` 时逐章点名（`formatFailedChapterList`），无登记时回退原首个错误口径。

### 新增 `chapterGenGuard.test.ts`（7 用例）
空判定 2 条（全空值族/非空最小内容）+ 点名文案 5 条（fallback/截断含括号、reason 空兜底、top3+「等 N 章」、自定义参数）。

## 3. 行为变化点（如实记录）

- 批量结束后若全部失败章被补试救回，终态 toast 为「全部章节正文生成完毕」；仍失败者 toast 由
  「N 个章节失败：<首个错误>」改为「N 个章节仍失败：<章名（原因）逐章点名>；可到章节列表对失败章节单独重试」。
- 续写轮失败从「整章 failed」改为「保留主稿 done（可能 underlength 警告）」——用户可见差异：
  少了一种整章报废情形，多了一次 underlength 橙条提示机会。
- 空产出章（罕见路径）从「done+空」改为「failed」：受影响的老数据（已被标 done 的空章）不会被本改动追溯性重置，
  但批量遇到 done 空章仍跳过——与标书侧同口径，留作既有局限不做追溯纠偏（避免动用户手工清空的合法章）。
- 批量补试为**串行一遍**、不带并发（首趟循环维持现状不并发化——并发 worker 池改造风险大，挂账后续）。

## 4. 四门验证

| 门禁 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0，零错误 |
| `npx vitest run` | **928 passed + 2 skipped**（基线 921，增量 +7 ＝ chapterGenGuard.test.ts 全部新增，零回归） |
| `npx eslint`（3 触及文件） | **净新增 0**：字节级可逆法实测——反向回放六补丁+r139c → eslint 基线 12err/1warn → 正向回放 → sha256 逐字节一致（ed501568…）；改前改后同为 12 errors / 1 warning，全部为该文件既有 react-hooks（set-state-in-effect / memo 保留 / exhaustive-deps）基线，新增两文件 0 问题 |
| `npx vite build` | 3.19s 成功（chunk>500kB 警告为既有基线） |

## 5. 在途保护

- `useSolutionStudio.ts` 为 git-M：`git diff -U0` 全部 6 个 hunk 位于 L429/435/692/722-734/738-740/1681
  （均为助手自有 R92 自动保存指示器代码）；本轮改动区 L949-975、L990-997、L1402-1500 与所有在途 hunk **零交集**。
- 两个新文件为全新创建（脚本 assert 不存在才写，避免覆盖任何在途文件）。
- 未 git commit（遵守禁令）。

## 6. 维持裁定与挂账

- 维持：编造嫌疑只报不拦（R89）、lint-debt-01 残余不重构、各 defer 项（r112/money-count/r119/r124/r130/r136）继续在途绕开。
- 新挂账（backlog）：`r139-solution-bulk-concurrency-defer`——方案侧批量仍为纯串行（标书侧生成链路 D2
  已上 BULK_CONCURRENCY=2 worker 池，12 章级方案整本时长可减半）；涉及进度语义与并发写安全，独立轮次评估。

## 7. 落地脚本

- `d:\KFDXCX\MedPreSales\scripts\r139_solution_bulk_resilience.py`（主补丁，6 站点 assert count==1）
- `scripts\r139b_fix_test_expect.py`（单测预期修正）
- `scripts\r139c_fix_useless_assign.py`（eslint no-useless-assignment 修复）
- `scripts\r139d_revert_probe.py` / `scripts\r139e_restore.py`（字节级可逆法 eslint 基线探针）
