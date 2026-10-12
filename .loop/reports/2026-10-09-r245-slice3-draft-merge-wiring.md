# R245 · 标书底稿增量合并「UI 接线 + 落库口径」实机收口（P0 bidkit-plan-slice3）

- 轮次：R245（round 244 → 245）　日期：2026-10-09　模块：/bid-workspace 第 3 步
- 优先级：P0（用户 P0 需求 R-001 的第三切片）　类型：A 类（会话内 state + json 列可选字段）+ UI/交互，**非 B 类提示词改动**

## 1. 选题依据

用户点名优先做 `quote-history-01`（报价历史二期）与 `prompt-fabscan-03`（残余「按章聚合回注改进建议」）。
读 `.loop/ledger.json` 核实：两项均已闭合——`quote-history-01` status=done（二期 R102 closed `r102-quote-history-phase2`）、
`prompt-fabscan-03` status=closed（R89 边界裁决 + R101 四态升级 + R103 按章聚合回注 `r103-chapter-audit-reflow`）。
且用户偏好明确「弱化报价、优先标书」。故据实承接 P0 项 `bidkit-plan-slice3-draft-incremental`：
R235 已交付纯函数匹配引擎 `bidDraftMerge.ts`，挂账「剩余：UI 接线 + schema」。本轮把接线做到真实可用，
并在真实三甲项目场景下自测（AGENTS.md 强制项），发现并闭合 4 个产品级缺陷——属于实质性优化，不是零风险小改。

同时巡检确认「不自动推翻既有裁定」：未触碰「疑似编造未清零禁导出」硬门禁（维持 R89 只报不拦）、
未重构 lint-debt-01 残余、未改任何 `prompts/*.yaml`（故不需要 PROMPT_VERSION 递增与快照更新）。

## 2. 变更文件

| 文件 | 变更 |
|---|---|
| `src/pages/BidWorkspace/bidDraftPlan.ts` | 落库口径纯函数：`parentIndexOfDraft` / `previewExtras`（折叠口径唯一真源）、`applyMergePlan` 增 `targets` 落点表与子节折叠、`releaseDraftChapter` 增 outline/scope 并同步 part 切换 |
| `src/components/bid-workspace/DraftMergePanel.tsx` | 展示全面改用折叠后口径（徽标 / 勾选文案 / 确认框 / 结果块 / toast）；`release` 传 outline+scope 并如实提示 part 切换；保留章管理列表抽为 `keptList`，无解析结果时也可用 |
| `src/pages/BidWorkspace/bidDraftPlan.test.ts` | **26 条用例**（17 条落库接线口径 + 6 条小节折叠 + 3 条解除保留/part 切换净增），覆盖跨级归属、正文不丢、`appendExtras=false`、父章缺位兜底、商务章切技术章与 scope=biz 不动 |
| `src/pages/BidWorkspace/bidDraftImport.ts` / `BidWorkspacePage.tsx` / `SolutionStudio/solutionTypes.ts` | 接线与 `Chapter.draftLocked?/draftFrom?` 可选字段；R243→R245 轮次标记更正 |

辅助脚本（本工作区 `d:/KFDXCX/MedPreSales/scripts/`）：`r245_fold/panel/tests/fix_assert/release/release2/keptlist.py` 补丁，
`r245_backup/target/verify_db/verify_release/restore/gates/pbprobe.py` 取证与四门。

## 3. 四道门禁（目标项目目录实测）

- `npx tsc -b` → exit 0，零错误
- `npx vitest run` → exit 0，**150 files / 1767 passed / 2 skipped**；基线 149 files / 1741 passed → **+1 文件 / +26 用例**
- `npx eslint <6 个触及文件>` → exit 0，零新增 error
- `npx vite build` → exit 0，6018 modules，4.40s

## 4. 实机自测与四个缺陷（详见 tests/records/2026-10-09-r245-bid-draft-merge-panel.md）

- **Bug A 口径割裂**：摘要「0 章保留」vs 列表「8 章」→ 摘要改用 `kept + appended`（追加章计入）+ 折叠节数单列。
- **Bug B 小节冒充独立章**：Word「标题 2」小节被拆成 4 个伪章并抽走父章正文 → 按 `level` 折叠回「最近更上层标题」所属章：
  父章有去处就并进父章正文（追加位 / 大纲位 / 参考段三种落点都支持），父章缺位才兜底独立成章，正文一个字不丢。
  落库 chapters 由 22（伪章 8）收敛到 18（保留章 4）。
- **Bug C「交 AI 重写」断链**：底稿多出章落成 `part=biz`，而商务骨架章不参与逐章生成 → 解除保留时连同大纲节点一起切 `tech`
  （`scope=biz` 下商务章本就是生成目标，保持不动；未传 outline 无法同步时不改 part），toast 如实说明「已切为技术章才会参与生成，可改回」。
  实测：树节点「商务·线下填写」→「技术 185/9096 字」，主按钮变「继续生成正文」，DB `chapter.part=tech / outline.part=tech / pending`。
- **Bug D 刷新后锁死**：「交 AI 重写」入口只在本次解析过底稿时可见 → `keptList` 抽成共享节点，未上传底稿时同样给出逐章解除入口。

## 5. 零 schema / 零提示词 / 零改批量逻辑论证

- **零 collection / 零 pb_hooks / 零迁移**：效果全部落在既有 json 列 `bid_chapters`、`bid_outline`、`ref_materials_text`。
  `Chapter` 新增的 `draftLocked?`、`draftFrom?` 是 TS 可选字段，随 json 列整份透传，PocketBase schema 未动，存量项目读取零变化。
- **零提示词改动**：「以底稿为参考重写」复用既有 `ref_materials_text` 通道 + 第十七轮 17D 的 `retrieveTenderFragments`
  按章标题本地检索注入（≤3 段 / ≤1200 字），未编辑任何 `app/services/ai/prompts/*.yaml` 等价物，故 B 类流程（逐字对比报告 +
  PROMPT_VERSION+1 + 快照 `-u` + 补单测）本轮不触发——已在此报告显式说明理由。
- **零改批量生成**：保留章写 `gen_status="done"`，天然被「批量只跑非 done 章」的既有语义跳过；AI 不可用时合并不受影响（纯本地整理）。
- **零新依赖 / 零重库回潮**：docx 解析继续用 package.json 既有 `mammoth`（动态 import，仅面板触发时加载），
  未把 docx/xlsx/pptxgenjs 引入标书路由壳静态可达图，R124 哨兵 `src/lib/onDemandHeavyLibs.test.ts` 随全量 vitest 通过。
- **数据安全**：浏览器本地解析，底稿原文不发往第三方云；实测前后完整备份/还原用户项目数据（`match backup: True`）。

## 6. 挂账（已写入 backlog `bidkit-draft-refine-01`，P2）

1. 参考重写口径细化：长底稿转参考段时按 900 字上限截断，要点选取可再智能化（标题命中 + 首段 + 量化承诺优先）。
2. 「底稿多出章」清退：换更短底稿重新应用时，上一轮 `draft-extra-*` 孤儿章不被回收（当前靠幂等覆盖同名节点）。
3. 大纲未确认（章节清单为空）时面板不渲染，缺「先生成/确认大纲」引导。

## 7. 未做（有意）

- 未接「AI 兜底匹配」第三段（R235 决策为纯本地两段匹配 + 置信度展示，避免额外费用与不可控错配）。
- 未做整本 external 底稿的章节级 diff 视图（属 slice4 范畴）。
- 全程 `git status` 保持用户 30 个在途改动文件原状，**未执行任何 git commit / git add**。
