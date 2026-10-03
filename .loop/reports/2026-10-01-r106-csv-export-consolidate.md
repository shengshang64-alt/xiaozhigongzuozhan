# R106 · CSV 导出口径收敛 + 死代码清理（会话内零 collection / 零提示词）

## 选题背景
本轮 prime 候选 quote-history-01（R102 已 closed）、prompt-fabscan-03（R103 已 closed）均已收口；
剩余 open 项（lint-debt-01 有意保留、ui-redesign-phase3 自然迭代、quote-history-3-mining 独立立项）
均为维持裁定或非本轮范围。按授权改为「巡检新角度」——循 R104（死代码/断链）、R105（漂移重复逻辑收敛）
的同一治理主题，脚本扫描 CSV 导出与占位入口，坐实三类真实问题。

## 坐实的问题
1. **重复且漂移的 CSV 拼装逻辑**：全站 CSV 口径本已收敛进 `src/lib/exportCsv.ts` 的
   `exportToCsv`（转义 + BOM + CRLF），但竞品矩阵导出 `buildOrderCompareCsv`（marketIntel.ts）
   另抄一份手写 `join(",")`——且**不做任何单元格转义**。厂商名是可编辑的用户数据，一旦含
   ASCII 逗号（如「智业,软件」）即窜列，表头/数据列错位。
2. **换行口径漂移**：同为矩阵导出，`buildOrderCompareCsv` 用 `\r\n`、`buildCompareCsv` 用 `\n`，
   两份手写实现各行其是（老版 Excel 按 `\r\n` 解析，`\n` 有兼容隐患）。
3. **死代码**：`competitorScores.buildCompareCsv` 全项目**零引用**（连测试都不调用），是历史遗留的
   孤儿函数；`useHome.ts` 的「占位入口」块（`assistantOpen`/`searchValue`/`setSearchValue`/
   `toggleAssistant`/`handleSearchSubmit`「全局搜索建设中，敬请期待」/`handleModuleClick`）
   早已被真正落地的 Cmd+K 全局命令面板（`useGlobalSearch` + `GlobalCommandPalette`，顶栏可见按钮 +
   跨 8 类实体聚合检索）取代，`HomePage` 一个都不消费——`handleSearchSubmit` 里那句「建设中」
   是误导性的僵尸文案（真实搜索早已可用）。

## 方案（复用优先、不自研引擎）
- 新建 `src/lib/csv.ts`：全站唯一 CSV 拼装纯函数 `buildCsv(headers, rows)`——RFC4180 单元格转义
  （含逗号/引号/换行 → 双引号包裹 + 内部引号翻倍）+ UTF-8 BOM + CRLF。纯函数、无副作用、
  不依赖 DOM/toast，供下载包装与自定义导出（矩阵转置）共用同一口径。
- `exportCsv.ts` 改为调用 `buildCsv`，`exportToCsv` 对外签名与产物**逐字不变**（7 个列表调用方零感知）。
- `buildOrderCompareCsv` 改用 `buildCsv`（自动补转义，厂商名含逗号/引号不再窜列）。
- 删除死函数 `buildCompareCsv`。
- 删除 `useHome` 占位入口 6 个僵尸符号 + `handleSearchSubmit` 的误导文案。
- 维持既有裁定：未动任何 AI 提示词（非 B 类，无 PROMPT_VERSION 变更）；零 collection / 零 pb_hooks；
  编造未清零硬门禁维持 R89「只报不拦」；lint-debt-01 残余不重构。

## 新旧口径对比（关键行为）
| 场景 | 旧（buildOrderCompareCsv 手写） | 新（共享 buildCsv） |
| --- | --- | --- |
| 厂商名含逗号「智业,软件」 | `...,智业,软件`（窜列，列数+1） | `...,"智业,软件"`（转义，列对齐） |
| 名称含引号 | 直接输出，破坏字段边界 | `""`翻倍转义 |
| 单元格含换行 | 破坏行结构 | 双引号包裹保护 |
| 普通名称「智业软件」 | `订单能力维度,智业软件` | 逐字一致（无回归） |
| BOM / 换行 | BOM + CRLF | BOM + CRLF（逐字一致） |
| exportToCsv 7 个列表 | BOM + CRLF + 转义 | 同（内部改为调用同一函数） |

## 门禁（目标项目目录）
- `npx tsc -b` → exit 0（零错误）
- `npx vitest run` → **664 passed / 2 skipped**（基线 659/2，净 +5：`csv.test.ts` 新增 4 用例覆盖
  逗号/引号/换行/null/undefined/BOM/CRLF/全角逗号不误伤；`marketIntel.test.ts` +1 用例锁「厂商名含逗号转义不窜列」回归）
- `npx eslint` 触及文件 → **净新增 0**：新/改文件（csv.ts / csv.test.ts / exportCsv.ts / marketIntel.ts /
  marketIntel.test.ts / competitorScores.ts）0 error；useHome.ts 命中 3 项均为**在途既有**
  `react-hooks/set-state-in-effect`（行 318/539/738，落在本轮未触碰的 qualAlertCount/loadIntelItems effect 内），
  本轮仅删除占位入口死代码，未新增任何 error。
- `npx vite build` → exit 0（3.24s）

## 影响面
- 用户可见价值：竞品「订单能力对比」CSV 在厂商名含逗号/引号时不再串列；首页不再有僵尸搜索入口。
- 代码健康：CSV 拼装口径单一来源，杜绝再次各抄一份漂移；清理 2 处死代码 + 1 处误导文案。

## 浏览器实机验证（R106 收口）
运行中站点 Vite :8000（200）+ PocketBase :7000（/api/health healthy）实测：
- `/`（作战驾驶舱）：删除 useHome 占位入口 6 僵尸符号后首页完整渲染（欢迎横幅/今日必看/待办/情报摘要/进行中项目全部在），
  顶栏「打开全局搜索（⌘K）」真实命令面板按钮仍在（坐实被删的僵尸搜索入口确属冗余）；console 0 error/warn。
- `/competitors` → 「能力对标」Tab：`CompetitorCompare` 正常渲染 4 家对标（智业软件/卫宁健康/东软集团/东华医为），
  点击「导出对比」触发本轮改写的 `buildOrderCompareCsv`→共享 `buildCsv` 端到端执行，下载弹出、
  toast「对比矩阵已导出」，全程 console 0 error/warn（真实无逗号厂商名走非转义分支，产物与旧口径逐字一致）。
- 逗号/引号转义分支由 `csv.test.ts`(4) + `marketIntel.test.ts`(+1) 单测锁定（浏览器实机名不含逗号，走正常路径）。
- 截图 `.qoder/tmp/r106_competitors_export.png`。
