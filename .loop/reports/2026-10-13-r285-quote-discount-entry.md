# R285 · 报价折扣录入入口补齐（闭合 r281-quote-discount-no-entry）

- 轮次：round 284 → 285
- 时间：2026-10-13 02:49
- 优先级：P2（backlog 实质项，非零风险小改）
- 域：/ppt-quote 报价主链路（用户优先级：标书 > 方案 > PPT/报价侧的折扣交互补全）

## 选题依据
巡检 backlog 中 `r281-quote-discount-no-entry`（P2）：`discount` 字段贯穿
数据模型（QuoteItem.discount）、算子（itemSubtotal × 折扣%）、导出（Excel
`ROUND(E*G*discount/100,2)` 单元格公式、Word itemSubtotal）、UI（小计列 (90%) 徽标）
全链路，但**唯一缺失是没有任何录入入口**——QuoteEditor 只有数量/单位/单价/备注可编辑，
AI 初稿与手工新建一律 `discount: 100`（grep 全仓 discount 赋值点 L1877/L2136/L2180/L2404
+ types L266/L291 全为 100，SQLite 只读实例 3 条 discount 全 100）。
结果是「改了也白改」：无法表达「原价 + 折扣」报价方式，无法做 A/B 折扣版本对比。

## 变更（四处读面闭合，零 AI/零 schema/零提示词）

### 1) 单一口径 normalizeDiscount（pptQuoteTypes.ts）
- 新增 `normalizeDiscount(d)`：缺省 / 非法(NaN) / ≤0 → 归一为原价 **100**；>100 封顶 100。
- `itemSubtotal` 与 `sanitizeQuote` 都改调它。旧 `sanitizeQuote` 的
  `Number(it.discount) || 0` 会在重载后把折扣存成 0 → 小计悄悄归零（资损路径），现杜绝。
- QuoteItem.discount 补口径注释。

### 2) 导出同口径（quoteExports.ts）
- `quoteItemSubtotalFormula` 改调 `normalizeDiscount`，Excel 单元格公式与 Word itemSubtotal
  保持 R281「落到分」完全一致，客户 Excel 复算/折让不再与 Word 对不上。

### 3) UI 录入入口（QuoteEditor.tsx + usePptQuote.ts + PptQuotePage.tsx）
- 行表新增「折扣(%)」列（单价与小计之间）：NumCell `min=1 max=100`，失焦回落 100，
  onCommit 写回 `{ discount: normalizeDiscount(n) }`（UI 层不可能落 0，双层护栏）。
- 分组头新增「整组折扣%」批量入口（整包折让一次改全组，逐行仍可单独覆盖），
  走新增 `usePptQuote.setGroupDiscount`（函数式 `mutateQuote`，非整数组竞态写法），toast 反馈。
- 小计徽标口径同步为「（N%计价）」（90 直显 90% 而非旧 (90%) 的歧义）。
- 表尾 `<tfoot>` 列跨度：label td colSpan 6→7（含新增折扣列），尾列保持 3（新增列在单价与小计之间，
  小计右侧评级/备注/操作三列不变）；`min-w` 1080→1160。
- PptQuotePage 接线 `setGroupDiscount={p.setGroupDiscount}`。

### 4) 测试增量 +9
- pptQuoteTypes.test.ts（+4）：normalizeDiscount 边界、90=90% 口径、itemSubtotal 脏 0 不清零、
  sanitizeQuote 重载 discount=0 归一为 100。
- 新建 quoteDiscount.test.ts（+5，源码扫描范式，本机无 jsdom/RTL，沿用 disclosureA11y）：
  UI 行内列 / 整组批量入口 / 页面接线 / 算子定义+暴露 / 导出同口径 五处锚点，任一被拆即报警。
  读取按行剥 CR，规避跨工作区补丁写回产生的 CRLF 让含换行断言假红。

## 四门验证（目标项目目录）
| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b` | exit 0（零错误） |
| 单测 | `npx vitest run` | 2209 passed / 2 skipped（+9 增量，基线 2200） |
| Lint | `npx eslint` 触及文件 | QuoteEditor exit 0；usePptQuote 4 处 set-state-in-effect error 与 `git show HEAD` 副本逐行一致，属既有非新增 |
| 构建 | `npx vite build` | exit 0 |

## 维持裁定（未触碰）
- 编造嫌疑未清零禁止导出硬门禁：维持「只报告不拦截」，本轮未改。
- lint-debt-01：有意保留残余，不重构，本轮未扩大。
- 零 collection / 会话内 state：本轮 discount 仍存 QuoteRecord.groups 内，未动 PocketBase collection/pb_hooks。

## 落点文件
- src/pages/PptQuote/pptQuoteTypes.ts
- src/pages/PptQuote/quoteExports.ts
- src/pages/PptQuote/usePptQuote.ts
- src/components/ppt-quote/QuoteEditor.tsx
- src/pages/PptQuote/PptQuotePage.tsx
- src/pages/PptQuote/pptQuoteTypes.test.ts
- src/pages/PptQuote/quoteDiscount.test.ts（新建）

## 补丁脚本（跨工作区 Python，d:\KFDXCX\MedPreSales\scripts\）
r285q_patch1 / patch2 / patch2b / patch2c / patch3 / patch3d / patch3e / patch3e2
（每个 str.replace 前 assert count==1；patch2c 修正 tfoot 列跨度溢出；patch3d/3e 重写扫描测试
绕过 Write 工具对反斜杠的二次转义）。
