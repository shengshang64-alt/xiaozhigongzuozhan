# R252 · 方案交付前本地体检（sol-delivery-check）

- 轮次：R252（账本 round 251 → 252）
- 日期：2026-10-10
- 类别：**A 类**（零 collection / 零 pb_hooks / 零提示词 / 零迁移 / 未 git commit）
- 模块：方案工作室 SolutionStudio（编辑器工作区）

## 1 选题依据

### 1.1 用户点名两项复核结论：均已闭环，不重复立项

| 点名牌 | 实况 | 闭环轮次 |
| --- | --- | --- |
| `quote-history-01` 报价历史二期（结项沉淀明细 + 按医院等级/床位数/模块组合智能推荐区间） | **已交付** | 一期 R40 → 沉淀通道 R79 → **二期智能推荐 R102（r102-quote-history-phase2）**，另 R131 引用加固 |
| `prompt-fabscan-03` 残余「按章聚合回注改进建议」 | **已交付** | 四态口径 P7.1 = R101；**按章聚合回注 = R103**；P7.2 由 `consistencyGuard`（R89）承接 |

与 R246～R249 各轮报告中的复核记录一致，故按指令转「巡检新角度」择优。

### 1.2 剩余非 closed 项均受既有裁定约束，本轮不动

| 项 | 优先级 | 不动理由（维持既有裁定，非本轮推翻） |
| --- | --- | --- |
| `lint-debt-01` | P3 | 用户裁定「有意保留残余，不重构」 |
| `ui-redesign-phase3` | P2/P3 | 视觉密度按自然迭代收敛，不单独立项 |
| `quote-history-3-mining` | P3 | 用户需要时才立项；且选题权重已弱化报价 |
| `r177-followup-generation-parallel-resume` | P2 | 章间并发 R162 已落地，剩余受控并发「风险较高，单独立项评估」 |
| `hook-security-01`（blocked） | — | 2026-09-22 拍板：本地单用户自用部署维持现状，**不碰 pb_hooks 红线** |

## 2 巡检发现（本轮选题）

**缺口**：标书侧「交卷体检」（`SubmissionCheckPanel`）承担 15+ 项**零费用确定性**硬核验；
而方案是直接交给医院的交付物，交付前却只有

1. AI 五维自检（`ChapterScoreCard`：coverage/logic/evidence/feasibility/writing，花钱、非确定、章级视角），
2. 导出时的空章节 toast 提示（R011），
3. 导出时的 `sanitizeChapterText` 结构清洗（剥 ``` 围栏 / 独立 JSON / 行首 markdown 符）。

即：**方案侧没有任何「不花钱、可复算、跨章视角」的交付前硬伤体检**。占位没填、元话语与绝对化承诺残留、
跨章指标口径打架、跨章复制段落、超链接与水印词、装饰符号残留——这些在标书侧早已被拦的类别，在方案侧全部裸奔。

旁证（同轮巡检顺带核对，确认非重复建设）：`src/pages/SolutionStudio/*.ts` 与
`src/components/solution-studio/*.tsx` 内 `体检|deliveryCheck|硬伤` 关键字命中为 0；
docs13/docs15/未来功能规划路线图 3.4/3.7/3.8/3.9 已分别由 R239/R199+R240/R241 闭环，资质有效期已由 Q20 落地。

## 3 方案与实施

### 3.1 规则口径单一真源（本轮最关键的设计决策）

不新建第二套规则：直接复用 `bidTypes` 既有纯函数。可行性来自一个既有事实——

```ts
// src/pages/BidWorkspace/bidTypes.ts:4
import type { Chapter, FigureSpec, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"
```

bidTypes 的 `Chapter` **就是** solutionTypes 的 `Chapter`（同一个类型），所以
`sol.chapters` 可原样喂进 `metaLeftoverHits` / `metricConflictHits` / `formatCheckReport` /
`findIntraDupPairs`：**零签名改动、零 cast、不碰 6595 行红线文件 bidTypes**。
中文口径同样复用 `FORMAT_RULE_LABEL`，只有方案侧新增的 5 条规则另立词条。

### 3.2 覆盖 13 项核验（零 AI、零费用、零网络）

| 来源 | 规则 |
| --- | --- |
| 复用标书侧 | `meta_leftover`（占位元话语与绝对化承诺）、`metric_conflict`（跨章同指标多值）、`no_hyperlink`、`no_watermark`、`no_empty_line_consecutive`、`no_half_width_punct`（密度型）、`wording_scan`、`decoration_leftover`、`intra_dup`（跨章重复段） |
| 方案侧新增 | `placeholder_leftover`（【待填写】/【请补充素材】未填）、`failed_chapter`、`empty_chapter`（标完成却空正文）、`underlength_chapter`（info） |

**暗标专属禁则明确排除**（彩色文字/图片、表格底纹、彩色边框、加粗、下划线、空白页、`identity_leak`）：
方案不是暗标文书，纳入只会刷出与交付无关的噪音。`no_bold`/`no_underline` 亦不纳入——
其行首 markdown 情形已被 `decoration_leftover` 覆盖，避免一处问题两种口径。

### 3.3 两处刻意的误报/成本防护

1. **未生成章不算交付硬伤**：`gen_status="pending"` 且空正文不报（属正常进度），只有
   `failed` 与 `done 却空正文` 才报红——开局满屏红会把卡片变成噪音源。
2. **查重主线程成本护栏**：`findIntraDupPairs` 是 O(段落数²)；每章只取前 `DUP_PARAGRAPH_BUDGET=12`
   个达标段落（经 `splitParagraphs(text, 50, 12)`）参与比对，11 章方案约 132 段 → 8.7k 段落对，实测量级 <20ms。
   单测锁住「第 15 段的重复不报」这条边界（宁漏不卡，注释已说明）。

### 3.4 契约：只报不拦

任何命中都**不阻断导出**，与既有裁定（编造嫌疑未清零禁止导出的硬门禁维持「只报告不拦截」）方向一致；
卡片说明行与展开态文案都写明「只报不拦，不影响导出」。

### 3.5 文件清单

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `src/pages/SolutionStudio/solDeliveryCheck.ts` | 新建 243 行 | 纯函数体检内核 + 整改清单文本 |
| `src/pages/SolutionStudio/solDeliveryCheck.test.ts` | 新建 268 行 | 26 个用例（含误报防护与口径哨兵） |
| `src/components/solution-studio/SolutionDeliveryCheckCard.tsx` | 新建 160 行 | 常驻卡片，默认收起 + 展开分组明细 + 点章名跳章 + 复制整改清单 |
| `src/components/solution-studio/EditorWorkspace.tsx` | 单点插入（2 处锚点） | 紧跟 `RequirementCoverageCard` 之后，数据全取既有 props |

**零 hook 改动**：`chapters` 与 `selectChapter` 早已在 `EditorWorkspaceProps` 里
（`RequirementCoverageCard` 同款范式），故 `useSolutionStudio.ts`、`SolutionStudioPage` 一行未动，
涟漪面为四个文件。与「需求条目落位核验」互补：那张卡管「客户要的写没写」，这张卡管「写出来的有没有硬伤」。

## 4 四门验证（目标项目目录内执行）

| 门 | 结果 | 数字 |
| --- | --- | --- |
| `npx tsc -b` | 通过 | exit 0，零输出（两轮各一次） |
| `npx vitest run` | 通过 | **155 files / 1834 passed + 2 skipped**（基线 154 files / 1808+2skip → **+26 用例 / +1 文件**） |
| `npx eslint`（触及 4 文件） | 通过 | exit 0，零 error 零 warning（`EditorWorkspace.tsx` 本轮 git CLEAN，无在途既有 error） |
| `npx vite build` | 通过 | exit 0，6020 modules transformed，3.66s |

新模块自身单测：`vitest run src/pages/SolutionStudio/solDeliveryCheck.test.ts` → 25 passed（首轮 1 例失败：
`metric_conflict` 的 quote 内含指标名「系统可用性」而非别名「可用率」，断言口径写错；已改断 `99.9/99.5/label` 后全绿）。

## 5 浏览器实机判别性验证（Vite dev :8000，热更新）

场景：`/solution-studio` → 《【演练】R01-solution-20261004》（三明市中西医结合医院 · 三级甲等 · 11 章 · 正文 0 章）。

| 验证点 | 实测 |
| --- | --- |
| 卡片挂载位置 | 顶部大标题卡 → 需求条目落位核验 → **交付前本地体检** → 大纲目录树，同列同宽，间距 16/20px |
| 命中判定 | 徽标「**11 处待复核**」+ 分类「章节生成失败 11」——与真实数据一致（11 章 `gen_status="failed"`，系 AI 未配置时逐章生成各抛一次；`pending` 章不报，判定分支正确） |
| 展开明细 | 分组「11 章节生成失败（导出会缺章）」，11 条明细含「『章名』上次生成失败，正文缺失或为旧稿」 |
| 跳章链路 | 点「重点应用系统规划」→ 编辑区 **第1章 项目背景与政策依据 → 第5章 重点应用系统规划**，左侧目录同步展开 5.1–5.8 |
| 控制台 | 0 error / 0 warning |
| 布局 | 卡内 `scrollWidth==clientWidth`（326/326），横向溢出 0 条，无遮挡塌陷 |
| 数据洁净 | 全程 72 条请求全为 GET，无 POST/PUT/PATCH，无付费 AI 调用，未改任何正文 |

截图：`r252_card_collapsed.png` / `r252_card_expanded.png` / `r252_card_jump.png` / `r252_card_copy_fixed.png`
（均在 `d:\KFDXCX\MedPreSales\.qoder\tmp\`）。

### 5.1 实机走查抓到的一处文案自相矛盾（已修）

首版说明行在「正文 0 章」时恒写「体检项在成稿后自动生效」，而同一卡片头部正亮着「11 处待复核」——
自相矛盾（说明行在否认自己有东西可看）。已改为三分支，实机复验逐字确认新口径生效、旧文案 DOM 无残留：

> 共 11 章，正文尚未生成（0 章），**但已有 11 处要先处理（生成失败 / 标完成却空章 / 占位未填）；补齐正文后其余核验项自动生效。**

并补 1 个卡片哨兵用例锁住该三分支文案（合计 +26 用例）。修完后四门全部重跑通过。

## 6 顺带发现（登记入 backlog，本轮不扩范围）

1. `kb-docs-pagination-loop`（P2）：知识库模块后台连续拉 `kb_docs?page=1..30`，末尾数条 pending——
   疑似分页循环未收敛/过度预取，属性能与请求浪费，值得单独定位。
2. `narrow-viewport-toolbar-overflow`（P3）：视口宽 < `lg` 断点时 `document.scrollWidth 803 > clientWidth 464`，
   溢出源为既有章操作条（带入技能/生成正文/改写/扩写/精简/自检）与顶部操作条（素材/…/导出 Word/打印）的
   `shrink-0` 单行，非本轮新卡所致。窄屏可用性待评估。

## 7 维持裁定复核

- 提示词：**未触碰**，PROMPT_VERSION 不变，无 B 类流程需求（无新旧口径对比报告义务）。
- 数据模型：**零 collection、零 pb_hooks、零会话外持久化**；`chapter.underlength`/`gen_status` 均为既有字段只读。
- 「只报告不拦截」硬门禁裁定：本卡刻意**不做任何拦截**，与裁定同向。
- `lint-debt-01`：未重构；`bidTypes.ts`（红线 + 在途 M）本轮**一行未改**，只 import 其导出。
- 未执行 git commit。

## 8 收轮

round 251 → **252**；closed 追加 `r252-sol-delivery-check`；backlog 新增两条巡检登记项；`noProgressStreak` 归 0。
