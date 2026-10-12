# R235 — bidkit-plan-slice3 底稿增量「三段式匹配 + 合并计划」引擎；slice4 核验关闭

## 选题依据
用户 P0 需求两条挂在 backlog：slice3（底稿增量合并）、slice4（Word 分页预览）。巡检发现：
- **slice4 其实早在 r211 已完整实现并已接线可达**——BidWordPreview.tsx + bidWordPreviewLogic.ts
  提供 A4 版心 / 页边距 / 页眉页脚 / 页码 / 三级标题编号 / 首行缩进 / 图表居中题注 / 连续滚动预览；
  ComposeStep 有「Word 预览」按钮（setWordPreviewOpen(true)）打开 Dialog 渲染，打印仍走 PrintExportButton。
  滚动连续预览已满足需求「翻页/滚动连续预览」之一。属 backlog 漏关，本轮核验后关闭（不改代码）。
- **slice3 是真正未动的一条**，且需 Chapter/BidProject 加 source/locked/draftRef（schema）+ mammoth 解析
  接进 ComposeStep（该区正被 R220–R234 连续改动、大量在途，ComposeStep/bidTypes/useBidWorkspace 均 dirty）。
  一次性把 5 天整包做完既超单轮容量、又必然误伤在途代码。按既定切片工作法，先钉死最易出错的
  「匹配与合并决策内核」（纯函数层），UI 接线与 PocketBase 落库留后续切片。

## 复用检索结论（新模块前置）
- docx 解析：复用 package.json 已有 mammoth@^1.12.3（不新增依赖）；本模块只做「HTML→结构化」，
  用纯正则按 h1/h2 切章，脱离浏览器即可单测（DOM 版 mammoth 调用留 UI 接线切片）。
- 项目内无可复用的「标题归一 + 相似度 + 大纲匹配」引擎（现有 normalize* 各有所指、outlineResidue 是残留检测、
  scoreCoverage/techParamCoverage 是覆盖率核对），故匹配/合并内核自研属正当。

## 变更（均为新增文件，不碰任何在途 M/?? 文件、不动 schema/pb_hooks/提示词）
- `src/pages/BidWorkspace/bidDraftMerge.ts`（238 行，纯函数内核）
  - `normalizeTitle`：去空白（含全角空格）、逐层剥离阿拉伯/中文/带圈/第…章 编号、去标点，仅留中日韩字与字母数字。
  - `titleSimilarity`：归一相等=1、包含=0.85、否则二元组 Jaccard。
  - `matchOutlineToDraft`：三段式（精确短路 → fuzzy≥0.6 → none），exclude 保证一章只并一处。
  - `decideAction`：未命中→偏离表补表 / 其余自动生成；命中→技术·偏离以底稿为参考重写，商务·架构·其它原文保留不动。
  - `buildMergePlan`：按大纲顺序逐个匹配产出 MergePlanItem[] + extras（未认领底稿章）+ stats。
  - `parseDraftHtml`：按 h1/h2 切章、去标签、解实体，无标题整段作单章。
- `src/pages/BidWorkspace/bidDraftMerge.test.ts`（+13 单测，environment=node）：归一/相似度/三段式/动作映射/
  计划统计与 extras/HTML 切章全链锁口径。

## 口径要点
- 保守优先：命中即「保留原文不动 / 参考重写」，绝不误删商务同事既有成果；低相似宁可判未命中走自动生成，不虚配。
- 纯内存零副作用，可脱离网关 / DOM / 后端独立验证。

## 四门验证
- `npx tsc -b`：exit 0。
- `npx vitest run`：全绿 1718 passed / 2 skipped（较上轮 +13，新增 bidDraftMerge.test.ts）。
- `npx eslint`（2 个新增文件）：exit 0，零 error/warning。
- `npx vite build`：exit 0，built in 3.10s（>500kB 为既有全局告警）。

## 挂账 / 后续切片（slice3 未完的部分，保持 open）
- UI 接线：ComposeStep 底稿上传入口从「仅 external」解耦常显、选文件→mammoth(DOM)→parseDraftHtml→buildMergePlan
  →展示「保留/参考/自动生成/补偏离」合并计划并一键续跑（startBulkGenerate skipLocked）。
- schema：Chapter 增 source/locked/draftRef、BidProject 增 bid_draft_file/chapters/match_report（A 类小 schema，
  动 PocketBase collection/pb_hooks 前须先出账本与理由说明）。
- 上述均落在当前在途文件区，须待用户 R220–R234 那批改动落定后再做，避免误伤。

## 维持裁定
- 未 commit；未触碰在途文件；编造嫌疑硬门禁「只报告不拦截」、lint-debt-01 残余不重构——均不涉及。
