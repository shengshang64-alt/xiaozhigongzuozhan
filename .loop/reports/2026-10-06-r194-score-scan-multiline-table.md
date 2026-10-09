# R194 · 评分项本地扫描：跨行断裂评分项与表格行归一（r193-score-scan-multiline-table 关闭）

日期：2026-10-06 ｜ 优先级：P3 ｜ 类型：纯函数优化（零 AI / 零 collection / 零提示词 / 零 pb_hooks）

## 选题依据
账本 round=193 巡检挂账 `r193-score-scan-multiline-table`（P3 open）：scanScoreItems 逐行启发式，
遇到 PDF/表格抽取后跨行断裂的评分项（项名上一行、纯分值下一行）与竖线/制表符表格行仍漏配。
用户点名项 quote-history-01、prompt-fabscan-03 经核实均已 closed（R102/R103），不重做。

## 方案与实施（补丁链 r194_score_scan.py ~ r194_score_scan14.py，MedPreSales 侧）
1. **两遍处理主循环**：先归一（`|`/`｜`/`\t` 单元格分隔符→空格、压缩空白、剔除纯序号首格
   `^\d+\s+(?=\S)`），再回并（纯分值行 `isPureScoreLine` 且前行为项名时合并为一行走既有 pickScoreHit）。
2. **新增常量/函数**：`RE_SCORE_LINE_PURE`（（最高）N分 / N-M分 / 最高N分 形态）、
   `RE_TABLE_LABEL_LINE`（表头「序号 评审因素 分值」标签行跳过）、`RE_PIPE_CELL`、
   `isPureScoreLine`（含「分/数/钟」否定护栏）、`hasAnyScoreHit`（回并前置校验，防误并）。
3. **护栏**：纯数字（页码）不回并；回并要求前行 ≤100 字且非评分行；合计/总分/满分纯标签行允许回并（补丁E）；
   `prevLine` 快照修复 prev 时序缺陷（补丁M）；移除方向性错误的 prevAlreadyScored 护栏（补丁K，
   R193 原实现本无此护栏且表格合计行前必跟评分行）。
4. **踩坑与回退**：补丁C1 给 nameFromHead split 字符类加 `\s` 导致「1. 技术方案比选 10-20分」
   head 切界后残留 `.` 被剥净 → name="" 漏报（补丁12 修隐式范围仍不够）；补丁13 **撤销 C1**，
   空格场景由尾步 `[\s\u3000]+` 去空白覆盖，R193 回归恢复全绿。

## harness 形状判读（临时探针 _r194_harness.test.ts，10 形态实测后已删除）
F1 列拆分跨行 ✓ ｜ F2 Markdown 整表+类目切换 ✓ ｜ F3 TSV 制表符 ✓ ｜ F4 页码护栏 ✓ ｜
F6 表格标签行 ✓ ｜ F7 背靠背双评分项 ✓ ｜ F8 跨行总分行 ✓ ｜ F9 竖线表格行上限 ✓ ｜ F10 时长回归护栏 ✓ ｜
F5「10/分」两行拆分（分字独行）——已知不覆盖，属 pdfjs 极端拆列形态，留观察。

## 正式回归测试（scoreItemsScan.test.ts +8 用例，17→25）
跨行回并双项、页码不回并、竖线表格行、TSV 行、表头标签行、跨行总分行、整表多行顺序稳定、时长跨行不误报。

## 四门验证（目标项目目录实测）
- `npx tsc -b` exit0 零错误
- `npx vitest run` exit0：113 files，1357 passed | 2 skipped（基线 1349→+8，全本轮新增）
- `npx eslint` 触及 2 文件 exit0 零 problem
- `npx vite build` exit0

## 裁定维持
编造嫌疑未清零禁导出「只报告不拦截」未触碰；lint-debt-01 残余不重构；未 git commit；
数据模型零改动（无 collection/pb_hooks 变更）；提示词零改动（非 B 类）。
