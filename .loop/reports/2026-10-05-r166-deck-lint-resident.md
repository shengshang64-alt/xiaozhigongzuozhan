# R166 · PPT 制作链路——deck 导出前自检接入编辑期常驻（deckLint-resident）

日期：2026-10-05 ｜ round：165 → 166 ｜ 优先级：P2 ｜ 域：/ppt-quote（PPT 制作主链路）

## 一、选题依据
- 用户点名两优先项 `quote-history-01`（R102/R131 已 closed）、`prompt-fabscan-03`（R101/R103 已 closed）均已收口；open backlog 全为维持裁定项（lint-debt-01 有意残余 / ui-redesign-phase3 自然迭代 / quote-history-3-mining 待立项 / r130-price-preview-404 受 pb_hooks 红线约束）。
- 按流程转入巡检新角度：PPT 制作主链路的「质检与生成接续」。
- **发现断链**：R121 建的 `deckLint`（8 条结构自检规则）此前**只在『导出 PPT 文件』那一下弹一次性 toast**，逐页编辑 / 页面预览阶段完全看不到命中项——用户必须导出才知道哪页有问题，与「下载前就知道哪几页要人工加强」的原始设计意图相悖。

## 二、本轮变更
| 文件 | 变更 | 说明 |
| --- | --- | --- |
| `src/pages/PptQuote/deckLint.ts` | 新增 `groupIssuesByPage` + 导出 `DeckLintIssue/DeckLintLevel` | 页级聚合单一真源（同页 warn 优先 info），非阻断契约不变 |
| `src/components/ppt-quote/DeckLintPanel.tsx` | 新建 | 常驻自检卡：通过态绿色徽标 / 命中态汇总+命中页预览+展开明细逐条（级别徽标·页码·建议），点页码跳转该页并切回逐页编辑，展开态 sessionStorage 记忆 |
| `src/components/ppt-quote/DeckEditorWorkspace.tsx` | 接线 | `useMemo` 算 `lintIssues`/`lintWarnPages`；面板挂在编辑与预览两 tab 之上；warn 页集合透传 SlideListNav |
| `src/components/ppt-quote/SlideListNav.tsx` | 徽标 | 页码与标题间按 `warnPages` 加红点（原生 `title` 提示）；新 prop 可选，未传不渲染，info 不打点 |
| `src/pages/PptQuote/deckLint.test.ts` | +3 例 | `groupIssuesByPage` 纯逻辑回归（warn 优先 / 整份 page 0 / 空集） |
| `src/pages/PptQuote/deckLintPanel.test.ts` | 新建 8 例 | 源码扫描接线哨兵：真源指向 deckLint、aria-expanded、分级徽标、memo 计算、跳转切页、warn 集合透传、非阻断契约（导出 toast 未被移除 + lint 到 try 间无 return/throw） |

## 三、四门验证（目标项目目录）
| 门禁 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0，零 error |
| `npx vitest run` | 98 files / 1086 passed, 2 skipped（R165 基线 1075 → 净 +11：+1 文件，deckLint +3、panel 哨兵 +8） |
| `npx eslint`（触及 6 文件） | exit 0，零 error/warning |
| `npx vite build` | 成功，built in 4.31s（>500kB chunk 警告为既有） |

## 四、实机验证（dev-server :8000 真实编译产物）
以运行中 Vite dev-server 动态 import 直取真实模块做等价运行时取证（同 R163/R164 运行时直调范式）：
- `lintDeck` 三段命中：codes=[noun_title, too_many_bullets, noun_title, empty_page]、pages=[1,2,2,3]、levels=[info,warn,info,warn]。
- `groupIssuesByPage` 聚合：{1:"info", 2:"warn", 3:"warn"}；`lintSummaryText` → 「2 处需注意，2 处可优化」。
- `DeckLintPanel` / `SlideListNav` 模块导出存在性均 true；console 0 error / 0 warn（仅 vite connected debug）。
- 诚实项：React 根内联挂载浮层截图因 react-dom/client 的 createRoot 在测试注入路径取不到命名导出而放弃，改以模块导出存在性 + 真实 lint 计算结果作等价证据。

## 五、约束遵守
- 非 B 类：未改任何提示词与 PROMPT_VERSION，无需快照 -u 与新旧口径逐字对比。
- 零 collection / 零 pb_hooks / 零新 AI 调用 / 零 schema；未 commit。
- 维持既有裁定不推翻：编造嫌疑导出硬门禁「只报不拦」、lint-debt-01 有意残余、r130 pb_hooks 红线。
- 在途保护：触及的 4 文件改前 git status/git diff 核对均为 git-CLEAN，锚点区无在途新功能；另新建 2 文件；未触碰 37 个 M 在途文件（含 usePptQuote.ts / deckExports.ts / pptQuoteTypes.ts）。
- 跨工作区实施：scripts/r166_deck_lint_panel.py、scripts/r166_deck_lint_tests.py、scripts/r166_ledger_writeback.py（pathlib utf-8 读改写，每个 str.replace 前 assert count==1；账本先落 .loop/ledger.json.bak-r166）。

## 六、用户重定向与后续排期（2026-10-05）
用户明确后续重点为三条主链路全流程测试 + 能力补全，本轮已按 标书>方案>PPT 权重登记 backlog：
- P1 r167-bid-material-library：标书「优质素材库」五类标准件（设计/背景分析/实施/培训/测试）→ 取基线 + 按招标要求定向调整闭环。
- P1 r167-solution-checklist-assemble：方案先对照公司系统/产品清单 → 按清单组装标准方案骨架（buildOutline 现与清单解耦）。
- P1 r167-ppt-template-driven-export：PPT 上传公司模板并在模板版式下导出（现仅固定母版壳下载、pptxgenjs 中性版式，需先做引擎可复用性检索）。
- P2 r167-ppt-skill-driven-generation：整份 PPT 生成带入全站技能（对齐清单侧 matchSkills，现 deck 仅逐页 refine）。
- 已满足基线：PPT 图文并茂生成（三通道真实配图 + AI 生图 + 一键配图 + 图文版式）巡检确认既有，无需重复自研。

下一轮从 P1 项起做全流程走查 + 实质实现，按既有门禁与 B 类流程推进。
