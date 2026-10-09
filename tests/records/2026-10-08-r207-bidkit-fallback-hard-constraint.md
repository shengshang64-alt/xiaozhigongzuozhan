# R207 场景自测记录

- 日期：2026-10-08
- 轮次：R207（BidWorkspace 优化实施计划 · 切片 2 / R-003）
- 需求来源：用户 P0 需求「无底稿兜底要显式对齐招标文件的响应文件组成与评分要求」
- 变更文件：bidTypes / useBidWorkspace / prompts(bidOutline,outlineLevel1) / ComposeStep / outlineGate.test

## 一、操作步骤

1. 打开 http://127.0.0.1:8000/ → 标书工作台
2. 项目列表选「安庆市第二人民医院智慧医院信息化系统项目（已解析）」→ 第 3 步「投标文件编制」
3. evaluate_script 查顶部副标题文案（新 vs 旧）
4. 代码核实 ParseConfigDialog 关键项是否含 响应文件要求/技术评分/商务评分（必选徽标）
5. 单测覆盖：hasBidComposition 判据 + bidOutline 有/缺组成时硬约束注入与否

## 二、输入与预期

| 场景 | 输入 | 预期 | 实测 |
|---|---|---|---|
| 副标题 | 已解析项目 step3 | 新文案命中、旧文案消失 | ✓ |
| 有组成 | report.response_req 非空 | prompt 注入「响应文件组成硬约束」「不允许合并或改名」 | ✓（单测） |
| 缺组成 | report 无 response_req | 不注入硬约束 + 运行时 toast 告警、不阻断 | ✓（单测 hasBidComposition=false） |
| 必勾项 | ParseConfigDialog | 响应文件要求/技术评分/商务评分=必选（现状即满足） | ✓（代码核实） |
| 快照 | 既有 fixture 无 response_req | promptsSnapshot 无 -u 通过（字节保留） | ✓ |

## 三、发现问题与处理

- **必勾项无需改**：计划要求把 composition/scoring 标必勾，核实发现三者已在 PARSE_KEY_SECTIONS 八项必选内，
  弹窗渲染为 disabled+checked「必选」，遂不重复改动。
- **告警不触发付费生成**：告警在 llmGenerate 之前，但同函数随后即调用 AI；实摆只验副标题 DOM，
  告警路径靠单测，避免无谓成本。
- **eslint 遗留**：outlineLevel1:58 no-useless-escape 为 R206 模板串遗留，.r207bak 基线同样命中，非本轮引入。
- **四门**：tsc / vitest(131/1554/2) / eslint(新增 0) / build 全绿。

## 四、结论

R-003 无底稿兜底强化闭环：硬约束对齐 + 缺失诚实告警 + 副标题显性化。可推切片 3（R-001 mammoth 底稿增量补写）。
