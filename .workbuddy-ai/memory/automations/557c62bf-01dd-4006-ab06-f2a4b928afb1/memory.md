# 自动化执行记忆 · 医疗软件售前工作台自主迭代

## 执行历史

### 2026-10-15 01:30 · 第 12 轮（**R49**）— 完成（有实质产出）

- **选题**：**B0c 剩余项「报价编辑器金额往返回归网」** → 定级 **S2 / B 类（只新增测试）**，自动执行。
- **⚠️ 编号事故（本轮最重要的一条）**：本轮**原记 R48**；收尾时实测发现**另一个执行者（同为本机 WorkBuddy AI 运行时）已把项目权威账本 round 推到 48**，主题「P0-2 事实来源优先级」（`BidWorkspace/factSources.ts`），并已写出 `docs/evolution/R48_20261015.md`。两个执行者写同一份 ledger = **round 双 bump**。处置：**本地自动化线主动顺延为 R49**，`.loop/ledger.json`、`docs/evolution/_loop_state.json`、轮报文件名三处同源。已登记为项目待办 `B22-multi-agent-same-workspace` 的实测证据。
- **改动**：新增 `src/components/ppt-quote/QuoteEditorMoney.test.tsx`（6 例，jsdom + testing-library，状态化 harness 等价线上 `mutateQuote`，驱动真实「数量/单价/折扣」输入框）+ 只读脚本 `docs/evolution/_r49_unwired_scan.mjs`（扫「导出但生产零引用」符号）。**业务代码 0 改动、0 新依赖、0 schema、0 提示词。**
- **硬证据**：探针行 = R034 经典反例 `15 × 599,729.21 × 90%`（精确 **8,096,344.34**，裸浮点 .33）。**「删实现即变红」**：把 `QuoteEditor.tsx:674` 临时改成裸浮点 → **2 failed | 4 passed**；`git checkout` 还原后 6 passed、diff 为空。
- **四门**：`npx tsc -b` exit 0；`npx vite build` 6.30s exit 0；`npx vitest run` **241 files / 2848 passed / 2 skipped**（连跑 3 次一致）；`npx eslint .` **119 error / 13 warning = 基线零新增**。
- **顺带结项（核对，非本轮实现）**：B1（A1–A6 已落地接线：`composeGates.ts` 387 行 + `useBidWorkspace.ts:712/:6938/:6944-6958`）、B10（`overPriceCeilingHits:2259` / `quoteRecordCeilingHits:2263` 已接 `refreshFormatReport`）、docs/13 §3.2–3.4。三者已从 backlog 移除，依据写进 `_loop_state.json` 的 `notes`。
- **落盘**：`.loop/ledger.json`(round 49)、`docs/evolution/_loop_state.json`(round 49)、`.loop/reports/2026-10-15-0130-r49-quote-money-ui-regression.md`、`docs/evolution/R49_20261015.md`、`.loop/MORNING.md`。
- **诚实项**：① agent-browser 不支持 Windows → **未做界面点鼠标实机复测**，界面证据由 jsdom 驱动真实组件/真实输入框替代（同 R42 四张网）；② **未执行 git commit**（工作区有并发在途批次，`git add -A` 会连带提交他人未完成改动）；③ 全量 vitest 的 241/2848 里含对方未提交的 4 文件 / 21 例，本轮自身只贡献 1 文件 / 6 例。

### 2026-10-14 10:05 · 第 11 轮 — 完成（有实质产出）

- **选题**：**B9 建设清单金额分位精确化** → 定级 **S1（金额级正确性）/ A 类（修）**，自动执行。
- **来源**：`docs/evolution/_loop_state.json` 的 `focus` + R36 报告 §5「下一轮建议」首位。
- **根因**：不是算法错，是**口径分裂**。项目 R034 已为报价域立了单一真源 `src/lib/money.ts`（`productCents` 微元整数精确相乘 + 分位远离零舍入），但建设清单域从未接入，五条算路（`calcTotal` / `subtotalOfLines` / 分类小计 / Excel 逐行小计与分类小计 / UI 行小计）全部用裸浮点 `qty * unit_price`，且各自独立累加。
- **改动**：6 个文件 —— `checklistTypes.ts`（新增 `lineSubtotalYuan`/`sumLinesYuan`，`calcTotal` 重写）、`checklistSummary.ts`（两处同口径）、`checklistExports.ts`（Excel 两处）、`ChecklistDetailPanel.tsx`（UI 行小计）、新增 `checklistMoney.test.ts`（6 例）、新增 `docs/evolution/_r37_checklist_cent_audit.mts`（证据脚本）。未加依赖、未改语义。
- **验证**：20 万组对拍 旧 140,477 组分位偏差 → 新 **0**；导出「逐行小计相加 ≠ 合计」18,083 → **0**；四门全过；实机 10 个分类小计之和 = 合计 = **4,960,000**、控制台 0 error。提交 `224061e`。
- **诚实项**：① 全量 eslint 160→**161** 的 +1 来自工作区**既有未提交**的 `src/components/model-config/ModelMetaDialog.tsx`，非本轮；② 缺陷在真实数据上**潜伏**（PB 现有 2 份清单 93 行、单价全为整数），实机**无法现场复现偏差**，实机只能证明"未回归 + 小计之和 = 合计"。

## 经验沉淀（下轮直接用）

1. **编号与并发（本轮新增，最重要）**：同一工作区**可能同时有另一个执行者在迭代**（本轮实测撞号：项目账本 R48 被对方占用）。开工读账本时先看 `round`；**收尾写账本前必须重读并断言期望值**（写入脚本里 `assert(s.round === 48)` 兜住），否则会被并发静默覆盖。若发现号已被占，**主动顺延**（本轮 R48 → R49）并在两边账本写明编号来源。
2. **本项目没有 `AI-ITERATION.md`**（项目 `Qoder自主迭代提示词-v2.md` 明确写着它已删除），但 **`.loop/` 已由本自动化线建立**（ledger/reports/MORNING）。**真实体系**：手册 `Qoder自主迭代提示词-v2.md`、权威账本 `docs/evolution/_loop_state.json`、轮报 `docs/evolution/R{轮次}_{YYYYMMDD}.md`、驱动器 `scripts/autoloop.mjs`。两边同源，写的时候两边都写。
3. **门禁命令（实测可用）**：`npx tsc -b`；`CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build`（不带前缀会被 safe-delete 守卫拦）；`npx vitest run`；`npx eslint .`。**当前基线（2026-10-15 实测）**：tsc 0 / vitest 241 files · 2848 passed · 2 skipped / eslint **119 error + 13 warning**。
4. **全量测试的绝对数会混入别人的在途文件**：报告必须点名区分「本轮贡献」与「在途增量」，并且**不要 `git add -A`**（会把别人没写完的改动一起提交）。「开工时 git status 干净」不代表整轮干净 —— 收尾写数字前再跑一次 `git status --porcelain`。
5. **eslint 要证明「新增 0」**：`npx eslint . -f json -o <file>` 存 JSON，再用 node 按文件统计 error 数并对比文件数；只看总数会被工作区里别人的未提交文件带偏。注意 `.mjs`/`.cjs` 脚本**会进分母**（规则只对 `**/*.{ts,tsx}` 生效，非 ts 文件被解析但不套规则）。
6. **环境事实**：`:8000` 是 **Vite dev server**（改 `src` 即 HMR，无需重启）；`:7000` 是 PocketBase。**agent-browser 不支持 Windows** → 界面验证只能走 jsdom + @testing-library（驱动真实组件与真实输入框）或 Playwright chromium 独立视口。项目 hook **禁止智能体结束进程** → 「重启 :7000」类动作一律做不到，只能让用户做。
7. **PB 接口**：后台/脚本调用一律带 `X-Rh-User-Id: local-user`，否则 401 `login_required`。
8. **UI 回归网的正确写法（R49 验证）**：驱动**真实组件 + 真实输入框**（`getAllByLabelText`）+ 断言**真实渲染文本**，不要调内部函数；harness 要**状态化**（totals 从最新 state 重算，等价线上 mutateQuote）。验收标准 = **「删实现即变红」**，不做这一步的网可能只是摆设。同值重复渲染时用 `getAllByText(...).length` 而不是 `getByText`。

## 下一轮建议

1. **首选：B0c 的另一半 —— 导出前门禁拦截的 UI 回归测试**（该拦的必须拦、该放行的必须放行）。与 R49 做的那半并列，同属「交付物正确性」。已在 `.loop/ledger.json` 登记为 `B25-export-gate-ui-test`。
2. **次选：B15 的可执行那一半** —— 让「模型配置」的可用性提示与真实可用性一致（现依据 `/models` 可达性，真正会 400 的是 `/chat/completions`）：把「接口可达」与「对话可用」分两行如实显示 + **用户主动点击**的「试一次对话」探针（不自动跑、不产生隐形费用）。属产品决策，需点头。
3. **优先处置 `B22-multi-agent-same-workspace`（high）**：约定「同一时刻只允许一个执行者写仓库」，或给两方分配不重叠的轮次号段 —— 已实测撞号一次，不处置还会再撞。
4. **开工第一件事：抽查待办池前几条的「真实落地状态」**（本轮一次核出 3 处「早已完成却仍挂在待办上」的项：B1 / B10 / docs-13）。不要直接相信优先级排序。
5. **不要碰 `B21-export-font-guard`**（触 `docs/17` 第 4 条红线：判定标准 = 「老用户已导出的文件是否还长得一样。会变 → 锁」）。如确要做，按「新增一种导出模板」口径走 C 类预授权。
6. 建议正式**关闭 E-1 阻塞**（pnpm build 卡死）—— 本机 pnpm 已是 11.21.0，实测通过。

## 待用户拍板（阻塞项，勿自行推进）

- **⚠️ 同一工作区有两个执行者并发迭代**（本轮已实测撞号：项目账本 R48 被另一执行者占用）—— 请决定：约定「同一时刻只允许一个执行者写仓库」，或给两方分配不重叠的轮次号段。本轮已把本地线顺延为 R49 并如实登记。
- **工作区那批未提交的并发在途改动**怎么处置（提交/继续/回滚）：`src/pages/BidWorkspace/factSources.ts` + 3 个新测试 + `prompts/factSettings.ts` + `promptsSnapshot.test.ts.snap` + `GlobalFactsPanel.tsx` + `useBidWorkspace.ts` + 3 份提示词手册镜像。本轮**未碰、未提交**（`git add -A` 会连带提交别人未完成的改动）。
- `D-12` 导出 Word 空章节：A 方案（导出前提示）vs B 方案（写「（待补充）」）—— 我推荐 A。
- `E-2` 是否造常备最小测试数据集（打 `[NIGHTTEST]` 标记）—— 我推荐造。
- `B10-auth` 自定义接口身份仅凭客户端请求头可伪造 —— **触碰「身份认证」红线，只能出方案**。
- `docs/06` 九项新能力全部属 **C 类**（新增能力），需用户点头；我推荐先做第 3 项「招标文件倾向性/排他性参数识别」（几乎零成本、决策级价值）。
- 是否提供一份含「评标基准价＝有效报价平均值下浮 X%」的**真实招标文件**（R36/R37 遗留，价格分链路闭环点验用）。
- 是否允许 `B15` 的「用户主动点击的对话探针」（会产生 token 费用）—— 我建议允许（主动点击才花钱，且能真正拦住「假绿」）。
