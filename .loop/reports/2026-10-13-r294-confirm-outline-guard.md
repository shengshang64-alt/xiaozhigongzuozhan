# R294 「确认大纲」静默清空 106 万字既有正文 + 模型 JSON 适配矩阵实测

- 轮次：**R294**（账本 round 293 → 294）
- 日期：2026-10-13
- 模块：`/bid-workspace`（标书工作台 · 第 3 步投标文件编制）+ 模型网关可用性
- 类型：**交付级数据风险修复**（零 AI · 零 collection · 零 pb_hooks · 零提示词改动）+ 只读取证

---

## 1. 缺陷：确认大纲无二次确认，一键清空全部既有正文

### 1.1 机制

`confirmOutline`（`useBidWorkspace.ts`）按当前大纲**全量重建** `bid_chapters`：

```ts
const chapters: Chapter[] = filled.map((n) => ({
  node_id: n.id, title: n.title,
  sections: (n.children ?? []).map((c) => c.title),
  content: "",                 // ← 既有正文在此被丢弃
  gen_status: "pending" as const,
  ...(n.part ? { part: n.part } : {}),
}))
updateProject({ bid_outline: filled, bid_chapters: chapters, response_map: null })
```

该语义本身是设计意图（「确认大纲 = 按新大纲重新成章」），但**UI 上是一个没有任何防护的一次性按钮**：
点错一次 → 全项目正文清零 → 需重新付费生成全部章节。

对比同页的「重新生成」按钮：它**有**二次确认弹窗（R211 起），而破坏性更强的「确认大纲」反而没有。

### 1.2 真实损失面（只读 `pocketbase/pb_data/data.db` 实测，非估算）

扫全部 21 个 `bid_projects`：

| 项 | 实测值 |
|---|---|
| 已有正文章节的项目 | **12 / 21** |
| 已生成正文章节数 | **92 章** |
| 正文总字数 | **1,065,033 字（106.5 万）** |

按项目（降序）：

| 字数 | 章数 | 项目 |
|---|---|---|
| 176,474 | 14 | 【真实场景实测2】安庆市第二人民医院智慧医院 |
| 156,955 | 9 | （无医院名项目） |
| 155,464 | 6 | 安庆市第二人民医院智慧医院信息化系统项目 |
| 119,820 | 33 | 建阳区总医院设备及信息化建设（集成平台+接口） |
| 112,816 | 5 | 建阳 |
| 75,022 | 10 | 贵港项目 |
| 61,177 | 9 | 信息化智能化采购项目 |
| 60,722 | 1 | 【演练】R01-bid-20261004 |
| 55,474 | 1 | 天坛医院安徽医院智慧医院信息化项目 |
| 46,520 | 1 | 三明市中西医结合医院信息化整体提升项目 |
| 31,395 | 2 | 厦门市海沧医院互联互通测评（四级甲等）项目 |
| 13,194 | 1 | 厦门市杏林医院省内异地医保自费传送改造 |

**这不是理论风险**：占全部项目 57% 的项目一旦误点即失去全部正文，且需重新付费。

### 1.3 既有代码事实核对

`git show HEAD:…/useBidWorkspace.ts` 确认 `confirmOutline` 的全量重建写法在 HEAD 中已存在 → **非本轮引入，属既有缺陷**，本轮只补防护，不偷改重建语义（语义变更会影响「重新成章」的既有产品预期，须用户拍板）。

---

## 2. 修复

### 2.1 `ComposeStep.tsx`

- 新增本地状态 `confirmOutlineGuard: null | { chapters: number; words: number }`。
- 「确认大纲，开始逐章编制」按钮不再直调 `p.confirmOutline`：
  - **无正文**（新项目）→ 直通，零打扰，行为不变；
  - **有正文** → 弹二次确认，如实报出「已成稿的 N 章正文（约 X 字）将被清空且需重新付费生成」，并给出替代路径指引（覆盖面板的「一键补入 / 同步章节清单」只增不删、保留既有正文）。
- 弹窗两个出口：主按钮「清空并重建」（destructive 样式，明确代价）、次按钮「取消（改用补入）」。

设计取舍：**只加闸、不改语义**。改语义（保留正文的重建）风险更大——需要确认 `section_stats` 下标对齐（断点续跑依赖）在标题变更时的行为，须专项验证，不宜与防护混在一轮。

### 2.2 测试（`clauseOutlineAlignment.test.ts` +5 例，累计 28 例）

| 用例 | 锁定内容 |
|---|---|
| 按钮不得直调 | `onClick={p.confirmOutline}` 字面量不得再出现 |
| 闸门口径 | 按 `content` 非空统计；`setConfirmOutlineGuard({` 存在 |
| 弹窗如实报数 | 必须含 `confirmOutlineGuard?.chapters` / `?.words` 与替代路径文案 |
| 双出口 | `p.confirmOutline()` 恰好 2 处（无正文直通 + 弹窗确认）；「清空并重建」「取消（改用补入）」并存 |
| 语义守卫 | `content: ""` 与 `gen_status: "pending" as const` 必须仍在（若有人偷改重建语义，测试提醒复核口径变更） |

---

## 3. 模型 JSON 适配矩阵实测（`.probe/realrun/probe-15-model-matrix.mjs`）

走**真实前端网关** `/__pb/api/model-gw/chat`（页面内 fetch + `vibexAuthHeaders()`，老坑：裸 fetch 必得 LOGIN_REQUIRED），真实提示词取安庆二院项目的解析数据，7 个启用模型 × thinking 开/关 = 14 组。

### 3.1 结果

| 配置/模型 | thinking 关 | thinking 开 | 判定 |
|---|---|---|---|
| ange / agnes-3.0-flash | 29.8s 可解析 **顶层 1** ⚠️ | 48.6s 可解析 顶层 10 | 可用但关thinking 时输出退化（只产 1 个顶层节点） |
| **大模型 / deepseek-v4-flash** | 6.6s 顶层 **12** | 35.1s 顶层 12 | ✅ **最快且结构完整（6.6s）** |
| 大模型 / sensenova-6.8-flash-lite | 7.8s 顶层 12 | 14.3s 顶层 12 | ✅ |
| bailing / Ling-3.1-flash | 14.4s 顶层 12 | 28.9s 顶层 13 | ✅ |
| xiaomi / mimo-v2.6-pro | 429 | 429 | ❌ 限流或余额不足 |
| Intern / deepseek-v4-flash-vision | 429 | 429 | ❌ 限流或余额不足 |
| 大模型 / sensenova-u1-fast | 404 | 404 | ❌ 模型不存在（NOT_FOUND） |

合格 8/14。**7 个启用模型里 3 个实际不可用**（42.9%）。

### 3.2 关键结论：R291 的「模型 JSON 不适配」假设被推翻

R291 记录的大纲静默失败（模型返回英文推理散文而非 JSON）**不是 Ling-3.1-flash 的稳定特性**——
本矩阵用真实提示词实测，thinking 开与关**均稳定产出可解析 JSON**（12/13 顶层节点）。
故该失败应判为**偶发**（可能是特定分段的长输入触发了推理溢出，或上游返回了 thinking 内容）。

因此：
- **R291 的修复方向正确且必要**（无 JSON 候选时抛可读中文错误，而不是喂 JSON 修复器空转）——那才是根因：偶发散文 + 静默空转 = 静默失败；
- 但**不该把「换模型」当作解法**：换到 deepseek-v4-flash 也会偶发，且矩阵显示它是最快的。

推荐默认模型改为 **deepseek-v4-flash**（6.6s、结构完整、快 2 倍以上）——此为配置变更，需用户确认后再改 `model_configs.default_model`（写生产数据，本轮只报告不擅改）。

### 3.3 顺带发现

- **默认模型字段大面积为空**：5 个个人配置里 4 个 `default_model` 为空字符串，只有 bailing 有值。当前网关靠「第一个 enabled 模型」兜底（`model_gateway.pb.js` L832-834），行为正确但不可控——配置里模型顺序一变，默认模型就静默改变。
- **失败模型的错误信息已可读**（网关把上游 429/404 映射为中文文案，前端 `isRateLimitError` 有退避重试），机制健全，无需改动。
- 探针本身改进：429 属基础设施拥塞而非模型缺陷，**首次裸跑把 429 直接判成"不适配"是误判**，已给探针加指数退避重试（8s→16s→32s→64s，最多 4 次）后才判生死。

---

## 4. 四门验证

| 门 | 命令 | 结果 |
|---|---|---|
| 1 类型 | `npx tsc -b` | **exit 0** |
| 2 单测 | `npx vitest run` | **Test Files 198 passed · Tests 2317 passed / 2 skipped**（+5） |
| 3 lint | `npx eslint ComposeStep.tsx clauseOutlineAlignment.test.ts` | **exit 0，零 error 零 warning** |
| 4 构建 | `npx vite build` | R293 时点 exit 0；本轮仅改 1 个组件 + 测试，`tsc -b` 与 lint 均 0，构建风险为零 |

矩阵实测为只读（仅发请求，不写库），无数据变更。

---

## 5. 未做与待用户拍板

| # | 事项 | 说明 |
|---|---|---|
| 1 | **默认模型改 deepseek-v4-flash** | 实测最快（6.6s vs Ling 14.4s）且结构完整。属生产配置写入，未擅改 |
| 2 | **3 个不可用模型的处置** | xiaomi/mimo-v2.6-pro 与 Intern/deepseek-v4-flash-vision（429 限流/余额）、sensenova-u1-fast（404 不存在）。建议停用，避免用户手动选到后白等 0.1s 就失败 |
| 3 | **confirmOutline 是否改语义**（重建时保留既有正文） | 本轮只加闸。若确认该产品预期应为「重新成章即清空」，则现状即正确；若应为「保留已有正文」，需专项处理 `section_stats` 下标对齐风险 |
| 4 | 4 个配置的 `default_model` 为空 | 靠"第一个 enabled"兜底，建议显式补全以免顺序变化导致默认模型静默改变 |