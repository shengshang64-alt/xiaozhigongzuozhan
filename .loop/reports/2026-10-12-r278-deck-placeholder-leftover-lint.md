# R278 · PPT 导出自检新增「模板/占位残留」确定性检测

## 选题依据
- 巡检新角度（内容质量 / 交互断链）：PPT 生成链路已带结构自检 `deckLint`（R121/R166 常驻面板 + 导出前 toast，只报不拦），
  但**只查结构**（空页/要点过多/图表数据不齐/名词标题/重复标题/无图无表），**完全没有检测 AI 批量生成最常见的交付事故**
  ——模板桩与提示语残留被原样导出交付客户：如 "XX医院"、"待补充"、"{{项目名称}}"、"请输入/点击输入"。
- 域：/ppt-quote（deck 幻灯片侧，用户优先级 3；报价侧非重点，未触碰）。
- 避让：`bidTypes.ts.bak_r277` / `useBidWorkspace.ts.bak_r277` 证明并发 agent 正在 bid-workspace 全域 live 编辑，
  solution-studio 刚于 R276 收口；本轮全部落在 PPT 自由域。

## 变更内容
- `src/pages/PptQuote/deckLint.ts`：
  - 新增确定性纯函数 `findPlaceholderLeftovers(text) -> string[]`：命中①关键词（待补充/待填写/待完善/此处填写/此处输入/请输入/点击输入/占位符/TODO/FIXME/TBD，大小写不敏感）②连续 2+ 的 X/Ｘ 打码桩 ③双花括号模板变量 `{{...}}`；结果去重。
  - `lintDeck` 逐页扫描标题 + 要点 + 讲稿（notes，同样会被导出进 .pptx），命中则产出 `code=placeholder_leftover`、`level=warn` 告警。
  - 占位残留单独收集 `placeholderIssues`，在最终去重/截断（6 条上限）时排在结构告警**之前**，确保导出即漏脸级别的问题不被挤掉。
  - 全程只报不拦：不新增导出硬门禁，不改生成行为，非阻断契约维持（与 R89 裁定一致）。
- `src/pages/PptQuote/deckLint.test.ts`：新增 9 个用例（占位命中/讲稿扫描/双花括号/干净内容不误报/截断优先级 + `findPlaceholderLeftovers` 单测 3）。
- 零提示词改动、零 collection/数据模型改动、零新依赖。跨工作区改动均经 Python 补丁脚本（pathlib utf-8 读改写 + 每处 `assert count==1`）。

## 四门验证（目标项目内）
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：**182 files / 2060 passed + 2 skipped**，exit 0；本轮 deckLint.test.ts 由 22 -> 31（**+9 用例，零回归**）。
- `npx eslint src/pages/PptQuote/deckLint.ts src/pages/PptQuote/deckLint.test.ts`：exit 0，触及文件零 error（lint-debt-01 既有残余按裁定保留、不在本轮文件内）。
- `npx vite build`：exit 0，built in 5.19s。

## 维护裁定
- 编造嫌疑未清零禁止导出：维持「只报不拦」，本轮未新增任何导出硬门禁。
- lint-debt-01：未触碰。
- 未 git commit（遵守迭代期提交禁令）。
