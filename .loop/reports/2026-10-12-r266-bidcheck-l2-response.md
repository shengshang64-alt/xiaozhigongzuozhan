# R266 · 标书检查中枢二期 L2 响应层接入（r261-bidcheck-followons）

## 选题依据
backlog `r261-bidcheck-followons`（P2·标书检查域）二期：一期仅接入 L1 格式 + L5 暗标，
`checkConfig` 默认层级已含 L2/L3/L4，但 `runCheck` 只跑 L1/L5——存在真实「交互断链」：
配置开关与规则清单页把 L2 显示为占位、不参与判定。优先标书域（用户权重 标书>方案>PPT），
本轮闭合 L2 断链，落地二期「L2 响应整合展示」。

## 复用优先（未自研新算法）
L2 直接复用 BidWorkspace 三把现成、已单测的本地尺子，零 AI / 零费用 / 零 collection schema：
- `complianceMatrix.buildComplianceRows(report)` → 从解析报告推导 ★/▲、废标、资格、符合性条款行；
- `complianceCoverage.auditComplianceCoverage(rows, chapters)` → ★条款正文逐字命中四态（full/partial/outline/missing）；
- `scoreCoverageCheckup.buildScoreCheckup(outline, report)` → 按【分值】统计技术评分项正文承接落点。

## 变更文件
- 新增 `src/pages/BidCheck/rules/response.ts`：L2 响应层主入口 `runResponseChecks(rec)`，产出两项——
  - `L2-R1 实质性条款(★)正文回应核对`：pending 条款（正文未见/仅标题/部分命中）逐条入清单，标未见要点；
  - `L2-R2 技术评分项落点核对`：未落点评分项逐条入清单，带分值与主/客观标注。
  - 诚实降级：上传文件（无解析报告）/ 未解析对应分区 / 正文未生成 → 标 `skipped` 并说明原因，绝不瞎判。
  - 只报不拦：一律 `severity=high` / `status=warn`，不标 critical/fail，不触发暗标导出门禁（维持既有裁定）。
- 改 `src/pages/BidCheck/runCheck.ts`：`runCheck` 增 `project` 形参（默认 null），`levels` 含 L2 时接入 `runResponseChecks`；注释分期口径同步（L3/L4 顺延三~四期）。
- 改 `src/pages/BidCheck/useBidCheck.ts`：`run` 选择项目源时把 `record` 透传给 `runCheck`（上传文件传 null）。
- 改 `src/pages/BidCheck/RulesListPanel.tsx`：L2/L3/L4 说明区把 L2 从「占位不参与判定」更新为「已接入（二期）」，闭合断链文案；当前接入态改述为 L1+L2+L5。
- 新增 `src/pages/BidCheck/rules/response.test.ts`：6 用例锁定 skipped 诚实降级 / ★待确认 warn / 逐字回应进入判定 / 评分未落点带分值 / 无评分表 skipped。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0，零错误（修 1 处测试局部变量隐式 any）。
- `npx vitest run`：171 files 全过，**1926 passed + 2 skipped**（基线 170 files/1920 passed+2 skipped，增量 +1 文件/+6 用例=response.test.ts）。
- `npx eslint`（触及 5 文件）：exit 0，零 error/warn。
- `npx vite build`：成功，built in 4.25s。

## 数据模型 / 提示词
零 collection schema 变更、零 pb_hooks、零提示词改动（未触 B 类流程）。L2 结论为只读派生覆盖层。

## 维持裁定不动
- 「疑似编造未清零禁止导出」只报不拦——本轮 L2 同样只报不拦，未加任何新硬门禁；
- `lint-debt-01` 有意保留残余未重构。

## 挂账
- 三期 L4 查重 / 四期 L3 内容+L5-D 语义 AI 类 / 五期 标注版 docx + PB 集合 anbid_checks + 分工流转仍在 backlog。
- L2 真实数据端到端复核待有已解析+生成正文的真项目补（本机项目多为未生成态，会走 skipped）。
