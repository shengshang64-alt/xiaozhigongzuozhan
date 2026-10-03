# R103 — 覆盖审计「按章聚合回注改进建议」（prompt-fabscan-03 剩余切片收口）

日期：2026-10-01 ｜ 轮次：R103 ｜ 优先级：P1 ｜ 类别：交互范式新增（非 B 类，见下）

## 选题依据
- 账本 round=102；quote-history-01 已于 R102 closed。backlog 唯一 P1 实质项 prompt-fabscan-03
  剩余切片「按章聚合回注改进建议（新交互范式）」，用户已授权自主推进（R89 边界裁决把该项从
  「需拍板」释放为可按 B/A 类流程实施；P7.1 四态升级已于 R101 落地）。
- 维持裁定不推翻：编造未清零禁导出硬门禁仍不做（只报不拦）；lint-debt-01 残余不重构。

## 实现（先读现有报价/审计实现后的设计决策）
问题：覆盖审计结果是逐叶（节）平铺的，同一顶层章下多个问题节要逐个手动点「补写」，
改进建议没有章级视角，也无法一次确认修完一章。

方案（3 文件分层，纯本地聚合 + 复用既有回注通道）：
1. `prompts/coverageAudit.ts` 新增纯函数（零 AI、PROMPT_VERSION 保持 2 不动）：
   - `buildReflowDirective`：单叶回注指令文案**单一来源**（从 supplementFromAudit 原样抽出，
     逐字对比见下）；over 走「必须删除…收敛」口径、partial/missing 走「必须补充…响应」口径。
   - `aggregateAuditByChapter`：非 full 条目按 resolveLeafSection 归入顶层章，按大纲章序输出，
     章内 worst 取最严重档（missing>over>partial），并生成可复制的章级改进建议文本 directive。
   - `collectReflowFixItems`：把章内问题叶落位为小节重写清单（按 sections 标题匹配下标；
     整章级叶/定位失败叶剔除；同一小节被多叶命中时指令换行合并为一次重写）。
2. `useBidWorkspace.ts`：
   - supplementFromAudit 改用 buildReflowDirective（行为等价）。
   - 新增 `reflowChapterFromAudit`/`runChapterReflow`/`chapterReflowBusy`：一次费用确认后
     对该章问题小节**串行** await runRegenerateSection 逐条重写（复用循环5 A2 补写通道，
     不新造生成链路、不动章级生成 prompt）；批量前校验登录/归档/并发锁；每轮取
     activeProjectRef 最新值防项目切换踩踏。
3. `SubmissionCheckPanel.tsx` 覆盖审计卡新增「逐节明细 / 按章聚合」视图切换（默认逐节，
   旧交互零变化）；按章视图含章分组卡（worst 徽章+问题节数+逐节漏点明细）、
   「复制建议」（零成本兜底通道）与「整章回注整改」（一次确认、串行重写、回注中禁用互斥）。

## 提示词口径对比（B 类流程核查）
本轮**未修改任何 AI 提示词文本**：聚合与回注全部本地完成，回注走既有 extraRequirements→
writing_focus 拼接通道（循环 5 A2 既有语义）。指令文案逐字对比：
- 旧（supplementFromAudit 内联）：`必须删除正文中以下过度承诺（加码）点，收敛回招标要求与写作计划的口径，不得再作无依据承诺：${extra}` /
  `必须补充覆盖审计发现的以下漏点并给出实质性响应：${extra}`，extra 皆空时 directive=undefined；
- 新（buildReflowDirective）：同两串**逐字一致**，extra 皆空返回 ""，调用处 `|| undefined` 归一。
结论：语义零漂移，无需 PROMPT_VERSION+1；提示词快照测试未重生成（-u 未动），647 全绿佐证。

## 数据模型
零 collection、零 pb_hooks：聚合结果与回注进度均为会话内 state（与 coverageAudit 同生命周期），
符合「优先会话内 state」裁定。

## 四门验证
- npx tsc -b：exit 0，零错误。
- npx vitest run：60 文件 647 passed / 2 skipped（基线 641 → **+6**，coverageAudit.test.ts 新增
  buildReflowDirective 口径 1 用例 + aggregateAuditByChapter 分组/排序/worst/丢弃 3 用例 +
  collectReflowFixItems 落位/同节合并 2 用例）。
- npx eslint 触及 6 文件：7 error 全部为既有/有意保留（bidTypes 3480/3482 no-control-regex＝
  lint-debt-01 保留项；useBidWorkspace 945/1009/1095/2601 setState-in-effect 与 7072
  no-useless-assignment 均不在本轮插入行区间）→ **零新增 error**；新增文件 coverageAudit.ts
  追加段、SubmissionCheckPanel.tsx、BidWorkspacePage.tsx、测试文件本身 0 error。
- npx vite build：exit 0 成功。

## 在途代码核对
改前 git status：189 个在途修改文件（R101/R102 及用户未提交在途），补丁锚点全部用
assert count==1 精确命中本轮目标行，未回滚/覆盖任何在途 hunk；未执行任何 git commit。
