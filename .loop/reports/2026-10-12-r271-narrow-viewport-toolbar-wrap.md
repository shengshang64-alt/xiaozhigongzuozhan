# R271 · 窄屏工具条横向溢出修复（闭合 narrow-viewport-toolbar-overflow）

## 选题依据
`narrow-viewport-toolbar-overflow` 是 R252 浏览器实机走查顺手记下的 P3 backlog，明确写出复现数据与定位：
> 视口宽 < lg 断点时 `document.scrollWidth(803) > clientWidth(464)`，横向溢出源为既有「章操作条」（带入技能/生成正文/改写/扩写/精简/自检，right=803）
> 与「顶部操作条」（素材/逐章生成/导出 Word/打印，right=771）的 `shrink-0` 单行不换行。
> 非本轮新卡所致（新卡 scrollWidth==clientWidth 已验）。窄屏可用性待评估：需允许换行或收纳为溢出菜单。

其余 open 项按裁定/性质不动：`lint-debt-01` 有意保留、`bidkit-global-opt-p0` 空 issue、`ui-redesign-phase3` 子项均已 ✓ 属自然迭代、
`quote-history-3-mining` 独立立项评估、`r177-followup-generation-parallel-resume` AI 并发、`r261-bidcheck-followons` 剩余子项触发数据模型/纯规则口径。
窄屏可用性直接影响售前在 pad/半屏浏览器下的实操，本轮挑此项做实质修复。

## 根因（CSS 语义核对）
组件里工具条容器写的是：
```
<div className="flex shrink-0 flex-wrap items-center gap-1.5">
```
- `flex-wrap` 声明在**该工具条自身**上，让工具条的子按钮可折行；
- `shrink-0`（`flex-shrink: 0`）声明在**同一容器**上，作为父 header（也是 flex 容器）里的一个 flex item，
  该 item **不会**从 `flex-basis: auto`（即 max-content 宽度）缩下去。
- 关键：一个 flex-wrap 容器的 **max-content** 宽度是「所有子项单行求和」（因为 max-content 假定不换行），
  所以 shrink-0 让工具条以「单行求和 ≈ 700-800px」为基准不可缩，父级只有 464px 时**父级不缩、工具条不缩 → 溢出**。
- 工具条自身虽有 flex-wrap，但父空间不足时它不会先"被压缩"，也就永远触发不了 wrap。

## 修复
把三处工具条的 `shrink-0` 改为 `min-w-0`（`min-width: 0`），恢复 Tailwind 官方推荐的「可缩 + 折行」窄屏响应式工具条惯用法：
- 该容器作为 flex item 默认可缩（`flex-shrink: 1`），且 `min-width: 0` 抹掉了「不能缩到 min-content 以下」的隐式下界，
  于是父宽不足时容器先被压缩，压缩到某宽度后自身 `flex-wrap` 生效，子按钮自然折行到多行；
- 视觉上不再出现 `document.scrollWidth > clientWidth`，浏览器横向滚动条消失；
- 宽屏不受影响（父宽足够时容器不缩，按钮单行呈现，视觉零变化）。

## 变更文件（3 处 className 字符串，逐字只动 shrink-0 → min-w-0）
- `src/components/solution-studio/ChapterEditor.tsx` L125：`{!isBiz && (<div className="flex … flex-wrap items-center gap-1.5">`
  —— R252 点名的「章操作条」。
- `src/components/solution-studio/EditorWorkspace.tsx` L111：`<div className="flex … flex-wrap items-center gap-2">`
  —— R252 点名的「顶部操作条」（素材/逐章生成/导出 Word/打印）。
- `src/components/shell/PageHeader.tsx` L14：`{actions ? <div className="flex … flex-wrap items-center gap-2">{actions}</div> : null}`
  —— 全站页头 actions 区（凡走 PageHeader 的页面都同享修复，覆盖面最广）。

其余 `flex shrink-0 flex-wrap` 命中点（DeviationPanel / DupCheckPanel / MockEvalPanel / ParseReportPanel / ComposeStep / SubmissionCheckPanel / ArchivePanel / QuoteEditor / StandardsPickerDialog / DocListPanel / CustomerOverviewSection 等）
经核均位于 `CardHeader` / `section` 之类的**列向或已限定宽度上下文**中，`shrink-0` 只影响交叉轴、不会引发同向溢出，
本轮不做过度收敛以免误伤既有布局；后续若巡检发现新溢出点可另立期次。

## Git 在途核对（前置）
- ChapterEditor.tsx 用户改动集中在 L97-116 / L111 / L220-224（商务骨架章「已生成」文案分支），锚点行 L125 **不在 hunk 范围**；
- EditorWorkspace.tsx 用户改动集中在 L7-8（新增 SolutionDeliveryCheckCard import）与 L235-241（渲染该卡），锚点行 L111 **不在 hunk 范围**；
- PageHeader.tsx 无 in-flight diff。
所有替换均走 `assert count==1` 再 `str.replace`，零误伤。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0。
- `npx vitest run`：174 files 全过，**1955 passed + 2 skipped**（R270 基线 174/1955+2 零回归；本轮为纯 className 修改，无逻辑变化，
  未新增单测——工具条折行属浏览器布局计算结果，jsdom/vitest 层不可靠测；建议真浏览器窄屏走查作补充证据，见挂账）。
- `npx eslint`（触及 3 文件）：exit 0，零 error/warn。
- `npx vite build`：成功，built in 4.24s。

## 数据模型 / 提示词
零 PocketBase collection schema、零 pb_hooks、零提示词改动（未触 B 类流程）。

## 维持裁定不动
- 编造嫌疑未清零禁止导出：只报不拦——本轮属响应式修复，未新增任何拦截；
- `lint-debt-01` 有意保留残余不重构。

## 挂账
- 真浏览器窄屏（< lg 断点）走查：本轮以 CSS 语义分析 + 全量回归 + 构建通过为证据，实机 scrollWidth/clientWidth 相等验证留给下一次浏览器走查
  （R252 走查记录本身在 `tests/records/` 内，届时可对比）。
- 若下一次巡检发现新的横向溢出源（如 ComposeStep 主工具条），沿用同一惯用法即可，无需重新分析。
- `ui-redesign-phase3` 剩余「整体视觉密度按自然迭代逐步收敛」不属本轮范围。
