# R254 报告 — 废标检查真三轮递进（易标 R-028 Slice2）

日期：2026-10-10 ｜ 轮次：R254 ｜ 模块：标书工作台/BidWorkspace ｜ 优先级：P0

## 背景与决策
易标《可复用能力分析》R-028 要求废标检查由「单轮一次性比对」升级为「真三轮递进（定位分类 → 逐条初检 → 定稿去误报）」，
并引入条款分类（对齐易标 check_engine L1 bid_killer / L2 company_redline）。用户已拍板：项目正式废标检查走真三轮、
授权额外 3 次模型调用；单轮版保留（快捷工具路径 + 三轮异常降级兜底）。

## 落地内容
1. **新建 `prompts/voidCheckRounds.ts`**（不进 promptsSnapshot 注册表 → 单轮 `voidCheck.ts` 原文与快照零破坏）：
   - `VOID_ROUNDS_PROMPT_VERSION = 1`；三个 builders：
     - `buildVoidScopeMessages`（第一轮·定位与分类）：逐条输出 should-be 响应位置线索 `where` + 同义词组 `synonyms` +
       `kind`（invalidBid / rejectionItem），本阶段不判合规；输出 `{"scope":[...]}` JSON 契约。
     - `buildVoidInitialCheckMessages`（第二轮·逐条初检）：携带第一阶段 plan，先定位后比对，输出
       `{"items":[{clause,kind,source_location,response,response_location,status,evidence}]}`；含「结构性线索豁免」
       （目录/附件清单提到材料不判 non_compliant，因解析看不到图片/扫描件）。
     - `buildVoidFinalizeMessages`（第三轮·定稿复核）：对 partial/non_compliant 强制证据剔误报，6 条防误报规则
       （证照归属主体 / 多客户名称正常 / 解析切分噪声不当实质差异 / 「待确认」流程行文豁免 / 目录线索补注人工核对），
       补 `severity`（invalidBid 默认 critical、rejectionItem 默认 major）+ `suggestion`，输出定稿矩阵。
2. **`bidTypes.ts`**：新增 `VoidKind = "invalidBid" | "rejectionItem"`、`VOID_KIND_LABEL`、`asVoidKind`；
   `VoidItem.kind?: VoidKind`（可选，老数据缺省 undefined）；`sanitizeVoidCheck` 保留 `kind: asVoidKind(r.kind)`、
   补漏条款默认 `kind: "invalidBid"`；`normalizeVoidCheck` 透传 `kind`。
3. **`useBidWorkspace.ts`**：`runVoidCheckThreeRounds(clauses, bidText, starBlock)` 串起三轮（每轮 `llmGenerate` +
   `withJsonRepair(extractJsonLoose)`，定稿 `sanitizeVoidCheck`）；项目正式 `runVoidCheck` 三轮化，
   三轮任一非授权异常 → 降级既有单轮（`AuthRequiredError` 仍上抛）；成本确认文案改为「将分三轮（定位→初检→定稿）…
   （约 3 次调用）」。

## 兼容与边界
- 单轮 `voidCheck.ts` 与 `promptsSnapshot.test.ts` 未改动（新 prompt 文件不入注册表）。
- `VoidItem.kind` 为可选字段：确认全仓无测试对 VoidItem 做 deep-equal，加字段安全；老 void_check 读出 kind=undefined。
- 三轮失败自动回退单轮，AI 抖动/限流下功能不崩（AGENTS「AI 不可用可降级」口径）。

## 四门禁（WIP 基线对照，全绿）
- `npx tsc -b` exit 0。
- `npx eslint`：新 2 文件（voidCheckRounds.ts / .test.ts）0 problem；bidTypes.ts + useBidWorkspace.ts 改前后均
  7 errors · 13 warnings（.bak-r254 还原对照计数一致 → 零新增在途既有问题）。
- `npx vitest run`：157 files / 1844 passed / 2 skipped（基线 156/1839，+1 文件 voidCheckRounds.test.ts +5 用例均本轮）。
- `npx vite build` exit 0（3.15s）。

## 补丁
`scripts/r254_void_rounds.py`（bidTypes 5 处 + useBidWorkspace 4 处锚点，全部 count==1 一次通过；
新建 2 文件；改前 .bak-r254）。测试 `all` 助手类型修正 `scripts/r254_fix_test.py`。未 commit。

## 后续
Slice3（R-029 扫描件检测 parse_quality）、Slice4（R-030 required 分级阻断）、Slice5（R-026③ 条数下限报警 +
建阳区样例端到端回归）待做。
