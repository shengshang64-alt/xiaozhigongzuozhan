# 场景自测 — 长文档解析分层段数上限（R260 / 全局优化汇总 R-038 Slice B）

日期：2026-10-10 ｜ 轮次：R260 ｜ 记录人：自动迭代（纯路由分层 + 跨块合并）

## 场景口径（AGENTS 强制）
模拟一所三甲医院（天坛式超长标书，41.7 万字）「建医院 → 建项目 → 上传超长招标文件 → 解析 → 生成大纲 → 成稿」全流程，
重点验证：①废标/评分关键项对超长文档走**整文全量覆盖 + 跨块合并**（不再回落 14k 单窗口）；②其余项行为不变；③R258 覆盖率门禁随之少误拦；④成本有界（24 段硬顶）。

## 操作步骤
1. 建医院 → 建项目 → 上传 41.7 万字招标文件（tender_text，> WHOLE_FILE_LIMIT 6 万字，落入切段路由）。
2. 触发整文通道批量解析：
   - `parseSegmentCap("tech_score"/"biz_score"/"void_items"/"qualification"/"compliance")` = **24** →
     splitTenderText 切 10 段 ≤ 24 → 走 `parseSectionViaSegments`：10 段并发（限流闸门错峰）→ `buildSegmentMergeMessages` 跨段合并 → 摊平落库。
     评分表（第四章）与技术参数（第五章）分处不同段 → 合并阶段取并集，**跨块汇总成功**（散段评分项不再丢）。
   - `parseSegmentCap("overview"/"purchase_list"/...)` = **6** → 10 段 > 6 → **回落检索通道**（行为与 R258 前完全一致，控成本）。
3. 极端超长（>108 万字，即 >24 段）：关键项也 `segments.length > 24` → 回落检索兜底，**杜绝无界费用**。
4. 生成前 R258 覆盖率门禁：因关键项整文覆盖 → 产出字符上升 → 覆盖率比值抬升 → 长标书被误判 <30% 阻断的概率下降。

## 自动化验证（零模型，纯函数）
`src/pages/BidWorkspace/prompts/wholeParseTier.test.ts`（4 例）：
- 5 个废标/评分关键项被识别为需整文全量覆盖（isFullCoverageParseItem=true）；
- 叙述/信息项（overview/project_info/purchase_list/lots/delivery_req/purchaser_info）不放宽（=false）；
- parseSegmentCap 对关键项返回 CRITICAL、其余返回通用上限；
- CRITICAL 严格 > 通用上限（放宽才有意义）且有界整数 ≤24（绝不无界放大调用数）。

## 端到端回归（负控 + 正控）
- 正控：≤6 万字短文档 → 整文直读路径，不触分段/回落，行为零变化。
- 负控：若把 parseSegmentCap 误写成恒返回通用上限 → 关键项超长仍回落 → 单测「关键项 cap==CRITICAL」即失败（负控对照锁定）。
- 口径一致性：合并走既有 `buildSegmentMergeMessages`（JSON 项 tech_score/biz_score 合并后再 `materializeWholeParseResult` 摊平 + `selfCheckScoringTotal` 分值自检），
  与 R-026 结构化落库链路无缝衔接，未新增第二套合并逻辑。
- 41.7 万字真实天坛文件本会话未落磁盘（微信附件），端到端以纯函数分层 + 路由代码走查承载；现场以真实超长项目复核「评分/废标项覆盖率显著抬升 + 成本符合预期」。

## 预期 / 实际结果
- 预期：超长标书的评分项/废标项整文全量覆盖、跨块汇总，覆盖率显著抬升；非关键项与短文档行为不变；成本有界可解释。
- 实际：四门全绿（tsc0 / eslint useBidWorkspace 前后 18 problems(5/13) 零新增、3 文件 0 problem /
  vitest 163 files·1872 passed+2skip（+1 文件 +4 用例）/ build exit0(3.46s)）。

## 发现问题
- 本轮为「定向分层」：仅废标/评分 5 项整文全量覆盖，其余 15 项长文档仍回落检索（覆盖偏低但多为重复性信息、漏了不致废标）。
  若后续要**全项**整文覆盖（文档①「按 8,000 字窗口 500 字重叠切块」更细粒度），涉更大 token 成本，建议结合真实项目覆盖率再评估是否放宽通用上限或调小段长。
- 补丁脚本编码教训：跨工作区读写**必须显式 utf-8**（系统默认 GBK 对含 ↔/→ 等符号的源文件会写坏）；已在脚本固化。
