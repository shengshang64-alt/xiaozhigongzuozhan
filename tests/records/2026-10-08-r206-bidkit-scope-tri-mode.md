# R206 场景自测记录

- 日期：2026-10-08
- 轮次：R206（BidWorkspace 优化实施计划 · 切片 1 / R-002）
- 需求来源：用户 P0 需求「生成内容范围三模式（仅商务/仅技术/商务+技术）+ 分册导出」
- 变更文件：bidTypes / prompts(bidOutline,outlineLevel1) / useBidWorkspace / bidFiles / BidWorkspacePage / GenerationSettingsBar / ComposeStep / scopeTriMode.test.ts

## 一、操作步骤

1. 打开 http://127.0.0.1:8000/ → 标书工作台
2. 项目列表选「安庆市第二人民医院智慧医院信息化系统项目（14 章，include_biz:true）」→ 第 3 步「投标文件编制」
3. 定位常驻「生成设置」条中的「生成内容范围」分段控件
4. evaluate_script 查：标签文案、三段按钮、当前 active 项、hint 文案
5. 点「仅商务」→ 复查 active 迁移、hint 更新、toast、后端 gen_options.scope 持久化
6. 回切「商务+技术」还原

## 二、输入与预期

| 场景 | 输入 | 预期 | 实测 |
|---|---|---|---|
| 控件常驻 | 有章节项目 step3 | 分段控件可见（不依赖 !hasChapters） | ✓ |
| 缺省派生 | include_biz:true 无 scope | active=商务+技术（both） | ✓ |
| 存量兼容 | include_biz:false（贵港） | 派生 tech，行为与旧一致 | ✓（normalizeBidScope 单测锁） |
| 切仅商务 | 点「仅商务」 | active 迁移 + hint 更新 + toast 提示重生成 | ✓ |
| 持久化 | 切换后 | gen_options.scope=biz、include_biz=true 落库 | ✓ |
| 提示词三分支 | biz/tech/both builder | 各含对应约束句，both/tech 字节不变 | ✓（7 单测 + 快照） |

## 三、发现问题与处理

- **落点修正**：初版把控件放 ComposeStep `!hasChapters` aside，有章节项目（贵港/演练/安庆）不渲染、
  新建项目又被 parse 门控无法直达 step3 → 迁到常驻 GenerationSettingsBar（fixup），任何项目可见可实摆。
- **命名冲突**：hook 级 `scope` 与局部派生冲突 → 用 `outlineScope`/`bulkScope`/`scopeForConfirm` 局部别名。
- **四门**：tsc / vitest(131/1551/2) / eslint(新增 0) / build 全绿；快照无 -u 通过。

## 四、结论

R-002 三模式 + 分册导出全链路闭环，存量零变化。可推切片 2（R-003 无底稿兜底强化）。
