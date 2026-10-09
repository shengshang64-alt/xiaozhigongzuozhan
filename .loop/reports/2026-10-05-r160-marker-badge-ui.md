# R160 解析报告「疑符号丢失」徽标 UI

## 选题依据
接续 `.loop/ledger.json` round=159。backlog 中 `quote-history-01`（二期 R102 closed）、`prompt-fabscan-03`（R89 边界裁决 + R101/R103 收口）经账本核实均已 closed，非本轮可选项。择定唯一 open 且数据就绪的实质项 **`r159-marker-badge-ui`（P3·标书主链路 /bid-workspace）**：R159 落地的 `detectMarkerSymbolLoss` 已产出命中行 `samples`，但只在三个触点做一次性 toast 提示，跨会话打开解析报告后命中行无任何视觉标记——展示层接线缺失。本轮补齐徽标，属"数据就绪只差渲染接线"的实质性闭环，而非零风险小改。

维持裁定核对：编造嫌疑未清零禁止导出=只报不拦（本徽标同为只报不拦，加警示不改行为）；lint-debt-01 残余不重构（未触碰）。

## 变更文件
| 文件 | 变更 |
|---|---|
| `src/pages/BidWorkspace/materialIntegrity.ts` | 新增 `lineHasMarkerLoss(line)` 单行判定 + `countMarkerLossLines(text)` 分区逐行计数，与 `detectMarkerSymbolLoss` 同源签名（去 g 复用 `MARK_LOSS_RE`/`PUA_RE`），零依赖零费用 |
| `src/components/bid-workspace/ParseReportPanel.tsx` | 新增 `renderDetailLine` 包装：命中行行尾挂琥珀色「疑符号丢失」徽标（`title` 悬停显示说明 + 该行摘录，`cursor-help`）；分区 header 命中数 >0 时显示「疑符号丢失 N 行」汇总徽标，跨会话打开即可复核 |
| `src/pages/BidWorkspace/materialIntegrity.test.ts` | 新增 3 单测覆盖 `lineHasMarkerLoss`（空引号命中/正常条款行与空白行不误报/PUA 残留命中）与 `countMarkerLossLines`（逐行计数忽略空行、空输入 0） |

## 实现口径
- **只报不拦**：徽标纯展示层，不改解析数据、不改 `star_clauses` 内容、不动扫描逻辑，`renderStarLine` 的 ★/▲ 高亮逻辑保留并置于徽标之前。
- **零新状态/零 hook 风险**：`markerLossInSelected = countMarkerLossLines(selected.content)` 为普通派生计算，未新增 `useState`/`useEffect`（规避 `react-hooks/set-state-in-effect`）。
- **逐行 + 汇总双视角**：命中行行内徽标定位具体行；header 汇总徽标给"本分区有几行"的整体判断，解决 toast 一次性、开走即失的问题。
- A 类：零 schema / 零 pb_hooks / 零提示词（非 B 类）/ 零 AI 费用 / 会话内无新 state / 未 commit。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：1044 passed | 2 skipped（1046），本轮基线 1041 → +3 全为本轮新增（materialIntegrity.test.ts 8→11），96 文件全绿，无回归。
- `npx eslint`（触及 3 文件）：净新增 0 error。`materialIntegrity.ts` / `materialIntegrity.test.ts` 零输出；`ParseReportPanel.tsx` 唯一 error 为 L105 `setKeyOnly` in `useEffect`——属既有基线代码（补丁前原文件 L81-83 即存在，本轮仅因插入 import/辅助函数下移行号），非本轮引入。
- `npx vite build`：exit 0，5948 modules transformed，built in 3.75s。

## 误伤防护
补丁前 `git status` 核对：`ParseReportPanel.tsx` git CLEAN、`materialIntegrity.ts(.test.ts)` 为 R159 self-produced 未提交新文件（非用户在途），无在途 WIP hunk 冲突；8 处 `str.replace` 锚点全部 `assert count==1` 命中唯一。未 `git commit`。

## 浏览器实机验证（dev :8000，HMR 已加载本轮改动）
- 数据源：真实项目 `7vco3jzj6abz8p0`「【演练】R01-bid-20261004」，探针扫其 `parse_report` 各分区，命中 `overview`(1 行) + `response_req`(1 行) 含空引号对签名（三明 F05「标注""的条款为实质性要求」上游损坏真实形态）。
- 打开 `/bid-workspace?project=7vco3jzj6abz8p0` → 选中「项目概述」分区：DOM 实测 2 处「疑符号丢失」徽标——
  - header 汇总徽标 `疑符号丢失 1 行`（`inHeader=true`，title=「本分区有 1 行疑似丢失 ★/▲ 等标注符号…」）；
  - 命中行行内徽标 `疑符号丢失`，行文本逐字为「重要标注约定：本文件中标注""的条款为实质性要求条款，投标人必须完全满足且不允许负偏离；标注"▲"的条款为重要技术指标/服务指标…」，title 摘录正确截断至该签名行。
- 视觉证据：截图 `.qoder/tmp/r160_marker_badge_proof.png`（琥珀色徽标清晰渲染于命中行尾，与设计系统 amber 口径一致）。
- 控制台：`list_console_messages(error|warn)` 零条，无回归无报错。只报不拦（徽标纯展示，未改分区内容/未拦截任何操作）。

## 后续挂账
`r159-marker-badge-ui` 仅覆盖 ParseReport 展示层；`ComplianceMatrixPanel` 的命中行徽标可另轮按同一 `lineHasMarkerLoss` 复用补齐（数据源已单一真源，接线成本低）。
