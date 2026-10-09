# R197 · 驾驶舱顶部数字改由真实四工作台聚合驱动（完成 docs/13 §3.2）

## 选题依据
R196 上线了跨标书 / 方案 / PPT / 报价的「进行中」只读聚合卡，但驾驶舱顶部两处**仍读空置的手工 `projects` 清单**：
1. 欢迎横幅问候语「有 N 个项目进行中」（`activeProjectCount`）
2. 统计卡首格「进行中项目」（同一 `activeProjectCount`）

两者恒显 0，与新卡的真实数据自相矛盾——这正是 `docs/13` §3.2 判定「驾驶舱『总览』名不副实」的根因。
本轮完成该目标闭环（非另起新战场的缩小，而是把同一 §3.2 需求真正做完）。

## 方案
| 文件 | 变更 |
|---|---|
| `src/pages/Home/activeWork.ts` | 追加纯函数 `countActiveWork(rows)`：真实总数 + 分工作台明细（进行中口径与 `buildActiveWork` 完全一致，但**不受单卡 12 展示上限截断**）；`formatActiveWorkBreakdown(byKind)`：明细可读串，跳过 0 项、按标书/方案/PPT/报价固定顺序 |
| `src/hooks/useActiveWork.ts` | 由「只存展示条目」改为「持有原始四集合行」，`useMemo` 派生 `items` 与 `stats`，新增导出 `activeWorkTotal` / `activeWorkByKind` |
| `src/pages/Home/useHome.ts` | 透出 `activeWorkTotal` / `activeWorkByKind` |
| `src/pages/Home/HomePage.tsx` | 问候语 → 「各工作台共 N 项工作在制」；`<StatsRow>` 首格数据源换真实聚合 |
| `src/components/home/StatsRow.tsx` | 首格 label「进行中项目」→「工作台进行中事项」，value 用 `activeWorkCount`，悬停 `formatActiveWorkBreakdown` 明细；移除 200 截断「+」旧口径 |
| `src/components/home/ProjectsSection.tsx` | 手工卡标题「进行中的项目」→「我的项目跟进清单」、空态「还没有进行中的项目」→「还没有登记跟进事项」，消除与聚合卡的口径冲突；新增/进度/备注全部行为与数据零改动 |

口径细节：报价无成稿状态 → 与 `buildActiveWork` 一致全量纳入；方案 / PPT 剔 `done`；标书剔软删除 / 归档。

## 四门验证（目标项目目录）
- `npx tsc -b`：**exit 0**（首轮报 `useActiveWork.ts` 未用 import `ActiveWorkItem` → 移除后归零；其余接线类型安全）。
- `npx vitest run`：**125 files / 1480 passed | 2 skipped，exit 0**。上一收口 1476，本轮 `activeWork.test.ts` +4 用例全绿（分工作台明细、真实总数不受 12 截断、明细串顺序与跳零、空源归零）。
- `npx eslint`（触及文件）：本轮 6 个新/改文件**零 error**；`useHome.ts` 仅剩 **3 条在途既有** `react-hooks/set-state-in-effect`（L321/542/741，非本轮所加行）。
- `npx vite build`：**exit 0，built in 3.12s**。

## 边界与裁定
- 零 AI / 零新 collection / 零提示词改动（不走 B 类流程）/ 零 pb_hooks；只读展示 + 文案，每处可回退。
- 手工跟进卡行为与数据完全保留，仅标题/空态文案消歧。
- **实机走查**：该卡与数字为数据驱动，需本地 PocketBase + 登录态 + 种子数据；当前无运行中的 dev 服务，故本轮以纯函数单测 + tsc + build 背书逻辑与接线，浏览器走查留待有栈时补（与既往数据驱动轮次一致）。
- 未 git commit（遵循禁令）；账本回写前已备份 `.bak-r197`。

*执行：R197 自主迭代 · 2026-10-08*
