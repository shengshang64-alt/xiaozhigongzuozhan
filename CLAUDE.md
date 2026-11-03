# 小智工作站 · 项目约定（供 AI 助手阅读）

## 项目是什么

医疗信息化售前工作台。前端 React + TypeScript + Vite（**本地 8000**，由 `vibex-local/vite.local.config.ts` 启动，见 `start-local.cmd`），后端 PocketBase（本地 7000，前端经 `/__pb` 代理访问）。
模块：方案工作室 / 标书工作台 / PPT 报价 / 知识库 / 情报竞品 / 大模型通道 / 助手。
**核心价值只有一条：产出可对外交付的标书 / 方案 / PPT。**

> 注意：`npm run dev`（裸 `vite`）用的是**根** `vite.config.ts`，**没有 `/__pb` 代理**，会表现为「界面能开但数据全空」；
> 且它与 `start-local.cmd` 都声明 `port 8000 + strictPort`，两者不能同时起。日常开发一律走 `start-local.cmd`。

## 门禁（任何改动后必须逐条实测，禁止凭想象结论）

| # | 命令 | 通过标准 |
|---|---|---|
| 1 | `npx tsc -b` | 0 error |
| 2 | `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build` | 构建成功 |
| 3 | `npx vitest run` | 全绿（基线 **339 files / 3884 passed / 2 skipped**，2026-10-26 当场实测。本轮新增 `exportFileName.test.ts` 6 例 + `exportFileNameRealDb.test.ts` 2 例 + `markdownTableConvert.test.ts` 8 例 + `bidDeptRulesHits.test.ts` +7 例 = +23 例，来自「导出文件名三要素 / 题注编号接线 / markdown 表格兜底转换」三项修复；同日开工时实测为 326 files / 3785 passed。更早历史见下方注释） |
| 4 | `npx eslint .` | error ≤ **116** 且 warning ≤ **11**（存量债预算，见 `eslint-budget.json`） |

> 第 3、4 条基线随轮次下降，**以 `eslint-budget.json` 与 `docs/evolution/_loop_state.json` 的 `gatesBaseline` 为准**（两者必须同源，
> `pnpm verify:eslint-budget` 会校验；不同源直接 exit 1）。改基线必须**同时**改这三处，否则会重演历史上「151 / 160 / 163 三个数字并存」的口径分裂。
>
> 第 3 条（vitest）的真源是账本 `baseline.r{最新轮次}`，每轮加/减用例后**必须同步本行**：R55 收尾时实测此处仍是 R52 期的
> 273 files / 3244 passed（R54 自己已记 3248，即本行落后 4 例、无人复算），已按 R55 实测值更正；R56 收尾时按当场实跑同步为
> 279 files / 3290 passed（+4 文件 / +26 例）；**R57 收尾时按当场实跑同步为 282 files / 3308 passed**（+3 文件 / +18 例：
> `hookSources.test.ts` 8 + `hookSourcesConvergence.test.ts` 5 + `useBidWorkspace.behavior.test.tsx` 5）；R58（B32 项目 CRUD
> 行为网）时按当场实跑同步为 **296 files / 3486 passed**（R58 自身 +1 文件 / +6 例：`useBidWorkspace.projectCrud.test.tsx`；
> 282→295 的增量来自并行 REQ 线：B28/B29 关键项门禁 + 解析退化自检 `parseDegradation.test.ts` 11 例 +
> `parseCoverage.test.ts` +3 例 + `useBidWorkspace.behavior.test.tsx` +2 例，及 REQ-009/010 情报/资质统计等非 loop 轮次）；R59（B32
> 行为网第二簇正文精修）时按当场实跑同步为 **297 files / 3491 passed**（+1 文件 / +5 例：`useBidWorkspace.chapterRefine.test.tsx`）。
> R58 的 296 / 3486 与 R62 的 300 / 3509 都只写进过轮报与账本、**本行当时没跟着改**（R63 对账时才发现）；R63 按分片实测同步为
> **301 files / 3513 passed / 7 skipped**（+1 文件：`bidVisibilityCorpus2.test.ts` 5 例；`bidVisibility.test.ts` +6 例分配器直测；
> 另有 5 例因「本机夹具 / 盘符路径缺失」转为 skip，见 `generate-format-materials.test.ts`、`generate-ppt-kb-materials.test.ts`、
> `pdfScanLayer.test.ts` 里的 skip 门）。
> **R63 的分片口径要照实理解**：本机（沙盒 2 核、单次调用约 175 秒上限）整包一次跑不完，是把 301 个文件按 jsdom/node 两组
> 分 15 片跑完、再用文件清单做集合校验「已跑 301 / 全部 301、未覆盖为空」得到的总数。宿主上单命令复跑如有 ±数例差异，以复跑为准。
> 数字与账本不一致时以**当场实跑**为准。
>
> **2026-10-21（用户需求：多份招标文件 + 文件角色路由，非 loop 轮次）**：当场分片实测同步为
> **303 files / 3543 passed / 6 skipped / 0 failed**（+2 文件 `tenderFiles.test.ts` 21 例 + `tenderFilesWiring.test.ts` 9 例；
> 6 个 skip 全部是本机夹具/盘符缺失的既有 skip 门：generate-format 1 + generate-ppt 1 + e2eRealParse 2 + pdfScanLayer 2）。
> 该次未新增账本 `baseline.rNNN` 条目（不是 loop 轮次），下一轮收尾时按当场实跑并入，避免出现两套口径。
>
> **2026-10-22（用户需求：标书解析 / 生成 / 检查三侧确认与优化，非 loop 轮次）**：当场分片实测同步为
> **305 files / 3567 passed / 6 skipped / 0 failed**（+1 文件 `outlineScoringAlignment.test.ts` 4 例；
> `parseSchemas.test.ts` +2 例：权重解析、声明总分保真；`slice1FormChecks.test.ts` +3 例：废标闸门与证据降级）。
> 分片口径同 R63：278 个 node 文件按 33~35 个一片（8 片）+ 27 个 jsdom 文件按 2 个一片（13 片 + 1 片 1 个），
> 再用文件清单做集合校验「已跑 305 / 全部 305」。jsdom 4 个文件同跑会超单次调用上限（实测 175 秒超时），
> 仍按 2 个一片最稳。
> **留痕**：本次 `vitest -u` 更新了 `promptsSnapshot.test.ts.snap`——除 `bidOutline` 的一一对应口径外，
> 还吸收了工作区里**既有的未提交**提示词改动（禁元话语/编号顺延等）。快照本就是源码镜像，属预期同步。
> 另：`pocketbase/pb_data/data.db` 副本实测 27 条有解析报告的项目里，**12 条缺 `void_items`/`qualification`/`compliance`、10 条三项全缺**
> ——这就是「废标三件套升必选」的依据；同批 8 条有总分构成句的项目，权重解析 8/8 成功。
>
> **2026-10-22 第二批（用户反馈：「大纲生成的内容，最基础的招标文件要求都没对齐」）**：实测定位到两条真问题并修复。
> ① **A4 目录检查常年全红**：原 `detectCatalogGaps` 只剥阿拉伯序号，对「一 开标一览表」这类中文序号无效——
> 真实库三个项目实测 **16/16 项全部判缺**，真问题被噪音淹没。现改为中文序号（一／（一））＋多级号（6.1）全剥，
> 并按 `scope` 分类：商务固定格式（开标一览表/投标函/报价表…）在仅技术模式下不算技术标缺章，阻断只算 `tech_required`。
> ② **采购需求子系统整块丢失**：招标第三章「定制软件开发清单」解析出 45 个子系统（安中医）／18 个（安庆），
> 而大纲标题命中 **0 个**。根因是 `req_structure` 只注入了单次路径 `bidOutline`，长标书默认走的**分步路径 `outlineLevel1` 从未注入**；
> 现已在分步路径补注入 + 硬规则（技术章的小节须逐子系统落点），并新增 `subsystemCoverage` 在生成后报「覆盖 X/Y」。
> 基线同步为 **305 files / 3572 passed / 6 skipped**（node 278 文件全量分片复跑；jsdom 27 文件里与本次改动相关的 6 个
> （5 个 `useBidWorkspace.*` + `GateChecklist`）复跑通过，其余 21 个未触碰、沿用同会话上一轮全量绿的结论）。
>
> **2026-10-22 第三批（用户裁定：不加目录章，改索引表）**：技术标按评分办法一级项成章、不为无分的目录项另起章；
> 「评委按目录翻不到」改用一张《投标文件目录对照表》解决——新增 `buildCatalogIndex`（与 A4 门禁同源），
> 在 `bidFiles` 的两条导出路径（默认 / 格式化）目录后各插一张表：招标目录项 → 本册对应章节 → 说明（商务分册/已覆盖/待补章节）。
> **实测**：用真实库项目（安中医 w8eqvkh08q6e1lr）跑 `exportBidDocx` 并解包 `word/document.xml`，
> 确认「投标文件目录对照表」「招标文件目录项」「商务分册」三处文本均出现（临时探针，跑完已删）。
> 基线同步为 **305 files / 3573 passed / 6 skipped**（+1 例：`composeGates.test.ts` 的索引表映射用例）。
>
> **2026-10-22 第四批（用户实测反馈：解析报告两条红字告警是误报）**：用真实项目 r2yrra7r62gh2xz（安中医，15.2 万字）复算定位到两处口径错误。
> ① **评分合计按分区比**：原实现拿每个分区的合计去比**全局总分**，于是「技术 90 ≠ 100」「商务 10 ≠ 90」两条假警；
> 现按 `weights` 分区比对（技术分区对「技术 N 分」，商务分区对「商务 N + 价格 N」），实测该报告 `mismatchWarnings` 由 2 条变 0 条。
> ② **废标条数下限要在本地扫描合并之后算**：原实现放在合并前，AI 单项只抽到 2 条就报警、紧接着本地补录到 792 行，
> 报告里留下「仅解析到 2 条」的自相矛盾提示；现已下移，实测该报告下限告警由有变无。
> 基线同步为 **305 files / 3574 passed / 6 skipped**（+1 例：`parseSchemas.test.ts` 分区口径用例）。
> 注：这两条告警是**上次解析时写进 parse_report.warnings 的历史文本**，重新解析该项/整份才会消失。
>
> **2026-10-22 第五批（用户反馈：采购清单要按表格体现）**：解析面板新增采购清单表格渲染。
> 根因不在提示词而在**呈现层**：`flattenPurchaseList` 落库的是「名称：X｜规格型号：Y｜数量：Z｜备注：W」行文本，
> 面板原来一行一张卡片，217 行的项目无法扫读。新增 `buildPurchaseListRows`（纯函数）把行文本还原成表：
> 列按招标原表「序号｜名称｜规格型号/关键参数｜数量｜单位｜备注」，序号自动补、`1套` 拆成数量+单位、全空列自动隐藏，
> 不足两行回落普通行渲染。真实项目 r2yrra7r62gh2xz 实测 217 行 → 217 行表格。
> 另留结论：该招标文件的功能清单在 PDF 抽取阶段列就错位了（「经营要素平台」竖排字符散进每一行），
> 「规格型号」这一列原文没有——这是抽取层问题（backlog B4 表格感知抽取），不是解析提示词能修的。
> 基线同步为 **305 files / 3577 passed / 6 skipped**（+3 例：`parseSchemas.test.ts` 采购清单表格用例）。
>
> **2026-10-22 第六批（用户需求：技术参数提取 + 按投标文件格式输出）**：编制环节本就有「技术参数响应表」面板
> （`techParamResponse.ts`：按标题定位参数章节 → 逐条原文响应 → ★/▲ 汇总 → 覆盖核对），但**只能看不能导**。
> 本轮补上导出：新增 `exportTechParamDocx`（五列：序号｜招标文件技术参数要求（原文）｜投标响应｜偏离情况｜证明材料/页码），
> 面板加「导出技术参数响应表 Word」按钮，与偏离表**同一来源口径**（同 `resolveTechParamSource` / `buildParamResponseRows`）。
> 同时修抽取噪声：页脚「第 N 页 共 M 页」、表头拼接行「序号 技术参数及要求」、重复页眉（同句 ≥3 次）不再建行。
> **实测**（真实项目 r2yrra7r62gh2xz）：定位到「第三章 采购需求 › 六、技术参数及要求」，条数 60→56→53，
> 首条由「政府采购项目公开招标文件示范文本（服务类）」变为真参数；导出 docx 解包确认表头与偏离列都在。
> **已知限制（如实记录）**：该章技术参数在 PDF 里是表格，抽取后行被拆碎（出现「拟，须体现上述内容。」这类断行残片），
> 「按原格式/排版还原表格」需要表格感知抽取（backlog B4），当前只能在文本层做到逐条原文 + 保持原序。
> 基线同步为 **305 files / 3579 passed / 6 skipped**（+2 例：`techParamResponse.test.ts` 噪声与重复页眉过滤）。
>
> **2026-10-22 第七批（B4 第一期：docx 表格还原）**：用户裁定先做 docx、PDF 排第二期。
> 新增 `src/lib/docxTableExtract.ts`（纯解析：unzip `word/document.xml` → `w:tbl/w:tr/w:tc`，
> 支持 `gridSpan` 横向合并展开、`vMerge` 续行留空、单元格多段落拼接、XML 实体解码；非 zip 字节返回空表）。
> 新增 `src/pages/BidWorkspace/tenderTables.ts`（落库层：同名文件整体替换、按 PB json 1MB 上限做体积闸
> `TENDER_TABLES_MAX_BYTES=600KB`、单表超限截到 200 行、按表头归类 采购清单/技术参数）。
> 接线：`handleTenderFiles` 对 `.docx` 在**本地**抽表（原文件仍不上传），落库到新列 `tender_tables`
> （pb_hooks bootstrap + 迁移快照 + create/update 白名单四处同步，`pbFieldContract` 与 `tenderFilesWiring` 守卫已覆盖）；
> 招标文件步骤显示「已还原 N 张表（清单 X · 参数 Y）」并可展开预览前 8 行。
> **实测**：`docx` 库现打包一份 3×4 表格 → `extractDocxTables` 原样读回（zip+XML 全链路，非手写夹具）。
> **注意**：新列 `tender_tables` 需**重启 PocketBase** 才生效；PDF 原件暂时还走文本抽取（第二期做坐标聚类）。
> 基线同步为 **307 files / 3594 passed / 6 skipped**（+2 文件 15 例：`docxTableExtract.test.ts` 7 + `tenderTables.test.ts` 8；
> 另 `tenderFilesWiring.test.ts` +1 例覆盖 B4 接线）。
>
> **2026-10-22 第八批（B4 第二期：原表回填）**：把还原出来的表真正接进业务，不再只是预览。
> ① 解析报告「采购清单」详情：有 docx 原表时**优先渲染原表**（原始列名与单元格，标注来源文件/第几张表），
> AI 摘要行退居其后（`ParseReportPanel` 新增 `restoredTables` 属性，`pickTableOfKind` 取行数最多的同类表）。
> ② 技术参数：`tableToParamItems`（表→逐条参数，保表内编号与行序）＋`paramRowsFromTable`（逐条走要求→响应改写），
> 面板与**导出**都优先用原表——导出的《技术参数响应表》因此与招标原表逐行对得上，而不是按文本行猜。
> **实测**（临时探针，跑完已删）：docx 库打包「清单表 3 行 + 参数表 3 行」→ 抽表 2 张、归类各 1；
> 清单表头原样（序号｜子系统名称｜数量｜单位｜备注）；参数条目保留表内编号；`exportTechParamDocx` 走原表路径
> （`tender_text` 故意留空，排除文本回退）后解包 docx 确认含原参数原文。
> 基线同步为 **307 files / 3601 passed / 6 skipped**（+6 例：`tenderTables.test.ts` +4、`techParamResponse.test.ts` +2）。
>
> **2026-10-22 第九批（B4 收口：采购清单按投标文件格式导出）**：补上 B4 链上最后一个缺口——
> 采购清单此前只能看不能导。新增 `exportPurchaseListDocx`：**有 docx 原表就按原表导出**（列与单元格一字不改，
> 只在末尾追加「投标响应＝完全响应」列），没有原表则用解析行还原的表（`purchaseListExportRows` 统一装配）；
> 解析报告「采购清单」详情右上角加「导出采购清单 Word」按钮（`ParseReportPanel.onExportPurchaseList` → hook `exportPurchaseListWord`）。
> **实测**（临时探针，跑完已删）：docx 库打包 3 行清单表 → 抽表 → `exportPurchaseListDocx` → 解包 docx，
> 原表头「子系统名称」、数据行「输血管理信息系统」、「完全响应」三处文本均出现。
> **未做（刻意）**：PDF 坐标聚类——它需要拿真实 PDF 的文字坐标反复调参，而仓里只有抽好的 `tender_text`、
> 没有原件字节，做出来无法验证，不能交付未验证的东西；等用户提供一份 PDF 原件再开工。
> 基线同步为 **307 files / 3603 passed / 6 skipped**（+2 例：`tenderTables.test.ts` 导出装配用例）。
>
> **2026-10-23（真实标书离线演练：解析 → 大纲）**：用户要求「直接操作一份标书去测试」。沙盒连不到宿主 8000/7000
> （网络隔离，curl 全 000），模型调用只能在用户机器上跑；因此把**模型之外的全部环节**拿真实项目跑了一遍，
> 并把演练固化为可复跑测试 `src/pages/BidWorkspace/bidRehearsalRealDb.test.ts`（库不存在自动 skip，只断言不变量、统计只打印，
> 与 `qualityAuditRealDb` 同范式；支持 `XZ_BID_PROJECT` / `XZ_BID_PROMPT_PROJECT` 指定项目）。
> **实测读数**：
> ① 最新项目 r2yrra7r62gh2xz（有解析、尚无大纲）：`buildOutlineLevel1Messages` 产物 15,366 字，
> 含【采购需求子系统清单】45 条（首条「动态路由管理」在内）、含【招标文件规定的投标文件目录】与【技术评分办法】
> ——证明分步路径的子系统注入真的生效（改动前该路径完全没有这块）。
> ② 旧大纲项目 d3c35o7axkw34wo（改动前生成）：顶层技术章 16 / 技术评分项 13、合并章 0、无章承接 1、
> **子系统覆盖 0/44**、技术标目录缺 2 条（「开一览表」OCR 少字 + 「其他相关证明材料」）——这就是改动前的基线读数。
> ③ 解析侧同一份报告：覆盖率 39%、分区合计 `{tech_score:90, biz_score:10}`、评分口径告警 0 条、废标下限告警无、废标条款 792 行
> ——第四批那两条误报确已清掉。
> **A/B 用法**：重生成大纲前后各跑一次 ② 那条用例，比「子系统覆盖 X/44」。
> 基线同步为 **308 files / 3606 passed / 6 skipped**（+1 文件 3 例：`bidRehearsalRealDb.test.ts`）。
>
> **2026-10-23 第十批（用户实测：「★8 系统集成、培训」这类主观内容识别不对）**：根因不是分类器，而是**条款边界**。
> `buildParamResponseRows` 原来**一个物理行一条**，于是 ★8 下面的（1）（2）①～⑤ 各自变成一条"参数"，一律标「完全响应」——
> 方案型内容被当参数打勾，评委按方案给分时等于零分。
> 修法两层：① `mergeClauseLines` —— ★/▲ 头一旦开始，其下（1）① 全归同一条，遇到下一个 ★/▲ 或章节边界才结束；
> 不在 ★ 段内时才按编号切（边界判据不依赖 ★ 是否幸存：PDF 常丢 ★，编号丢不掉）。
> ② `classifyParamClause` —— 判「能不能用一句完全响应过关」：服务/方案/承诺类措辞 ≥100 字、或 ★ 条款成段/分点 → 方案型；
> 功能清单里 200~300 字的「要求支持…」仍是参数型（长度不能单独作判据）。方案型的响应列改写「须成文作答：编制专项方案并附承诺函」，
> 导出表同步。
> **实测**（三明 lkxxznhgwnw0g0h，真实库）：★8 合并为 1073 字整条（含 ①、含承诺函、尾句到「医院不再另行支付任何培训相关费用」），
> ★9 合并为 613 字整条，均判为方案型；条款数由 98 条碎片降为 64 条完整条款（参数型 57 / 方案型 7）。
> 基线同步为 **308 files / 3610 passed / 6 skipped**（+4 例：`techParamResponse.test.ts` 合并与作答类型用例）。
>
> **2026-10-23 第十一批（用户要求：大纲建节 + 修章节越界 + 所有承诺函按原文响应）**：
> ① **技术参数章节越界**：`locateTenderSection`/`narrowToTechParamSubsection` 原先只在「同级或更高级标题」处停，
> 而 PDF 里第六章标题常没被识别成标题，于是「6、投标人的资格要求 / 6.1 法定条件」被当参数吃进来。
> 新增 `isTopicSwitch` 话题切换边界（短标题行含 资格要求/资格审查/符合性审查/评标办法/合同条款/投标人须知 即结束）。
> **实测**（三明 lkxxznhgwnw0g0h）：条款 64→36，越界命中 0，★8 仍在。
> ② **方案型条款补节**：新增 `ensureProposalClauseSections` + `proposalClauseTitle`（剥 ★/编号、表格行取最长中文段、
> 按空格与句读截断），生成大纲后确定性补节（零 AI）：优先挂到标题含「参数响应/技术参数/技术响应」的顶层章，
> 没有则新建「方案型实质性条款响应」章。**实测**：补出「系统集成、培训」「数据互通互联、数据质量提升」「服务器负载均衡」三节。
> ③ **承诺函覆盖所有承诺要求**：原有 `generateCommitmentLetter`（编制环节已有入口）只取 ★/▲ 条款；
> 现扩展为 ★/▲ 条款 + 技术参数里「方案型且含承诺要求」的条款（承诺函/书面承诺/作出承诺/承诺不/承诺提供/承诺其/出具承诺），
> 两类都**逐字引用原文** + 模板承诺语，用户人工再调整。
> 基线同步为 **308 files / 3614 passed / 6 skipped**（+4 例：`outlineScoringAlignment.test.ts` 补节 3 例、`commitmentLetter.test.ts` 采集 1 例）。
>
> **2026-10-23 第十二批（用户口径：演示相关内容不该出现在技术方案大纲里）**：
> 旧策略是「演示/答辩章留在目录里、只跳过正文生成」，用户否掉了这种形态——演示是现场环节，占着章号会让评委以为标书该有内容。
> 改为**直接从大纲剔除**：新增 `stripDemoNodes`（商务章不动），生成大纲后调用并提示「已剔除 N 个演示/答辩节点……请线下准备演示环境与脚本」。
> 三处口径同步：① 两条大纲提示词都加了「演示/答辩/讲标类评分项不设任何章节」；
> ② `outlineChapterScoringAlignment` 不再把演示项算作「无章承接」（否则剔完立刻报缺章）；
> ③ `ensureSubjectiveScoringChapters` 不再为演示项补章。
> **实测**：三明 lkxxznhgwnw0g0h 的评分项含「包01 演示1/2/3」，剔除后不进大纲；对齐判据对该项目不再报演示项缺章。
> 基线同步为 **308 files / 3617 passed / 6 skipped**（+3 例：`demoSection.test.ts` 2、`outlineScoringAlignment.test.ts` 1）。
>
> **2026-10-23 第十三批（对标易标 v2.30：先核对再移植）**：用户要求读 OpenBidKit_Yibiao（AGPL-3.0，v2.30.20）看还有什么可参考。
> 读源码后**撤回了三条建议**（不是缺，是已有/无证据）：① 编排层已有（`prompts/orchestration.ts` + 每节 `secOrchOpt` 的
> writing_focus/table/figure/facts/knowledge）；② 大纲 ID 稳定映射已有（`alignChaptersWithOutline` 先 `byId` 再标题兜底）；
> ③ 「评分项 vs 评分要求」二分在本库无证据——全库 **147 个评分项、名字含总则/评分要求/扣分/评审标准的 0 个**。
> 真正缺的只有一条，本轮做了：**大纲评审问题单分级**。原 `OutlineGateReview.issues` 是 `string[]`，
> 标题润色与「评分项 R3 未承接」混在一起全部自动修——等于替用户改了得分结构且事后无感。
> 现改为 `{category, text, action}`：`landing`（评分承接）/`part`（章归属）默认 `need_user`，不自动修、只汇总 toast 提示；
> 其余（单分支/层级/体量/判重/命名）`silent_fix` 仍走 `buildOutlineFixMessages`；旧字符串契约兼容（按 other→silent_fix）。
> 基线同步为 **308 files / 3620 passed / 6 skipped**（+3 例：`outlineGate.test.ts` 分级处置用例）。
> **2026-10-23 第十四批（P0-1 交卷清单）**：五视角评审（`docs/23-产品优化评审-五视角-20261023.md`）后落地的第一件——
> 真实库 32 项目漏斗显示：解析 97% → 正文 53% → 偏离表 16% → 废标 6% → 评标 3% → **投标结果 0%**，
> 用户走完前三步就停。新增 `submissionReadiness.ts`（纯本地零 AI，9 项跨步骤判定：解析关键项/大纲对齐/正文完整/
> 编制门禁 A1-A6/偏离表/废标核销/交卷体检/查重/评标，每项带 `step` 供「去处理」跳转）
> + `SubmissionReadinessPanel`（挂归档导出页顶部）。「建议」级（查重/评标）缺了不拦交卷。
> **顺手修一个真 bug**：`detectScoringLandingGaps`（A6）原来要求**所有**评分项都有技术章正文落点，
> 于是「价格分/商务分」这类商务评分项永远无落点——真实项目复算三明 2 项、海沧 31 项全红；
> 我上一轮把 A6 接进 check 闸后会把正常项目永久卡死。现排除 商务项/资信类/演示项，三明 **2→0**。
> 基线同步为 **309 files / 3625 passed / 6 skipped**（+1 文件 5 例：`submissionReadiness.test.ts` 4 + `composeGates.test.ts` 1）。
>
> **2026-10-23 第十五批（P0-2 证据台账）**：售前与评审专家两个视角指向同一缺口——正文写「证明材料见【待填写】」，
> 却没有一处把「评分点 → 承接章 → 要什么材料 → 编号」串起来。新增 `evidenceLedger.ts`：
> `inferEvidenceKind` 按评分标准措辞推材料类型（承诺函/社保与证书/合同/证书/截图/方案正文），
> `buildEvidenceLedger` 用既有 `buildScoringCoverageMatrix` 取承接章、按项序发 M1/M2… 编号、正文含【待填写】即标「待挂载」，
> `evidenceLedgerTableRows` 出七列表。导出侧两路径都插《评分点与证明材料索引表》（与《投标文件目录对照表》并列在技术标开头）；
> 交卷清单加一项「证明材料挂载」（N/M 待挂载）。
> **实测**（临时探针，跑完已删）：真实项目 w8eqvkh08q6e1lr 台账 14 项、编号 M1…，导出 docx 解包确认标题与 M1 均在。
> **顺手修**：`bidRehearsalRealDb.test.ts` 直连真实库在沙盒会 `disk I/O error`（PB 运行时 WAL 锁），
> 改为「先直连、失败则复制 data.db(+wal/shm) 到临时目录再只读打开」，环境无关。
> 基线同步为 **310 files / 3629 passed / 6 skipped**（+1 文件 4 例：`evidenceLedger.test.ts`）。
>
> **2026-10-23 第十六批（P0-3 正文可读性门禁）**：用真实交付标书当标尺量段落（`bidProseLinter` 头部基准表：
> 真实件段落中位 81.5 字 / 超 300 字 0.7%；旧 AI 稿 272 / 37%）。新增 `proseQualityGate.ts`：
> `evaluateProseQuality` 走同源 `splitParagraphs` 统计「段落中位 / 85 分位 / 超 300 字占比 / 可本地拆分段落数」，
> 分三档（ok ≤120 且 ≤10%；poor 中位 >200 或 >30%；其余 warn），并复用 `splitLongParagraphs` 给出「可拆 N 段」。
> 接线：交卷清单加「正文可读性」项（建议级，不拦交卷）+ 面板「一键拆段」按钮 → hook `splitProseLongParagraphs`
> （纯本地、零 AI、字符零改动；单句超长的枚举段拆不动，如实提示需人工/模型改写）。
> **实测（真实库 6 个有正文项目）**：新生成的三份已是 **ok**（中位 55 / 83 / 84，超 300 占 0.2%~6.1%）；
> 旧的两份 **poor**（中位 270、超 300 占 35.8% / 41.8%，可拆 83 / 62 段）——门禁既能抓住旧病灶，也没误伤新稿。
> 基线同步为 **311 files / 3633 passed / 6 skipped**（+1 文件 4 例：`proseQualityGate.test.ts`）。
>
> **2026-10-23 第十七批（P0-4 素材注入默认开启 + 空库提示）**：真实库 17 个有正文项目里 `material_boost` 开启数 **0**——
> 知识库建了、文档也进了，却从未进过任何一份正文。根因不是开关难找，而是「空库时静默跳过」没有任何提示。
> 三处改动：① `defaultGenOptions().material_boost` 改 **true**（只影响新建项目；`normalizeGenOptions` 仍按存储值读，
> 存量项目保持原状，不改变老项目下次生成的内容与费用）；② 生成时若 boost 开、知识库为空 → 每项目每会话提示一次
> （说明「本章只用招标原文与自有资料，建议先导入素材」）；③ 生成设置里该开关下加一行静态提示「依赖素材库/知识库有内容」。
> 基线同步为 **312 files / 3636 passed / 6 skipped**（+1 文件 3 例：`genOptionsDefaults.test.ts`）。
> **P0 四件至此全部落地**：交卷清单 / 证据台账 / 正文可读性 / 素材注入。
>
> **2026-10-24 第十八批（用户走查报告 P0 整改：根因优先）**：用户提交 66 项走查问题（含 60+ 截图、原文对照）。
> 先说结论：报告把「评分算错 / 编号预算错 / ★漏识别 / 原文污染」列成 5 个独立 P0，但真实数据指向**一个根因**——
> 被走查项目 4c11hvz43c0u2am 的 `tender_text` 只有 **52,631 字**（原文件 66,699 字），开头就是
> 「项目编号：[350000]SMZC[GK]2026-XXX号」「采购代理机构：（按实际委托填写）」「预算：人民币XXXX万元」——
> **输入源本身是一份带占位符的模板稿**，系统却照常解析、生成、检查，全程没有一处提示。据此修了五处：
> ① 新增 `tenderTextQuality.ts`：`scanTenderText` 检测 8 类占位符/模板痕迹（XXX/编号占位/「按实际…填写」/金额占位等，
>    单独出现「示范文本」页眉不算），`reconcileStarClauses` 做 ★/▲ 数量对账（原文声明 N 项 vs 解析条数；无声明但 ★=0 而 ▲ 有则弱提示）。
> ② 交卷清单新增前两项：**招标原文有效性**、**★/▲ 条款对账**（均为阻断/待办级）。
> ③ `stepEntryMissing(3)`：必选项解析失败（requiredParseFailures 口径）**不再允许进入编制**——
>    走查实测该项目缺资格/符合性/无效标/目录，第 2 步报失败、第 3 步照样生成 49 页正文。
> ④ 资质过期硬拦截默认开（`qual_hard_block` 未设置即拦截，只有显式 "0" 才放行）——走查项目 ISO20000 过期 87 天仍可导出。
> ⑤ 暗标违规硬阻断默认开（`sealedViolationIsFatal` 缺省 true，显式 false 才关）。
> **实测复算**（同一项目）：原文判定「含 4 类占位符」；★对账「未识别到任何 ★ 条款（▲4 条）」；
> 第 3 步门控「必选项解析失败：资格性审查、符合性检查、无效标与废标项、投标文件目录要求」；
> 交卷清单阻断项 `tender-text, parse, compose-gate`。
> **未修（诚实记账）**：P0-5 检查覆盖率分母（动 BidCheck 报告结构）、P0-7 重复项目去重（数据治理，需授权清理）、
> P0-8 客户官网 147 家失真（客户域）、P0-10 归档与编制中状态机冲突、以及 P1 大部分（知识库计数/权限审计/生产部署/搜索覆盖）。
> 基线同步为 **313 files / 3644 passed / 6 skipped**（+1 文件 8 例：`tenderTextQuality.test.ts`）。
>
> **2026-10-24 第十九批（P0-5 检查覆盖分母 + P0-10 状态机）**：
> ① **检查结论必须带分母**：走查实测某项目 13 个技术章只有 1 章有正文，检查器只看到这 1 章，却给出「必须整改 0」——
>    用户会读成「标书已安全」。新增 `CheckCoverage`（`bidCheckTypes`）+ `computeCoverage`（`runCheck`，纯函数）：
>    应检查 = 技术章数、已检查 = 正文 ≥50 字的章数、商务骨架章不计；`ReadingView` 顶部在覆盖不完整时显示琥珀横幅
>    「检查范围不完整：已检查 N/M 章……下方『必须整改 0』不代表可以交卷」，并把「可直接导出」降级为「覆盖不完整，本结论仅供参考」。
> ② **归档状态优先**：真实库存在 `archived=1` 但 `stage=composing` 的记录，卡片显示「编制中」、页面又提示「已归档只读」。
>    `deriveStage`/`displayStageLabel` 改为 archived 标志优先。
> 实测（真实库 4c11hvz43c0u2am）：`archived=1`、`stage=composing` → 现显示「已归档」。
> 基线同步为 **313 files / 3648 passed / 6 skipped**（+4 例：`runCheck.test.ts` 3 + `bidParseBackfill.test.ts` 1）。
> **仍缺（未做）**：正文一致性核对闭环（易标：程序抽事实 → 分「全局冲突/节内矛盾/跨节矛盾」→ 各节并发核对 → 主控统一取值 → 批量修复），
> 本项目现有 `consistencyGuard` 只做三条规则的事后扫描、只报不拦。
> **遗留**：① 大纲尚未为这些方案型条款建节（下一步）；② `resolveTechParamSource` 定位「技术参数及要求」时会串到第六章，
> 把资格审查条款（6.1/6.2/6.3、87 号令）混进参数表，属另一条问题。

> **2026-10-24 第二十批（P1-3 核查「docx 解析丢字 21%」：实测证伪，落地为安全网）**：
> 走查报告称同一份招标文件 docx 66,699 字、工作台只剩 52,631 字（丢 21%）。拿仓里唯一一份真实招标 docx
> （`_eval/R142_tender_sanming.docx`，142KB）解包对账：`word/document.xml` 里全部 `<w:t>` 文本非空白字符合计
> **58,412**，与 mammoth 现有输出**完全相等**；另有 3 份仓内 docx 同样吻合（1446/1464、20299/20305、137436/137436）。
> 结论：**docx 文本抽取没有丢字**。我们自己的 XML 路反而多 684 字（+1.17%），那是 `vMerge` 纵向合并格向上填充的重复文本。
> 因此**不做「谁长用谁」**（那会把表格更好读的 mammoth 结果换成重复文本更多的 XML 结果），改加一层安全网：
> `pickRicherDocxText` 只在 XML 路**显著更全（≥300 字且 ≥3%）**时才替换，`extractDocxText` 两条路都跑、按此规则取，
> 覆盖 mammoth 可能整块吃不到的极端结构（文本框等）。21% 的真实来源仍待查：最可能是走查那份是**脱敏/模板稿**
> （第十八批已确认该项目 `tender_text` 满是「XXX号 / 按实际委托填写 / XXXX万元」占位符），而非抽取环节——
> 用户若还保有原件，放进仓里即可复算（`_eval/` 下已有先例）。
> 基线同步为 **313 files / 3654 passed / 6 skipped**（+6 例：`docxXmlExtract.test.ts` 12→18）。
> **分片口径（本轮实测）**：288 个 node 文件按 6 片（每片 48 个）全量跑完 = 3462 passed / 6 skipped；
> 25 个 jsdom 文件因本机 worker 启动超时（`[vitest-pool-runner] Timeout waiting for worker to respond`，
> 非用例失败）改为 `--no-file-parallelism --maxWorkers=1` 单/双文件串跑，25 个全部跑通 = 192 passed。
> 3462 + 192 = 3654，与「上轮 3648 − 12 + 18」自洽。

> **2026-10-25（A1 章表↔大纲对账 + A2 写→落库→重读巡检，零 AI）**：真实库 32 项目实测定位到两类「导出即错」的落库问题，
> 本轮只做**检测 + 阻断 + 出路**，不删章、不改正文（红线：不删用户既有产物）。
> ① **A1 孤儿章**：`alignChaptersWithOutline` 的口径是「只增不删」，重新生成大纲后旧章全部留在 `bid_chapters`；
> `pickExportChapters` 只按 scope 与有无正文筛，不按大纲筛。实测 d3c35o7axkw34wo：大纲 16 节点 / 章表 31 章，
> **15 章不在大纲里、8 章与现有章同主题**（`总体建设方案` vs `总体技术解决方案`、`应急方案与业务连续性保障` vs `应急预案与业务连续性保障方案`…），
> 导出 Word 会多出一整套重复章。新增 `chapterIntegrity.ts` 的 `reconcileChaptersWithOutline`：
> 标题归一（剥「第N章」与中英标点、全角数字转半角）→ **一对一贪心匹配、按相似度降序分配**（先让精确同名占位，
> 否则「总体技术解决方案与统分结合架构设计」会把「总体建设方案与统分结合架构设计」的节点抢走，把本该匹配的同名章判成孤儿）→
> 剩余孤儿再与「已占用的节点」比相似度：≥0.5 判**重复**（阻断），否则判**增补**（如「项目理解与需求分析」，只提示不阻断）。
> ② **A2 假成功**：同项目 6 章 `gen_status=done` 但正文 364–592 字，`section_stats` 却记录 28,342–37,226 字已生成——
> 分节产物没拼回正文（`chapterCompletion.ts:52` 已记过反方向的同类态）。新增 `checkChapterIntegrity`：
> 假成功（阻断）/ 统计漂移（正文显著短于统计，提示）/ 正文**长于**统计不报（R179 整章补足只更新正文，属预期）。
> ③ **接线**：交卷清单加两项 `chapter-reconcile` / `chapter-integrity`（均 blocking 级）；
> `archiveCardGuidance("bid")` 在「本来就能导」的项目上再判重复章，未过则禁用导出并把按钮文案改成「章表与大纲不一致」
> （新增可选字段 `shortLabel`，缺省仍走「内容未就绪」，其余四张卡行为不变）。
> **真实库校准（全 17 个有章表的项目）**：d3c35o7axkw34wo 判「重复 8 / 增补 7 / 假成功 6 / 漂移 4」→ 阻断；
> 其余 16 个项目**全部阻断=false**（w8eqvkh08q6e1lr 判增补 6、重复 0——它的增补章标题与评分项式大纲不同名，属真实增补）。
> 判据不是「章数≠大纲数」，所以 7vco3jzj6abz8p0（章 2 / 纲 33）这类未生成完的项目不会被误拦。
> 基线同步为 **323 files / 3744 passed / 6 skipped**（+1 文件 `chapterIntegrity.test.ts` 16 例；
> `submissionReadiness.test.ts` 4→7 例、`archiveExport.test.ts` 5→7 例）。四门逐一实测：`tsc -b` 0 error；
> `vite build` 1m11s 成功；`eslint .` **116 error / 11 warning，与 `eslint-budget.json` 逐规则同源**（未上调预算）。
> **环境留痕（沙盒，非仓库改动）**：本次 `node_modules` 是 Windows 装的，缺 linux 原生绑定，
> 已补 `rolldown-binding.linux-x64-gnu.node`(1.0.0-rc.18) 与 `lightningcss.linux-x64-gnu.node`(1.32.0) 两个文件到既有 .pnpm 目录，
> **未改 package.json / pnpm-lock.yaml**；`--reporter=basic` 在 vitest 5 已废弃，分片命令不要带。
> **本次未做（诚实记账）**：不改 `chapterWordBudgets` 的分值权重（A7）、不做跨文档口径比对（A4）、不清理存量孤儿章（数据治理，需用户逐项目确认后删）。

**第 2 条的 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD` 前缀是必需的**：本机沙箱通过 `NODE_OPTIONS`
注入了 safe-delete 守卫，`vite build` 清空 `dist/` 时会触发批量删除拦截（阈值 50，`dist/assets` 有 260+ 文件）。
不写该前缀会看到 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 失败。

**行尾纪律（R52 新增）**：仓库根有 `.gitattributes`（`* text=auto eol=lf`）保证文本文件统一以 LF 存储与检出。
本仓曾因 `.gitattributes` 为空 + `core.autocrlf=true` 导致工作区行尾混乱（实测 351 CRLF / 394 LF / 21 混合），
并因此让「读源码做正则断言」的守卫测试**假红**——`proseFallbackWiring.test.ts` 的 `/\n\s*"bid-outline",\n/`
在 CRLF 下静默匹配 0 处，把「接线完好」误判成「接线缺失」。
**新增此类扫描型守卫时，行锚一律写 `\r?\n`（或先 `split(/\r?\n/)`），不要依赖文件行尾。**

## 自主迭代机制（v2）

- 提示词：`Qoder自主迭代提示词-v2.md`
- 驱动器：`scripts/autoloop.mjs`
  - `--check` 环境预检（零费用）｜`--gate-only` 只跑四门（零费用）｜`--dry-run` 只组装提示词
  - `--rounds N` 连续跑 N 轮（注入 `XIAOZHI_AUTOLOOP=1`，无人值守）
- 状态：`docs/evolution/_loop_state.json`（轮次 / eslint 基线 / backlog / history）
- 轮报：`docs/evolution/R{轮次}_{YYYYMMDD}.md`　停机说明：`docs/evolution/_STOP.md`
- 一键启动：`qoder-auto.cmd run N`（睡前多轮用）

## 红线（触犯即停）

- 不改 `.qoder/settings.json`、`.qoder/hooks/**`（权限与守卫）
- 不执行 `git push` / `reset` / `clean` / `rebase`；不删 `pocketbase/pb_data`
- 不动 `.env` 等凭据文件；密钥不得进代码或日志
- **不删用户既有产物**（已生成的标书正文、方案、PPT 数据）

## 源码来源

本项目源码由 VibeX 导出。改动或准备回传文件前，请先读
`.vibex/skills/vibex-app-source-roundtrip/SKILL.md`，保持 VibeX app id 与平台集成不变。
