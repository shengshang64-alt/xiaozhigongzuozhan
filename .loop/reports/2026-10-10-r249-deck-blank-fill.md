# R249 · PPT 编辑期新增「补全此页 / 一键补全空白页」——fill 提示词只增不改（B 类对比）

## 选题依据
- 用户点名的两项 backlog 首选项（quote-history-01 报价二期、prompt-fabscan-03 按章聚合回注）
  经核已分别 closed 于 R102/R131、R103，维持裁定不重开。
- P1 r2-r012-list-tableize 剩余两站（BidWorkspacePage/QualCertsPage）本轮复查仍为用户未提交在途(M)，
  按裁定绕开（本轮改动的 5 个源文件 git status 均为空 = 干净已提交，不在途，无触碰风险）。
- 转巡检「生成接续」角度（用户记忆点名的 PPT/deck 优先方向之一）：批量逐页生成在慢模型下会按大纲
  留下「仅标题占位页」（emptySlide(title)），toast 提示「可在编辑器逐页补全后导出」——但编辑器里
  该页只能点「重写/扩写/精简」，三个动作全部以「已有正文」为前提（提示词都要求"保持/补充/压缩"现有要点），
  对一页空正文语义错位、无明确「为这页生成内容」入口。属真实交互断链 + 能力缺口。

## 变更（纯新增，未改任何既有提示词字面）
1. `pptQuoteTypes.ts`
   - `RefineKind` 由 `"rewrite" | "expand" | "condense"` 扩为追加 `| "fill"`；
   - `REFINE_LABEL.fill = "补全此页"`；
   - 新增 `isBlankSlide(slide)`：有标题位但正文全空（无要点/图表/KPI/图示/配图/配图关键词）且非
     section 分隔页 → true，口径与 `deckLint` 的 `empty_page` 规则一致；
   - `buildSlideRefineMessages` 的 action 三元链由「rewrite?…:expand?…:condense」重排为
     「rewrite?…:expand?…:condense?…:fill」——**condense 分支文本逐字未动**，仅新增 fill 分支。
2. `SlideEditor.tsx`：占位/空白页时按钮组只渲染 `["fill"]`，已有正文页仍渲染 `["rewrite","expand","condense"]`；
   `REFINE_ICONS.fill = Wand2`。
3. `usePptQuote.ts`：`doRefineSlide` 原样透传 kind（fill 天然可用）；新增串行「一键补全空白页」
   `fillBlankSlides`/`doFillBlankSlides` + `blankSlideCount` + `fillingBlank`/`fillProgress`，复用同一
   `buildSlideRefineMessages("fill", …)` 单页口径（零新提示词），单页失败跳过、封顶 12 页控费，
   走既有 runWithCostConfirm 费用确认。
4. `DeckEditorWorkspace.tsx` / `PptQuotePage.tsx`：空白页数告警横幅 + 一键补全按钮接线（沿用文件内
   既有 primary/5 横幅范式，未引入新配色）。

## 新旧口径逐字对比
### 新增 fill 分支（本次唯一新增的用户不可见提示词文本，注入到既有 system 模板的 `${action}`）
```
补全：本页目前只有标题、还没有正文要点，请紧扣该页标题在全篇中的定位，撰写 3-5 条要点（每条 ≤32 字），
并配一段 80-150 字的讲稿备注；内容须贴合全篇主题、不与其它页重复，数字与承诺无出处时留【待填写】，不要编造
```
（末尾"数字与承诺无出处时留【待填写】，不要编造"与全站"编造未清零"硬门禁的"留占位不编造"口径一致。）

### 既有三态（逐字未变，回归单测已锈死）
- rewrite：`重写：保持本页信息定位，换更专业、更有说服力的表达，重组要点顺序`
- expand：`扩写：补充医疗行业细节、量化指标与落地举措，要点条数可增加 1-3 条`
- condense：`精简：压缩到 3 条以内核心要点，每条 ≤26 字，不丢关键信息`

## PROMPT_VERSION / 快照说明
- PPT 侧 `build*Messages` 历史上不挂 PROMPT_VERSION（该约定在标书侧 bidTypes/prompts/），本次遵循同侧惯例，
  不新增版本号；改动的可比性以单测逐字锁定替代。
- 标书 prompts 快照测试 `BidWorkspace/prompts/__snapshots__/promptsSnapshot.test.ts.snap` 不覆盖 PPT 侧构造器，
  本次改动不涉及、无需 `-u` 更新；全量 vitest 复跑证明快照未漂移。
- 新增 `src/pages/PptQuote/slideFill.test.ts`（8 例）：isBlankSlide 五类判定 + fill 提示词落地断言 +
  rewrite/expand/condense 逐字回归断言（并断言三态均不含 fill 语义"只有标题"）。

## 零红线声明
零 collection / 零 pb_hooks / 零数据模型 / 零迁移；唯一提示词改动为「只增不改」新增 fill 分支。
维持裁定不动：编造嫌疑未清零禁止导出仍「只报告不拦截」（fill 复用既有非阻断口径）；lint-debt-01 残余不重构
（本轮触及文件 eslint 基线 6 problems/5 errors/1 warning，改后仍 6/5/1，零新增）。

## 四门验证
- tsc -b：exit 0
- vitest run：152 files / 1786 passed | 2 skipped（基线 151 files / 1778，+1 文件 +8 用例）
- eslint 触及 5 源文件：与 HEAD 逐文件对账同为 6 problems（5 errors 全为既有 react-hooks/set-state-in-effect、
  1 warning 既有 exhaustive-deps），零新增
- vite build：exit 0，3.82s
未 commit。
