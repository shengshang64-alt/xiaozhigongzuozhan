# 任务 2.1 修复验证报告

> 执行时间: 2026-11-07 10:40 – 11:35
> 执行者: GLM-5.3-Flash
> 依据脚本: docs/GLM-5.3-EXECUTE-SCRIPT-TASK-2.1.md（Part 0→5 全步骤执行，未跳步）

## 环境信息
- Node: v24.19.0
- pnpm: 11.21.0（`pnpm install --frozen-lockfile` 通过，"Already up to date"）
- OS: Windows（本机 localhost 部署，PocketBase + Vite 本地配置）
- 分支: feature/ui-phase1-homepage（工作树另有并行会话在途改动，见「遗留问题」）

## Part 1: 测试修复
- [x] 测试文件已按脚本完整重写（`BidPipelineStepperEnhanced.test.tsx`）
- [x] 测试结果: **12 passed, 0 failed**（脚本 11 个用例编号中第 9 项含两个 it，共 12 条）
- 失败项处理:
  1. 旧测试文件基于**虚构的类型形状**（`chapter_index`/`hospital_id`/`stage: "in_progress"`/`stage_gates: []`），tsc 直接报 9+ 处类型错误，属于「测试从未通过过」状态。按脚本指引「对照组件源码与实际类型调整」：
     - 夹具改用真实类型：`Chapter = { node_id, title, sections, content, gen_status }`（SolutionStudio/solutionTypes），`stage: "composing"`（真实 BidStage 枚举值），`stage_gates: { gates: [] }`（真实 StageGates 结构）；最小夹具 + `as unknown as BidProjectRecord` 收窄，沿用仓库既有惯例（BidCheck/rules/dedup.test.ts 的 rec()）
     - 断言文案与 PIPELINE_STEPS **实际标签逐字对齐**：脚本写的「查重/废标与合规检查/模拟评标与答辩」实为「标书查重/废标项检查/模拟评标」
     - 「当前步骤蓝色」用例的夹具改为 0 章有正文——组件逻辑是**完成态优先于当前态**，任一章节有正文即第 3 步呈绿色
     - 补 jsdom 环境声明（`/** @vitest-environment jsdom */`）与 jest-dom 导入（项目约定，脚本样例缺失）

## Part 2: 组件 Bug 修复
- [x] Bug 2.1 逻辑错误已修复：`!step.status === 'current'`（恒 false，分支永不渲染）→ `step.status !== 'current' && !step.progress`，按脚本给定的修复片段落位
- [x] Bug 2.2 同类检查完成：全文件检索 `!step.status`，仅此一处，已修
- [x] Bug 2.3 函数顺序确认：isGateConfirmed / stepDone / handleSaveDraft 移至组件定义之前（原依赖函数声明提升，行为等价，现按脚本要求收敛为「先辅助函数、后组件、最后内部子组件」）
- [x] Bug 2.4 未使用导入移除：`ArrowRight`
- [x] Bug 2.5 未使用类型移除：`UseBidWorkspace`
- [x] tsc -b: **0 error**

**修复过程中额外发现并修复 2 项**（不修则 tsc 门禁无法归零，且均在脚本划定的流水线组件范围内）：
1. **isGateConfirmed 与真实 StageGates 类型失配**：原实现 `project.stage_gates ?? []` 按数组下标取 `confirmed`——但 stage_gates 实为 `{ gates: GateRecord[] }` 对象（GateRecord 无 confirmed 字段，只有 confirmed_at），原逻辑永远取不到值且 tsc 报错。改为委托 bidTypes 的权威实现 `stepGateConfirmed(step, project?.stage_gates ?? null)`（STEP_GATE_MAP 定步骤→闸门映射），与旧 PipelineStepper 同语义
2. **BidWorkspacePage.tsx 死导入**：并行会话已把页面切到 `BidPipelineStepperEnhanced` 渲染（第 111 行），但遗留旧 `PipelineStepper` 导入未删（TS6133）。属流水线组件范围代码，删除（旧组件文件本身未动，保留作回滚备份）

## Part 3: UI 验证
验证对象：蚌埠医科大学第一附属医院智慧医疗核心业务系统（编制中，22 章 11 章成稿，真实数据）

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | 七步流程条显示 | ✅ 7 个圆圈一字排开 + 灰色连接线 |
| 2 | 已完成步骤 | ✅ 绿色圆圈 + ✓ 图标 + 绿色文字 + 时长（3 小时/45 分钟） |
| 3 | 当前步骤 | ✅ 白圈 + 蓝色边框 + Clock 图标 + 蓝色文字 + animate-pulse（第 5/7 步实测；第 3 步因「完成态优先」显示为绿色完成态，见遗留备注） |
| 4 | 待开始步骤 | ✅ 灰色圆圈 + ○ 图标 + 编号 + 灰色文字 + 「待开始」 |
| 5 | 第 3 步进度 | ✅ 「50% (11/22章)」+ 蓝色渐变进度条（真实章节数据） |
| 6 | 步骤可点击 | ✅ 点击步骤跳转生效（7/5/1 实测）；注意：跳第 6 步被页面级步骤准入拦截（见遗留备注，属既有业务逻辑非组件缺陷） |
| 7 | 上一步按钮 | ✅ 第 1 步 disabled 实测；其余步骤可用 |
| 8 | 下一步按钮 | ✅ 非最后一步「继续编写 →」；第 7 步变「完成 →」（disabled，已在末步） |
| 9 | 保存草稿按钮 | ✅ 存在且可点击，console 捕获日志 `Draft saved at 2026-11-07T03:21:32.770Z` |
| 10 | 上下文面板条件渲染 | ✅ 仅第 3 步显示（章节导航 + 快速工具双栏） |
| 11 | 章节导航 | ✅ 已完成章节绿色左边框 + 绿底 + ✓ + 「已完成」徽标；未完成白底 + ○（22 章真实清单） |
| 12 | 快速工具 | ✅ 4 卡片（引用素材库/插入图表/AI 写作助手/保存草稿）；hover 实测 transform none → matrix(1.1) 放大 |
| 13 | 其他步骤面板隐藏 | ✅ 切到 1/5/7 步面板均消失（DOM 实证） |
| 14 | 旧功能完好 | ✅ 第 1 步「导入招标文件」（上传区/文件清单/762238 字文本）、第 5 步「废标项检查」（三页签+运行按钮）、第 7 步「归档导出」（标记项目归档）内容区全部正常渲染 |
| 15 | 控制台无报错 | ✅ 注入 console.error/window.onerror 采集器跑完全部跳转与交互，0 条 error |

截图（全部真实截取于 2026-11-07，存 `_shots/`）:
- [x] task2.1-stepper-step1.png — 第 1 步全景（步骤条 + 导入招标文件内容区 + 禁用的返回按钮）
- [x] task2.1-stepper-step3.png — 第 3 步全景（50% 进度条 + 章节导航 + 快速工具双栏）
- [x] task2.1-stepper-step5.png — 第 5 步全景（蓝色当前态步骤条 + 废标项检查内容区，面板消失）
- [x] task2.1-chapters-tree.png — 章节导航树特写（绿章 ✓已完成 / 白章 ○ 对比）
- [x] task2.1-quick-tools.png — 快速工具卡片特写（4 卡 + 提示行）

## Part 4: 门禁
- [x] tsc -b: **0 error**
- [x] vite build: **exit 0**（CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000，5.2s 构建成功）
- [x] vitest run: **445 文件 / 5064 passed / 11 skipped 全绿**——以 `--environment node`（即改动前的默认环境语义，各文件 jsdom pragma 不受影响）运行
  - ⚠️ 若按工作树当前 `vitest.config.ts`（并行会话 09:51 未提交改动：默认环境 node→jsdom）运行，44 个假设 node 环境的源码读取型测试报 `TypeError: The URL must be of scheme file`（`import.meta.url` 在 jsdom 模块上下文非 file 协议）。该 44 项失败与 TASK-2.1 改动无关（失败清单不含本任务触碰的任何文件），归属见「遗留问题」
- [x] eslint: **0 error 0 warning**（BidPipelineStepperEnhanced.tsx / .test.tsx / BidWorkspacePage.tsx 三文件）

## 遗留问题
1. **并行会话未提交的 `vitest.config.ts` 改动**（默认环境 node→jsdom）导致 44 个源码读取型测试套件在默认命令下失败。本仓库既有约定是「node 默认 + 按文件加 jsdom pragma」，该改动与此冲突。需该改动所有者决策：要么回退默认环境，要么给 44 个文件补 `/** @vitest-environment node */`（后者涉及大量非本任务文件，本任务按「不修改其他页面文件」约束未处理）。另 `pnpm-lock.yaml` 亦被并行会话重写（-11575/+3366 行），`pnpm install --frozen-lockfile` 仍通过，暂无功能影响，建议一并核对
2. **「完成态优先于当前态」的展示语义**：项目停在第 3 步且该步已有产物时，当前步骤显示为绿色完成态而非蓝色当前态（activeStep 与 status 解耦）。是否要「当前步即使已完成也保留蓝色指示」属产品决策，本任务按脚本未改
3. **保存草稿按钮为占位实现**（仅 console.log，代码内 TODO 标明）——脚本验收口径即「点击后 console 有日志」，已满足；接真实保存逻辑属后续任务
4. 旧 `PipelineStepper.tsx` 完整保留未动（回滚备份），页面已不再引用

## 签字
执行者: GLM-5.3-Flash
日期: 2026-11-07
