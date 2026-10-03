# R147 — 全路由重导出库按需化收官（解除 r124-solutionstudio-docx-defer 挂账）

日期：2026-10-03 ｜ 优先级：P2（性能实质项，方案编制主链路）｜ 选题依据：用户授权自主推进，
两既定点名项（quote-history-01/prompt-fabscan-03）已收口，按"方案>标书>PPT"权重巡检账本挂账，
R124 遗留的 SolutionStudio docx 残余链是明账，且挂账 plan 自注"届时同轮可顺带核查 bidFiles 链"。

## 背景与问题
R124 已完成入口 main.tsx 与 PptQuote/IntelCenter 的 xlsx 按需化，并把成果钉进
src/lib/onDemandHeavyLibs.test.ts 哨兵（BFS 静态 import 图）。但 SolutionStudio 路由 chunk
仍静态打包 docx（约 500 kB 级），来源三条腿：
1. useSolutionStudio.ts 顶层直接 `import {...} from "docx"`；
2. useSolutionStudio.ts 顶层静态 `@/pages/BidWorkspace/bidFiles`（连带 docx + pdf worker + mermaid）；
3. exportTemplate.ts 顶层静态 docx（封面/目录构建）。
同轮巡检发现同类残余：BidWorkspace 路由经 SubmissionCheckPanel/DefensePanel/useBidWorkspace
静态拉 bidFiles/defenseHandbook；Knowledge 路由经 kbUpload 静态拉 bidFiles。
即访问这些页面时首载就多载数百 kB 导出库——即使从不点导出。

## 方案（沿用 R124/ChatStream 既有按需化模式，零新框架）
- useSolutionStudio.ts：docx 顶层 import 转 `import type`（编译期擦除）；exportWord 点击链内
  `await import("docx")` + `await import("@/pages/BidWorkspace/bidFiles")`。
- exportTemplate.ts：buildExportFrontMatter 转 async，docx 函数内动态导入；封面/目录结构口径不变。
- SubmissionCheckPanel.tsx：文本审计"导出报告"按钮点击时动态 import bidFiles。
- DefensePanel.tsx：答辩手册导出点击时动态 import defenseHandbook。
- useBidWorkspace.ts：删顶层 bidFiles import，文件末尾加同名薄封装（函数声明提升，
  extractTenderFileText 4 个调用点零改动，行为等价）。
- kbUpload.ts：docx/pdf 解析分支内动态 import bidFiles。
- 哨兵测试升级：SolutionStudio 壳由"只钉 xlsx"升级为钉 docx/xlsx/pptxgenjs 全量；
  新增 BidWorkspace 壳（ALL_HEAVY）与 Knowledge 壳（docx）两个防回潮用例。

## 附带（裁定合规小修）
- useCompetitorAnalysis.ts 采纳确认文案删除内部字段名「（evidence_refs 为空）」，
  符合既有裁定"用户可见文案禁止暴露内部字段名"。window.confirm → ConfirmDialog 的
  交互统一为组件形态改造（hook 无法直接挂弹窗），开新挂账 r147-native-confirm-dialog-01。

## 在途保护
- 触及文件 git status 均为 M/??（助手前序轮产物）；useSolutionStudio 在途 hunk 集中于
  R139/R140 批量生成区（1380-1512）与 import 区 40-41 行，与本轮锚点（4/21-26/1553-1557）
  不重叠；SubmissionCheckPanel/DefensePanel 锚点行本身即助手 R89/R137 轮产物。
- 全部锚点 assert count==1 命中；补丁脚本幂等可重跑（scripts/r147_docx_ondemand.py）。

## 验证（四门 + 产物 + 实机）
- npx tsc -b：0 错误。
- npx vitest run：974 passed | 2 skipped（基线 966 → +8：哨兵新增 2 例 + exportTemplate 伴生
  单测 6 例，覆盖 async 化后封面/目录/日期结构口径等价与 localStorage 降级）。
- npx eslint 触及 9 文件：0 新增 error（既有 17 个 react-hooks 类 error 行号全部位于本轮
  未触及区域；exportTemplate/kbUpload/DefensePanel 等 7 文件 0err0warn）。
- npx vite build：3.37s 成功。产物甄别：SolutionStudio chunk 154 kB，docx 库核心符号
  （TABLE_OF_CONTENTS/Packer/w:document）0 命中，仅余 ".docx" 文件名字符串——按需化生效实证。
- 实机 browser-use :8000：/solution-studio、/bid-workspace、/knowledge 三页加载正常，
  console 0 error 0 warn。

## 边界与维持裁定
- 零 schema / 零 pb_hooks / 零会话外 state；未动提示词（非 B 类）；未 commit。
- 编造嫌疑只报不拦（R89）、lint-debt-01 残余不重构 维持不动。
- 其余 5 个 defer-on-WIP 挂账（QualCerts/ComposeStep/死导出/a11y/FolderTree）继续在途区绕开。
