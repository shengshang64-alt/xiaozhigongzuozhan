# R201 · 交卷前合规清单空态补跳转出路（2026-10-08）

## 选题
「交互断链」新角度续扫（R197-R200「提示必须有出路」原则的收口）。全站跨边界断链扫描后，
`SubmissionChecklistPanel.tsx` 的空态提示是 bid-workspace 里最后一个**无任何出路**的跨步骤断链：

- 原文：`解析报告里还没有「响应文件要求」或「资格性审查」分区——请先在解析环节勾选并解析这两项（或在解析报告中手动补充），清单会自动生成。`
- 症状：提示要用户「先去解析环节」，但面板本身没有任何跳转入口；而同工作区的查重 / 废标 / 模拟评标三面板
  在 R200 已统一补了 `requestStep` 出路按钮 —— **同域内自相矛盾**。

排除项：`ChecklistImportDialog`（模态，关闭即出路 + 已给「从产品库追加」原地替代，非真断链）；DefensePanel×2（已有跳转，误报）。

## 改动（跨 5 文件）
1. **pipelineStep.ts（单一真源，R200 新建）** — 新增 `PARSE_STEP = 2` 与 `checklistParseHint()`：
   引导语步骤名走 `stepGoLabel(PARSE_STEP)`（`PIPELINE_STEPS.find` 取真实名「AI 解析报告」），
   把含糊的「解析环节」对齐到流程条真名，杜绝漂移、顺带文案一致性收敛。
2. **SubmissionChecklistPanel.tsx（clean）** — 加可选 `onGoParse?: () => void`；空态由单段 `<p>` 改为
   文案 + 「前往第 2 步 · AI 解析报告」出路按钮（沿用 R200 ESCAPE_BTN 视觉：ArrowRight + text-primary + focus-visible ring）。
3. **SubmissionCheckPanel.tsx（在途 M，仅动 pristine 区，避开 new-line 965 的在途 hunk）** —
   Pick + destructure 加 `requestStep`；渲染子面板时传 `onGoParse={!isArchivedLocked ? () => requestStep(PARSE_STEP) : undefined}`
   （已归档只读不给跳转）。
4. **BidWorkspacePage.tsx（在途 M，两处 SubmissionCheckPanel 渲染点均在 pristine 走廊）** — 各传 `requestStep={p.requestStep}`。
5. **pipelineStep.test.ts** — +2 用例：`PARSE_STEP` 指向真实存在且名称含「AI 解析报告」；`checklistParseHint` 用单一真源步骤名拼接。

## 关键设计
- 复用**守卫版** `requestStep(2)`：目标步骤前置产物齐则跳转，否则 toast 说明缺什么 —— **永不死链**，
  与 R200 三面板同一机制。
- 步骤名不硬编码：`checklistParseHint` / 按钮标签均经 `stepGoLabel → PIPELINE_STEPS.find`，与流程条唯一真源绑定。

## 类别与合规
A 类：零 schema / 零 collection / 零 pb_hooks / 零提示词改动（`B` 类流程未触发）。

## 四门验证（目标项目目录）
| 门 | 结果 |
|----|------|
| `npx tsc -b` | 0 错误 |
| `npx vitest run` | 128 files，**1501 passed / 2 skipped**（基线 1499 → +2 用例） |
| `npx eslint`（触及 5 文件） | 0 error（在途既有 error 不计） |
| `npx vite build` | built in 3.42s |

## 在途说明
SubmissionCheckPanel.tsx / BidWorkspacePage.tsx 处于重度在途期。锚点均落在 git diff hunk 之外的 pristine 区域
（SubmissionCheckPanel 唯一 hunk 在 new-line 965 的格式检查文案，距本次改动区很远），每处 `str.replace` 前
`assert count==1`。未 commit（遵守禁令）。

## 实机核验限制
本地 PocketBase 经 `/__pb` 代理走托管后端，无后端 / 无登录 / 无种子 → 浏览器实机点击核验不可行，
以纯函数单测（步骤名真源校验）+ tsc + build 背书，与 R196-R200 一致口径。
