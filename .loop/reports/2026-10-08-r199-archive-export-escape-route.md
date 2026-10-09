# R199 · 归档导出卡「内容未就绪」补出路（修复交互断链）

## 选题依据
`docs/13` §3.7 记「导出卡显示『内容未就绪』但没有跳转动作」。原文指 PPT 讲稿导出，其落点 `DeckEditorWorkspace.tsx` **在途（M）不可碰**。
核查发现**同款缺陷独立存在于 clean 的标书 `ArchivePanel.tsx`**（流水线第 7 步）：五张导出卡在对应产物缺失时，按钮 `disabled` 且只显示灰态「内容未就绪」，**既不说缺什么、也不给去哪个环节生成**——违反本项目反复修复的「提示必须有出路」原则（BidNodesCard、MockEvalPanel「前往解析环节」皆同类修复）。

在可碰的 clean 文件上修同类问题，是就 §3.7 的实质交付，而非缩小或绕开。

## 方案
| 文件 | 变更 |
|---|---|
| `archiveExport.ts`（新建，纯逻辑） | `archiveCardGuidance(key, proj)` → `{ready, step, goLabel, missingHint}`，作为**单一真源**集中：① 每张卡就绪所需产物；② 生成它的流水线步骤号（bid/deviation→3、parse→2、check→4、eval→6）；③ 步骤可读名走 `PIPELINE_STEPS.find(...)`，**与流程条同源、不硬编码不漂移**；④ 未就绪引导语 |
| `ArchivePanel.tsx`（clean） | 卡片消费 guidance：未就绪的禁用按钮补 `title`（说明缺什么）；下方渲染可点击「前往第 N 步 · <步骤名>」出路按钮 `onClick={() => p.requestStep(g.step)}`；就绪判定从内联 5 行迁入纯函数，卡片类型移除 `ready` 字段（行为等价、可脱渲染单测） |
| `BidWorkspacePage.tsx` | 给 `<ArchivePanel>` 传 `requestStep={p.requestStep}`（插入点在 `activeProject`/`exportBusy` 之间，经 `git diff` 核对在 4 个在途 hunk 之外） |

### 为什么出路永不「点了没反应」
复用既有 `requestStep(step)`：内部 `stepEntryMissing` 守卫——目标步骤前置产物已就绪则 `setActiveStep`，否则 toast 明确说明还缺什么。跳转动作要么成功、要么给出更精确的缺项提示，绝不死链（与 `PipelineStepper` 步签同款行为）。

### 边界
**零新 collection / 零迁移 / 零 pb_hooks / 零提示词改动（不走 B 类流程）/ 零 AI**；无新增持久化写路径（`requestStep` 只切 `activeStep`）。

## 四门验证（目标项目目录）
- `npx tsc -b`：**exit 0**。
- `npx vitest run`：**127 files / 1495 passed | 2 skipped，exit 0**。上一收口（R198）126/1490，本轮 `archiveExport.test.ts` +1 文件 +5 用例全绿。
- `npx eslint`（触及 4 文件）：**exit 0，零 error 零 warning**。
- `npx vite build`：**exit 0，built in 3.01s**。

## 实机核验说明
该导出卡属登录态 + 数据驱动（需打开某项目走到第 7 步），且 PocketBase 经 `/__pb` 走 VibeX 托管后端；本地 `localhost:8000` 无该后端 → 无法登录并进入带种子项目的归档步骤。故与 R196/197/198 数据驱动轮次一致：以纯函数单测（就绪判定 + 步骤映射 + 步骤名同源，均已覆盖）+ tsc + build 背书逻辑与接线正确性，浏览器走查留待有托管栈 + 登录 + 种子时补。

*执行：R199 自主迭代 · 2026-10-08*
