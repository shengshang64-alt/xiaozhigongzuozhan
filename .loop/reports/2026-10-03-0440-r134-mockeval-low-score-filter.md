# R134 模拟评标交互补全：低得分/分差判定收敛单一真源 + 汇总卡点击筛选

日期：2026-10-03-0440　round：134（接续 133）

## 选题背景
用户点名的两个实质项经账本核实均已 closed：
- quote-history-01 报价历史二期：一期 R40、结单沉淀 R79、二期智能推荐区间 R102、相关性精化 R131，全链路已交付；
- prompt-fabscan-03 残余「按章聚合回注改进建议」：R103 落地 + R131/R133 复核，backlog 已 closed。

按优先级（标书 > 方案 > PPT）巡检标书主链路新实质角度。R131-R133 连续三轮均在标书侧，本轮继续标书「模拟评标」补全交互（用户 memory 明确列为「评标模拟/符合性检查交互补全」优先候选）。

## 发现的问题
`EvalResultView`（模拟评标技术路结果视图，MockEvalPanel.tsx，另被 QuickToolsPanel 只读复用）顶部四张汇总卡中：
- 「低得分率评分项」卡只显示计数，无法据此定位到具体是哪些弱项、扣在哪；
- 「AI 与人工分差」卡只显总分差，同样不可点。
且「低得分率」判定 `max_score>0 && ai_score/max_score<0.6` 在**卡片计数**与**表格行内 lowRate 高亮**两处内联重复，属单一真源缺失（任一后续调阈值易漂移）。

## 变更
1. 新建 `src/components/bid-workspace/evalItemFilter.ts`（纯函数，node 可测）：
   - `isLowScoreBidItem`：低得分率判定单一真源（得分率<60% 且 max_score>0，max_score=0 避免除零）；
   - `isGapBidItem`：AI-人工分差判定（人工已打分>0 且 |差|>=阈值，默认 2）；
   - `filterEvalRowIndexes`：按筛选模式返回**原始下标**列表，不重排——人工打分回调仍以原 idx 定位，筛选后不串行。
2. `MockEvalPanel.tsx` EvalResultView：
   - 顶部 `useState<EvalRowFilter>("none")`；`lowCount`/`gapCount`/`visibleIdx` 由上述纯函数派生；表格行 `lowRate` 改取 `isLowScoreBidItem`（内联重复消除，行为等价）；
   - 「低得分率评分项」「AI 与人工分差」两张卡改为可点击 `<button>`（aria-pressed + title + 命中态 destructive 高亮），点击切换只看该类项；无命中（计数 0 或只读无人工分）时 disabled 不可点；
   - 筛选态提示条显示「只看…（n/总数）」+「显示全部」复位；空态行 colSpan 随 editable 取 6/5。
   - QuickToolsPanel 只读复用不传 manualReview → editable=false → gapCount=0 分差卡自动禁用、低分卡仍可筛，向后兼容零改动生效。

## 红线与裁定
- 零 collection / 零 pb_hooks / 零会话外 state（filter 为组件内 useState）；
- 未动 AI 提示词（不涉 B 类，无 PROMPT_VERSION 变更）；
- 纯展示层交互，业务行为与数据等价；
- 维持全部既有裁定：编造未清零只报不拦（R89）、lint-debt-01 不重构、各 defer 项（r112/money-count-composestep/r119/r124/r130）继续在途绕开；
- 未 git commit。

## 在途保护
MockEvalPanel.tsx 为 git-M，但 `git diff -U0` 仅一处日期格式化（L7 import dateDisplay + L336 评标时间改用 formatDateTimeDisplay，均 R114 助手自有收口，非用户 WIP）。本轮 import/header/cards/table-body/empty-row 五处锚点全落在 commit-state 代码区，补丁内置 `assert count==1` 强制校验命中唯一。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0，零错误；
- `npx vitest run`：888 passed | 2 skipped（基线 878 +10 = evalItemFilter.test.ts 新增 10 用例：isLowScore 3 / isGap 3 / filterEvalRowIndexes 含保留原下标与 manual 缺省不抛 4），exit 0；
- `npx eslint` 触及 3 文件（MockEvalPanel.tsx / evalItemFilter.ts / evalItemFilter.test.ts）：exit 0，零 error；
- `npx vite build`：exit 0（3.98s）。

## 文件
- src/components/bid-workspace/evalItemFilter.ts（新建，纯函数单一真源）
- src/components/bid-workspace/evalItemFilter.test.ts（新建，10 用例）
- src/components/bid-workspace/MockEvalPanel.tsx（判定收敛 + 两卡可点击筛选 + 提示条/空态）
- scripts/r134_moockeval_low_score_filter.py（跨工作区补丁脚本）
