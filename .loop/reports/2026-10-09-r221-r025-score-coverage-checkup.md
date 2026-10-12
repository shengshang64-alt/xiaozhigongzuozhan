# R221 · R-025 评分覆盖体检（第 2 轮改造 · 标书链第二 slice）

## 选题依据
第 2 轮 M-001：建阳区 32 章大纲把「售后服务方案(5分)」「技术培训方案(2分)」「技术参数(58分)」
整章漏掉，最终评分却仍报「需求响应覆盖 59/60 条」——现有覆盖检查只数**条款数**、不数**评分项分值**，
丢分看不见。用户拍板标书链顺序 R-021→R-025→…，本 slice 补「按分值」的评分体检观测手段。

## 变更文件
- 新增 src/pages/BidWorkspace/scoreCoverageCheckup.ts（纯本地零 AI：复用 R31 现成能力
  numberScoringItems + buildScoringCoverageMatrix，按【分值】聚合「技术总分/已落点/未落点」+ 逐评分项明细 +
  未落点丢分清单（分值降序，丢分大户在前）；未落点标题去重保序供一键补入）
- 新增 src/pages/BidWorkspace/scoreCoverageCheckup.test.ts（4 例：无评分表不呈现、空大纲总技术分 53/落点 0/全未落点、
  [响应:Rx] 标注即落点使分值前移、未落点标题去重）
- 改 src/pages/BidWorkspace/useBidWorkspace.ts（import buildScoreCheckup；新增 scoreCheckup useMemo（依赖 coverageNodes +
  parse_report，实时随大纲/评分表变化）；新增 addUncoveredScoringToOutline 一键补入回调（未落点评分项追加为技术章节、
  同名跳过、setOutlineDraft+updateProject 落库、toast 涉及分值）；hook 返回值暴露 scoreCheckup / addUncoveredScoringToOutline）
- 改 src/pages/BidWorkspace/BidWorkspacePage.tsx（activeStep===3 渲染「评分覆盖体检（按分值）」卡片：
  总分/已落点/未落点三段 + 未落点明细（含主观分标记）+「一键补入 N 个未落点评分项」按钮，零涟漪不改 ComposeStep props）

## 落点判定口径（复用现成，不另建映射）
沿用 R31 覆盖矩阵：技术叶子 description 的 [响应:Rx] 标注由 backfillResponseTags 依章节名相似度回填，
故「项目重点难点及对策建议（含专家点评）」这类近义章节能命中对应评分项——与既有「评分项未承接→并入同一次结构修复」
口径完全一致，体检只是把「条数」升维成「分值」。

## 四门验证
- tsc --noEmit：0 error
- vitest run：1609 passed | 2 skipped（基线 1605，+4 全绿，0 回归）
- eslint（新文件 + 页面 3 文件）：0 issue；useBidWorkspace 报错全在未触碰历史行（setState-in-effect、no-useless-assignment L8032），零新增
- npm run build：success 4.14s

## 遗留 / 后续
- 体检面板默认在编制步(步骤3)常驻；实机 AI 回归按用户选择「另建演练项目」，拟在标书链后段合并一次实机验证。
- 一键补入生成的是占位技术章节（title=评分项名），正文仍需 R-022/生成补齐；R-023 双层目录将把派生章节进一步按评分要点展开小节。
