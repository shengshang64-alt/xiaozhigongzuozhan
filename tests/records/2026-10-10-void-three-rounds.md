# 场景自测 — 废标检查真三轮递进（R254 / 易标 R-028 Slice2）

日期：2026-10-10 ｜ 轮次：R254 ｜ 记录人：自动迭代（提示词 + 编排 + 分类）

## 场景口径（AGENTS 强制）
模拟一所三甲医院信息化招标项目「废标条款解析 → 三轮废标检查（定位分类→逐条初检→定稿去误报）→ invalidBid/rejectionItem
分类落库 → 老数据兼容 → 三轮异常降级单轮」全流程，验证 R-028 三轮的真实行为，不破坏单轮快照与既有 17 存量项目。

## 操作步骤
1. 建医院 → 建项目 → 上传招标文件 → 解析出「废标条款」分区（void_items，按行拆条）。
2. 生成/导入投标文件正文 → 进入废标检查 → 点「开始废标检查」→ 成本确认弹「将分三轮（定位→初检→定稿）…（约 3 次调用）」。
3. 第一轮·定位分类：模型对每条条款输出响应位置线索 + 同义词组 + kind（如「未盖章无效」→ invalidBid；
   「某项参数不满足扣分」→ rejectionItem），本阶段不下合规结论。
4. 第二轮·逐条初检：带定位线索先定位后比对，输出 status/response/evidence，目录/附件清单提到材料者豁免不判缺失。
5. 第三轮·定稿复核：对 partial/non_compliant 强制附证据剔误报（第三方证照有效期≠投标人自身、多客户名称正常、
   解析切分噪声不当实质差异等），补 severity（invalidBid→critical、rejectionItem→major）+ suggestion，落 void_check。
6. 报告呈现：每条带 kind 标签（废标项 / 单项否决·扣分项），critical 高亮，可逐项复核。
7. 降级：三轮中任一轮异常（非登录态）→ 自动回退既有单轮废标检查，功能不崩。
8. 老数据兼容：本轮之前落库、无 kind 的 void_check 读出 kind=undefined，展示与行为不变。

## 自动化验证（零模型费用）
`src/pages/BidWorkspace/prompts/voidCheckRounds.test.ts`（5 例）：
- 第一轮 builder：system+user 两段、含 invalidBid/rejectionItem 与 `"scope"` 契约、条款原文注入；
- 第二轮 builder：携带第一阶段 plan、输出 `"items"` 契约、user 含「第一阶段定位与分类」；
- 第三轮 builder：system 含「定稿复核」、输出含 severity；
- `VOID_ROUNDS_PROMPT_VERSION >= 1`；
- `sanitizeVoidCheck`：AI 输出的 kind=rejectionItem 被保留、补漏条款默认 kind=invalidBid。

## 预期 / 实际结果
- 预期：三轮逐轮收窄、条款带 kind 分类、异常降级单轮、老数据与单轮快照零变化。
- 实际：四门全绿（tsc0 / eslint 新 2 文件 0 problem + bidTypes·useBidWorkspace 前后 7 errors·13 warnings 计数一致 /
  vitest 157/1844+2skip（+1 文件 +5 用例）/ build exit0 3.15s）。单轮 voidCheck.ts 与 promptsSnapshot 未动。

## 发现问题
- 测试 `all` 助手初版形参类型 `{role,content:string}[]` 与 `LlmMessage`（content 含 LlmContentPart[]）不符致 tsc 报错，
  已按既有 prompt 测试范式改为 `(m: LlmMessage[])` + `typeof content === "string"` 取值。真实三轮 AI 端到端与
  建阳区样例回归留 Slice5。
