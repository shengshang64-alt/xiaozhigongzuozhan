# R167 标书主链路：公司优质素材库（五类标准件）+ 编制「0 成稿」空回复降级修复

## 0. 选题依据
用户重定向后续重点为「标书 / 方案 / PPT 三条主链路全流程测试与能力补全」，并明确优先级 标书 > 方案 > PPT，
其中标书诉求为「按公司比较好的标书梳理材料（设计方案/项目背景分析/实施方案/培训方案/测试方案），
再根据招标要求合理调整即可」。账本 R166 已登记对应 P1 backlog `r167-bid-material-library`。本轮即闭环该项，
并在真实全流程走查中发现并修复编制链路的「0 成稿」真缺陷。

## 1. A：标书全流程浏览器走查（建医院→建项目→解析→大纲→编制→检查→评标→归档）
- 环境：localhost:8000/bid-workspace，存量 2 项目（贵港 8/10 章、【演练】R01-bid-20261004 已解析·待编制）。
- 走查确认素材库面板已挂载：进入第 3 步显示「公司优质素材库（标准件）0/5 类有内容」（空库诚实占位，非报错）。
- 「AI 生成大纲」一次实测约 115s 返回（POST /__pb/api/model-gw/chat → 200），大纲 30 叶、需求覆盖 60/60。
- 附带发现：进入第 3 步会把 kb_docs 全量预载到 36 页（首屏性能可优化点，记入后续巡检，未在本轮动）。

### 「测试止步于投标文件编制前」的三层归因（回答用户问题）
1. 门禁（设计如此）：`bidTypes.stepEntryMissing` 规定 step3 需 `parse_report`、step4/5 需 ≥1 章正文——
   前置解析没跑完则编制被 toast 拦，是主动定位逻辑而非故障。
2. 性能：编制是最重最慢一步（大纲单次 ~115s、正文逐章/逐小节串行，全量 1hr 级），走查易判超时提前收工。
3. 真缺陷（本轮修复）：全量串行正文实测发 5× chat + 7× PATCH 但「0/2 章成稿」，见第 3 节。

## 2. B：公司优质素材库（五类标准件）实现
### 数据结构（零 collection / 零 AI 归类）
- 单一真源 `src/pages/BidWorkspace/materialLibrary.ts`。内容编进既有字段 `ref_materials_text`，
  以「【素材库·<label>】」标记段区分五类；未标记文本归 `other`。
- canonical 编码可逆约定：**other（自由资料）前置**（因「标记段延伸到下一标记」解析模型，other 置尾会被末段吸收）；
  `splitBlocks` 按空行切块。`parseMaterialLibrary` ↔ `renderMaterialLibrary` 双向往返无损（单测锁定）。
- 归类纯本地关键词命中（design→background→implementation→training→testing 顺序首命中），零 LLM 调用。
- `COMPANY_DEFAULTS` 预置五类长文本标准件，占位统一「〔按本项目填写：…〕」，`isCompanyDefaultBody` 识别默认体避免误当用户内容。
- 注入协议：`composeRefMaterials(baselineMark, baseline, fragments)` 拼接、`extractBaselineSegment`/`extractFragmentSegment` 拆分，
  以 `BASELINE_PREFIX_MARK`、`BASELINE_SEGMENT_SEP="\n\n\n"` 为界。

### B 类提示词变更（bidChapter / bidSection：PROMPT_VERSION 2 -> 3）
「取公司较优范式定结构 → 再按招标条款/评分办法/全局事实定向调整」两段接入逐章与逐小节生成。
**向后兼容：无素材标记时 new 变量全为空串，团队资料段回落 `opts.refMaterials` 原值，输出与 v2 逐字一致。**

#### 逐字对比——规则句（章级 bidChapter；节级 bidSection 同口径，措辞「本章/本小节」相应替换）
- 旧（v2）：无此规则句。
- 新（v3，`libraryBaseline` 非空时追加一条 rule）：
  - 命中类别时：
    `N. 下面【公司优质素材库·${libraryKindLabel}标准件】是公司较优标书中该主题的写法范式，不是本项目事实：本章以它的结构与写法要求为基线，再按招标文件的条款、评分办法与【${factsLabel}】逐项定向调整（篇幅与取舍服从招标要求）；禁止整段照抄，禁止沿用其中与招标不符、或仍留着〔按本项目填写〕占位的人名、业绩与承诺；`
  - 通用（无类别标签）时：
    `N. 下面【公司优质素材库标准件】是公司较优标书的写法范式，不是本项目事实：本章以它的结构与写法要求为基线，再按招标文件与【${factsLabel}】逐项定向调整；禁止整段照抄，禁止沿用其中与招标不符、或仍留着〔按本项目填写〕占位的人名、业绩与承诺；`

#### 逐字对比——taskUser 素材段（保 stableUser 跨章 identical 前缀缓存，章/节差异内容一律进 taskUser）
- 旧（v2，团队写作资料段）：`【团队写作资料（自有人员/案例/资质/制度，可引用其事实与口径，注明来自自有资料，禁止整段照抄）】\n${opts.refMaterials}`
- 新（v3）：
  1) 新增基线段（`libraryBaseline` 非空时）：
     `【公司优质素材库·${libraryKindLabel || "通用"}标准件（公司较优标书该主题的结构与写法基线，须按招标要求与全局事实改写，禁止照抄、禁止沿用占位）】\n${libraryBaseline}`
  2) 团队写作资料段的变量由 `opts.refMaterials` 改为 `freeMaterialsText`
     （`freeMaterialsText = libraryBaseline ? extractFragmentSegment(...) : opts.refMaterials`，
     即有基线时只渲染基线之外的自由检索段，避免同一内容既进基线又进团队段造成重复）。

- 快照测试：`materialLibrary.test.ts` 断言 `PROMPT_VERSION === 3`，并对 buildBidChapterMessages/buildBidSectionMessages
  做「运行时非回流哨兵」+ 基线/自由段拆分用例；相关快照 -u 更新。

### 面板与接线
- 新建 `src/components/bid-workspace/MaterialLibraryPanel.tsx`：五类标准件编辑面板，切项目在渲染期 reset 编辑态
  （React「随 props 变化重置 state」范式，规避 set-state-in-effect）；空库诚实显示「0/5 类有内容」。
- `BidWorkspacePage.tsx` / `ComposeStep.tsx` / `useBidWorkspace.ts` 透传 activeProject + refMaterialsDraft，
  生成侧在章/节调用前 `composeRefMaterials` 注入基线段。

## 3. F1：编制「0 成稿」真缺陷根因与修复
### 根因（代码级）
`chatViaGateway`（modelGateway.ts:295）在 HTTP 200 但 `content` 为空时返回 `{ok:true,status:"success",text:""}`。
`llmGenerate`（useBidWorkspace.ts:384 原口径）对 `!r.text` 直接抛错；批量逐章的空产出被标 `failed` 后，
收口前 R124 自动重试**以同模型同参再发一次**（useBidWorkspace.ts:5569）→ 再次空返回 → 「重试后仍空产出」→ 0 成稿。
触发条件：所选为推理型/vision 模型（deepseek-v4-flash-vision），把 `max_tokens` 耗在「思考」上导致 content 空
（网关 §5.2/T13 已记录同类问题，但正文生成链路此前未享受降级）。

### 修复（唯一收敛点，最小面）
在 `llmGenerate` 内，对「成功但空回复」做一次**关闭思考的降级重试**：
```
if (!r.needsLogin && r.ok && r.status === "success" && !r.text?.trim() && !opts?.disableThinking) {
  const retry = await chatViaGateway({ ...同参, disableThinking: true })
  if (retry.needsLogin) throw new AuthRequiredError("请求需要重新验证，请稍后重试")
  if (retry.ok && retry.status === "success" && retry.text?.trim()) return retry.text
  r = retry
}
```
- `const r` 改 `let r` 以承接重试结果；仍空则维持既有抛错口径与计费不变。
- 显式已关思考的调用（解析类，`opts.disableThinking` 为真）不重复重试，避免额外计费。
- 因所有生成路径（逐章/小节/续写/精调/大纲）都经 `llmGenerate`，此单点降级对整链路生效；
  批量收口的 R124 重试也随之受益（其内部再走 llmGenerate 会自降级）。

## 4. 四门验证（目标项目目录）
- `npx tsc -b`：0 error。
- `npx vitest run`：99 files，**1112 passed | 2 skipped**（无回归；含素材库 +26 用例）。
- `npx eslint src/pages/BidWorkspace/useBidWorkspace.ts`：5 error 全部为在途既有（981/1045/1131/2657 set-state-in-effect、7291 未用赋值，
  由本轮 +13 行整体下移所致），本轮触及区（365-403）**零新增 error**。
- `npx vite build`：成功（built in 4.30s，仅既有 chunk-size 警告）。

## 5. 触及文件
- 新增：src/pages/BidWorkspace/materialLibrary.ts、materialLibrary.test.ts、
  src/components/bid-workspace/MaterialLibraryPanel.tsx
- 修改：src/pages/BidWorkspace/prompts/bidChapter.ts、prompts/bidSection.ts（B类 v3）、
  src/pages/BidWorkspace/useBidWorkspace.ts（素材注入接线 + llmGenerate 空回复降级）、
  src/pages/BidWorkspace/BidWorkspacePage.tsx、src/components/bid-workspace/ComposeStep.tsx
- 补丁脚本：scripts/r167_bid_empty_reply_degrade.py（llmGenerate 降级重试）等
