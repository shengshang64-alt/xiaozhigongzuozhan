# R187 金额大小写一致性接入交卷体检（r184-bid-amount-consistency-wiring · P2）

日期：2026-10-06 ｜ 轮次：R187 ｜ 类别：A 类（零提示词、零 collection、零 pb_hooks、零导出门禁）

## 1. 选题依据

- 账本 round=186，用户点名的两个实质项经核实均已收口：`quote-history-01`（R102 二期已 closed，状态 done）、
  `prompt-fabscan-03`（R101 四态 + R103 按章聚合回注 + R89 编造扫描边界裁决，已 closed）→ 本轮不再重复投入。
- open 清单里 `r184-bid-amount-consistency-wiring`（P2）是标书主链路（用户优先级：标书 > 方案 > PPT）上
  唯一「内核已交付、只差接线」的实质项：R184 已落 `src/lib/currencyCn.ts` 确定性内核（16 单测全绿），
  但金额大小写一致性这道经典废标项此前只在内核里，交卷体检跑不出来。
- 其余 open 项：`r169-ppt-template-master-fidelity`（PPT 侧，优先级低于标书）、`r177-...parallel-resume`、
  `ui-redesign-phase3`（多轮分批）、`lint-debt-01`（维持裁定不重构）、`quote-history-3-mining`（报价侧，用户已弱化）。

## 2. 变更内容

| 文件 | 变更 |
| --- | --- |
| `src/pages/BidWorkspace/bidTypes.ts` | 新增纯函数 `amountCaseMismatchHits(chapters, deviationTable)`；`FormatCheckRule` 并集扩 `amount_case_mismatch`；`FORMAT_RULE_LABEL` 补文案（白名单随 `Record<FormatCheckRule,…>` 派生自动生效，老报告零影响）；顶部 import 内核 |
| `src/pages/BidWorkspace/useBidWorkspace.ts` | `buildFormatReportFor` 内 `report.hits.push(...amountCaseMismatchHits(cur.bid_chapters, cur.response_map))`（与 metric/meta/deviation 同区，不依赖全局事实表）；import 补一行 |
| `src/lib/currencyCn.ts` | **内核精度修复（真实语料实测暴露）**：`ARABIC_RE` 前缀分支补可选「万/亿 + 元」单位，修「人民币1万元」被截成小写「人民币1」+ 幻影大写碎片「万元」；`AmountMismatch` 新增 `sep` 字段（相邻两侧的间隔串），供上层区分同行重述与跨行/跨表格格相邻 |
| `src/components/bid-workspace/SubmissionCheckPanel.tsx` | 格式检查区说明文案补全实际在跑的规则（报价超限价 / 承诺不够与参数加码 / 占位元话语残留 / 金额大小写一致性），消除「面板说明落后于规则集」的文案不一致 |
| `src/pages/BidWorkspace/bidFormatCheck.test.ts` | +11 用例（接线行为 8 + 真实语料噪声锁 3） |
| `src/lib/currencyCn.test.ts` | +2 用例（前缀分支回归锁、sep 记录） |

判定口径（只报不拦，维持既有裁定）：
- `mismatch`（大写与小写都可解析、相邻重述且金额不等）→ **warn**，文案带【废标风险】，例：
  「大写『人民币贰仟贰佰肆拾伍万元整』与小写『¥22,100,000.00』金额不一致，导出前必核」；
- `malformed`（大写形状可疑但解析失败）门槛更严：须与一个小写金额**同一片落**相邻（`sep` 不含换行）才提示 **info**，
  用来抓「投标总价（大写）：人民币万元整」这类模板占位未填；跨行跨表格格的「（单位：万元）列头 + 邻格数字」不报。
- 独立 ≤15 条上限、同章同串去重，不挤占既有格式命中列表；不改导出行为、不加硬门禁。

## 3. 场景自测（真实标书语料，AGENTS.md #1）

按「一所三甲医院真实投标件」口径，不做构造数据：从本地真实语料（`D:/重要文件/A重要客户情况` 4079 份 docx）
里筛出含中文大写金额的文档 47 份，取前 20 份（60KB–1.2MB）跑 `amountCaseMismatchHits`（临时探针
`src/pages/BidWorkspace/r187realprobe.test.ts`，跑完已移入 `.loop/trash_r187/`）：

- 修复前：`scanned=20 totalHits=5 filesWithHit=3`，其中 3 条 info 为噪声——
  「（单位：万元）」列头配邻格数字、「人民币1万元」被拆出的幻影大写碎片。
- 修复后：`scanned=20 totalHits=2 filesWithHit=1`，噪声清零，2 条均为**真实缺陷**（池州第二人民医院智慧医院 20240930 投标文件报价表）：
  - `软件价格合计：￥22,100,000.00 人民币贰仟贰佰肆拾伍万元整` → 2210 万 vs 2245 万，差 35 万；
  - `硬件价格合计：￥4000,000.00 人民币叁佰陆拾伍万元整` → 400 万 vs 365 万（千分位本身也写错）。
  两处都是评标现场会被当场指出的大小写不符，此前体检完全看不见。

## 4. 四门验证

| 门 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0，零错误 |
| `npx vitest run` | **1268 passed / 2 skipped（108 文件）**；基线 R186=1255，净增 **+13**（接线 8 + 噪声锁 3 + 内核 2），零回退 |
| `npx eslint`（触及 6 文件） | 20 problems = 7 errors / 13 warnings，与改动前同一集合**逐条等量**（`git stash` 式前后对比：改前 5 文件同为 20/7/13），零新增；7 条 error 全是 `lint-debt-01` 保留项（no-control-regex）与在途代码的 setState-in-effect |
| `npx vite build` | 5959 modules transformed / built in 3.25s（chunk >500KB 提示为既有基线） |

## 5. 维持裁定与红线

- 未动任何提示词（不需走 B 类流程）、未动 PocketBase collection / pb_hooks、未动导出门禁；
  「疑似编造未清零禁止导出」维持 R89「只报告不拦截」裁定，本规则同样只 warn/info。
- `lint-debt-01` 残余不重构；未提交任何 git commit。
- 接线锚点核查：`bidTypes.ts` / `bidFormatCheck.test.ts` / `SubmissionCheckPanel.tsx` 改动前均为 git 清洁文件；
  `useBidWorkspace.ts` 为历史累积 M，本轮两处锚点（import 块与 `buildFormatReportFor` 尾部）经 `git diff -U0`
  hunk 定位确认**不落在任何未提交在途 hunk 内**，未误伤在途功能。

## 6. UI 实机验证边界（诚实记录）

本轮命中项的最终可见载体是交卷体检面板（`SubmissionCheckPanel`）。实机走查需要 PocketBase 已登录会话 +
带章节数据的真实标书项目：本机 PocketBase 在 127.0.0.1:7000 运行中，但集合接口返回 401（需用户凭证，
代理不持有亦不应记录凭证），故未做浏览器实机截图。替代证据链：
- 渲染路径零新增分支：命中沿用既有 `FORMAT_RULE_LABEL[hit.rule]` 通道（`SubmissionCheckPanel.tsx:992`），
  规则进白名单即自动可见；`normalizeFormatCheckReport` 白名单存活用例已在单测覆盖；
- 逻辑正确性由 12 个新单测 + 20 份真实投标 docx 探针（totalHits 5→2、噪声 3→0）双重锁定；
- 面板说明文案的补全属纯静态文案，`vite build` 通过即证明可编译渲染。
若后续轮取得可登录环境，建议补一次「真实项目体检 → 金额大小写命中卡片展开」的截图留档。

## 7. 挂账

- 本轮把 `r184-bid-amount-consistency-wiring` 收口；`currencyCn.cnyToUpper`（大写生成）仍未被任何生产路径调用
  ——开标一览表「大写金额自动填制」是一个独立的正向能力（可在后续轮按「填表」角度立项）。
- `r186-pii-redact-ai-assembly-wiring`（P3）仍在 open，属安全接线，非用户优先链路，排队。
