# R200 · 三面板「投标文件还没有正文」提示补出路（修复交互断链）

## 选题依据
延续 R199「提示必须有出路」原则。docs/13 §3.x 剩余项落点全部在途（§3.3 撞 `modelGateway.ts`/`llm.ts` 均 M、§3.4 撞 `CustomerDetailPanel.tsx` M、§3.2 dashboard 全 M、§3.6 维持 roadmap），故转巡检新角度，命中三处 clean 面板的同款断链：

`DupCheckPanel`（第 4 步查重）、`VoidCheckPanel`（第 5 步废标检查）、`MockEvalPanel`（第 6 步模拟评标）——**每个面板紧邻的「解析依赖」提示都带「前往解析环节」跳转按钮**（`onClick={goParseStep}`），**但紧接其下的「章节正文依赖」提示只是一行纯文本** `投标文件还没有正文，请先完成「投标文件编制」环节`，无任何跳转——同一面板内一个有出路、一个没出路，自相矛盾。面板头部那个因此 `disabled` 的运行按钮，`title` 也只覆盖「已归档只读」一种禁用原因，鼠标悬停灰按钮既不知为何不可点、也无处可去。

## 方案
| 文件 | 变更 |
|---|---|
| `pipelineStep.ts`（新建，纯逻辑） | **步骤号 ↔ 流程条名 单一真源**：`stepGoLabel(step)` 走 `PIPELINE_STEPS.find(...)?.label`（查不到兜底「相关环节」）；`COMPOSE_STEP = 3`；`composeChaptersHint()` 用该 label 拼引导语——**不硬编码「投标文件编制」，杜绝与流程条漂移** |
| `DupCheckPanel / VoidCheckPanel / MockEvalPanel`（均 clean） | 纯文本提示改为与「解析依赖」提示同款的两列容器，右侧渲染可点击「前往第 3 步 · {stepGoLabel(3)}」出路 `onClick={() => requestStep(COMPOSE_STEP)}`；disabled 运行按钮 `title` 补 `!chaptersReady ? composeChaptersHint() : undefined` |
| `archiveExport.ts`（R199 新建，clean） | 顺带把其内重复实现的 `stepLabel` 收敛为委派 `stepGoLabel`（步骤名单一真源） |
| `BidWorkspacePage.tsx` | 给三面板各传 `requestStep={p.requestStep}`（插入点在 `dupLoading`/`voidLoading`/`evalLoading` 三个独有 prop 行之后） |

### 为什么出路永不「点了没反应」
复用既有已导出 `requestStep(step)`：内部 `stepEntryMissing` 守卫——第 3 步前置产物齐则 `setActiveStep`，否则 toast 明确说明还缺什么。与 R199 archive 出路、MockEvalPanel「前往解析环节」同款范式。

### 在途避让
`git diff --unified=0 src/pages/BidWorkspace/BidWorkspacePage.tsx` 显示 7 个在途 hunk（new-line 6/61/153/179/243/274/429）；三面板渲染点在 274↔429 之间干净走廊，插入锚点均为各面板独有 prop 行，逐处 `assert count==1`。三面板本体（DupCheck/VoidCheck/MockEval）+ archiveExport 均 `git status` clean。

### 边界
**零新 collection / 零迁移 / 零 pb_hooks / 零提示词改动（不走 B 类流程）/ 零 AI**；无新增持久化写路径（`requestStep` 只切 `activeStep`）。

## 四门验证（目标项目目录）
- `npx tsc -b`：**exit 0**。
- `npx vitest run`：**128 files / 1499 passed | 2 skipped，exit 0**。上一收口（R199）127/1495，本轮 `pipelineStep.test.ts` +1 文件 +4 用例；`archiveExport.ts` 重构后其 5 用例仍全绿。
- `npx eslint`（触及 7 文件）：**exit 0，零 error 零 warning**。
- `npx vite build`：**exit 0，built in 3.11s**（仅既有 chunk 体积告警）。

## 实机核验说明
三面板均属登录态 + 数据驱动（需打开某项目走到第 4/5/6 步），且 PocketBase 经 `/__pb` 走 VibeX 托管后端；本地无该后端 → 无法登录并进入带种子项目走到这些步骤。故与 R196/197/198/199 数据驱动轮次一致：以纯函数单测（步骤名同源 + 引导语拼接全覆盖）+ tsc + build 背书逻辑与接线正确性，浏览器走查留待有托管栈 + 登录 + 种子时补。

*执行：R200 自主迭代 · 2026-10-08*
