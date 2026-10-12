# R262 报告 — 标书检查中枢界面改造：/bid-check 三栏阅读视图 + 定位解析层 + 规则清单页

日期：2026-10-10 ｜ 轮次：R262 ｜ 模块：标书检查/BidCheck ｜ 依据：交付Qoder-标书检查中枢界面改造.md（v2）

## 背景与目标
R261 一期结果区是单页清单，看不到「问题出在正文哪里」。交付文档要求把 /bid-check 改造成**三栏阅读界面**
（左章节导航 / 中 A4 只读正文 + 问题位置标记 / 右问题清单），并先修四个提取缺陷 T-1~T-4、补 CheckHit 定位锚点。
三条已定决策照办：D-1 中栏只显示文字不渲染图片（[图片] 占位）；D-2 已检出问题必须显示位置标记（核心能力）；D-3 不做目录气泡（左栏树 + 滚动联动补偿）。
红线遵守：不改检查规则判定逻辑、只标不改（UI 不放真「一键修复」，无 fixable=auto 项）、不加 AI、不重写 docxInspect。

## 一、改动文件清单（目标项目 src/pages/BidCheck/，均经 scripts/r262_deploy.py 复制部署）
**阶段0 提取层**
- `engine/docxInspect.ts`：Paragraph 加 index/inTable/tableIndex/hasImage（T-1/T-2/T-4）；collectTableRanges 栈式扫描 `<w:tbl>` 顶层区间（嵌套表格归最外层）；hasImage 判 w:drawing|w:pict|w:imagedata|w:object；parasToChapters 改返回 {chapters, chapterOf}（T-3）；新增 paragraphsFromChapters（project/PDF 路径合成段落）；buildDocContextFromParts / inspectPdfFile 产出 paragraphs+chapterOf。
**阶段1 类型与定位层**
- `bidCheckTypes.ts`：Paragraph 类型；CheckHit 加 7 定位字段（paragraphIndex/paragraphText/chapterIndex/chapterTitle/sectionHint/partName/lineNo）；DocContext 与 BidCheckResult 加 chapters/paragraphs/chapterOf。
- `runCheck.ts`：新增 resolvePositions **派生定位后处理层**（不改规则判定）——归一化去空白、剥两端省略号、整段→前缀→后缀三候选、章 hint 优先 + 全局兜底双向包含匹配；paragraphText 复制实际段落全文（#17 断言 by-construction 成立）；chapterIndex 一律 chapterOf[paragraphIndex] 换算（**绝不用 chapters[i].content indexOf 反查**，T-3 禁令）；nearestSection 反查小节标题；assertPositions 开发态自校验（import.meta.env.DEV 守卫，生产零开销）；返回值补 chapters/paragraphs/chapterOf。
**阶段2 UI**
- `ReadingView.tsx`（新建 ~635 行）：三栏布局（左 w-64 章节树 / 中 flex-1 A4 版心 max-w-[794px] / 右 w-80 问题清单）；6 联动全做（点问题→中栏滚动+1秒闪烁、滚动→左树高亮、hover 互亮、树↔正文、汇总条筛选、只看有问题）；段落标记（红/琥珀/黄/浅蓝底 + 左 3px 竖条 + 角标必改/建议/提示，多命中合并角标 ×N 不叠底色）；表格块折叠「▤ 表格（含N段）」；[图片] 占位；只看有问题 run 级折叠灰条「连续 N 段无问题」可展开；↑↓/Enter 键盘导航；右栏完整章节路径 + 段落全文 + 定位/标记已改（本机认知态）+「手动调整（本工具不改正文）」。
- `RulesListPanel.tsx`（新建 163 行）：规则清单 Tab——L1 禁则 14 条逐条开关（复用 checkCfg.formatKeys）+ 每条层/严重度/说明含命中示例（图片/表格类标「需人工抽检」）+ identity_leak disabled 标「由 L5 处理」；L5 21 条目录随 sealedLevels["L5"] 总开关；L2/L3/L4 规划说明。复用既有 checkConfig/anbidCheckConfig 机制，不动配置层。
- `BidCheckPage.tsx`（重写 269 行）：结果态渲染 ReadingView；新增「检查结果(徽标 N)/规则清单」Tab；容器放宽 max-w-[1400px]；头部/模式/输入/配置弹窗/导出门禁原样保留。
- `rules/format.ts`：export KEY_SEVERITY（规则清单页单一真源）。
**测试（co-located）**
- `engine/docxInspect.test.ts` +5 用例（T-1/T-2/T-3/T-4/buildDocContextFromParts 产出）；`runCheck.test.ts` 新建 4 用例（resolvePositions 回归：前导省略号/跨段前后缀候选/元数据不参与/不匹配安全跳过）；toExcel/format/anbid .test.ts 工厂补新必填字段。

## 二、T-1~T-4 验证方式
- **T-1 表格**：单测喂手写 OOXML（w:tbl 含两段）断言 inTable=true 且 tableIndex=0、嵌套表归顶层；UI 中栏表格块折叠「▤ 表格（含N段）」展开为纯文字列表。
- **T-2 图片**：单测 `<w:drawing>` 段断言 hasImage=true；UI 渲染 [图片] 占位徽标；图片类规则（彩色图片/EXIF）在规则清单页与结果说明中显式标「依赖渲染层，需人工抽检」，不假判。
- **T-3 chapterOf**：单测断言 chapterOf[正文段下标]===章下标；定位解析全程 chapterOf[paragraphIndex] 换算（resolvePositions 注释固化禁令）；实机 8/8 命中 chapterTitle 与中栏所在章一致。
- **T-4 index**：单测断言 Paragraph.index 与数组下标逐一对齐。

## 三、定位准确性核对（实机随机 3 条，右栏条目 ↔ 中栏段落逐字一致）
1. L1-T1「…互通交互服务套件配置、数据ETL与主数据管理…」→ 商务条件响应表 / 第 4 段，paragraphText 与该段原文逐字相等 ✓
2. L1-T2「…充分理解本招标文件中带 ★/▲ 标注的实质…」→ 实质性条款响应承诺函 / 第 529 段 ✓
3. L1-T2「…质性条款（逐字引用）：「★（二）接口对接…」→ 实质性条款响应承诺函 / 第 530 段 ✓
#17 硬性验收：开发态 assertPositions 全程 **0 条「[bid-check] 定位错位」告警**（console warn/error 均空）；#18 无 pageerror；#16 四个既有导出（Excel/HTML/配置/检查）不受影响（导出按钮与门禁弹窗原样保留）。

## 四、截图三张
- 规则清单页：`MedPreSales/.qoder/r262_rules_page.png`（L1 14 条 7/14 启用 + L5 21 条目录 + L2/3/4 说明）
- 三栏结果页：`MedPreSales/.qoder/r262_three_col.png`（左树徽标 + 中栏琥珀底「建议 L1-T1」标记段 + 右清单定位按钮，点「定位」后中栏滚动到标记段）
- 只看有问题生效：`MedPreSales/.qoder/r262_only_issues.png`（非问题段折叠为「连续 30 段无问题（点击展开）」灰条，问题段保留标记）
（副本已归档至目标项目 tests/records/ 下 r262_*.png）

## 实机验证环境修复（本轮发现并修复的缺陷）
选真实项目「建阳区总医院设备及信息化建设（集成平台+接口对接）」跑检：2 项建议整改 / 8 处命中。
首轮 **6/8 命中无正文定位**——根因：formatCheckReport 的 clip() 窗口摘录带**前导省略号**且 80 字窗口可能跨段落拼接，resolvePositions 只剥尾部省略号导致匹配失败。
修复：两端剥 `…/.`、整段失败退化为前 32/后 32 字候选（章 hint 优先），并加 runCheck.test.ts 4 条回归。重跑 **8/8 全部定位**、console 0 告警。
另做**规则开关实机负控**（#13）：规则清单页关闭「措辞检查」→ 重跑 Tab 徽标 2→1（L1-T1 不再报）→ 重新启用复跑恢复 2，配置已还原——改配置即调规则、无需改代码。

## 四门验证（修复后全绿）
- `npx tsc -b` exit 0；`npx vitest run src/pages/BidCheck` **5 files / 32 passed**（R261 基线 4/28 + runCheck.test 4 用例零回归）；`npx eslint src/pages/BidCheck` exit 0；`npx vite build` exit 0（3.42s，chunk 警告为既有）。

## 边界与不做项（照交付文档）
不改任何规则判定逻辑（定位是纯派生后处理）；只标不改——「标记已改」仅本机认知态（Set，不写库不回写）；无 fixable=auto 项故「一键修复」按钮天然不渲染；不渲染图片/表格内容；不做目录气泡。
