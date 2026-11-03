# PPT 生成链路重构 · 修改计划

> 依据用户 2026-10-30 需求（十项要求 + 六、七两大章节）。
> 原则：**先读代码再改，分四阶段落地，不一次性重写，不破坏历史数据读取。**

---

## 一、现状核查结论（逐条对应问题）

| # | 用户指出的问题 | 代码位置 | 现状核实 |
|---|---|---|---|
| 1 | role/intent/visualHint 未传递到逐页生成 | `pptQuoteTypes.ts: SlidePlan = { title, intent }` | ✅ **确认**：`normalizeSlidePlan` 只保留 title/intent，`role`/`kind`/`sourceRefs`/`estimatedContent` 全部丢弃 |
| 2 | buildDeckBatchMessages 用 bullets 作统一示例 | `pptQuoteTypes.ts:1143` | ✅ **确认**：`"layout":"bullets"` 写死在示例里 |
| 3 | 60% 硬配额 + 凑图表编数据 | `pptQuoteTypes.ts: layoutQuotaRules()` + `deckReshape.ts` | ✅ **确认**：配额强制 + reshape 自动改语义 |
| 4 | 依赖 parseJsonLoose、按批重试 | `deckBatchRecovery.ts: runBatchesWithRetry` | ⚠️ **部分**：有重试但单位是「批 8 页」不是页；无 Schema 校验 |
| 5 | reshapeTextHeavySlides 自动改语义 | `deckReshape.ts` 全文 | ✅ **确认**：自动转 chart/kpi/table/flow/arch/iconGrid，不问用户 |
| 6 | lint 不阻断导出 | `usePptQuote.ts:1032-1034` | ✅ **确认**：只有 `toast.warning`，无阻断 |
| 7 | 只提颜色字体就宣称「按模板生成」 | `deckTheme.ts: extractDeckTheme` | ✅ **确认**：只读 accent + major/minorFont |
| 8 | 无 Zod Schema | 全局 | ✅ **确认**：只有手写 `normalizeXxx` 函数 |

**额外确认的好消息**：
- `zod@4.4.3` 已安装，可直接用
- `templateFidelity.ts` 已能解析 `slideLayout` + 占位符 + 克隆样例页（可在此基础上做版式映射）
- `deckBatchRecovery.ts` 的重试骨架可复用（改成按页）

---

## 二、四阶段实施计划

### 阶段 1：Schema + 大纲传递 + 逐页生成（核心，先做）

**新建 `src/pages/PptQuote/deckSchema.ts`**（Zod Schema 单一真源）
- `SlideKindSchema`：cover/agenda/section/bullets/kpi/chart/table/flow/architecture/image/summary
- `SlideRoleSchema`：context/problem/question/answer/evidence/approach/plan/value/close
- `ChartDataSchema` / `TableDataSchema` / `FlowDataSchema` / `ArchitectureDataSchema`
- `SlideOutlineSchema`：id/title/role/intent/kind/sourceRefs/estimatedContent
- `SlideContentSchema`：逐页生成产物校验
- `DeckSchema` / `TemplateMappingSchema`
- 统一 `parseOrThrow` / `safeParse` 包装，错误信息带页码与字段路径

**改 `pptQuoteTypes.ts`**
- `SlidePlan` 扩展：`id, title, role, intent, kind, sourceRefs, estimatedContent`
- `normalizeSlidePlan` 用 Zod 校验，保留全部字段
- `buildDeckOutlineMessages`：要求输出完整字段（已部分有 role/visualHint，补齐 kind/sourceRefs/estimatedContent）
- `buildDeckBatchMessages`：**按 kind 给对应示例**，删除 bullets 统一示例
- `layoutQuotaRules()` → 删除，改为 `NO_FABRICATION_RULES`（无数据禁止造图表/量化承诺，输出【待补充：字段】）

**改 `usePptQuote.ts`**
- 逐页生成：默认 1 页/批，最多 2 页；单页失败只重试该页
- 校验失败 → 该页重试一次 → 仍失败留占位，不影响他页
- 大纲的 kind 强制传入逐页生成，模型输出若改 kind 则丢弃按其原 kind 渲染

**改 `deckReshape.ts`**
- 从「自动执行」改为「产出建议列表」，由用户点击应用
- 保留规则实现，但只作为 `suggestReshape(slides)` 返回建议

### 阶段 2：素材解析 + 检索 + sourceRefs

**新建 `src/pages/PptQuote/deckMaterials.ts`**
- 解析 DOCX/PDF/PPTX/XLSX/TXT → 分块（chunk）+ 建轻量倒排索引（复用现有 `parse` 能力）
- `MaterialChunk { id, text, ref, page?, para? }` / `ContentSource` / `VisualSource`
- `searchMaterialChunks(query, topK)` 按页检索相关片段
- 每页保存 `sourceRefs: { chunkId, excerpt }[]`，UI 可查看

**改生成提示词**：只塞相关片段（不塞全文）；缺数据输出【待补充：xxx】

### 阶段 3：公司模板真实版式映射

**新建 `src/pages/PptQuote/templateLayouts.ts`**
- 解析 pptx 的 `slideMasters` + `slideLayouts`：名称、缩略、占位符类型/位置
- `TemplateMapping`：kind → layoutId（可保存为公司默认）
- `buildDeckFromTemplate(deck, template, mapping)`：**按真实 layout 建页**（不是克隆样本页）

**改 `deckFidelityPlan` / `templateFidelity`**：接入映射，缺失版式明确提示而非静默降级

### 阶段 4：渲染质检 + 导出阻断 + 界面

**改 `deckLint.ts`**
- 新增严重级：`blank_page`、`placeholder_leftover`（XX医院/待补充）、`chart_data_mismatch`、`overflow`、`overlap`、`missing_template_layout`
- 严重问题 → `blocking: true`

**改 `usePptQuote.ts` 导出**：有 blocking 问题**不导出**，抛结构化错误列表

**新增渲染质检**：导出后 pptx → PDF → 逐页图 → 检测元素越界/溢出（可在 Node 脚本或浏览器侧做）

**界面**：NewDeckWizard 四步（基本信息 → 参考素材 → 公司模板 → 大纲确认）；编辑器加「素材来源 / 模板映射 / 页面检查」面板

---

## 三、本次会话的执行顺序

1. ✅ 现状核查（本文档）
2. 阶段 1 全部（Schema + 传递 + 逐页 + 去配额 + reshape 改建议）
3. 阶段 1 测试（Schema 校验、kind 传递、单页重试、无数据不造图）
4. 阶段 2（素材检索 + sourceRefs）
5. 阶段 3（模板版式映射）
6. 阶段 4（质检阻断 + 界面）
7. 全量门禁 + 验收测试

## 四、不做的事（明确边界）

- 不改报价、登录、权限、模型网关
- 不改历史 PPT 数据结构（只做向后兼容扩展）
- 不一次性重写 `usePptQuote.ts`（99KB，按点修改）
- 不承诺「所有像素无损转可编辑」（图片→SceneGraph 属后续大工程，本轮只做结构化通道）
