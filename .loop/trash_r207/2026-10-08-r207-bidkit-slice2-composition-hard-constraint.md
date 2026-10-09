# R207 · bidkit-plan-slice2-fallback-hard-constraint（R-003 无底稿兜底 · 响应文件组成硬约束）

日期：2026-10-08    轮次：R207（round 206→207）    优先级：P0    模块：/bid-workspace

## 一、选题依据
账本 R206 完成 bidkit 切片 1/6（R-002 内容范围三模式），本轮接续 **切片 2（R-003）**，为用户 P0 需求、标书主链路，属实质性优化（优先于零风险小改）。用户点名的 quote-history-01 / prompt-fabscan-03 经账本核实均已 closed/done，故按“接续 bidkit 切片序列 + 标书优先”择优。

R-003 诉求：无底稿兜底要显式对齐招标文件的**响应文件组成与评分要求**。原 bidOutline / outlineLevel1 的【响应文件要求】段只有一句弱表述「响应文件要求须逐条落实」，未强制“章节顺序与命名严格按 composition 逐项映射”，缺 composition 时也无提示——用户会误以为是“系统乱编目录”。

## 二、变更文件（6 个，全部会话内 state + 只读 parse_report，零 collection / 零 pb_hooks）
- `src/pages/BidWorkspace/prompts/bidOutline.ts` — **提示词**：PROMPT_VERSION 2→3；`respText` 非空时向硬性要求注入「响应文件组成硬约束」句（缺组成不注入）。
- `src/pages/BidWorkspace/prompts/outlineLevel1.ts` — **提示词**（长标书分步 call1 路径）：PROMPT_VERSION 2→3；同上注入。
- `src/pages/BidWorkspace/bidTypes.ts` — 新增只读判据 `hasBidComposition(report)`（response_req 非空）。
- `src/pages/BidWorkspace/useBidWorkspace.ts` — generateOutline 前：缺「响应文件组成」时 `toast.info` 诚实告警 + 引导回第 2 步补解析，**不阻断**（维持“只报告不拦截”裁定）。
- `src/components/bid-workspace/ComposeStep.tsx` — 顶部副标题文案点明兜底语义。
- `src/pages/BidWorkspace/prompts/outlineGate.test.ts` — +3 单测（判据三态 / 有组成注入 / 缺组成不注入）。

说明：`ParseConfigDialog` 未改——`response_req`(响应文件要求)本就是 `PARSE_KEY_SECTIONS` 8 项必选之一，plan(c)“必勾”已天然满足。

## 三、新旧口径逐字对比（B 类）
### bidOutline.ts
- PROMPT_VERSION：`2` → `3`
- 新增（条件 `if (respText)` 注入硬性要求数组，置于 05 三模式段之前）：
  > 响应文件组成硬约束：下面【技术方案与响应要求】中「响应文件组成」列出的每个组成部分（如报价文件、商务文件、技术文件、资格证明、承诺函、授权委托书、响应表、偏离表等），必须逐项映射为目录中对应的顶层章或专门小节，顺序与命名保持一致，不允许合并或改名；组成未列出但编制必需的常规章可在末尾补充；

### outlineLevel1.ts
- PROMPT_VERSION：`2` → `3`
- 新增（条件 `if (respText)`，置于 starText 段之前）：
  > 响应文件组成硬约束：下面【响应文件要求】中「响应文件组成」列出的每个组成部分，必须逐项映射为对应的顶层章，顺序与命名保持一致，不允许合并或改名；组成未列出但编制必需的常规章可在末尾补充；

### ComposeStep.tsx 副标题（hasParse 分支）
- 旧：`按解析出的评分办法与响应要求组织技术标，可从方案编制引入底稿`
- 新：`未上传底稿时，按招标文件解析出的响应文件组成与评分要求自动编排全部内容；可从方案编制引入底稿`

### useBidWorkspace.ts generateOutline（前置告警，不阻断）
- 新增：`if (!hasBidComposition(cur.parse_report)) toast.info("未解析到「响应文件要求」的响应文件组成，大纲将按评分办法与常规骨架兜底编排；建议回到第 2 步补勾并解析该项以严格对齐招标组成要求")`

## 四、向后兼容与快照
新注入为**纯条件式**（仅当 `response_req` 分区非空），缺省报告（`report=null`）不触发。`promptsSnapshot.test.ts` 与 `scopeTriMode.test.ts` 对 bidOutline/outlineLevel1 的调用均传 `report=null`，输出**逐字不变**，快照零漂移——`npx vitest run` 未产生任何快照 diff（无需 -u，实际全绿）。

## 五、维持裁定
- 编造嫌疑/缺组成“只报告不拦截”：沿用，缺 composition 仅 toast.info，不阻断生成。
- lint-debt-01 有意保留残余不重构：不触碰。

## 六、四门验证
- tsc -b：EXIT=0，零错误。
- vitest run：131 files / **1554 passed | 2 skipped**（含本轮 +3 outlineGate 用例）；快照无失配；EXIT=0。
- eslint 触及 6 文件：9 个 error 全部位于 R207 改动区之外（outlineLevel1.ts L58 R206 `${techHint}`/`part=\"tech\"` no-useless-escape；bidTypes.ts L3596/3598 no-control-regex；useBidWorkspace.ts L1130/1194/1280/2987/7983 setState-in-effect/no-useless-assignment），均为 R206 在途既有 error；**R207 新增 error = 0**。
- vite build：EXIT=0，5983 modules transformed，built in 3.83s。

## 七、数据模型影响
零新增 collection、零会话外持久化、零 pb_hooks；仅只读 parse_report 判据 + 会话内告警。

未 git commit（遵守门禁）。
