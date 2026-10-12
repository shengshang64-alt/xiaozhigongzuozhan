# R261 报告 — 标书检查中枢（BidCheck）· 一期：独立页面 /bid-check + L5 暗标引擎 + L1 格式 + 三件套

日期：2026-10-11 ｜ 轮次：R261 ｜ 模块：标书检查/BidCheck（新独立页面 /bid-check）｜ 优先级：P0

## 背景与目标
售前要「一个入口聚合现有检查能力（格式/响应/内容/查重）+ 新增暗标合规层」，同时覆盖**普通标书**与**暗标**两种交付。
经四项决策锁定：① 落点=与 7 步流水线平级的**独立页面 /bid-check**（不插第 8 步）；② 产出=**清单 + Excel + HTML 三件套**（v1 不生成标注版 docx）；
③ **纯规则零 AI**（L3/L5-D 语义 AI 留后续期）；④ 暗标格式项/页数上限做成**可配置占位**，未配置标「⚠️ 标准未配置」不瞎判。
红线：**只标不改**（产出覆盖层不改正文、不写库、不回写原文件）；**暗标是严格模式非独立模块**（同一引擎加严阈值 + 追加暗标项，一个开关切换）。

## 一期落地范围（分期见文末）
- **页面/路由**：新建 `src/pages/BidCheck/`（与 BidWorkspace 同级），薄壳 `index.tsx` + `BidCheckPage.tsx` + `useBidCheck.ts`；
  接线 8 处：App.tsx（lazy + Route）、routePreload（LOADERS）、SidebarNav（决胜分组 + ClipboardCheck 图标）、
  WorkbenchShell/TopBarShell/assistantCore（标题映射）、useGlobalSearch（搜索项 关键词 检查/暗标/合规/废标/体检/check）、GlobalCommandPalette（命令面板图标）。
- **输入两态（均只读）**：① 上传 `.docx/.pdf` → `engine/docxInspect.ts` 用 **fflate** 解包 OOXML 扫节点痕迹、**pdfjs-dist** 抽正文 + getMetadata；
  ② 选择标书项目 → 复用其正文（sections/成稿）+ `format_settings.sealed` + `identity_words`（无文件包时节点痕迹项诚实标「无法检测」）。
- **五级引擎 `rules/`（零 AI，单一规则表同时喂检测与展示，每条命中含五要素：级别/位置/问题原文/依据/建议改法）**：
  - **L1 格式 `format.ts`**：复用 BidWorkspace `formatCheckReport`（数字口径一致性/报价超限价/金额大小写/装饰残留/水印词等，剔除 identity_leak 交 L5）
    + 本地结构判定（字体/字号/行距一致性、编号断裂、页码、空白页）；L1-10~12（页数上限/边距/字体达标）读配置，**未配置标「⚠️ 标准未配置」**。
  - **L5 暗标 `anbid.ts`（本期核心）**：A 类主体身份泄露（公司名/品牌/人名/手机/座机/邮箱/传真/微信QQ/信用代码/资质编号/案例名/独特标识/第一人称，正则命中即证据，词库来自配置）；
    B 类元数据与痕迹（core.xml creator/lastModifiedBy/title/subject/keywords、app.xml Company/Manager、comments.xml 批注作者、w:vanish 隐藏文字、w:ins/del 修订残留、书签名、页眉页脚全文、settings 保护/水印、customXml、文件名、PDF 元数据，fflate 解包按节点路径扫）；
    C 类格式合规 / E 类文件形态（读暗标配置，未配置标「⚠️ 标准未配置」）；F 类语义第一人称（v1 仅确定性正则）。
  - **L2 响应 / L3 内容 / L4 查重**：一期**预留**（复用点已在设计中标注），分期推进。
- **普通 vs 暗标严格（一个开关）**：普通跑 L1；严格 L1~L5 全开、L1 未达配置升 🔴、出现必改 🔴 → **导出门禁**：
  `blocked = sealed && hasBlockingCritical`；`hardFatal = blocked && sealedViolationIsFatal`（配置声明「暗标违规即废标」则硬阻断导出）；否则**二次确认可继续**（沿用 R-009/Q-016 口径，不硬阻断）。
- **配置化 `config/`（仿 mustWriteConfig + localStorage）**：`checkConfig`（开关/阈值/严重度）+ `anbidCheckConfig`（暗标身份词库 + 格式标准 + 页数上限 + 是否单独成册 + sealedViolationIsFatal）；
  **留空即标「标准未配置」不瞎判**；售前改配置即调规则，待用户提供 `招标文件正文.pdf` 暗标条款 + `标书检查.xlsm` 检查项映射进配置即可生效，**当前不编造**。
- **产出三件套 `report/`（只标不改）**：侧边栏清单（分级 🔴🟡 + 按级别/层级筛选 + 逐条五要素）；
  Excel 整改清单 `toExcel.ts`（xlsx，列=序号/级别/层级/检查项编号/检查项/位置/问题原文/**依据**/建议改法/置信度(零AI填「—」)/责任人(留空)/状态）；
  HTML 体检报告 `toHtml.ts`（五级通过率 + 风险分布）。下载统一走 `triggerBlobDownload` + `buildSafeFileName`。

## 四门验证（全绿）
- `npx tsc -b` exit 0。
- `npx vitest run`：**167 files / 1895 passed / 2 skipped**（基线 R260 163/1872，+4 文件 docxInspect/anbid/format/toExcel .test.ts +23 用例，零回归）。
- `npx eslint`：新 BidCheck 目录（含 .test）**0 problem**；8 个 patch 文件 git diff 仅含预期锚点增行，其既有 problem（useGlobalSearch setState-in-effect/react-refresh/exhaustive-deps 等）均为**基线存量、零新增**。
- `npx vite build` exit 0（3.38s），产出独立懒加载 chunk `BidCheck-*.js`（路由接线生效）。

## 实机端到端验证（localhost:8000/bid-check，浏览器带登录态）
- 页面正常渲染：标题「标书检查中枢」+「纯规则·零 AI·只标不改」副标、模式分段按钮、配置按钮、上传/选项目双入口、开始检查（未选对象时 disabled）。
- 配置弹窗完整：暗标身份词库 4 textarea + 格式标准（字体/字号/行距/页数/四边距/页码/颜色/成册）+ 禁则（sealedViolationIsFatal checkbox + L1 本地禁则 14 开关）；Escape 正常关闭、未保存。
- **真实跑检**（暗标严格模式 + 选「贵港项目」正文）：汇总 34 检查项 / 3 必改 / 3 建议 / 13 未配置·无法检测；风险分布 🔴2 🟠1 🟡3 🔵0。
  真实命中含 **L5-A8 案例/项目名泄露 🔴**（「贵港市人民医院…合作项目」）、**L5-F1 第一人称「我公司…」🔴**、L5-F3 荣誉自述 🟠、L5-A1G 疑似公司名 🟡、L1-T1/T6 措辞/水印词 🟡——五要素齐全。
  B 类（批注作者/隐藏文字/修订/页眉页脚）因输入为「项目正文无文件包」**按设计降级为「无法检测」**、C/E 未配置项标「标准未配置」，数字自洽。
  导出「整改清单 Excel」触发**二次确认弹窗**（检出 3 项必改含废标级 🔴），点「返回整改」取消、未下载。控制台**零 error/warn**。

## 过程中修复
1. `anbid.ts` 重复 `items.push(`（会导致 undefined 入数组 + tsc 报错）——删多余行。
2. `format.ts` Chapter 类型改从 `@/pages/SolutionStudio/solutionTypes` import（bidTypes 只 import 不 re-export）。
3. `BidCheckConfigDialog.tsx` `React.ReactNode` → `import type { ReactNode }`（模块内 React 未导入）。
4. `format.ts` L1-4 无编号标题时 status `"info"`（ItemStatus 无此值）→ `"skipped"`。
5. `docxInspect.ts` PDF getMetadata 断言 → `as unknown as { info?: ... }`（Object 与 Record 不重叠）。
6. `anbid.test.ts` L5-E1 期望对齐实现（severity high → 命中即 fail，暗标文件名泄露从严）。
7. `useBidCheck.ts` 删除从未赋值的 dead `objectUrlRef`（+ useRef import）；首拉改微任务 `Promise.resolve().then(loadProjects)` 规避 set-state-in-effect（同 useAiHot）。
8. `BidCheckConfigDialog.tsx` 弹窗打开重置草稿的同步 setState 块用 `/* eslint-disable react-hooks/set-state-in-effect */` 局部豁免（同 useActiveWork 登出清空口径，附理由注释）。

## 补丁
`scripts/r261_deploy.py`：从工作区内 `scripts/r261_stage/` 复制 17 个 .ts/.tsx 到 `src/pages/BidCheck`（shutil.copyfile 字节复制保 utf-8、保留 config/engine/rules/report 子目录）
+ 8 文件锚点 `str.replace`（count==1 断言 + 改前 .bak-r261）；**幂等**：接线补丁以文件是否已含 `"/bid-check"` 为 guard，重复运行不重复插入。未 commit（迭代期 Git 提交禁令）。

## 分期（一期已闭合，后续待续）
一期（本次 R261）：页面/路由 + L5-A/B/C/E/F 暗标引擎 + L1 格式复用 + 三件套 + 配置占位 + 测试门禁 ✓。
二期：L2 响应（complianceMatrix/complianceCoverage/scoreCoverageCheckup/voidCheck 复用）整合展示；三期：L4 查重（内部自重复/跨章节/历史标书，串标 L4-4 多文件对比默认关）；
四期：L3 内容 + L5-D 语义 AI 类（标置信度）；五期：标注版 docx（Word 批注引擎）+ PB 集合 `anbid_checks` + 分工流转。
待用户提供 `招标文件正文.pdf` 暗标条款 + `标书检查.xlsm` 检查项 → 映射进 `anbidCheckConfig` 即生效（不编造）。
