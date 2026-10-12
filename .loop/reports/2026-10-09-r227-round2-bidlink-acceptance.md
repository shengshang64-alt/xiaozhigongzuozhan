# R227 · 第2轮标书链路改造 完整验收报告（slice8 收口）

## 概览
第2轮改造指令针对 http://localhost:8000/bid-workspace 标书链路提出 9 项需求（R-017~R-025），
按 8 个 slice 顺序落地（R-021→R-025→R-020→R-023/R-018→R-022→R-017→R-019/R-024→演练回归）。
本 slice（R227）为实机回归 + 四门门禁 + 自测留档 + 本聚合报告。账本 round 226→227。

## 九项需求落点（R-017~R-025）
| 需求 | 内容 | slice/round | 核心改动 |
| --- | --- | --- | --- |
| R-021 | 大纲残句治理 | R220 | 解析残句清洗，避免半截标题入大纲 |
| R-025 | 评分覆盖体检 | R221 | 评分项与大纲覆盖对照，丢分醒目提示 + 一键补入 |
| R-020 | 商务/技术判定改按评分办法 + mustWrite 解耦 | R222 | part 判定以评分办法为准，mustWrite 与 part 解耦 |
| R-023 | 双层目录 | R223 | 商务骨架章 + 技术详细大纲双层结构 |
| R-018 | 三态视图 / 必备清单可配置 | R223+R225 | 目录三态视图；必备技术内容清单可配置 |
| R-022 | 技术参数落点 | R224 | techParamCoverage 逐条建节点 / 进偏离表落点卡片 |
| R-017 | 目录按招标节点为骨架 | R225 | 以招标评分/需求节点为大纲骨架 |
| R-019 | 演示分默认不生成 + 线下提示 | R226 | demoSection 模块；isGenTargetChapter/chapterWordBudgets 默认排除演示分 |
| R-024 | 演示分生成开关 | R226 | gen_options.generate_demo 随项目持久化开关 |

## R-019/R-024 设计要点（本 slice 回归对象）
- 复用「商务骨架章不生成正文」中央生命周期：isGenTargetChapter + chapterWordBudgets 权重 0，
  新增可选参数默认 generateDemo=true 向后兼容，杜绝散点漏改。
- 检测单一真源 isDemoScoreTitle（演示|答辩|讲标 + 视频需与演示语境同现，防误判视频监控/远程会诊等真实技术章）。
- gate 演示分专属友好文案；开关走 gen_options.generate_demo（随项目持久化，非 localStorage）。
- 存量项目 gen_options 无该字段 → normalize 得 false → 演示分即刻默认不生成，无需迁移。

## 实机回归结论（详见 tests/records/2026-10-09-r227-round2-bid-link-regression.md）
建阳区总医院项目（含真实「功能演示1/2 共 6 分」评分项）只读验证：
生成设置栏出现演示分开关（默认关）+ amber 线下提示（检测到 1 个演示节点）；
大纲树第7章标「演示分·不响应」且字数预算 0；历史成稿正文原样保留；页面无渲染错误。全部通过。

## 四门门禁（收口复跑）
- tsc --noEmit：0 error
- vitest run：141 文件 1637 passed | 2 skipped（0 回归；demoSection 5 例 + 既有 scope/预算 21 例向后兼容）
- eslint：本 slice 7 文件 10 err/13 warn 全为既有基线，新文件与改动行零新增
- npm run build：3.20s 成功

## 遗留 / 后续
- P1 表格化（评分项/技术参数表格呈现）按要求后置，未纳入本轮。
- 演示分「占位应答」在开启 generate_demo 后按普通技术章生成，本轮未实机触发（涉及 AI 费用），逻辑由单测覆盖。
