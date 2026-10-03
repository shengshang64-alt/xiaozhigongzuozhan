# R131 报价参考区间相关性精化（quote-history 二期增量）

日期：2026-10-03　round：130 → 131　优先级：P2（实质性优化，非零风险小改）

## 背景与选题
- backlog 中 quote-history-01（R102）与 prompt-fabscan-03（R89）均已 closed，用户强调的
  「报价历史二期智能推荐区间」核心逻辑已在 R102 以纯函数 quoteRecommend.ts 落地并由
  QuoteEditor「成交参考区间」面板消费（total_range / matches / module_ranges / note）。
- 巡检发现一处**实质性可用性缺陷**：面板底部「逐模块单价参考（历史成交）」只按历史出现
  频次排 top10，与用户**当前这单实际涉及的产品无关**——标题叫「逐模块」，展示的却可能是
  本单根本没买的模块单价，用户无法据此校准自己的报价。

## 方案（纯函数增强 + 调用方喂参，向后兼容）
1. `QuoteDimensions` 新增可选 `items?: string[]`（当前报价涉及的产品/条目名）。
2. `ModuleRange` 新增 `in_current: boolean` 标记该模块是否为当前报价涉及条目。
3. `recommendFromHistory` 内：
   - 计算 `currentItems` 集合（trim + 去空，与 priceByModule 键提取口径一致）；
   - module_ranges 排序由「仅按 count 降序」升级为
     **相关性优先：in_current 置顶 → 样本数降序 → 中位价升序**；
   - 当存在当前涉及模块时，向 note 追加口径说明「已优先展示当前报价涉及模块的历史单价。」
4. 调用方 `usePptQuote.ts` 的 `quoteRecommendation` useMemo 里给 dims 传入 `items`
   （从 activeQuote.groups 的条目取 `product_name ?? item_name`）。
- **渲染层零改动**：QuoteEditor 仅按 module_ranges 数组顺序 map，置顶即自动生效，
  无需触碰 git-M 的 QuoteEditor.tsx。

## 边界与裁定
- 数据模型：零 collection、零 pb_hooks、零会话 state 变更；仅一个可选入参 + 一个纯函数输出字段。
- 提示词：本轮**未改任何提示词**，不涉及 B 类流程 / PROMPT_VERSION / 快照。
- 维持既有裁定不动：编造嫌疑门禁只报不拦、lint-debt-01 有意保留残余、五个 defer 项
  （r112-datestamp / money-count-composestep / r119-dead-export / r124-solutionstudio-docx /
  r130-price-preview-404）均在 git-M 在途区，本轮继续绕开不接。
- 未 git commit。

## 在途代码保护（改前核对）
- quoteRecommend.ts / quoteRecommend.test.ts 为 `?? ` 未跟踪（R102/R127 系列本助手新增模块，非用户手写 WIP）。
- usePptQuote.ts 为 `git M`：`git diff -U0` 显示 20 个 hunk，触区为 R102/R103 自己新增的
  纯 added 块 `@@ -1969,0 +1991,47 @@`（含 quoteRecommendation useMemo，行 2033）；本轮新增 items 行
  落在该「本助手新增块」内部，与用户手写 set-state-in-effect WIP hunk（216/1358/1433/2148）零交集。

## 四门验证（目标项目目录）
- `npx tsc -b`：0 错误。
- `npx vitest run`：**871 passed | 2 skipped**（基线 869 passed + 2 skip → **+2**，即本轮两条增量单测；
  quoteRecommend.test.ts 单跑 13 passed = 旧 11 + 新 2）。
- `npx eslint` 触及文件：quoteRecommend.ts / quoteRecommend.test.ts 净新增 0；
  usePptQuote.ts 5 error（react-hooks/set-state-in-effect）+1 warning（exhaustive-deps）**全为既有**，
  与本轮 items 纯计算无关，净新增 0。
- `npx vite build`：成功（约 5.0s，dist 资源正常产出）。

## 新增测试
1. 「传 items：当前报价涉及模块优先置顶并标记 in_current」——构造 服务器(3)/HIS(2) 在当前 items 内、
   办公桌椅(2) 不在，断言 module_ranges 前二为 [服务器, HIS]、首位 in_current===true、办公桌椅 in_current===false、
   note 含「已优先展示当前报价涉及模块」。
2. 「不传 items：in_current 全为 false 且不追加相关度提示（向后兼容）」——保证不喂 items 时旧行为完全等价。

## 涉及文件
- src/pages/PptQuote/quoteRecommend.ts（纯函数：QuoteDimensions.items / ModuleRange.in_current / 排序 / note）
- src/pages/PptQuote/usePptQuote.ts（dims 传入 items）
- src/pages/PptQuote/quoteRecommend.test.ts（+2 增量单测）
- scripts/r131_quote_module_relevance.py（补丁落地脚本）
