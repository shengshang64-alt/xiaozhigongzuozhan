# R113 全站金额显示口径单一来源（money consolidation）

日期：2026-10-01；轮次：R113；类型：A 类（口径收敛，无提示词、无数据模型、零 collection）

## 背景与选题
既定优先项全部收口：quote-history-01 报价二期已于 R102 closed、prompt-fabscan-03
（含残余「按章聚合回注」）已于 R101/R103 全部 closed；其余 open 项为维持裁定
（lint-debt-01 有意保留）、需用户立项（quote-history-3-mining）或命中在途新功能
（r112-datestamp-qualcerts-defer，QualCerts 目录仍为用户未跟踪在途代码，本轮继续绕开）。
故按手册巡检新角度，承接 R105-R112 单一来源收敛主线。

## 巡检发现（脚本扫描 src 全站 332 个 ts/tsx）
货币格式化存在**两套平行实现 + 真实口径漂移**：
1. 报价域 `formatMoney`（pptQuoteTypes.ts L191）：zh-CN 千分位 + **固定 2 位小数**
   （min=max=2），¥ 前缀散在各调用点；
2. 方案建设清单域 `fmtMoney`（checklistTypes.ts L208）：zh-CN 千分位 +
   **仅 maximumFractionDigits:2 无保底**，¥ 前缀在函数内。
同一笔 1234 元：报价单显示「¥1,234.00」，建设清单显示「¥ 1,234」——单台金额在
「新建方案向导 → 关联清单导入报价（ChecklistImportDialog 同时渲染两套）」链路里
两种小数口径并存。且两个函数都住在页面模块，跨域复用只能靠复制。

## 修复
新增唯一入口 `src/lib/money.ts`：
- `formatMoney(n): string` → zh-CN 千分位 + 固定 2 位小数；非有限值兜底 0。
落地点（2 文件，全部为已提交无在途改动文件）：
- `pptQuoteTypes.ts`：原实现删除，改为 `export { formatMoney } from "@/lib/money"`
  同源再导出——报价域 4 个调用文件（含**在途修改中的 QuoteEditor.tsx**）零改动；
- `checklistTypes.ts`：`fmtMoney` 改为同源别名 `` `¥ ${formatMoney(...)}` ``，
  方案域 8 个调用文件零改动。
行为变化点（口径统一，如实记录）：建设清单金额整数不再省略 `.00`
（「¥ 58,000」→「¥ 58,000.00」），与报价单/导出 docx 既有口径对齐。

## 波及面核查
- fmtMoney/formatMoney 在测试与快照文件中零直接断言（脚本扫描 *.test.*/*.snap），
  无需 -u；非提示词改动，PROMPT_VERSION 不变，不走 B 类。
- 零 collection / 零 pb_hooks / 零数据模型。

## 四门验证
- npx tsc -b：exit 0
- npx vitest run：699 passed / 2 skipped（基线 696，**+3** 为新增 money.test.ts）
- npx eslint 4 个触及文件：exit 0，零 error
- npx vite build：exit 0（3.21s）

## 维持裁定
编造嫌疑未清零禁导出维持「只报告不拦截」（R89）；lint-debt-01 残余不重构；
QualCertsPage 日期戳站点继续挂 r112-datestamp-qualcerts-defer 待在途收口。
禁止 commit。
