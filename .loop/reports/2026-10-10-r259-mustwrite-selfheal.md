# R259 报告 — mustWrite 读时自愈 + 大纲「必写」标识（全局优化汇总·次高优先 R-039②④）

日期：2026-10-10 ｜ 轮次：R259 ｜ 模块：标书工作台/BidWorkspace ｜ 优先级：P0

## 背景与缺口（含文档①的结论）
《小智工作站-全局优化汇总》把 **R-039 mustWrite 落库**列为次高优先（「不修，R-017/R-020 两条 P0 等于没做」），
并抛出 4 个子要求。侦查仓库 + 代码后逐项定性：

- **①先查是"patch 没带字段"还是"PocketBase schema 没建字段"**：二者皆非。`mustWrite` 是 `OutlineNode` 的可选字段
  （solutionTypes），随 `bid_outline` **PocketBase JSON 列**整体落库，**不是独立列 → 无需 schema 迁移**。
  生成侧 `applyMustWrite`（useBidWorkspace:4169）已把顶层章 mustWrite 写入并 `writeStageSnapshot/setOutlineDraft` 落库。
  文档"查库 17 项目全为 0"的真实原因＝**这些是存量项目，其大纲生成于该功能之前**，JSON 里自然没有该字段。
- **②读到大纲时主动重算补标记**：缺失。存量项目打开时不会补标记 → 本轮落地。
- **③再重跑 17 个项目 / ⚠️直接批量重跑等于白跑 17 次**：护栏结论——生成侧已 apply mustWrite，重跑**不再白跑**；
  而②的读时自愈让用户**无需重跑**即可看到正确必写标记，进一步省去无谓的 AI 重跑成本。
- **④大纲区显示"必写"标识**：缺失。ComposeStep 大纲导航无必写徽标 → 本轮落地。

判定链 `bidMustWrite.judgeMustWrite`（六级：①评分办法技术评分项②必备技术清单③技术关键词④★▲⑤目录商务仅降权⑥要求性兜底）
与上下文口径（`numberScoringItems(tech) + readRequiredTechKeywords()`）在 R-020 已实现且接线良好，本轮直接复用、**零 AI、零迁移**。

## 落地内容
1. **新建 `mustWriteSelfHeal.ts`**（纯函数、零模型、零 DOM、零 DB 写）：
   - `mustWriteBackfillNeeded(nodes, report)`：是否存在「判定应必写、但顶层章缺 mustWrite 标记」的存量大纲；无报告/空大纲→false。
   - `healMustWriteOnRead(nodes, report)`：仅当需要时按 `applyMustWrite` 同口径给顶层章补标（子级与标题结构不动）；
     **无需自愈原样返回入参引用**（引用稳定，免多余重渲染与落库），安全幂等。
2. **`ComposeStep.tsx`（大纲导航）**：
   - `useMemo` 在把 `proj.bid_outline` 传给 `OutlineNavTree` 前做读时自愈（`navOutline = healMustWriteOnRead(...)`），
     deps 取 `[proj?.bid_outline, proj?.parse_report]`（引用稳定，无 react-hooks 警告）。
   - 章行在「商务/技术/演示」主徽标后追加**「必写」青绿实底徽标**（`isChapter && !isDemo && node.mustWrite === true`），
     title 说明判定依据。存量项目打开即见，无需重跑。

## 兼容与边界
- 自愈只在「缺标记且判定必写」时补，**不强制覆写合法 false**，也不动无强信号章 → 最小churn。
- 纯函数不写库：`bid_outline` 的持久化仍由生成/编辑既有链路负责；读时派生保证 UI 与消费侧看到的顶层必写标记始终正确。
- 与 R-020 mustWriteRescued 纠偏横幅（BidWorkspacePage）互补：横幅讲"回收被误标商务的必写技术章"，徽标讲"逐章是否必写"。

## 四门禁（WIP 基线对照，全绿）
- `npx tsc -b` exit 0。
- `npx eslint`：新 2 文件（mustWriteSelfHeal.ts / .test.ts）0 problem；ComposeStep.tsx .bak-r259 前后**均 0 problems**（零新增，useMemo deps 无告警）。
- `npx vitest run`：**162 files / 1868 passed / 2 skipped**（基线 161/1863，+1 文件 mustWriteSelfHeal.test.ts +5 用例）。
- `npx vite build` exit 0（3.50s）。

## 补丁
`scripts/r259_mustwrite_selfheal.py`（新建 2 文件 + ComposeStep 5 锚点，全部 count==1；改前 .bak-r259）。未 commit。

## 伞项进度（bidkit-global-opt-p0）
R-038③ Slice A（覆盖率门禁，R258）✓ ｜ R-039②④（自愈+必写标识，R259）✓。
待续：R-038 Slice B（提高段数上限/跨块评分废标汇总真正拉高覆盖率，涉额外 AI 成本需拍板）；
文档其余 P0（R-027 补 5 解析项 / R-028 废标三轮 / R-010 资质口径 / R-033 cleanup-irrelevant 数据安全）逐条评估——多数判定链/模块已在库，按缺口择优推进。
