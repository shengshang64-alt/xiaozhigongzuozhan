# R145 · 竞品 AI 深度分析「可写字段白名单」——解析/写回双拦截，堵数据完整性与越权隐患

- 日期：2026-10-03　轮次：145　主攻：`/competitors`（AI 深度分析建议采纳链路）
- 选题来源：巡检新角度（死代码之外的「交互/数据完整性断链」探针）——遍历未跟踪在途新模块的接线与消费，落到 `useCompetitorAnalysis.ts`（git-CLEAN、纯逻辑、此前无伴生单测）。

## 一句话结论
竞品「AI 深度分析」把模型返回的字段建议写回 `competitors` 记录时，**只校验 field 是不是字符串，不校验它是不是允许被 AI 改的字段**。
模型（或被污染的事实片段）只要返回 `name` / `legal_name` / `software_copyrights` / `keywords` / `source` / `visibility`，
甚至 `id` / `rh_user_id`，前端就会：生成建议 → UI 展示 → 用户勾选采纳 → `PATCH /api/competitors/{id}`
**覆盖竞品公司身份 / 把数值列与数组列写成字符串 / 越权改归属用户**。类型层 `CompetitorPatch` 的 `Omit` 只挡编译期，
运行时 `(patch as Record<string,unknown>)[u.field] = u.suggested` 完全绕过它。

## 改了什么（纯前端逻辑，零 AI 调用变更、零 schema、零 pb_hooks、未改提示词文本）
- **`src/pages/Competitors/useCompetitorAnalysis.ts`**：
  1. 新增导出常量 `ANALYZABLE_FIELDS`（11 个字段）——与 `ANALYSIS_SYSTEM_PROMPT` 末尾「可选 field 值：…」同口径的**单一真源**。
  2. `parseAnalysisResponse` 过滤链加 `ANALYZABLE_FIELDS.includes(u.field)`：非白名单 field 在**解析阶段即丢弃**，根本不生成建议、不进 UI。
  3. `applyUpdates` 写 `patch` 前二次防御：`if (ANALYZABLE_FIELDS.includes(String(u.field)))`——纵深，防 accepted 从别处流入。

## 为何不算 B 类（未走提示词快照流程）
提示词文本**零改动**：L94 早已写明「可选 field 值」，本轮是把既有提示词契约在代码侧落实为确定性校验
（防线从「靠模型自觉」升级为「代码强制」），新旧口径逐字一致。并新增**哨兵测试**用正则从提示词抽出该 field 列表，
断言与 `ANALYZABLE_FIELDS` 逐项相等，**防未来二者漂移**（改了提示词忘了改白名单 → 测试即红）。

## 误伤防护
`ANALYZABLE_FIELDS` 严格取提示词声明的 11 项，均为 `CompetitorRow` 里的 string 字段；
`competitorEvidence.test.ts` 既有用例（products / regions）全部在白名单内，行为不变、无回归。
非白名单的合法业务写入（用户手工编辑档案的 name/keywords 等）走 `competitorsCore` 的创建/编辑路径，不经本分析链路，不受影响。

## 增量单测
新增 `src/pages/Competitors/useCompetitorAnalysis.test.ts`（**9 用例 / +1 文件**）：
- 白名单拦截：合法 field 保留 / 身份·归属·数值·数组·未知 field 全丢 / 混合输入只留白名单 / field 非字符串仍过滤（回归既有）。
- 防漂移哨兵：提示词「可选 field 值」列表 == `ANALYZABLE_FIELDS` 逐项一致。
- 顺带补齐该文件测试盲区：`formatExternalBlock`（招投标空占位句 / 上市公告空不生成段 / 有数据带 evidenceId）、`buildUserMessage`（含档案名+事实上下文 / 空外部块不追加 / 非空外部块拼接）。

## 四门验证
- `npx tsc -b`：0 error。
- `npx vitest run`：91 test files，**958 passed | 2 skipped**（基线 949，+9=本轮新用例，90→91 文件）。
- `npx eslint`（触及 useCompetitorAnalysis.ts + .test.ts）：**0 error / 0 warning**（输出为空）。
- `npx vite build`：成功 3.32s（5945 modules）。

## 未触碰 / 维持裁定
未 commit；未动 collection/pb_hooks/会话外数据；未改提示词文本（哨兵测试仅读校验、不改写）；未新增 CSS。
编造嫌疑未清零禁止导出硬门禁维持「只报告不拦截」；lint-debt-01 有意保留残余不重构。
defer-on-WIP 四项复核：QualCertsPage(r112)/ComposeStep(r118)/FolderTree(r136)/R119 死码清单所在文件仍 git-M 或 ??未跟踪，继续绕开（本轮未命中）。
