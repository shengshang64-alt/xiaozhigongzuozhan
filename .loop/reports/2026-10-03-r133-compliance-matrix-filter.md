# R133 · 实质性条款覆盖矩阵：按类汇总纯函数 + 关键判定收敛 + 类型筛选/只看未覆盖

## 背景与选题
接续账本 round=132。用户指定的两个 backlog 首选项（quote-history 二期、prompt-fabscan-03「按章聚合回注」）经核对已分别 closed 于 R102/R131 与 R103，不重复。
巡检新角度：`ComplianceMatrixPanel`（标书·实质性条款覆盖矩阵，交卷前防废标核心面板）此前把全部类型（★/▲、废标项、资格要求、符合性检查）平铺在同一张表里，且解析报告条款多时（历史 R50/F2 记录 11 条会撑到数十行）用户只能靠滚动逐条找「未覆盖」，缺乏按类聚焦与只看未覆盖的能力；同时「关键（废标级）」判定 `kind === "void" || mandatory` 直接内联在组件里，是分散的魔法口径。选题属标书主链路的实质性交互补全（非零风险小改），符合优先级。

## 变更内容
1. `complianceMatrix.ts`（纯函数层，git-CLEAN）
   - 新增 `isCriticalComplianceRow(row)`：把「废标级关键条款＝废标项或强制条款」口径收敛为单一导出，供组件与汇总共用，消除魔法判定分叉。
   - 新增 `summarizeCompliance(rows, progress)`：按四类产出 `total/uncovered/uncoveredCritical` 与全局合计的纯函数；未标注的行按 `open` 保守计入，与面板既有默认状态等价。
2. `ComplianceMatrixPanel.tsx`（git-CLEAN）
   - 顶部徽标改用 `summarizeCompliance` 同源取数（`summary.uncovered` / `summary.uncoveredCritical`），行为与旧 `uncovered.length`/`uncoveredCritical.length` 等价。
   - 新增类型筛选标签（全部 / ★-▲条款 / 废标风险项 / 资格要求 / 符合性检查），每个标签带该类条数与「未覆盖」橙色角标；点击切换、再次点击回到全部。
   - 新增「只看未覆盖」开关；表格随之渲染 `visibleRows`。筛选后无匹配时给出友好空态提示（区分「已全部清零」与「换筛选」）。
3. `complianceMatrix.test.ts`（git-CLEAN）新增 5 个用例：关键判定四象限、默认 open 计入未覆盖、covered/na 退出计数、混合类型下非关键（符合性检查）不计入关键未覆盖、空输入全零不抛错。

## 红线与裁定遵守
- 未动数据模型：进度仍存 localStorage `bid_matrix_`，键与结构完全不变，零 collection / 零 pb_hooks / 零会话外状态。
- 未动 AI 提示词（无需走 B 类流程、无 PROMPT_VERSION 变更、无快照更新）。
- 未触碰任何硬门禁裁定：编造未清零「只报不拦」、lint-debt-01 有意保留、既有 defer 项均未推翻。
- 三个改动文件均为 git-CLEAN（`git status --porcelain` 空），改动全部为本轮自有，无误伤用户未提交在途代码；未 commit。
- 交互为纯展示/筛选层，业务行为与数据完全等价（同一条款的标注、保存、导出下游读取路径不变）。

## 四门验证（目标项目目录）
- `npx tsc -b`：0 error。
- `npx vitest run`：878 passed | 2 skipped（基线 873+2 → 净增 5，全为本轮 `summarizeCompliance` 新增用例）；`complianceMatrix.test.ts` 单跑 9 passed（4 旧+5 新）。
- `npx eslint`（3 触及文件）：仅 1 条 `react-hooks/set-state-in-effect`（L99 `setProgress(readComplianceProgress)`），经 `git show HEAD` 核对该行在提交态原样存在，属既有 lint-debt，本轮净新增 error=0。
- `npx vite build`：成功，3.81s。

## 遗留
- 关键判定角标当前只对「未覆盖」显示橙色计数；若后续要按「关键未覆盖」优先排序整表，需要新交互拍板，暂不扩范围。

## 实机验证（浏览器，dev :8000，已登录态）
进入 标书工作台 → 贵港项目 → 第 2 步 AI 解析报告 → 实质性条款覆盖矩阵（真实 112 条）。逐项确认：
- 顶部类型标签全部渲染并带橙色未覆盖角标：全部 112 / ★▲条款 18(18) / 废标项 2(2) / 资格要求 60(60) / 符合性检查 32(32)；汇总徽标 共112·未覆盖112·废标★未覆盖80。
- 点击「★/▲ 条款」→ 表格过滤为 18 行且类型纯净；再点回「全部」恢复 112 行。
- 点「只看未覆盖 (112)」生效；把 1 行改为已覆盖后 → 未覆盖 112→111、废标★ 80→79、★标签角标 18→17、开关 (112)→(111)，联动正确；随后已还原，数据零改动。
- 全程未触发任何 AI/费用弹窗、未上传、未删除。截图：matrix_all.png / matrix_uncovered.png。
