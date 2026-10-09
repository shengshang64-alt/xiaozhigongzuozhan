# R184 · 人民币大写金额确定性模块（补「金额大小写一致性」废标核验）

- round：183 → 184  |  类别：A 类实施（新建自包含纯函数模块 + 全量单测）
- 提示词：无改动（不触发 B 类逐字对比流程）  |  数据模型：零 PocketBase collection / 零会话 state 改动
- 维持裁定：编造嫌疑硬门禁「只报告不拦截」——本模块口径完全一致（只报不拦）；lint-debt-01 有意保留残余——本轮未触及

## 1. 选题依据（巡检新角度：内容核验盲区 / 交互断链）
- 本轮开始时目标项目仍处重度在途（55 个 M + 多个 ??），标书主链路编排（useBidWorkspace.ts / bidSection.ts /
  bidChapter.ts）与 PPT 导出接线（deckExports.ts）、报价全链路（quoteRecommend/pptQuoteTypes/usePptQuote）均为 M，
  r169 切片二/三、r177 并发接线、quote-history 二期接线均命中在途区，按红线绕开并记录（quote 推荐内核 R102/R176 已完成）。
- 复核 consistencyGuard 三条 LLM 护栏规则（②量化依据 / ③量级自洽 / ④政策时效）——**均未覆盖「金额大小写是否一致」**，
  而这是标书/报价/合同的经典硬性废标/扣分项（大写被篡改或大小写笔误即废标）。
- 全库检索确认：此前无任何人民币大写金额的生成/解析能力（仅测试快照里出现过字面串「人民币肆仟万元整」）。
  该判定天然可**确定性完成**（大写串 ↔ 阿拉伯数字为精确互逆），无需 LLM、零成本、零误判、可离线。
- 故本轮走「清洁新建自包含模块」路线（同 R182 templateFidelity 模式），零触碰在途 M 文件。

## 2. 交付（src/lib/currencyCn.ts，纯函数三件套）
1. `cnyToUpper(amount, {prefixRmb?})`：阿拉伯金额 → 中文大写。四舍五入到分；正确处理
   内部零（壹佰零伍）、跨节零（壹亿零壹佰）、万/亿/万亿分节、元角分、不足壹元（伍角陆分）、
   零元整、负（负捌元捌角）、非法（NaN/Infinity→空串）。
2. `parseCnyUpper(text)`：大写 → 阿拉伯（`cnyToUpper` 逆运算）；兼容人民币/¥前缀、负/欠、圆、整/正、
   元零X分、万亿；不规范/碎片（万元、ABC元、壹佰块钱、无有效数字）返回 null。
3. `scanAmountMismatches(text, window=6)`：扫描正文中「大写金额与其紧邻重述的小写金额」一致性，
   输出 mismatch（含相对偏差 diffRatio）或 malformed（未填写的大写占位碎片）。

## 3. 防误配设计（只报不拦，但控制噪声）
- **紧邻才比**：只比较被括号/标点/轻连接词（（）[]，、。：~－为即约合至到约等共计¥￥ 空格）隔开、间隔 ≤6 字符的对；
  含被排除汉字者不配对 → 「总投资1亿元（含贰仟万元不可预见费）」不误判（「含」被拒）。
- **重叠丢弃**：与任一阿拉伯金额区间重叠的大写串被丢弃 → 小写「4000万元」内的「万元」不被当成独立大写碎片。
- 解析两侧均四舍五入到分后比较，容差为 0（确定性精确判定）。

## 4. 向后兼容
- 全新文件，零改动既有实现/调用点，零回归风险。buildSafeFileName/quoteRecommend 等既有导出与推荐链路不受影响。

## 5. 四门验证
| 门 | 结果 |
|---|---|
| npx tsc -b | exit 0，零错误 |
| npx vitest run（新文件） | 16 passed |
| npx vitest run（全量） | 1230 passed / 2 skipped（基线 1214 → **+16 新增，零回退**） |
| npx eslint（触及 2 文件） | 零 error / 零 warning |
| npx vite build | 成功，built in 3.07s |

## 6. 触及与合规
- 仅 `src/lib/currencyCn.ts`、`src/lib/currencyCn.test.ts`（git status 核对：二者均为新建 ?? 非在途 M，零冲突）。
- 跨工作区经 Python 补丁脚本 `scripts/r184_currency_cn.py`（新建）+ `scripts/r184_fix1.py`（测试边界用例修正：
  1.005 属浮点边界舍入到 1.00 元整，为正确行为，改用无歧义 1.01 断言）。
- 未 commit。

## 7. 记账的绕开项 / 后续接线待办
- **新增 backlog `r184-bid-amount-consistency-wiring`（open）**：把 `scanAmountMismatches` 接入交卷体检 format_issues
  作第 0 条确定性硬核验（与 consistencyGuard LLM 三条并列，只报不拦）；锚点 useBidWorkspace.ts 在途 M，待其稳定后接线。
- r177 并发/续跑、r169 PPT 切片二/三、quote-history 二期接线：落地锚点均在用户未提交 M 文件内，本轮按红线绕开。
