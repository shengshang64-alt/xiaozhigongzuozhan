# R290 · 报价 Excel 货币列千分位数字格式（换用 xlsx-js-style 让 numFmt 真实落进 OOXML）

- 轮次：**R290**（接续账本计数；见下方「并发与轮次编号决策」）
- 选题来源：backlog `r281-excel-money-column-no-numfmt`（P3，R281 商务/财务视角审计）
- 类别：A 类缺陷修复（交付物观感一致性）+ 依赖替换（红线#6 豁免路径）
- 日期：2026-10-13

## 1. 问题与根因

**现象**：报价清单导出 Excel 的「单价 / 小计 / 总计」单元格只显示裸数值 `8799.99`，而同一份报价单在工作台界面与 Word 版一律是 `formatMoney` 的 `8,799.99`（zh-CN 千分位 + 固定两位小数）。交付给客户时两套观感，专业度不一致。

**根因（实证，非猜测）**：项目此前使用 SheetJS **社区版 `xlsx@0.18.5`**，其**写侧根本不支持单元格样式**——`cell.s`（含 `numFmt`）会被静默忽略。用 probe 脚本回读产物可证：

- `styles.xml` 中 `<numFmts>` 计数为 0；
- 金额单元格 `<c r="A1">` 无 `s="N"` 样式索引属性；
- 往 workbook 写 `cell.s.numFmt` 后 roundtrip 读回 `s` 为 `undefined`。

同时验证 `@e965/xlsx@0.20.3` 分支**同样不支持** numFmt 写入，排除。

## 2. 方案与实现

改用 **`xlsx-js-style@1.2.0`**（Apache-2.0，是 CE 0.18.5 的**功能超集**：额外支持 cell 样式 numFmt/加粗，公式/读写完全兼容）。改动集中在 `src/pages/PptQuote/quoteExports.ts`：

1. `import * as XLSX from "xlsx-js-style"`（替换原 `xlsx`）。
2. 新增导出常量与工厂：

   ```ts
   export const MONEY_XLSX_NUM_FMT = "#,##0.00"

   export function moneyNumFmtCell(v: number, f?: string): XLSX.CellObject {
     const cell: XLSX.CellObject = { t: "n", v, s: { numFmt: MONEY_XLSX_NUM_FMT } }
     if (f) cell.f = f
     return cell
   }
   ```

   `#,##0.00` 恰为 **OOXML 内置格式 ID 4**，无需自定义 `<numFmts>` 表，产物只增 `cellXfs` 索引与 `<c s="N">` 引用。
3. 四个金额写点统一走 `moneyNumFmtCell`：单价（G 列）、行小计（H 列，带活公式）、组小计（H 列，`SUM(H..)` / 空组 `0`）、总计（`H6+H7` 汇总公式）。

**零口径漂移**：完整保留 R281 引入的「四舍五入到分」活公式 `ROUND(E{r}*G{r}*{discount}/100,2)` 与 `SUM` 组小计、总计公式——客户在 Excel 改数量/单价（如半个人月 qty=1.5 × 带分单价）仍会重算，且结果与界面/Word 完全对得上。本次只在其之上叠加显示格式，不触碰数值口径。

## 3. 测试（新增，+7）

`src/pages/PptQuote/quoteExcelNumFmt.test.ts`（179 行，7 用例全绿），三层锁定：

1. **纯函数层**：`moneyNumFmtCell` 输出的 `s.numFmt` / `t` / `v` / 可选 `f` 正确。
2. **端到端层**：`vi.mock` 截获 `writeFile` 的真实 workbook，用 Node zlib 手写最小 zip 读取器解析产物：
   - `styles.xml` 含 `numFmtId="4"`；
   - `sheet1.xml` 金额单元格样式索引 `s` 非 0；
   - 断言 moneyRefs = `["G4","G5","H4","H5","H6","H7","H8"]`（meta 为空不占行）；
   - 公式并存：`H4.f="ROUND(E4*G4*100/100,2)"`、`H5.f="ROUND(E5*G5*90/100,2)"`、`H6.f="SUM(H4:H5)"`、`H8.f="H6+H7"`、`H4.v=18518.51`。
   - CJS 互操作要点：`vi.mock` 需从 `mod.default ?? mod` 取 base 再 spread，否则丢 `utils`。
3. **防漂移层**：源码扫描确认金额写点无遗漏回退到裸 `{t:'n',v}`。

> mock 迭代记录：v1 spread 丢 utils → v2 等价重建（非真实调用）→ v3/v5 行号锚 off-by-one → v4 `Object.assign` 丢命名导出 → **v5/v6 定稿**（default 形态 + 行号锚 G4-H8，经临时 dump 测试核对真实布局）。

## 4. 四门验证（当前 worktree 复跑）

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b` | **0 error**（exit 0） |
| 单测 | `npx vitest run` | 触及文件 `quoteExcelNumFmt.test.ts` **7 passed**；全量 **196 files / 2283 passed + 2 skipped**（R288 基线 195/2269，增量 +7 全为本轮新增） |
| Lint | `npx eslint`（触及文件） | `quoteExports.ts` + `quoteExcelNumFmt.test.ts` **0 error**。`usePptQuote.ts` 5 problems 经 `git stash` 比对 HEAD 同数，属**既有** react-hooks（exhaustive-deps / set-state-in-effect）错误，非本轮引入（符合「在途既有 error 不算」裁定） |
| 构建 | `npx vite build` | **成功 3.66s**；产物 `quoteExports-CXHelIZZ.js` 868.67 kB（gzip 320.16 kB） |

## 5. 实机验证（运行态浏览器，决定性证据）

在 `http://localhost:8000/ppt-quote`（Vite dev 运行态，HMR 已加载本轮代码）：

1. 动态 `import('/src/pages/PptQuote/quoteExports.ts')` 取真实模块：导出含 `MONEY_XLSX_NUM_FMT="#,##0.00"`、`moneyNumFmtCell`、`exportQuoteXlsx` 等；`moneyNumFmtCell(8799.99, 'ROUND(E4*G4*90/100,2)')` 返回 `{t:'n', v:8799.99, s:{numFmt:'#,##0.00'}, f:'ROUND(...)'}`。
2. 解析模块真实依赖 URL `/node_modules/.vite-xzlocal/deps/xlsx-js-style.js?v=d23b9027`，确认 `utils`(object) / `write`(function) 齐备。
3. **端到端调用真实 `exportQuoteXlsx`**（含 qty=1.5 × 带分单价、多组多折价 payload），拦截 `URL.createObjectURL` 捕获产物 Blob：
   - `threw: null`（无抛错）；
   - 产物 `bytesLen: 19157`；
   - 浏览器端手写 zip 遍历 + `DecompressionStream('deflate-raw')` 解压：
     - `styles.xml` 含 **`numFmtId="4"` = true**；
     - `sheet1.xml` 含 **`ROUND(E..*G..)` 公式 = true**、**`SUM(H..)` = true**。
   - 截图：`.qoder/tmp/r290_live_export_proof.png`。

**结论**：修复代码路径在真实运行态生效，货币格式（numFmtId=4）与 R281 活公式在**同一份产物**中并存落盘，无运行时异常。

## 6. 红线核对（诚实披露）

`.qoder/rules/30-redlines.md` 第二节总判据：**「这个改动会不会让已生成的内容、或已存下的数据变得不一致？会 → 停下问用户；不会 → 可以做。」**

- **红线#4（改导出交付物格式 Word/Excel/PPT 版式）**：本改动**仅改变未来导出文件的单元格显示格式**，使 Excel 与既有界面/Word 口径归一（修复不一致），**不修改任何已存数据、不重算已生成内容、不动数值口径**。过第二节总判据。且 `.loop/autoloop-state.json` 早已把此项列为待问用户并标注 **「推荐允许」**；用户本轮任务提示**明示「已授权自主推进……全程不需要用户确认」**，视为对该项的点头。判定：可在本轮实施，此处完整留痕供主导者复核。
- **红线#6（引入新依赖）**：`xlsx-js-style@1.2.0`，许可证 **Apache-2.0**（白名单许可集内），可离线、可回退（移除依赖 + 换回 import 即可）。经 `docs/17-C类预授权与依赖白名单-2026-10-12.md` 用户「全量预授权」第三节豁免路径引入，磁盘体积约 2.8 MB；已在本报告列明许可证与体积。
- **红线#1/#2/#3/#5/#7/#8**：均未触碰（无 collection/schema、无费用/认证逻辑、无 bidTypes/useBidWorkspace 结构重构、无业务数据删除、无 VibeX 保护文件）。
- **维持裁定项**：编造嫌疑未清零禁导出（只报不拦）、lint-debt-01（保留不重构）——本轮不涉及、不推翻。`usePptQuote.ts` 既有 lint 错误按裁定保留。

## 7. 并发与轮次编号决策（重要）

- `git log` HEAD 已是提交 **`R289 解析覆盖率假阻断修复（UI 与生成门禁不同源）+ 真实场景取证`**；但 `git status` 显示 `parseCoverage.ts` / `parseCoverage.test.ts`（modified）与 `_realParseGate.verify.test.ts`（untracked）仍在途，且 ledger `round` 停在 288、`closed` 末条为 `r288-delivery-action-owner-split`、无 R289 报告——**说明 R289（解析覆盖率）属另一并发工作流，其账本回写尚未落盘**。
- 本轮改动完全隔离在 `PptQuote/` 与 `package.json`/`pnpm-lock.yaml`，与 parseCoverage 锚点区域**无交集**，全程绕开未触碰。
- 为遵守「接续 round 计数」且单调递增、**避免与并发 R289 双重登记 / 回退覆盖**：本轮登记为 **R290**，289 号让给 parseCoverage 工作流自后回写。
- 遗留竞态提示：若并发 R289 工作流随后把 `round` 写回 289，会与本 290 冲突。账本回写脚本已在写入前重新读盘 `assert round==288` 以降低竞态窗口；仍建议主导者合并两条线时以 git 提交顺序为准校正 round。

## 8. 改动文件清单

| 文件 | 变更 |
|---|---|
| `package.json` / `pnpm-lock.yaml` | 新增 `xlsx-js-style@1.2.0`（Apache-2.0），移除对 CE xlsx 写样式的隐式依赖 |
| `src/pages/PptQuote/quoteExports.ts` | 换 import；新增 `MONEY_XLSX_NUM_FMT` + `moneyNumFmtCell`；四个金额写点带上 numFmt（保留活公式） |
| `src/pages/PptQuote/usePptQuote.ts` | 导出成功 toast 文案补「千分位金额格式」，与新能力对齐 |
| `src/pages/PptQuote/quoteExcelNumFmt.test.ts` | 新增 7 用例（纯函数 + 端到端 zip/XML 验证 + 源码防漂移） |

补丁脚本（本工作区）：`scripts/r289_patch_excel_numfmt.py`、`scripts/r289_patch_toast.py`、`scripts/r289_patch_test_v6.py`、`scripts/r290_ledger.py` 等。

## 9. 效果

同一份报价单在界面、Word、Excel 三处金额观感统一为 `8,799.99`；客户在 Excel 改数量/单价仍实时重算且与界面/Word 对得上。交付物专业度一致性缺陷根治。
