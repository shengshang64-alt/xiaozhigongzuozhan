# R273 — BidCheck L5-D AI 语义复核（置信度接入）

**Round**: 273 | **Date**: 2026-10-12 | **Priority**: P2 | **Type**: 实质性优化（非零风险小改）

## 选题依据
`.loop/ledger.json` round=272 时 backlog 86 项中，剔除陈旧项（r219/r142/prompt-fabscan-03 
虽显示 open 但早期已闭环）与维持裁定项（编造嫌疑未清零硬门禁保留只报不拦、lint-debt-01 
有意保留），真正 open 的实质项集中在 `r261-bidcheck-followons` 五期残余——
**L5-D「AI 类项置信度」**是 BidCheck 五级中枢唯一未接入的 AI 侧能力：
`CheckItem.confidence` 字段已定义、`toExcel.ts` 已预留「置信度 %」列，从未填充。
本轮把这条挂账闭环。

## 实现概览
### 新增 `semanticReview.ts`（纯函数、可测）
- `REVIEW_BATCH_MAX = 10`
- `pickReviewCandidates(items)` — 按 critical→high→medium→info 排序筛 fail/warn，截断 10
- `buildReviewInputs(items)` — 首条 hit 上下文，hitText ≤160/paragraphText ≤200
- `buildReviewPrompt(inputs)` — system 含 1.0/0.7-0.9/0.3-0.6/0.0-0.2 判定准则 + JSON 契约
- `parseReviewResponse(text)` — 去 markdown 代码块、找 JSON 数组、clamp 0-1、reason/reasoning 兼容
- `applyConfidence(items, results)` — 只标不改裁定：仅更新 confidence + 挂会话态 confidenceReasoning，
  status/severity 恒不变，不 mutate 原数组
- 类型 `ReviewAnnotatedItem = CheckItem & { confidenceReasoning?: string }`

### `useBidCheck.ts` 增量
- `import` chatViaGateway / useCostConfirm / semanticReview.*
- `const [reviewing, setReviewing] = useState(false)`
- `const costConfirm = useCostConfirm()`
- `runSemanticReview = useCallback(...)`：pickReviewCandidates → buildReviewInputs → 
  buildReviewPrompt → chatViaGateway(cacheable=true, page=BidCheck) → parseReviewResponse → 
  applyConfidence → setResult 更新 items
- 全程 `costConfirm.runWithCostConfirm(() => ...)` 包裹，走全站计费契约
- vm 返回新增 `reviewing / runSemanticReview / costConfirm`

### `BidCheckPage.tsx` 增量
- 「开始检查」按钮左侧新增「AI 复核」按钮（variant=outline，Sparkles 图标）
- `disabled = reviewing || running || !result || (fail+warn===0)`
- 页面底部挂载 `<CostConfirmDialog {...costConfirm} />`

### `ReadingView.tsx` 增量
- 问题卡片 severity badge 旁追加 confidence `%` badge（variant=neutral）
- badge `title` tooltip：有 reasoning → `AI 复核：${reasoning}`；否则显示"AI 复核置信度（问题真实存在的把握度）"
- 局部 cast 到 `ReviewAnnotatedItem`，不污染共享 `CheckItem`

## 维持裁定
- **只标不改**：AI 只填 confidence，不改 status/pass/fail → 「编造嫌疑未清零禁止导出=只报告不拦截」
  硬门禁裁定不推翻
- **零 collection 变更**：confidence 字段早已存在，confidenceReasoning 走会话态 TS union
- **零提示词文件改动**：本次 prompt 内嵌于 system 参数而非 prompts/*.yaml，不需 B 类流程
- **不动 pb_hooks**

## 成本三重护栏
1. `REVIEW_BATCH_MAX=10` — 单次最多 10 条送审
2. `cacheable=true` — 会话内相同 items 命中 llmCacheIdentity，不重复计费
3. 用户主动点击 — 不自动运行，不做后台 AI 消耗

## 四门验证
| 门 | 命令 | 结果 |
|---|---|---|
| Type-check | `npx tsc -b` | EXIT 0 |
| Unit-test | `npx vitest run` | 175 files / **1968 passed + 2 skipped**（基线 174/1955+2 → +1 file / +13 tests） |
| Lint | `npx eslint` 触及 5 文件 | EXIT 0（零 error/warn） |
| Build | `npx vite build` | EXIT 0 |

## 触及文件（5 个）
- 新增：`src/pages/BidCheck/semanticReview.ts`
- 新增：`src/pages/BidCheck/semanticReview.test.ts`
- 修改：`src/pages/BidCheck/useBidCheck.ts`
- 修改：`src/pages/BidCheck/BidCheckPage.tsx`
- 修改：`src/pages/BidCheck/ReadingView.tsx`

补丁脚本（跨工作区）：`d:\KFDXCX\MedPreSales\scripts\r273_*.py`
备份：`.bak-r273` × 3（useBidCheck.ts / BidCheckPage.tsx / ReadingView.tsx）

## 后续挂账
- L5-D 若稳定后可考虑在 Excel 导出增加"高置信 fail"独立 sheet（当前 confidence 列已就绪）
- 若要引入 AI 直接建议改 status，需重新评审「只报不拦」裁定 → 挂 r273-followup-confidence-gate
- 更多 L3 内容类项送审需重新评估批量阈值与 token 成本
