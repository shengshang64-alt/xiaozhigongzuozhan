# R287 · 标书 L2 逐字审计第二刀：生成侧改写抑制（bid-l2-verbatim-compare P0 切片2）

日期：2026-10-13 · 执行：Qoder 自主轮 · 优先级：P0 伞项第二切片 · 类别：B类（提示词口径变更）+ 整改回注接线

## 选题依据
- R286 摸底出数：引文级改写全库 34 处，全部产自**生成环节**（照抄途中改写）——本刀做生成侧抑制，
  即伞项剩余切片①「生成侧改写抑制（体检命中回注重写）」。
- 双通道：预防（提示词纪律，管未来生成）+ 整改（体检命中一键回注，管存量正文）。
- 编造 AI 复核全量铺开（有真实模型费用、需逐项目跑）与漏答清零（依赖补生成）不在本刀，伞项保持 open。

## B类·提示词新旧口径逐字对比

### bidSection.ts（小节正文生成）PROMPT_VERSION 5 → 6
**旧口径（v5）**：规则表中无任何引号使用纪律；第 6 条起为写作模式档（complianceModeRule）、衔接、
隐式硬约束、条款响应、事实一致…；模型在引号内改写/概括招标原文不受任何约束——34 处改写即此缺口产物。

**新口径（v6）**：在 `let ruleNo = 6` 之后、模式档规则之前插入一条**无条件**规则（其后各条序号顺移 +1）：

> 正文引号只用于逐字照录招标原文：引用招标文件条款、评分标准、要求语句时，引号内文字必须与招标原文一字不差（仅允许把「要求/需/应」等要求类字眼改写为投标人自述人称），禁止在引号内改写、缩略、概括或插改字词；无法逐字照录时一律去掉引号改为间接转述；自拟的标题、口号与概念名称不用引号引用；

逐字变更说明：仅新增上述一条；未删除、未改写任何既有规则句；注入位置在 system 消息规则表第 6 条。

### bidChapter.ts（整章正文生成）PROMPT_VERSION 4 → 5
同一条规则句逐字一致（上文引用），注入位置同为 `let ruleNo = 6` 后、模式档前。其余规则未动。

### 口径配套（与体检同一把尺子）
- 规则句禁则「禁止在引号内改写、缩略、概括或插改字词」＝ R286 quote_rewrite 判据（引号内归一文本
  招标原文逐字未见即命中）的事前镜像；「允许要求类字眼转自述人称」对应判据 normalizeFidelity 不豁免
  该改动的已知误报面（照录+人称转换仍可能被判——体检只报不拦、人核对，与维持裁定一致）。
- 「无法逐字照录→去引号间接转述」给出合规出口：转述不带引号即不再进入 quote_rewrite 核对面。

### 快照与回归
- promptsSnapshot.test.ts：`vitest -u` 更新 2 条快照（buildBidChapterMessages / buildBidSectionMessages），
  其余 29 条未变（本次改动不触其它 builder）。
- 补单测：bidPromptBase.test.ts 新增「r287 引号照录纪律」锈死锚点（逐字照录/间接转述/禁则在引号内改写）；
  materialLibrary.test.ts 两处版本断言随升位 4→5、5→6（标题注明 r287 缘由）。

## 整改回注（会话内接线，零提示词、零 collection）
- quoteFidelity.ts 重构：核对扫描抽口 `iterRewriteQuotes` 单一真源（切片1 报告与切片2 回注共用，行为逐字等价，
  原 10 例快照型单测全过即为证）。
- 新增 `quoteRewriteFixTargets(tenderText, chapters)`：命中按 section_stats `sliceSectionPieces` 确定性切片
  定位到（章, 小节）；**全片段匹配**——同一改写形态散落多节时每处都定位（回注重在清零，与报告的跨章
  去重刻意不同）；无小节统计的整章 blob 章静默跳过（指引回③整章处理，口径同 R103 整章级叶）；
  单节封顶 8 条、单轮全局封顶 12 小节（一次费用确认的量必须可控）。
- 新增 `buildQuoteFixDirective(quotes)`：运行时附加写作要求（非提示词模板）——逐条列疑改写引语+
  招标原文定位，二选一修正（逐字照录 / 去引号间接转述），限定「只动引语与所在句、其余保持不变、禁止顺手扩写」。
- useBidWorkspace.ts：`startQuoteRewriteFix`（登录闸/归档只读/并发锁/一次 costConfirm 费用确认）→
  `runQuoteRewriteFix` 串行复用 `runRegenerateSection` 通道；重写完成由既有 refreshFormatReport 自动刷新体检。
- SubmissionCheckPanel.tsx：格式规则检查卡右上新增「引文改写整改（N 处）」按钮（有 quote_rewrite 命中才出现）；
  BidWorkspacePage.tsx 两处挂载点透传 props。

## 四门验证
- `npx tsc -b` exit 0
- `npx vitest run` 194 files / **2227 passed + 2 skipped**（基线 2219+2，增量 +8：quoteFidelity +7、bidPromptBase +1）
- `npx eslint` 触及 9 文件：除 useBidWorkspace.ts 外零问题；useBidWorkspace.ts 18 problems (5 err/13 warn)
  与 R286 基线逐条同数（既有 set-state-in-effect×4 + no-useless-assignment×1 + 存量 warn），本轮新增代码区间
  （6900-7000 行）零命中——零新增 error
- `npx vite build` exit 0（6.4s）

## 维持裁定与避让
- 「只报告不拦」维持：按钮只是把命中转为可选整改，不拦截导出、不自动重写；扫描定位全程零 AI。
- lint-debt-01 不重构；未触碰 ppt-quote 在途文件（QuoteEditor/usePptQuote/quoteExports 等 git-MODIFIED 六件）；
  BidWorkspace 锚点区（useBidWorkspace 尾部导出段）git diff 核对仅为 R286 本系列在途行，无用户功能误伤。
- 禁止 commit 裁定维持：本轮全部改动留在工作区未提交。

## 真实链路验证（浏览器实证）
环境：本地 vibex-local vite（:8000，/__pb 代理 → PocketBase :7000），真实项目「13」（中国农业银行股份有限公司贵港分行 ·
GXKLG202630843，正文 166 页）——即 R286 摸底「改写 19」项目。步骤与结果：
- 第5步交卷体检点「重新审计」（走既有费用确认）→ 体检完成：格式检查命中 81 处，其中 rule=quote_rewrite 16 处；
- 格式规则检查卡右上**「引文改写整改（16 处）」按钮按预期渲染**（quoteRewriteHitCount>0 条件成立，Wand2 图标、enabled）；
- 点按钮 → costConfirm 弹窗如实显示本地计算结果：「共 11 个小节…单轮封顶 12 小节」——16 处命中经
  quoteRewriteFixTargets 去重/跳过无 section_stats 的整章 blob/全局封顶后为 11 节，与实现口径一致；
- 点「取消」关闭，未实际回注重写（零 AI 费用）。截图：.qoder/tmp/r287_quote_fix_button.png（MedPreSales 工作区）。
