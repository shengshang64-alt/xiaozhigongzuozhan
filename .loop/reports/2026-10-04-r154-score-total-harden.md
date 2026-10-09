# R154 · 评分交叉核对总分口径硬化（闭环 r151-score-scan-206）

日期：2026-10-04 ｜ 域：/bid-workspace ｜ 类别：A 类（零 schema / 零 pb_hooks / 零提示词 / 未 commit）

## 选题依据
- backlog 唯一标书主链路实质项：R151 实机观察「评分项交叉核对面板 本地扫描 0 项 vs 原文总分 206」疑点（P3）。
- 优先级授权：标书 > 方案 > PPT，弱化报价；quote-history-01 / prompt-fabscan-03 均已 closed 且用户两次批评收口过。

## 诊断（零 AI harness，真值文本 _eval/R142_faithful_tender.txt，62596 字，R142/R149/R151 三次确定性基线同文）
- 复现：`scanScoreItems` → items=0、total.value=206，与实机面板完全一致。
- 根因一（真 bug）：总分兜底 `Number(line.match(/(\d+(?:\.\d+)?)/)?.[1])` 在「本项目建设范围…合计约206个系统/子系统模块…」行
  抓到裸数字 206——那是模块个数不是分值（文档真实 100 分制：6.2 价格分 10 + 6.4 技术 65 + 6.5 商务 25）。
- 根因二（0 项核实为合理）：全文仅 4 行含「N分」；3 行为目录标题行（如「6.2 价格分（10分） 29」）被 CATEGORY_HEADER_RULES
  正确跳过，1 行为 ★ 定义长行（>120 字符排除）。精简版招标正表未抽取，0 项是口径正确结果，维持「核对辅助非真值源」诚实声明。
- 面板消费端 ScoreCrossCheckPanel.tsx 已有 `total.value !== null ? … : "未识别"` null 分支，无需改动。

## 变更
| 文件 | 变更 |
| --- | --- |
| src/pages/BidWorkspace/scoreItemsScan.ts | 总分采信口径：删除裸数字兜底，仅当 pickScore 命中「N分」显式单位才记录；注释钉住根因 |
| src/pages/BidWorkspace/scoreItemsScan.ts | L50 字符类内冗余转义 \\[ \\] 去除（R35 先例，正则匹配完全等价，HEAD 既有 no-useless-escape error 顺手清零） |
| src/pages/BidWorkspace/scoreItemsScan.test.ts | 新增 describe「总分口径」3 it：206 误报回归 / 冒号·贴身·括号三式显式总分 / 首条不覆盖 |

## 在途代码保护
- git diff 全仓仅 R153 自有未提交文件（starClauseNoise.*）+ ledger；本轮锚点区域（L80 总分分支、L50）均无用户未提交 hunk，安全。
- 全程禁止 commit，未执行。

## 四门验证
| 门禁 | 结果 |
| --- | --- |
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 94 文件全绿：1001 passed \| 2 skipped（基线 998 **+3**，零回退） |
| npx eslint（触及 2 文件） | exit 0（修复前检出 1 个 HEAD 既有 no-useless-escape，确认非本轮引入后按 R35 先例等价清除） |
| npx vite build | exit 0，built in 3.10s |

## harness 复验（修后）
- 同文本重跑：items=0、total.value=**null**（面板将显示「原文总分：未识别」），206 假阳性消除。

## 维持裁定
- 编造扫描只报告不拦截：维持。lint-debt-01 有意保留残余：维持（本轮清除的 scoreItemsScan 转义不在其 bidTypes 清单内，属顺带等价清理）。
