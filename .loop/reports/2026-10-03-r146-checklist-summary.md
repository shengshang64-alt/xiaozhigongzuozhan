# R146 建设清单分类小计 + 顶部汇总（预算结构可视化）

日期：2026-10-03 | 轮次：R146（接续 R145）| 优先级：P2 实质项 | 模块：/solution-studio（方案编制主链路）

## 选题依据
用户点名的两优先项（quote-history-01 R102/R131、prompt-fabscan-03 R103）均已收口，按权重（方案>标书>PPT）巡检方案编制链路。建设清单是「方案前置环节」（ChecklistView 页首原话），其明细表 `ChecklistDetailPanel` 原本只有逐行小计与底部全局合计，缺两项结构视角：
- 每个分类（HIS/LIS/硬件…）的**分类小计**——售前做预算分档评审时无法一眼看清钱集中在哪些分类；
- **条目数 / 分类数 / 外购缺口数**的汇总口径——底部只显示合计金额，分类/条目/外购需人工数。
属真实交互补全，纯本地零 AI、零 schema。

## 变更
1. 新建纯函数模块 `src/pages/SolutionStudio/checklistSummary.ts`：
   - `subtotalOfLines(lines)`：一组行数量×单价求和，qty/unit_price 非法值按 0 计；
   - `summarizeChecklistCategories(lines)`：按 category 分组汇总勾选行，保留首次出现顺序，未勾选剔除，空分类归「未分类」（与 DetailPanel 既有 `l.category || "未分类"` 口径一致），统计各分类外购行数；
   - `buildChecklistTotals(lines)`：全局 `lineCount / categoryCount / externalCount / total`，其中 total **复用 `calcTotal` 单一真源**避免口径分叉。
2. 新建单测 `checklistSummary.test.ts`（8 用例）：小计、NaN 兜底、分类聚合顺序、未勾选剔除、空分类归未分类、外购计数、totals 与 calcTotal 一致、空/全未勾选/null 入参安全。
3. 接线 `ChecklistDetailPanel.tsx`（4 处）：
   - import `buildChecklistTotals, subtotalOfLines`；
   - `if (!rec) return null` 后 `const totals = buildChecklistTotals(rec.items ?? [])`；
   - 每个分类组尾追加小计行（colSpan 6 标签 + 小计金额 + colSpan 3 补齐，合计 10 列对齐表头）；
   - 底部汇总条由「合计」扩展为「N 个分类 · M 个条目 · 外购 X」+「合计」。

## 在途保护
`git diff -U1` 核对该文件在途改动仅为助手前序轮的 xlsx 懒加载(`@@ -5,3 +5,2`)与数量/单价 `min={0}`(`@@ -122/-138`)，全部不落在四个锚点区。四锚点 `assert count==1` 唯一命中，未误伤用户代码。

## 合规
零 collection / 零 pb_hooks / 零会话外 state（totals 为组件内派生 const，groups 亦为 useMemo 派生）/ 未动提示词（非 B 类，无 PROMPT_VERSION）/ 未 commit。维持裁定不动：编造只报不拦(R89)、lint-debt-01 不重构、5 个 defer-on-WIP 项继续在途绕开。金额显示走 `fmtMoney`→`@/lib/money` 单一真源（R113）。

## 四门验证
- `npx tsc -b`：exit 0（零错误）
- `npx vitest run`：966 passed / 2 skipped（基线 958 +8 新用例，91→92 测试文件，全绿）
- `npx eslint` 三个触及文件：0 error 0 warning
- `npx vite build`：exit 0（3.75s；chunk 体积告警为既有基线非本次引入）

## 后续观察（不本轮做）
分类小计目前按「插入顺序」分组；若后续需要「按金额降序」重排分类以突出预算大头，可在 `summarizeChecklistCategories` 追加排序选项，属独立口径变更需先定夺，暂挂。
