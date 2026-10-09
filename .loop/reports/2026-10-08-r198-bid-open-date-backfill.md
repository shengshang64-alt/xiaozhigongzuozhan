# R198 · 标书开标时间就地补录条（修复 §3.5 功能断链）

## 选题依据
`docs/13` §3.5 记「开标时间补录入口在标书工作台项目内不显眼」。源码核查后确认根因更严重——是**功能断链**：

- `bid_open_date` 只能在 **新建项目对话框**（`BidProjectList` `formBidOpenDate`）设置，或由解析回填 `parseBackfillFields` 命中；
- 项目建好并打开后，流水线头部 / 作战室 / 列表**均无编辑入口**（列表只有已设值时的倒计时 chip，作战室只在描述里只读展示）；
- 而 `BidNodesCard`（驾驶舱投标节点提醒）、`PipelineStepper`（开标倒计时徽标）、截标预警**全部依赖该字段**。

于是形成「提醒催你去补、却无处可补」的死循环。这是用户点名优先级里标书域（方案>标书>PPT）的实质缺陷，故选它。

## 方案（最小碰撞）
| 文件 | 变更 |
|---|---|
| `src/components/bid-workspace/bidOpenDate.ts` | 新建纯逻辑：`bidOpenDateStatus(iso, nowMs?)` 返回 `{daysLeft, tone, label}`，分档 `missing/past/urgent/normal`（天数口径与 `PipelineStepper.daysUntilOpen` 一致，可注入基准时刻便于单测）；`normalizeBidOpenDateInput(v)` 归一：合法 `yyyy-mm-dd` 原样、空白→`""`（清除）、格式/日期非法→`null` |
| `src/components/bid-workspace/BidOpenDateBar.tsx` | 新建流水线头部补录条：未登记→琥珀引导 + 就地日期输入；已登记→查看态 + 修改/清除；倒计时 chip 走 `bidOpenDateStatus`；`isArchivedLocked` 禁用全部编辑并 title 说明 |
| `src/pages/BidWorkspace/BidWorkspacePage.tsx` | 接线：`import` + 在 `OpportunityLinkBar` 之后、归档横幅之前插入 `<BidOpenDateBar key={activeProject.id} …/>`（`key` 绑项目 id 触发重挂载，杜绝切项目陈旧草稿，组件因此**零 effect**） |

### 持久化：零改 93-hunk 在途 hook
复用 `useBidWorkspace` **已导出**的 `updateProject({ bid_open_date })`——它 PATCH 的是集合里**已存在**的 `bid_open_date` 字段，并 `applyProjectState` 同步 `activeProject` 与列表，故 `PipelineStepper` 倒计时即时刷新；`deriveStage` 不以 `bid_open_date` 为输入，故不会误改阶段。
→ **零新 collection / 零迁移 / 零 pb_hooks / 零提示词改动 / 零 AI 调用**；`useBidWorkspace.ts`、`bidTypes.ts` 一行未动。

### 碰撞核对
`git diff` 显示 `BidWorkspacePage.tsx` 仅 4 个在途 hunk（行 145/171/235/266），本轮两处插入（import 区、`OpportunityLinkBar` 之后 ~行 59）均在 hunk 之外；`useBidWorkspace.ts`(93 hunk) / `bidTypes.ts` 未触碰。

## 四门验证（目标项目目录）
- `npx tsc -b`：**exit 0**。
- `npx vitest run`：**126 files / 1490 passed | 2 skipped，exit 0**。上一收口 1480，本轮 `bidOpenDate.test.ts` +1 文件 +10 用例全绿（缺失 / 非法 / >7 天 normal / ≤7 天 urgent / 已过期 past / 今日开标 / 清除归一空串 / 合法 ISO 原样 / 错误分隔符拒绝 / 月份越界拒绝）。
- `npx eslint`（触及 4 文件）：**exit 0，零 error 零 warning**；过程中清掉一处未用导出 `BID_OPEN_EMPTY`（避免留下死代码）。
- `npx vite build`：**exit 0，built in 3.25s**。

> 说明：objective 文中「基线 630 passed」为旧值，实际上一收口为 1480（125 files）；本轮报真实增量 +1 文件 / +10 用例。

## 边界与裁定
- 属既有字段写入 + 只读展示，非数据模型变更；无提示词改动，不走 B 类流程。
- 维持既有裁定不变（编造嫌疑导出门禁「只报告不拦截」、lint-debt-01 不重构），本轮未触碰。
- **浏览器实机核验**：该条为登录态 + 数据驱动，且 PocketBase 经 `/__pb` 走 VibeX 托管后端（`getPocketBaseUrl`）；本地 `localhost:8000` 无该后端 → 无法登录并打开「缺失开标时间的种子项目」走到该 detail 视图。故与既往数据驱动轮次一致，以纯函数单测 + tsc + build 背书逻辑与接线正确性，实机走查留待有托管栈 + 登录 + 种子时补。
- 未 `git commit`（遵循禁令）；账本回写前已备份 `.bak-r198`。

*执行：R198 自主迭代 · 2026-10-08*
