# 自动化执行记忆 · 医疗软件售前工作台自主迭代

## 执行历史

### 2026-10-14 10:05 · 第 11 轮 — 完成（有实质产出）

- **选题**：**B9 建设清单金额分位精确化** → 定级 **S1（金额级正确性）/ A 类（修）**，自动执行。
- **来源**：`docs/evolution/_loop_state.json` 的 `focus` + R36 报告 §5「下一轮建议」首位。
- **根因**：不是算法错，是**口径分裂**。项目 R034 已为报价域立了单一真源 `src/lib/money.ts`（`productCents` 微元整数精确相乘 + 分位远离零舍入），但建设清单域从未接入，五条算路（`calcTotal` / `subtotalOfLines` / 分类小计 / Excel 逐行小计与分类小计 / UI 行小计）全部用裸浮点 `qty * unit_price`，且各自独立累加。
- **改动**：6 个文件 —— `checklistTypes.ts`（新增 `lineSubtotalYuan`/`sumLinesYuan`，`calcTotal` 重写）、`checklistSummary.ts`（两处同口径）、`checklistExports.ts`（Excel 两处）、`ChecklistDetailPanel.tsx`（UI 行小计）、新增 `checklistMoney.test.ts`（6 例）、新增 `docs/evolution/_r37_checklist_cent_audit.mts`（证据脚本）。未加依赖、未改语义。
- **验证**：20 万组对拍 旧 140,477 组分位偏差 → 新 **0**；导出「逐行小计相加 ≠ 合计」18,083 → **0**；四门全过；实机 10 个分类小计之和 = 合计 = **4,960,000**、控制台 0 error。提交 `224061e`。
- **诚实项**：① 全量 eslint 160→**161** 的 +1 来自工作区**既有未提交**的 `src/components/model-config/ModelMetaDialog.tsx`，非本轮；② 缺陷在真实数据上**潜伏**（PB 现有 2 份清单 93 行、单价全为整数），实机**无法现场复现偏差**，实机只能证明"未回归 + 小计之和 = 合计"。

## 经验沉淀（下轮直接用）

1. **本项目没有 `AI-ITERATION.md`，也没有 `.loop/`**。作业手册点名的这些路径**不存在**（项目 `Qoder自主迭代提示词-v2.md` 里明确写着 `AI-ITERATION.md` 已删除、旧提示词因此失效）。**真实体系**是：手册 `Qoder自主迭代提示词-v2.md`、状态 `docs/evolution/_loop_state.json`、轮报 `docs/evolution/R{轮次}_{YYYYMMDD}.md`、驱动器 `scripts/autoloop.mjs`。本轮按作业要求**建了 `.loop/`**（ledger/reports/MORNING），同时在 `docs/evolution/` 也落了正式记录，两边同源。
2. **并发写入警告**：`.loop/ledger.json` 与本项目 `docs/evolution/_loop_state.json` 都可能被并发进程推进。开工读、写前**重新 Read**，用精确 `old_string` 做增量 Edit，**不要整体覆盖写 JSON**。本轮开工实测 `_loop_state.json` mtime 未变（autoloop 已于 01:24 结束），可安全编辑。
3. **门禁命令（本轮实测）**：`pnpm build` **现在可用**（pnpm 11.21.0，`CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 pnpm build` → 6.42s）；`npx tsc -b`；`npx vitest run`；`npx eslint .`（本轮 216 files / 2555 passed）。
4. **eslint 要证明"新增 0"**：`npx eslint . -f json -o <file>` 存 JSON，再用 node 按文件统计 error 数并对比文件数（基线 160 error / 53 文件）。只看总数会被工作区里别人的未提交文件带偏。
5. **环境事实**：`:8000` 是 **Vite dev server**（响应含 `/@react-refresh`），改 `src` 即 HMR 生效、无需重启；`:7000` 是 PocketBase。浏览器验证 `source _qa/ab.sh`（`ab_login`/`ab_go`），**agent-browser 的会话与 ref 都不跨 bash 调用保持**，必须**同一次调用内** snapshot 取 ref 再 `agent-browser click @ref`（不要用 eval 的 `.click()`）。取 ref 的稳妥写法：`grep 'button "X"' | grep -oE 'ref=e[0-9]+' | sed 's/ref=//'`。
6. **PB 接口**：后台/脚本调用一律带 `X-Rh-User-Id: local-user`，否则 401 `login_required`。

## 下一轮建议

1. **先处置工作区卫生**：`src/components/model-config/{PersonalConfigList,ModelMetaDialog}.tsx`、`src/pages/ModelConfig/{ModelConfigPage.tsx,useModelConfig.ts}`、`src/lib/{modelMetaLocal,modelProfiles}.ts` + 2 个 `.test.ts` 是**与本轮无关的未提交改动**，本轮刻意未碰。它们让全量 eslint 停在 161、vitest 多 2 文件。需用户拍板 提交/继续/回滚。
2. **首选 `B12` 价格分测算接 UI**：R35 交付算法层、R36 修对闭式解，至今 **0 个用户入口**（`fullScoreTargetPrice` 在 `src/` 只被模型与测试引用）。做时注意：对手报价**必须手输**（`competitor_evidence` 存的是中标金额，不可冒用）；面板要显式写出「基准价口径 + 临界价含下浮」；认不出公式显示 `ok:false`，不许猜数。
3. 次选 `B8` 折扣语义歧义（high）；再次 `B1` R031 遗留 A1–A6 编制层（high）。
4. 建议正式**关闭 E-1 阻塞**（pnpm build 卡死）—— 本机 pnpm 已是 11.21.0，实测通过。

## 待用户拍板（阻塞项，勿自行推进）

- **工作区那批未提交的 model-config 改动**怎么处置（提交/继续/回滚）—— 影响每轮门禁比对。
- `D-12` 导出 Word 空章节：A 方案（导出前提示）vs B 方案（写"（待补充）"）—— 我推荐 A。
- `E-2` 是否造常备最小测试数据集（打 `[NIGHTTEST]` 标记）—— 我推荐造。
- `B10` 自定义接口身份仅凭客户端请求头可伪造 —— **触碰"身份认证"红线，只能出方案**。
- `docs/06` 九项新能力全部属 **C 类**（新增能力），需用户点头；我推荐先做第 3 项「招标文件倾向性/排他性参数识别」（几乎零成本、决策级价值）。
- 是否提供一份含「评标基准价＝有效报价平均值下浮 X%」的**真实招标文件**（R36/R37 遗留，价格分链路闭环点验用）。
