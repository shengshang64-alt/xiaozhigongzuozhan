# R190 · PPT 公司模板「保真体检」：事前可见 + 失败归因（r169 切片三）

日期：2026-10-06　轮次：round 189 → 190　优先级：P2
关联账本项：`r169-ppt-template-master-fidelity`（切片③，另含实机验证发现的切片④）

---

## 1. 选题依据

- 用户点名的两项经账本核实**均已闭环**：`quote-history-01`（R102 closed）、`prompt-fabscan-03`（R103 closed），
  故按授权在 backlog 内择优。
- 选中 `r169` 切片③：内核（R182）与导出接线（R189）都已交付，**唯一剩下的真实体验缺口**是
  「用户上传公司模板后，能不能真的复用母版/版式，只有点导出、看 toast 才知道」。
  这是实质性优化（事前可见性 + 可执行建议），不是零风险小改。
- 未选项目由：`lint-debt-01`（裁定维持不重构）、`ui-redesign-phase3`（只剩视觉密度自然迭代）、
  `quote-history-3-mining`（需独立立项）、`r177-followup-generation-parallel-resume`（并发改造风险需单独评估）。
- 本轮**零提示词改动**（B 类流程不适用）、**零 PocketBase collection / pb_hooks**、零 AI 调用变更。

## 2. 交付内容

### 2.1 探测层 `src/pages/PptQuote/deckFidelityProbe.ts`（新增，纯函数）

| 导出 | 作用 |
| --- | --- |
| `probeTemplateFacts(t)` | 只依赖模板本身：是否存原件 / 可否解包 / 样张目录 / 标题·正文样张页 / 是否含备注页版式 |
| `describeFidelityRows(slides, picked)` | 逐页展示行（页号、能力标签、中文归因、被选作哪种样式页） |
| `finalizeFidelityProbe(facts, slides)` | 合成结论：verdict（可保真 / 仅套主题 / 读取失败）+ 一句话结论 + 归因 + 建议 |

口径同源性（关键设计，避免「体检说能、导出回退」的漂移）：

- 选页复用引擎真源 `templateFidelity.pickFidelitySamples`（本轮从渲染函数里**抽出**并导出）；
- 当前册页面合格性复用 `deckFidelityPlan.isFidelityEligibleSlide`；
- 归因先后顺序与 `deckExports` 的分流严格一致：存原件 → 可解包 → 有页面 → 整册逐页合格 →
  讲稿需备注页版式 → 标题样张 → 正文样张 → 保真；
- 诚实边界写入模块注释：引擎真正写文本时仍可能拒绝某样张（运行期情形），探测不预测，
  由导出侧 legacy 回退时的归因 toast 兜底闭环。

### 2.2 展示层 `src/components/ppt-quote/TemplateFidelityPanel.tsx`（新增）

- 交互形态沿用 R166「导出前自检」面板：`section[aria-label="模板保真体检"]` + 三态徽章 +
  `aria-expanded` 展开明细 + sessionStorage（`ppt_fidelity_panel_open`）记忆开合。
- 明细含：归因列表、「可复用版式目录」（选中样式页优先，`MAX_ROWS=8`，溢出显示「另有 N 页未列出」）、建议行。
- **非阻断契约维持**：只提示，不拦截导出与生成（与「编造嫌疑只报不拦」同一裁定精神）。

### 2.3 接线

- `usePptQuote.ts`：`deckTemplateProbe = useMemo(() => probeTemplateFacts(deckTemplate), [deckTemplate])`
  ——重解包只随模板变化发生一次（1.7MB 模板不会逐字符重算）；`exportPptx` 走 legacy 通道时补当次归因 toast；
  对外暴露 `deckTemplateProbe`。
- `PptQuotePage.tsx` 透传 → `DeckEditorWorkspace.tsx` 在「导出前自检」上方渲染体检卡片。

### 2.4 引擎真源抽出（同轮）

`templateFidelity.ts`：`pickSample` 内的选页逻辑抽成导出的 `pickFidelitySamples`；
新增 `inspectFidelityTemplateDetailed`（带 `hasNotesMaster` 与失败归因），
`inspectFidelityTemplate` 保持原 null 契约不破 R182 既有用例。

## 3. 实机验证反手抓到的真缺陷（切片④，已修）

实机上传 python-pptx 造的模板后，体检目录里第 2/3 页（真正的「标题 + 内容」版式页）只列出「标题框」。
解包核对部件 XML：

```
ppt/slideLayouts/slideLayout2.xml  <p:ph type="title"/> | <p:ph idx="1"/>        ← 版式里正文 ph 无 type
ppt/slides/slide2.xml              <p:ph type="title"/> | <p:ph idx="1"/>        ← 克隆到页面上仍无 type
BODY_RE hit: False
```

- **根因**：ECMA-376 中 `<p:ph>` 的 `type` 属性**缺省即 body**；python-pptx / PowerPoint 从版式克隆正文
  占位符时常常只写 `<p:ph idx="1"/>`。原 `BODY_PH_RE` 只认显式 `type="body|subTitle|obj"`。
- **影响面**（不只是新面板显示不准）：
  1. 体检目录把真内容页**少报能力**（用户看不到「正文框」）；
  2. `pickFidelitySamples` 的正文样张选页**退到「文本框数 ≥ 2」兜底口径**，
     当封面页是「标题框 + 一个文本框」时会**误选封面页当正文样张**，导出复用错版式。
- **修复**：新增 `BARE_PH_RE`（`type` 缺省的 ph）与 `hasBodyPlaceholder()`，
  `classifySlide`（能力探测）与 `injectSlideText`（文本注入定位正文形状）**同步改口径**，
  保持单一真源；显式 `type="body"` 的既有形态行为不变。
- **回归护栏用例**（判别性）：`pickFidelitySamples([封面(标题+文本框), 内容(裸 ph)])`
  → `{title:1, body:2}`；把内容页 `bodyPh` 置回 false → `{title:1, body:1}`（证明修复前确实错选封面页）。

## 4. 四门验证（目标项目目录）

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 类型 | `npx tsc -b` | exit **0**，零错误 |
| 单测 | `npx vitest run` | 112 files 全绿，**1328 passed / 2 skipped**（本轮开始基线 1295 → **+33**，0 失败） |
| Lint | `npx eslint <9 个触及文件>` | 8 个文件 **0 error / 0 warn**；`usePptQuote.ts` 4 error + 1 warn = 在途代码基线（见 §4.1），**零新增** |
| 构建 | `npx vite build` | exit **0**，built in 2.96s（仅基线既有 chunk>500kB 提示） |

定向：`templateFidelity / deckFidelityProbe / deckFidelityWiring` 3 files **58 passed**（切片③ 53 + 切片④ 5），首跑即绿。

测试增量构成：探测层 20（全新增文件）+ 引擎侧 9（详细体检 5、裸 ph 4）+ 接线哨兵 4 = **+33**。

### 4.1 eslint 基线甄别（在途代码既有 error 不算）

`usePptQuote.ts` 是用户未提交的在途文件（`git status` = `M`），补丁前基线 4 error + 1 warn：
`L227 / L1451 / L1526 / L2241`（`react-hooks/set-state-in-effect`）+ `L1864`（`exhaustive-deps`）。
补丁后同一批问题在 `L228 / L1464 / L1539 / L2254` + `L1877`，**规则名、代码位置、条数完全一致**，
行号偏移全部由本轮插入行造成（+1 / +13）→ 判定零新增。
新增/修改的其余 8 个文件全部 0 error 0 warn。

### 4.2 在途代码规避

`usePptQuote.ts` 的三处锚点（import 区、`deckTemplate` 声明附近、`exportPptx` 的 toast 之后与 deps 数组）
均落在 R169/R189 已有语义块内，未触碰用户其它在途改动；每处 `assert s.count(old) == 1` 命中后才替换。

## 5. 实机验证（dev:8000 + PocketBase:7000，团队账号登录）

三组判别性证据（同一条链路：上传模板 → 体检卡片 → 导出 → toast）：

| # | 模板 | 体检结论（面板原文） | 导出侧 |
| --- | --- | --- | --- |
| A | `r190_tpl_full.pptx`（含备注页版式，3 页标准版式） | **可复用模板版式** ·「整册 2 页都能复用模板版式，导出按公司模板的母版与版式呈现」；目录：第 2 页「标题与正文样式」标题框/正文框 | toast：**「PPT 已按公司模板母版/版式保真导出（纯文字页复用模板版式，讲稿写入演讲者备注）」** |
| B | `r190_tpl_nonotes.pptx`（剥掉备注页版式，阴性对照） | **本次仅套用主题** ·「模板里没有备注页版式，为防讲稿丢失整册按内置版式导出（导出仍会套用模板的配色与字体）」；归因「本册 2 页写了讲稿，而模板缺少备注页版式」；建议「在模板里保留备注页版式后重新上传；或先清空讲稿」 | toast：**「本次未按模板版式保真导出：本册 2 页写了讲稿，而模板缺少备注页版式；详情见「模板保真体检」」** + 成功导出提示 |
| C | **公司真实模板** `att5-ppt-template.potx`（1.74MB / 4 页） | **本次仅套用主题** ·「模板里找不到能填标题的页面，整册按内置版式导出（…）」；逐页目录：第 1 页「文本框 12 处 + 页面含图表、备注等专属内容，无法复用」、第 2 页「文本框 2 处 + 同上」、第 3 页「没有可填写文字的框」、第 4 页「页面含图表…」；建议「在模板里保留至少一页带标题框的版式，另存为标准 .pptx 后重新上传」 | toast：**「本次未按模板版式保真导出：模板内没有任何页面带标题框或可填写文字的文本框；详情见「模板保真体检」」** + 成功导出提示 |

C 组价值最大：公司当前那份 .potx 其实**根本不能做母版级保真**（4 页里 3 页带图表/备注关系、1 页无文本形状），
以前只能导出后看到一句笼统提示；现在事前就能看到「哪一页、为什么、怎么改」。

- 文案外泄检查（面板实际渲染文本）：无 `notesMaster / slideLayout / rels / pptx / zip / txBody / placeholder`，
  无阶段编号 `P\d / F\d\d`（单测哨兵 + 实机 innerText 双向钉死）。
- 无障碍：`section[aria-label]`、`aria-expanded` 开合可见（`take_snapshot` 里面板为
  `region "模板保真体检"` + `button "收起明细" expandable expanded`）。
- 控制台：全程 **0 error / 0 warn**（仅 vite debug 连接与 React DevTools 提示）。
- 现场还原：验证结束已清除上传的模板选择（`模板：…` 徽章消失、localStorage 不再存模板字节），
  用户本地状态回到验证前。
- 证据截图（随本报告归档在 `.loop/reports/`）：
  - `2026-10-06-r190-proof-full-template-panel.png`（A 组：可复用模板版式 + 展开目录）
  - `2026-10-06-r190-proof-bareph-fixed.png`（切片④修复后：第 2/3 页出现「正文框」）
  - `2026-10-06-r190-proof-company-potx.png`（C 组：公司 .potx 的逐页归因目录）

## 6. 裁定与安全边界

- 未推翻任何既有裁定：编造嫌疑未清零禁止导出的硬门禁仍「只报告不拦截」；`lint-debt-01` 残余不重构。
- 引擎隔离维持：docx/pptx 的 XML 操作只在 `templateFidelity`（引擎层）内；探测层只做只读体检、展示层只呈现。
- 零提示词改动 → 无 PROMPT_VERSION 变更、无快照需 `-u`。
- 零 collection / 零 pb_hooks：模板与体检结果仍是浏览器本地 state + localStorage（沿用 R189 既有存储）。
- 未执行 `git commit`（用户明令禁止）。

## 7. 下一轮候选

- `r177-followup-generation-parallel-resume`（P2，需先评估并发与额度风险）
- `quote-history-3-mining`（P3，独立立项：按医院等级/床位数/模块组合挖历史区间）
- `ui-redesign-phase3`（P3，视觉密度自然迭代）
- 可选小项：体检卡片在「模板原件未存到本地（超容量降级）」路径上补一条容量提示的具体阈值文案。
