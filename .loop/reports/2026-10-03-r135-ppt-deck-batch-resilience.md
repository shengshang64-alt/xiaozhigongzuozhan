# R135 PPT 逐页生成韧性改造（deckBatchRecovery，PPT 主链路·生成接续）

## 选题
- 用户点名两项（quote-history 二期、prompt-fabscan-03 按章聚合回注）已分别于 R102/R131、R103 closed；
  五个 defer 项继续在途绕开（ComposeStep 458 行 WIP 等）。
- 巡检命中：`doGenerateDeck` 分批生成路径**零容错**——批量循环内无任何 try/catch，
  单批网络抖动/网关错误/返回空即整单 throw：前面批次已付费 token 全部作废、deck 不落库、
  用户只看到一条报错要从头重跑。与 R126 标书侧修复的「从未完整生成/静默失败」同类故障，
  标书侧已有「单批失败重试 1 次后跳过（不让一批拖垮全局）」成熟口径，PPT 侧缺失。
  该缺口正是既往规划点名的「deck 生成接续」候选项。

## 变更
1. 新建 `src/pages/PptQuote/deckBatchRecovery.ts`（纯函数、零副作用、node 直测）：
   - `withGenerationRetry(generate, {maxAttempts=2, isEmptyResult, emptyMessage})`：
     单发生成重试核心；全部抛错重抛最后一个错误（保留网关侧已本地化文案），
     末试「成功但为空」抛 emptyMessage。
   - `runBatchesWithRetry({batches, generate, onBatchStart})`：逐批串行 + 批内重试，
     返回按批次序对齐的 `(Item[]|null)[]`，null=该批彻底失败，不中断后续批次。
2. `usePptQuote.ts` `doGenerateDeck` 两路接入：
   - 单发路径（≤10 页）：瞬时失败/返空自动重试 1 次，进度文案「生成未完成，正在自动重试…」。
   - 分批路径（>10 页）：每批重试 1 次；仍失败的批按大纲**原位**留「仅标题占位页」
     （emptySlide：无正文、layout=auto，不会被自动配图选中二次烧钱），保住骨架供编辑器逐页补全；
     全军覆没才报错且**不建空壳 deck**。
   - 结果反馈：部分失败改 `toast.warning「N/M 页已生成，X 页未成功已留标题占位…」`，
     全成功维持原 success 文案。
3. 新建 `src/pages/PptQuote/deckBatchRecovery.test.ts` 共置单测 12 用例：
   首试成功不二调、抛错后重试成功、重抛末错、空结果判定重试/耗尽抛 emptyMessage、
   maxAttempts 上限、批次序对齐、失败置 null 不中断后续、空批返回空、onBatchStart 试次序列。

## 红线与裁定
- 零 collection / 零 pb_hooks / 零会话外 state / 未动 AI 提示词（免 B 类流程，无 PROMPT_VERSION 变更）。
- 维持既有裁定：编造门禁只报不拦、lint-debt-01 残余不重构、五个 defer 项继续在途。
- 未 commit。用户可见文案无内部字段名/阶段编号。

## 在途保护
- `usePptQuote.ts` 为 git-M，但核对全部 20 个 diff hunk 均属助手前序轮次自有改动
  （R105/R112/R113/R124/R130/R131 收敛项），doGenerateDeck 锚点区域不在任何 hunk 内，
  无用户 WIP 命中；补丁三处锚点 assert count==1 唯一命中。

## 四门验证
- `npx tsc -b`：exit 0。
- `npx vitest run`：**900 passed + 2 skipped**（基线 888，增量 +12 = deckBatchRecovery.test.ts 全绿）。
- `npx eslint` 触及 3 文件：新模块+新测试 0 问题；usePptQuote.ts PRE/POST 对照完全同构
  （4 errors + 1 warning 均为在途既有 react-hooks 遗留，仅行号位移），本轮净新增 error = 0。
- `npx vite build`：exit 0，4.22s。

## 补丁脚本
`d:\KFDXCX\MedPreSales\scripts\r135_deck_batch_recovery.py`
