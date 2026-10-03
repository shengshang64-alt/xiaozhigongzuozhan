# 2026-09-30 AI 内容护栏 consistencyGuard（D3/R89）自测记录

> 方案依据：`.loop/plans/C-content-guard.md`（拍板：只报不拦）；国庆自主优化计划 D3 条目。
> 红线遵守：不自动改写任何已生成正文；提示词快照锁字；零 schema 变更。

## 一、落地内容

| 文件 | 动作 |
|---|---|
| `src/pages/BidWorkspace/prompts/consistencyGuard.ts` | 新增：逐章护栏 prompt 构造器（规则②量化依据/③量级自洽/④政策时效）、`sanitizeConsistencyIssues` 清洗、`checkBudgetGate` 预算闸（150 次/天、¥5/天）、`readTodayAiUsage`/`recordAiCall` 日用量计数（localStorage）、规则/严重度中文标签映射。PROMPT_VERSION=1 |
| `src/pages/BidWorkspace/prompts/consistencyGuard.test.ts` | 新增 14 用例：prompt 结构/规则关键词/空字段容错 + 快照锁字基线 + 清洗（合法/非法归一/去重/空输入）+ 预算闸（放行/次数超限/费用超限）+ `normalizeSubmissionCheck` consistency_issues 容错回归 |
| `src/pages/BidWorkspace/bidTypes.ts` | `SubmissionCheck` 增可选字段 `consistency_issues`（null=未跑/失败，[]=跑过无问题，与 fact_conflicts 同语义）；`normalizeSubmissionCheck` 容错保留 |
| `src/pages/BidWorkspace/useBidWorkspace.ts` | 交卷体检新增第四路 `runConsistencyGuardPath`：逐章正文前 6000 字 + 事实表/招标片段/KB 命中各 ≤2000 字裁剪；每章调用前过预算闸（超限章节自动跳过＝如实"未检查"语义）；单章失败静默继续；整体自吞异常不拖垮审计主路；降级分支（无评分/废标解析）同样执行；`refreshFormatReport` 零 AI 回显保留护栏结果；费用确认文案更新 |
| `src/components/bid-workspace/SubmissionCheckPanel.tsx` | 顶栏徽标「内容护栏 N 处提示 / 内容护栏通过」+ 第四区卡（复用格式检查卡样式：严重度 chip + 规则 chip + 章节定位 + 原文摘录 + 建议） |

## 二、真实场景自测（贵港项目 · 中国农业银行贵港分行 GXKLG202630843）

前置：项目已有解析报告（评分项+废标条款）、1/10 章成稿——取"编制中"真实项目走交卷体检环节。

操作：标书工作台 → 贵港项目 → 第5步（交卷体检面板）→「重新审计」→ 费用确认弹窗（新文案含"AI 内容护栏逐章检查（护栏受每日预算闸限制…）"）→ 确认运行。

实际结果（DB `submission_check` 落库 + 面板 a11y 快照双重取证）：
- 审计 22 项：1/22 实质响应、21 项未覆盖（既有两路行为不变，零回归）；
- 事实路：跑过、0 矛盾（`fact_conflicts: []`）；
- **护栏路：产出 1 条真实命中**——
  `rule=quant_basis（量化依据）| severity=minor | 位置=1.1 医院现状与需求深度分析 |
  issue="正文中出现'95项本地化流程改造'和'80个第三方系统接口对接'等关键数字，但招标文件及全局事实中均无对应依据" |
  evidence=正文原文摘录 | suggestion=核实/删除无依据数字`
  ——正是护栏设计目标（AI 编造无依据数字）抓得实；
- 面板渲染：徽标「内容护栏 1 处提示」、区卡标题「AI 内容护栏（量化依据 / 量级自洽 / 政策时效）提示 1 处」、条目含原文摘录与建议，符合"问题条目附原文摘录与依据出处"验收；
- toast 摘要：「交卷体检完成：1/22 项已实质响应，21 项未覆盖；内容护栏 1 处提示，请逐条处理」；
- console 零业务报错；"疑似编造未清零"不拦导出（只报不拦红线维持）。

## 三、门禁结果

- `tsc -b`：0 错误；
- `vitest run`（全量）：57 文件 617 通过 2 跳过（改动前后一致，零误报红线夹具回归通过）；
- promptsSnapshot 31 用例通过（提示词零改字）；
- eslint：本次仅新增文件+集成点，修复了自己引入的 1 个 `no-useless-assignment`；余错均为存量基线（no-control-regex×2、setState-in-effect×4、updatedOpp 赋值）。

## 四、发现问题（记入账本）

1. **[P2] 护栏首跑 KB 冷缓存拖时**：`getCachedVisibleDocs` 首次触发 kb_docs 全库分页（本机 36 页 × ~4.3s ≈ 155s，串行），显著拉长交卷体检总时长。缓存预热/并发分页属既有 kbAssemble 通道（D1 领域）优化项，已登记 `r89-guard-kb-cold-01`。
2. 本次 toast 同时出现一条网关「请求超时」提示（审计路首试失败后系统自动重试成功），为既有容错行为，非护栏引入。

## 五、边界裁决（prompt-fabscan-03 剩余 C 类）

- **做**：编造内容扫描（=本护栏②③④，已闭环）；覆盖审计四态升级按 V1 最小切片另轮立项（动提示词语义需走 B 类改字流程）。
- **不做**：「疑似编造未清零禁导出」硬门禁——维持只报不拦（全程红线：护栏与检查一律只报不拦；处置权归用户）。
