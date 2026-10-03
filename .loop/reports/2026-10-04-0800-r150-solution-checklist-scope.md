# R150 · 专项轮 D · 场景 R01 三明 · 方案编制阶段 —— 关联清单快照时序缺陷修复（F-S1/S2/S3）

- 日期：2026-10-04 08:00　轮次：150（150 mod 3 = 0 → 主攻 方案编制）
- 场景：R01 三明市中西医结合医院 · **solution 阶段**（A1-A6 完成；A7-A9 因 T3 预算到顶留待下一方案轮）
- 走查方式：**浏览器实机**（agent-browser）；费用：T3 真实调用确认 1 次成功（另 2 次存疑，见 honest_notes），配图不涉及

## 本轮做了什么

用真实三明招标的「建设范围」逐字摘录建了一份 66 条的建设清单，在方案向导里走完「选类型 → 关联清单 → 填项目信息 → AI 生成大纲」全流程。发现**关联清单的数据到不了大纲**（时序缺陷：快照在确认后才写，而生成本该用它），修复后大纲评级目标与招标逐字一致、建设范围按九大类集群落章。确认大纲后方案已落库，编辑器可继续编制。

## 为什么做这个

场景卡 R01 点名：「以建设清单为输入 → 生成方案大纲 → 核验大纲是否逐条覆盖清单条目（R139 类问题高发场景）」。实测确实复发——但根因不在大纲提示词，而在**数据通道时序**：清单快照 `ref_checklist_snapshot` 要到「确认大纲」（A6）才写进方案记录，而「生成大纲」（A5）的 prompt 读的是向导态 `formInfo.ref_checklist_snapshot`——从未被赋值。也就是说**大纲生成从来见不到关联清单**，所谓"AI 大纲会按清单条目覆盖分系统章节"在源头就不成立。

## 三层判定

### L1 功能（A1-A6）——通过（修复后）

- 向导三步、类型卡、清单下拉（Radix Select 需原生点击）、医院名称自动预填 ✓（对照清单 hospital 字段）
- A5 生成大纲：T3 调用成功，1694 字符 / 175 个标题节点、11 章结构，树编辑器可编辑（单字输入粒度）
- A6 确认进编制：方案落库 `g267q0imbmt27q5`，编辑器/导出面板正常，截图 `_shots/R150/02-editor.png`

### L2 内容（大纲 vs 清单/招标）——有条件通过，缺口已挂账

基准件：66 条系统组清单（逐字摘自招标 2.3 建设范围，原件 `20260727…招标文件（精简版）.docx`，指纹 `0ec7f6c0`）：

| 维度 | 结果 |
|---|---|
| 评级目标 | **逐字正确**：差距分析章=「电子病历五级差距 / 互联互通五乙差距 / 智慧服务三级差距」，收尾=「评级目标达成预测」三节；快照 rating_targets = emr:5 / hpc:5B / ss:3 ✓ |
| 逐字口径（系统组名上大纲） | 23/66 = 34.8%——受 prompt「章数量 8-12」结构约束，66 个系统组名不可能逐条成节 |
| 集群语义口径 | ≈42/66 ≈ 94%：财务/绩效/预算/资产→「绩效与财务内控+运营管理系统群」，体检/康复→「体检与康复系统」，AI 类→「AI 应用系统群」等，无一串台 |
| **真实缺口** | 「评级咨询服务」类 3 条服务类条目（智慧医疗五级/智慧服务三级/互联互通五乙评级咨询）未在大纲成节——大纲把评级当「目标/预测」处理，没把它当「采购的服务内容」回应 |
| 编造 | 大纲标题层零编造；投资估算章保留结构未填数（符合防编造占位规则，招标预算为 XXXX 占位） |

### L3 实战（三问，仅就大纲层）

售前：这份大纲敢拿去写方案——骨架专业、评级口径一字不错；评标：不会被挑出事实错误；信息科：像正经厂家规划。完整 L3 待正文生成后（下一方案轮）。

## 根因分析与修复（三个缺陷，均已修）

| # | 缺陷 | 根因（复算证据） | 最小修复 |
|---|---|---|---|
| F-S1 (A) | A5 大纲 prompt 拿不到关联清单 | `ref_checklist_snapshot` 仅在 `confirmOutline`（A6）落库时写入；A5 的 `buildOutlineMessages(formInfo)` 读 `formInfo.ref_checklist_snapshot` 恒为 undefined（useSolutionStudio.ts 代码直读坐实） | `applyChecklistPrefill` 选清单时即写 `ref_checklist_id` + `ref_checklist_snapshot` 入 formInfo |
| F-S2 (B) | 未匹配产品的真实清单整段丢失 | `snapshotFromChecklist` 只收 `source=company/external` 且按 `product_name` 去重；真实招标来源清单无产品字典 → company/external 双空 → scope block 变成「承建系统：无」 | 快照新增 `customer_requirements[]`（无 product_name 条目的 module_name+module_func）；`checklistScopeBlock` 渲染编号需求条目并要求逐条覆盖 |
| F-S3 (B) | 「从清单带入 1 个系统」假计数 | `new Set(items.map(l=>l.product_name)).size` 把 undefined 也算一个（66 条全无 product_name → Set{undefined}.size=1）；`applyChecklistPrefill` 还把 undefined 混进 systems | 两处都过滤空值；修复后实机显示「带入 **0 个**系统」（诚实） |

改动文件：`solutionTypes.ts`（快照类型+scope block）、`checklistTypes.ts`（快照收集）、`useSolutionStudio.ts`（预填时序+过滤）、`NewSolutionWizard.tsx`（计数）、`systemsFromChecklist.test.ts`（+5 用例）。

## 端到端证据

- 落库方案 `g267q0imbmt27q5` 的 `hospital_info.ref_checklist_snapshot.customer_requirements` = **66 条完整需求**（首条「一体化医院信息管理系统（门急诊挂号系统…）」、末条「系统集成实施与驻场运维服务三年」），rating_targets 三项正确——修复前该字段通道不存在
- 大纲 175 个标题节点全文存 `_eval`（见本轮 coverage66.json 与 titles.txt 于 Temp 归档），比对脚本逐条核验

## 验证与回归

| 门禁 | 结果 |
|---|---|
| `npx tsc -b` | exit 0 |
| `npx vitest run` | 94 files · **995 passed \| 2 skipped**（R149 基线 990+5=新增用例，零回退） |
| `npx eslint`（4 触及文件 HEAD 对照） | HEAD=14 problems vs 当前=14 problems（13e+1w，全为既有 react-hooks 残留），**零新增** |
| `npx vite build` | 成功 3.49s |
| R6（方案生成） | 实机真跑：大纲生成→确认→落库→编辑器，全链路通（本轮改动模块的真实路径验证） |
| R1-R5/R7-R10 | 未触及（改动限于 solution-studio 素材通道），按 §9 裁剪不强制 |

## 你怎么自己验证

1. 打开 方案工作室 → **建设清单** 页签 → 能看到「【演练】R01-solution-20261004 建设清单（摘自招标2.3建设范围）」（66 条，三明市中西医结合医院）
2. 方案编制 → 新建方案 → 选「规划方案」→ 关联建设清单下拉里选它 → 下一步：医院名称应自动填「三明市中西医结合医院」；若选一份**没有产品匹配**的清单，「带入 N 个系统」显示 0（真实数，不再虚报 1）
3. 填一两个系统标签 → 生成方案大纲：大纲里应出现「电子病历五级差距 / 互联互通五乙差距 / 智慧服务三级差距」和九大类集群章节——关联清单的内容真的进了大纲

## 遗留与新发现

- `r150-outline-consulting-gap`（B/P2）：大纲对「评级咨询服务」类服务条目无显式承载；且 8-12 章约束下逐字覆盖天花板 ~35%，建议：分系统集群章节正文生成时强制引用 snapshot.customer_requirements 对应条目（通道本轮已打通），或在向导提供「服务类条目单独成节」开关
- 方案编制 A7（正文）/A8（五维自检）/A9（导出）与 串联链① leg3（方案转 PPT）→ 下一方案轮（R153）续跑，演练数据保留
- 素材侧：本批 F01'（建设清单 1.0）不可回取；同一清单家族 1.0/1.3 赛道标签不一致（集成平台 vs 信创改造），素材侧噪声，反馈资料

## 需要你决定的事

无。

## honest_notes（必须读）

1. **诚实更正（本轮中途误诊）**：我一度依据 `innerText` 不含「三明市中西医结合医院」判定"页面重载、状态被清、T3 调用丢失"——经 performance 导航记录（文档 15 分钟未变、type=navigate）与 input.value 直读复核，**状态从未丢失，是我取证手段错误**（innerText 本就不含输入框值）。此误诊导致我取消了第一次已成功生成的大纲（自弃产物）。
2. **T3 计数（保守口径 3 次触顶）**：第 1 次生成成功但我误取消（费用已花）；第 2 次确认点击后无任何生成迹象（是否到达供应商无法本地核实——系统无本地用量表）；第 3 次成功（本轮产物）。按上限 3 计，本轮**不再发起任何真实生成**，A7-A9 与 PPT 链路顺延。
3. 演练数据**保留未删**（与 R142/R149 不同，本轮阶段未完待续）：清单 `e7qjtugzr40arey`、方案 `g267q0imbmt27q5`，均带【演练】前缀可识别，清理清单已记 scenario-state。

---

```json
{"round": 150, "topic": "R01三明·方案编制阶段：关联清单快照时序缺陷修复（A5大纲prompt拿不到清单）+ 未匹配清单需求通道", "module": "/solution-studio", "work_class": "B",
 "problems_found": ["F-S1 快照仅A6落库,A5大纲恒看不到清单(A,已修)", "F-S2 未匹配产品清单在快照链整段丢失(B,已修)", "F-S3 undefined混入systems+带入1个系统假计数(B,已修)", "r150-outline-consulting-gap 评级咨询服务类未成节(B,P2,backlog)", "诚实更正:innerText误诊页面重载"],
 "files_changed": ["src/pages/SolutionStudio/solutionTypes.ts", "src/pages/SolutionStudio/checklistTypes.ts", "src/pages/SolutionStudio/useSolutionStudio.ts", "src/components/solution-studio/NewSolutionWizard.tsx", "src/pages/SolutionStudio/systemsFromChecklist.test.ts"],
 "build": "pass", "tests": "995/995(+5=新增,基线990)", "lint": "4文件HEAD对照14=14零新增",
 "regression": "R6实机真跑(大纲生成→确认→落库→编辑器)；其余按裁剪不涉",
 "output_before": "选清单后A5大纲prompt的清单scope=空(快照A6才写+未匹配条目被丢弃)；实机显示'带入1个系统'(Set{undefined}.size=1)",
 "output_after": "选清单即写快照,66条customer_requirements进prompt并随方案落库(实测66条)；计数诚实显示0；大纲评级目标与招标逐字一致",
 "github_scout": "",
 "next_recommend": "R151:151mod3=1主攻标书工作台(R01.bid续:B2 AI解析/B3编制,T3门禁内)或按场景算法续R01.solution A7-A9(R153)——以轮转优先",
 "honest_notes": ["诚实更正:innerText不含input.value,曾误判页面重载/状态丢失并误取消第一次已成功的大纲(费用已花,产物自弃)", "T3保守计3次触顶:1次成功+1次误弃+1次存疑未核实(无本地用量表);本轮不再发起真实生成", "A7/A8/A9与方案转PPT未做(T3触顶),方案阶段保持in_progress", "演练数据保留:清单e7qjtugzr40arey+方案g267q0imbmt27q5(均【演练】前缀,下轮续用后统一清理)"],
 "needs_user_decision": []}
```
