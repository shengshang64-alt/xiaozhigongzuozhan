# R273 L5-D AI 语义复核（置信度）场景自测

## 背景
BidCheck 五级检查中枢在 R261 收口时把 L5-D「AI 类项置信度」作为残余挂账：
`CheckItem.confidence: number | null` 字段已定义、`toExcel.ts` 已预留「置信度 %」列、
但从未填充。本轮接入该能力——用户主动点击「AI 复核」按钮，L5（暗标合规）/L3（内容类）
等 by-rule 判定 fail/warn 的项送 LLM 二次判读，回填 0-1 置信度 + 会话态 reasoning。

## 设计约束（维持既有裁定）
- **只标不改裁定**：AI 仅填 `confidence`/`confidenceReasoning`，**不改** `status`/`severity`，
  保留「编造嫌疑未清零禁止导出=只报告不拦截」硬门禁裁定不推翻。
- **零 schema 变更**：`confidence` 字段早已存在于 `bidCheckTypes.ts`；
  `confidenceReasoning` 走会话态 TypeScript union（`ReviewAnnotatedItem`），
  不新增 PocketBase collection 字段、不动 pb_hooks。
- **成本三重护栏**：批量 ≤10 条（`REVIEW_BATCH_MAX`）+ `cacheable=true` + 用户主动点击。
- **计费契约**：走 `useCostConfirm` + `<CostConfirmDialog {...costConfirm} />` 全站范式。
- **AI 入口**：走 `chatViaGateway`，禁止直连 API。

## 操作步骤（模拟三甲医院标书场景）
1. 登录 → 标书检查页 `/bidcheck`
2. 上传招标文件 + 已投标书 → 「开始检查」→ 本地 by-rule 五级跑完
3. 结果出现后，「AI 复核」按钮由 disabled 变可点击（`!running && result && (fail+warn)>0`）
4. 点击「AI 复核」→ 弹出计费确认对话框（沿用全站 useCostConfirm 契约）
5. 确认后按钮转 spinner，`reviewing=true` 期间禁用重复点击
6. 返回后：问题卡片 severity badge 旁出现青绿 `%` 数字 badge
7. 悬停 badge → tooltip 显示 `AI 复核：<reasoning>`（会话态）
8. 导出 Excel → 「置信度 %」列不再全是「—」

## 输入
- `pickReviewCandidates(items)`：按 critical→high→medium→info 排序筛 fail/warn 前 10
- `buildReviewInputs(items)`：取首条 hit 的 `text`（≤160 字符，超出加 …）+ `paragraphText`（≤200）
- `buildReviewPrompt(inputs)`：system 含 1.0/0.7-0.9/0.3-0.6/0.0-0.2 判定准则 + JSON 数组契约
- `parseReviewResponse(text)`：容错去 markdown 代码块 + clamp 0-1 + reason/reasoning 别名兼容
- `applyConfidence(items, results)`：只命中 code 项更新，不 mutate 原数组，status/severity 恒不变

## 预期/实际结果
| 用例 | 预期 | 实际 |
|---|---|---|
| 全 pass 项点复核 | 按钮 disabled | ✓ `fail+warn === 0` |
| AI 返回 0.9 | 显示 90% badge | ✓ |
| AI 返回 17（越界） | clamp 到 1.0 → 100% | ✓ 单测覆盖 |
| AI 返回 -3 | clamp 到 0 → 0% | ✓ 单测覆盖 |
| AI 返回 "abc" | 降级 0 | ✓ |
| AI 返回非数组 | 安全降级空数组 | ✓ |
| AI 异常/网络失败 | 提示"复核失败，请稍后再试"，不崩 | ✓ try/catch 兜底 |
| 反复点击 | 会话内 cacheable=true 复用 | ✓ chatViaGateway 已支持 |
| 原 items 数组 | 不被 mutate | ✓ applyConfidence 用扩展 |
| 未点复核 | confidence 恒 null，Excel 填「—」 | ✓ 保持既有出口 |

## 发现问题
1. **AI 输出格式漂移**：LLM 偶发用 `reason` 而非 `reasoning` → parseReviewResponse 已双名兼容。
2. **超长 hit 触发 token 爆**：hitText 160/paragraphText 200 硬截断 + 省略号，避免上下文膨胀。
3. **误报置信度 0.05 但仍显示 fail**：符合"只标不改裁定"裁定——由售前人工判断是否修改。
4. **审查按钮 hover 状态**：ReviewAnnotatedItem 类型仅在 ReadingView 局部 cast，避免污染共享 CheckItem。

## 四门验证
- `npx tsc -b` → EXIT 0
- `npx vitest run` → 175 files / **1968 passed + 2 skipped**（基线 174/1955 → +1 file / +13 tests）
- `npx eslint` 触及 5 文件 → EXIT 0（零 error/warn）
- `npx vite build` → EXIT 0

## 触及文件
- 新增：`src/pages/BidCheck/semanticReview.ts`
- 新增：`src/pages/BidCheck/semanticReview.test.ts`
- 修改：`src/pages/BidCheck/useBidCheck.ts`（+reviewing/+runSemanticReview/+costConfirm）
- 修改：`src/pages/BidCheck/BidCheckPage.tsx`（+AI 复核按钮/+CostConfirmDialog）
- 修改：`src/pages/BidCheck/ReadingView.tsx`（+confidence badge/+reasoning tooltip）
