# R268 · 标书检查中枢四期 L3 内容层接入（r261-bidcheck-followons）

## 选题依据
接续 R266（二期 L2）/ R267（三期 L4）完成同一伞项 `r261-bidcheck-followons`（P2·标书检查域）的四期 L3 内容层。
巡检坐实又一处「交互断链」：`checkConfig` 默认层级 `normalLevels`/`sealedLevels` 均已含 L3、
且预留了 `thinChapterMinChars`（章节单薄字数阈值）配置旋钮，规则清单页把 L3 说明为
「语义/完整性判定，可选接入 AI（暂未启用）」——但 runCheck 从不跑 L3，配置项与规则说明都是空头承诺。本轮闭合 L3 断链。

## 复用优先（零 AI，未接 AIClient）
与 L2/L4 保持同口径——全部读现成的确定性信号，不引入新算法、不接 AI（语义类 AI 判定仍挂账）：
- **L3-C1 章节正文单薄/空缺**：直接接线预留旋钮 `thinChapterMinChars`，逐技术章去空白计字，
  低于阈值（含 0 字空缺）即 warn。商务骨架章（`part=biz`，本就无 AI 正文）不参与判定，避免误报。
- **L3-C2 成稿偏短章节**：复用标书工作台生成时写入并随 chapters json 持久化的
  `Chapter.underlength` 标记（成稿字数低于预算 60%，第十轮修复 3 已落），把该信号汇入检查中枢。
两把尺子与 solDeliveryCheck / useBidWorkspace 同用同一 Chapter 数据结构，零 collection schema、零 pb_hooks。

## 变更文件
- 新增 `src/pages/BidCheck/rules/content.ts`：L3 入口 `runContentChecks(rec, cfg)`，
  产 `L3-C1 章节正文单薄/空缺` + `L3-C2 成稿偏短章节` 两项 CheckItem。
  - 只报不拦：一律 `severity=medium` / `status=warn`，不标 fail、不触暗标导出门禁（与既有裁定同口径）。
  - 诚实降级：未选项目 / 尚无章节 / 仅商务骨架章 / 阈值=0 → `skipped` 并逐因说明，绝不瞎判。
  - 命中每条给章节定位 + 实际字数/空缺 + 阈值依据。
- 改 `src/pages/BidCheck/runCheck.ts`：导入 `runContentChecks`，`levels` 含 L3 时在 L2 与 L4 间接入；
  移除文件头「L2/L3/L4 后续接入」与尾「L3 层级预留位待补」两处过期注释。
- 改 `src/pages/BidCheck/RulesListPanel.tsx`：L3 从「暂未启用/占位不参与判定」改为「已接入（四期）」，
  当前接入态改述为 L1+L2+L3+L4+L5 五级全接入（均只报不拦、只标不改），闭合断链文案。
- 新增 `src/pages/BidCheck/rules/content.test.ts`：8 用例（无章节双 skipped / 单薄 warn 带 thin_chapter /
  空缺命中「正文空缺」 / 全达标 pass / 商务骨架章不参与 skipped / 阈值=0 skipped / underlength warn / 无偏短标记 pass）。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0。
- `npx vitest run`：173 files 全过，**1939 passed + 2 skipped**（R267 基线 172 files/1931 passed+2 skipped，增量 +1 文件/+8 用例=content.test.ts）。
- `npx eslint`（触及 4 文件）：exit 0，零 error/warn。
- `npx vite build`：成功，built in 4.09s。

## 数据模型 / 提示词
零 collection schema、零 pb_hooks、零提示词改动（未触 B 类流程）。L3 结论为只读派生覆盖层。

## 维持裁定不动
- 编造嫌疑未清零禁止导出：只报不拦——L3 同样 medium/warn，不加任何新硬门禁；
- `lint-debt-01` 有意保留残余未重构。

## 挂账
- 五期 标注版 docx（Word 批注引擎）+ PB 集合 anbid_checks + 分工流转仍在 backlog。
- L5-D 语义 AI 类（标置信度）内容判定仍挂账（本轮 L3 只做零 AI 确定性项，AI 语义类留待独立立项）。
- L3 真实数据端到端复核待有含单薄/偏短章的真项目补。
