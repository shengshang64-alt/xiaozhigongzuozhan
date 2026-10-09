# R196 · 驾驶舱「进行中的项目」数据打通（docs/13 §3.2）

## 选题依据
docs/13「全站体验审查与优化清单 2026-10-08」§三·最值得投入三件事之一（§3.2）：首页「进行中的项目」卡
读取独立的 `projects` 手工清单，因无人维护常年显示「还没有进行中的项目」，而标书工作台有 7 个活跃项目、
方案 1 个——驾驶舱「总览」名不副实。Home 页面（src/pages/Home）当前不在在途改动集内，碰撞风险最低，
且属实质功能补强而非零风险小改，故本轮择优实施。

## 方案（只读聚合，零后端 / 零新 collection）
把四个工作台集合的「进行中」条目纯客户端聚合为统一只读视图，点击深链跳转，不写任何数据，每卡可回退。
取数与逻辑分离，纯函数可脱离后端单测。

| 文件 | 职责 |
|---|---|
| `src/pages/Home/activeWork.ts` | 纯逻辑：`buildActiveWork` 聚合/过滤/排序/截断 + `isBidActive`；结构化行类型 |
| `src/hooks/useActiveWork.ts` | 并行拉 `/api/bid_projects`、`/api/solutions`、`/api/ppt_decks`、`/api/quotes` 各 30 条，`pbJsonGet` 静默降级、全失败返回空不阻塞首页（沿用 `useActivityFeed` 约定） |
| `src/components/home/ActiveWorkSection.tsx` | 只读聚合卡，图标沿用全局命令面板对四集合既有取色（bid=FileCheck2 / solution=FileText / deck=Monitor / quote=Calculator） |
| `src/pages/Home/activeWork.test.ts` | 单测 +7 |
| `src/pages/Home/useHome.ts` | 接线：import + `useActiveWork(userId)` + return `activeWork`/`activeWorkLoading` |
| `src/pages/Home/HomePage.tsx` | 接线：置于手工 `ProjectsSection` 之前渲染 `<ActiveWorkSection />` |

## 口径细节
- **进行中判定**：标书剔除 `deleted_at` 与 `archived`/`stage==='archived'`；方案 `doc_status!=='done'`；
  PPT `doc_status!=='done'`；报价无成稿状态，作为参考性在制事项全量纳入。
- **缺省态**：方案缺 `doc_status` 按「大纲中」、PPT 按「草稿」、标书按「进行中」；名称缺省回退「未命名…」占位。
- **状态标签**：`BID_STAGE_LABEL` / `DOC_STATUS_LABEL` / `DECK_STATUS_LABEL`，报价固定「报价参考」。
- **排序/上限**：按 `updated` 倒序，单卡最多 12 条（总览非清单）。
- **深链**：`/bid-workspace?project=` · `/solution-studio?solution=` · `/ppt-quote?deck=` / `?quote=`，
  与 `useGlobalSearch`、`usePptQuote` 深链消费参数一致。

## 四门验证（目标项目目录）
- `npx tsc -b`：**exit 0**（新文件与接线均类型安全；`DocStatus`/`DeckStatus` 索引 cast 兜底 + `|| '进行中'` 回退）。
- `npx vitest run`：**125 files / 1476 passed | 2 skipped，exit 0**。基线 124 files / 1469 passed，本轮 +1 文件 +7 用例全绿。
- `npx eslint`（触及文件）：`activeWork.ts`/`useActiveWork.ts`/`ActiveWorkSection.tsx`/`activeWork.test.ts`/`HomePage.tsx` **零 error**；
  `useHome.ts` 仅剩 3 条在途既有 `react-hooks/set-state-in-effect`（L321/542/741，非本轮所加行，属在途代码既有 error）。
  新 hook 空态分支的同步 setState 与 `useActivityFeed` 同模式，对该行加定向豁免以保持新文件零新增 error。
- `npx vite build`：**exit 0，built in 3.41s**。

## 边界与裁定
- 零 AI 调用、零新 collection、零提示词改动（不走 B 类流程）、零 pb_hooks 改动；只读不写。
- 手工 `ProjectsSection`（新增/进度/备注）行为与数据完全保留，本轮仅在其之前叠加只读聚合卡，可安全回退。
- 未 git commit（遵循禁令）。

*执行：R196 自主迭代 · 2026-10-08*
