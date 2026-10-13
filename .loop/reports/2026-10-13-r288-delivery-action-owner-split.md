# R288 · 交付前必办清单（按责任方）落地 + 归责/致命判据两侧同源

日期：2026-10-13　轮次：R288（round 287 → 288）　执行：Qoder 自主轮（用户已授权自主推进）
选题来源：backlog `bid-placeholder-owner-split`（P1）+ `r283-gate-owner-rules-overbroad`（P3）
类别：**A 类（功能/判据实现）**——未触碰任何提示词，故 B 类逐字对比流程本轮不适用；**零 collection、零 pb_hooks**；维持「只报告不拦截」裁定。

---

## 1. 为什么选它（选题依据）

- 用户点名的两项已无空间：`quote-history-01` 报价历史二期早在 R102/R131/R176 就分刀落地（结项沉淀 + 按等级/床位/模块推荐区间已在产），`prompt-fabscan-03` 残余「按章聚合回注」R287 已 closed。
- 按长期裁定「标书 > 方案 > PPT、优先实质项、零 AI 成本优先」，`bid-placeholder-owner-split` 是 backlog 里唯一的 **P1 交付风险项**，且纯本地判定、零模型费用。
- 该项与 `r283-gate-owner-rules-overbroad`（④ 待判定 41 条致命过多）是同一根因的两面：**归责判据只活在 CLI 脚本里，应用内一份都没有**。所以本轮一次性把「判据」与「界面」两件事并起来做，而不是先扩关键词再做界面。

## 2. 先巡检再动手（可复用检索结论）

| 已存在能力 | 位置 | 本轮如何复用 |
|---|---|---|
| 占位形态扫描（按章聚合、rule=`placeholder_leftover`） | `src/pages/BidWorkspace/placeholderLedger.ts` | 把 `PLACEHOLDER_RES` 由私有改为 **export**，必办清单复用同一把尺子，不另写一份占位正则 |
| 依据表无编号占位规整（防 BLOCKER 虚高） | `bidTypes.normalizeBasisPlaceholders` | 清单入口先跑它，**与导出链路同口径**（历史上两侧不一造成过虚高） |
| 本机勾销进度范式（按项目隔离） | `src/pages/BidWorkspace/submissionChecklist.ts`（`KEY_PREFIX="bid_checklist_"`） | 同范式新前缀 `bid_actions_`，读失败降级空表、写失败静默 |
| 交卷体检面板 | `SubmissionCheckPanel.tsx` 第 5/6 步 | 挂在「交卷前合规清单」卡之后，同一 `locked`（归档锁定）语义 |
| 复制/下载单一入口 | `@/lib/clipboard`、`@/lib/download` | 「复制清单 / 下载清单」直接走封装，toast 文案统一 |
| 归责四态 + `classifyOwner` | `scripts/bid-delivery-gate.mjs`（仅 4 条粗规则） | 扩为 12 条模式表，并**升格为与界面同源** |

## 3. 数据驱动，不靠推理（实测基线）

改前先跑真实库基线（只读 sqlite，零写入）：

```
node --experimental-sqlite scripts/bid-delivery-gate.mjs --json --no-write
19 项目 / 150 章 / 917,612 字 / BLOCKER 88 / WARN 170
① 商务决策 10 致命 + 0 警告
② 人工附材料 37 致命 + 52 警告
③ 系统可回取 0 致命 + 1 警告
④ 待人工判定 41 致命 + 117 警告   ← 病灶
```

把 41 条 ④ 致命**逐条导出人工核对**（.qoder/tmp/r288_gate_baseline.json 同源摘录），按核对结论反推关键词，而不是拍脑袋补词。核对中的关键判定：

- 「在 3 年基础上延长【待填写】年」「免费质保期【待填写】年」→ ① 评分项，必须商务拍板；
- 「项目编号【待填写】及佐证材料」「装订份数【待填写】份」→ ③ 采购文件里已有该事实，属注入链路缺陷，**不算人工材料**；
- 「人员证书编号【待填写】【请补充】」「排班表【待填写】」→ ② 人工附/补录；
- 剩余 1 条确实判不出 → 诚实留在 ④，不做假装归类。

## 4. 改了什么

### 4.1 新建 `src/pages/BidWorkspace/deliveryActionList.ts`（判据单一真源，约 315 行）

- `DELIVERY_OWNER_PATTERNS`（12 条）：**顺序即优先级 ①→③→②**，全部落空才进 ④。
  - ① 先判：承诺数值/时限/收费/质保延长——评标打分项，漏一项即丢分，不允许被材料类宽词抢走；
  - ③ 次判：判据窗口最窄（10 字）故先跑，既防误报，也避免「项目编号【待填写】及佐证材料」被放宽后的 ② 抢走（**R288 实测纠偏**：初版按 ①→②→③ 跑，真实语料里 ③ 的命中被 ② 吞了 2 条）；
  - ② 后判：词表最宽（前置窗口 40 字），记录/台账/模板/名单/材料/「（请填写…）」指令形态。
- `RE_PROMISE_VALUE` / `DELIVERY_FATAL_PATTERNS`：致命口径（导出供漂移守卫比对），补齐 `工作日|日历天|日历日|课时` 与「【待填写】个工作日」形态。
- 逐处 occurrence 取上下文窗口 **前 40 / 后 30**（与门禁同尺子）；`occurrencesOf` 克隆全局正则，避免 lastIndex 串味。
- **同形态跨章合并**：按去空白指纹合并，`occurrences` 累计、章名最多列 3 个——填一次处处对齐，按 R288 改前实测口径，全库命中 258 处（88 致命 + 170 警告；backlog 登记的 205 处为早期快照），同形态跨章合并后压成可读完的清单；上限 `MAX_ACTION_ITEMS=120`，超出按「另有 N 条同形态未展开」披露。
- 排序：①→④ → 同级致命优先 → 次数多优先。
- `renderDeliveryActionMarkdown` + `readDeliveryProgress/writeDeliveryProgress`（`bid_actions_<projectId>`，非浏览器环境降级不抛错）。

### 4.2 新建 `src/components/bid-workspace/DeliveryActionPanel.tsx`（248 行）

- 头部「还有 N 项等你拍板」胶囊 + 「致命待办 N」红徽 + 复制/下载；四组分卡（默认 8 条，超出可展开）；每项：致命/警告徽标、章名、N 处同形态徽标、原文摘录、**归责依据 tooltip**、「标记已拍板/已附」+「不适用」；
- 空态绿卡「占位层面已清零」；页脚固定「本卡只报不拦」；
- `key={`actions-${projectId}`}` 重挂载 + `useState(() => readDeliveryProgress(id))` 惰性初始化——规避 `react-hooks/set-state-in-effect`，eslint 零 error。

### 4.3 `scripts/bid-delivery-gate.mjs`：归责与致命两侧同源

- `OWNER_RULES`（4 条粗规则）→ `OWNER_LABEL` / `OWNER_ACTION` / `OWNER_PATTERNS`（12 条，与 src 逐字一致）/ `UNCLASSIFIED_WHY` / `FACT_SYSTEM_REFETCH_RULES`；
- `classifyOwner` 升级为三段式：**规则直判（③）→ 模式表顺序命中 → ④ 兜底**，绝不返回空导致统计漏项；
- `PLACEHOLDER_RULES` 两条致命字面量对齐 src 单一真源：
  - `promise-empty-value` 补 `工作日/日历天/日历日/课时` 与 `(?:个)` 前缀；**去掉 `份`**——「【待填写】份」是采购文件规定的装订份数，归 ③ 系统可回取更正确，不再一边算 ① 致命一边由文件回取；
  - `promise-sentence` 由 `承诺` 收紧为 `承诺(?!函)` 并加 `确保`——「承诺函【待填写】」是人工附材料（②），不是商务承诺数值。
- 顺带修 `no-useless-escape`（字符类内 `\[` → `[`），两侧同一字面量同批修改。

### 4.4 挂载与复用

- `SubmissionCheckPanel.tsx`：import + 挂载 `<DeliveryActionPanel …locked={isArchivedLocked} />`；
- `placeholderLedger.ts`：`PLACEHOLDER_RES` 加 export 与来源注释。

## 5. 数字：④ 待判定致命是否清零

| 归责 | 改前（致命+警告） | 改后（致命+警告） | 变化 |
|---|---|---|---|
| ① 商务决策 | 10 + 0 | **39 + 0** | 致命 +29 |
| ② 人工附材料 | 37 + 52 | **46 + 64** | 致命 +9 / 警告 +12 |
| ③ 系统可回取 | 0 + 1 | **2 + 2** | 链路缺陷显形 3 条 |
| ④ 待人工判定 | 41 + 117 | **1 + 104** | 致命 **−40**（41→1，收敛 97.6%） |
| 合计 | 88 + 170 | **88 + 170** | **总数不变** |

BLOCKER/WARN 总量一字未动（88/170）——本轮**只重新归责、没有放宽也没有收紧风险判据**，把「该谁办」说清楚了；致命判据虽补了单位，`份` 的移出与 `承诺函` 的豁免恰好抵消，说明真实语料里这两类形态本就极少。残余 1 条 ④ 致命是诚实保留（自动判不出，留给人）。

## 6. 四门验证（全绿）

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b` | **0 error**（首轮 5 处 TS2345：单测夹具 `owner` 被推成 `string`，已显式标注 `DeliveryActionItem[]`） |
| 单测 | `npx vitest run` | **195 files passed / 2269 passed + 2 skipped**（基线 194 files / 2227 passed + 2 skipped → **+1 file / +42 例**） |
| Lint | `npx eslint` 触及 5 文件 | **0 error 0 warning**（首轮 1 处 `no-useless-escape` 已两侧同批修掉） |
| 构建 | `npx vite build` | **成功 8.02s**（>500kB 分包警告为既有状况） |

注：任务书给的基线「630 passed」与仓库实际不符，以实测 R287 后基线 2227 passed / 2 skipped 为准并报增量。

新增 `deliveryActionList.test.ts`（42 例）覆盖：①②③④ 分流（用例正文全部取自真实库内摘录）、优先级抢占（① 抢在 ② 前、③ 抢在放宽后的 ② 前）、同形态跨章合并、依据表规整后不进清单、`GB/T 22239` 真漏填必须进清单、致命判据、排序、summarize 口径、markdown 渲染、node 环境 localStorage 降级。

**漂移守卫**（本轮的长效防线）：

```ts
// src 每条归责模式 / 每条致命判据，逐字出现在 scripts/bid-delivery-gate.mjs
const needle = `re: /${p.re.source}/${p.re.flags},`
expect(gateSrc, `门禁脚本缺少同源模式：${p.re.source}`).toContain(needle)
```

首跑即抓到两处真问题：(a) 断言漏了 `/` 分隔符（`RegExp.source` 不含定界符，12 条全对不上）；(b) 门禁致命表与界面致命表**确实不同源**（缺工作日/课时、承诺函未豁免）——守卫不是装饰，它立刻把两侧拉齐。

## 7. 实机验证（真实项目、原生无垫片）

dev server 用 `vibex-local/vite.local.config.ts`（含 `/__pb → 127.0.0.1:7000` 代理）起在 :8000，浏览器复用本机已有会话自动放行（未输入任何凭据，`fetch`/`XHR` 前后均为 `[native code]`）：

- **贵港项目**（中国农业银行贵港分行 · GXKLG202630843，10/10 章成稿）：面板标题「交付前必办清单（按责任方）」、红徽「致命待办 8」、胶囊「还有 6 项等你拍板」；① `待办 6 / 6 · 致命待办 6`、② `待办 5 / 5 · 致命待办 2`；
- **建阳区总医院**（34/45 章）：② 5、③ 1、④ 4，胶囊「商务决策项均已拍板」，页脚「还有 10 项未办结（其中致命 2 项）」；
- 勾销联动：① 首条点「标记已拍板」→ 胶囊 6→5、① 组 6/6→5/6、致命待办 6→5、面板 8→7、页脚 11→10，**五处同步**；「取消办结」精确还原，`localStorage.bid_actions_n6l21cok5x688tg` 回 `{}` 无残留；
- 复制清单 toast「清单已复制，可粘贴进邮件或评审纪要」正常；控制台 0 error / 0 warning。
- 截图：`.qoder/tmp/r288_native_overview.png`、`r288_native_checked.png`（另 `r288_panel_*.png` 为首轮验证留证）。

实机还抓到一处**代码看不出、看得出的口径瑕疵**：分组徽标「· 致命 N」用的是该组致命总数，勾掉后不減（与同排「待办 x / y」不同口径，读起来像没勾掉）。已改 `fatalPending` 并复验：清零后后缀消失（② 组变 `待办 3 / 5`），面板标题同步 8→6。

## 8. 维持的裁定与未做的事

- **只报告不拦截**：面板页脚与门禁退出码语义均未改动，导出仍不被硬拦。
- **零 AI 调用**：本轮全部本地正则判定，无任何 LLM 依赖，也就没有费用与降级路径要设计。
- **零 collection / 零 pb_hooks**：进度存 localStorage（与既有 checklist 同范式），未动数据模型。
- **lint-debt-01**：维持不重构，本轮不触碰。
- 未做（挂账不动）：`bid-l2-verbatim-compare` 剩余切片（漏答 76 条、编造 AI 复核需真实模型费用）、`delivery-p0-01-ocr-input`、`delivery-p1-01-hybrid-retrieval`（已登记冻结等用户拍板）、`r280-generror-visibility`、`r281-excel-money-column-no-numfmt`（触交付物版式红线需点头）。
- **本轮新登记**：`r288-back-to-top-overlaps-badge`（P3）——窄视口（694px）下右下角「回到顶部」浮钮会压住分组徽标尾部字符，实机截图时已通过滚动避让取到完整图，留待后续顺带修（避让 padding 或窄屏隐藏）。

## 9. 触及文件

新增：`src/pages/BidWorkspace/deliveryActionList.ts`、`src/pages/BidWorkspace/deliveryActionList.test.ts`、`src/components/bid-workspace/DeliveryActionPanel.tsx`
修改：`scripts/bid-delivery-gate.mjs`（归责三段式 + 致命字面量对齐）、`src/components/bid-workspace/SubmissionCheckPanel.tsx`（挂载）、`src/pages/BidWorkspace/placeholderLedger.ts`（导出复用）
补丁脚本：`d:\KFDXCX\MedPreSales\scripts\r288_apply.py`、`r288_fix_drift.py`、`r288_fix_types.py`、`r288_align_fatal.py`、`r288_fix_badge.py`（pathlib + utf-8 + 锚点唯一断言 + 原文件行尾回写；未 git commit）

## 10. 场景自测留档（AGENTS.md §1）

实操走查记录见 `tests/records/2026-10-13-r288-delivery-action-owner-split.md`——按「建阳区总医院（34/45 章）+ 中国农业银行贵港分行（10/10 章）」两个真实项目逐步操作，含预期/实际逐项对照表与 5 条发现及处置（自查 2、漂移守卫抓到 1、实机抓到 1、残余登记 1）。
