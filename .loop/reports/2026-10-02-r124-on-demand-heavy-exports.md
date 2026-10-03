# R124 重型导出库按需加载（docx/xlsx/pptxgenjs 移出静态首载图）

日期：2026-10-02 ｜ 轮次：R124 ｜ 类型：性能（实质性优化，非零风险小改）｜ 提示词：未动 ｜ 数据模型：未动（零 collection/零 pb_hooks）

## 1. 选题与定位

用户建议优先项 quote-history-01 二期（r102 已交付成交参考区间推荐）、prompt-fabscan-03 按章聚合回注（r103 已交付）均已 closed，按流程转巡检新角度。性能巡检（静态 import 图 BFS + vite build chunk 定位双探针）发现真实问题：

- **docx（数百 kB）经 `main.tsx → WorkbenchShell → FloatingAssistant → ChatStream → docx` 静态链漏进 832 kB 入口 chunk**——浮动助手挂在每个页面，全站每一页首访都为 Word 导出买单；
- PptQuote 路由**进页即加载** pptxgenjs（内联 456 kB 路由 chunk）+ jszip(96 kB) + xlsx(425 kB) + docx，尽管导出是低频点击动作；
- IntelCenter / SolutionStudio 路由静态可达 xlsx 共享 chunk（425 kB）。

## 2. 改动（7 文件，全部只在调用侧动刀）

手法：删除模块级静态 import，在导出/导入点击处改 `await import(...)` 按需加载；不触碰导出模块内部（ChatStream 的 docx 使用区命中用户未提交在途 hunk，已绕开，详见 §5）。

| 文件 | 改动 |
|---|---|
| src/components/shell/FloatingAssistant.tsx | ChatStream 改 `React.lazy` + `Suspense`（fallback「对话窗加载中…」），切断入口→docx 静态链 |
| src/pages/PptQuote/usePptQuote.ts | exportDeckPptx/exportSpeechDocx/writeQuoteXlsx→exportQuoteXlsx/writeQuoteDocx→exportQuoteDocx 4 个调用点改动态 import（均在既有 try/catch async 内，失败兜底不变） |
| src/pages/IntelCenter/useIntelCenter.ts | exportIntelItemsXlsx 动态 import；exportItems 回调同步→async |
| src/pages/SolutionStudio/checklistLogic.ts | exportTechParamsXlsx 动态 import；回调同步→async |
| src/components/solution-studio/checklist/ChecklistDetailPanel.tsx | exportChecklistXlsx onClick 改 `void import(...).then(...)` |
| src/components/solution-studio/checklist/NewChecklistWizard.tsx | parseCustomerLinesFile 动态 import（函数已 async） |
| src/components/solution-studio/checklist/ProductLibraryPanel.tsx | downloadProductTemplate/exportProducts/parseProductFile 3 处按需化 |

新增 **src/lib/onDemandHeavyLibs.test.ts**（防回潮哨兵，4 用例）：对静态 import 图做 BFS（不含动态 import / import type），钉住「入口 main.tsx 与 PptQuote/IntelCenter/SolutionStudio 路由壳静态不可达对应重库」。

## 3. 效果实证（vite build chunk 前后对比）

| chunk | R124 前 | R124 后 | Δ |
|---|---|---|---|
| index-*（入口，**每页**加载） | **832.04 kB** / gzip 250.70 | **318.16 kB** / gzip 104.94 | **-513.88 kB（gzip -145.76，-58%）** |
| PptQuote-*（路由） | 456.09 kB | 167.52 kB | -288.57 kB |
| SolutionStudio-*（路由） | 167.68 kB | 165.55 kB | -2.13 kB（xlsx 剥离） |
| IntelCenter-*（路由） | 99.28 kB | 99.24 kB | ≈0（xlsx 原为共享 chunk，现改为点击才加载） |
| docx 运行时 | 内联进入口 index | 独立 dist-sh30NXh6.js 368 kB，仅导出/对话窗按需 | 每页 -368 kB |
| pptxgenjs | 内联 PptQuote chunk | 独立 deckExports-*.js 278 kB + jszip 96 kB 按需 | 进页 -288 kB |

chunk marker 探针复核：改后 index chunk 不再含 docx-xml/docx-pack 标记（改前 6/9）；xlsx/pptx-core 标记只出现在按需 chunk。

## 4. 四门验证

1. `npx tsc -b` — exit 0，零错误 ✅
2. `npx vitest run` — **781 passed / 2 skipped**（R123 基线 777+2，**增量 +4** 全绿=哨兵测试）✅
3. `npx eslint`（7 个触及文件）— **净新增 0**：用字节级可逆法实测基线对照（反向回放全部补丁→跑 eslint→正向回放→sha256 校验与改后状态逐字节一致）：改前 31 errors/3 warnings，改后 31 errors/3 warnings，DELTA=0。既有 error 全部为 react-hooks 编译器规则（set-state-in-effect/preserve-manual-memoization/immutability/refs），落点行均非本轮改动行，与 R102 记载口径一致；本轮新文件 onDemandHeavyLibs.test.ts 与 FloatingAssistant/三面板 0 问题 ✅
4. `npx vite build` — exit 0 成功（见 §3 效果数据）✅

## 5. 在途代码保护

- 改前逐文件 git status/diff -U0 核对：**FloatingAssistant.tsx、checklistExports.ts 为 CLEAN**；useIntelCenter/usePptQuote/checklistLogic/三面板的 M hunks 均为既往已记账轮（R106/107/113/116/117 等口径收敛）改动，非用户未提交新功能，锚点区逐一确认不重叠。
- ChatStream.tsx 的 docx 使用区（downloadWeeklyDocx 附近）命中未记账在途 hunk → **只改其调用方 FloatingAssistant（CLEAN），不改 ChatStream 内部**，经 lazy 化整块移出静态图，效果等价。

## 6. 遗留挂账

- **r124-solutionstudio-docx-defer**（P3 open）：SolutionStudio 路由仍有 docx 静态可达链（useSolutionStudio/bidFiles 内部静态 import docx，且该区含在途改动风险高）。哨兵测试本轮只钉 xlsx 成果；docx 待在途落地后另轮拆分。
- 维持裁定不推翻：编造嫌疑未清零禁导出硬门禁=只报告不拦截；lint-debt-01 残余不重构。

## 7. 决策记录

无提示词改动（免 B 类流程）；无 PocketBase collection/pb_hooks/数据模型改动（零迁移）；未 commit。
