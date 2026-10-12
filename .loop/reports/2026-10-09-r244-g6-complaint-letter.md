# R244 · G6 投诉书六要素生成器（验收报告）

## 背景
《医疗信息化投标全流程规范（整合版）V1.0》2.8 / 附录 E 依《政府采购质疑和投诉办法》（财政部令 94 号）第十八条要求投诉书完整包含六要素，且**投诉以质疑为前置程序**、须写明质疑函编号与答复情况、逐条附证据材料并标注来源。此前 G4 已交付质疑函，用户确认本轮补做**投诉书生成器**，载体「标书工作台·快捷工具」，口径「模板为主 + AI 兜底」。

## 交付物
### 1. 纯模块 `complaintLetter.ts`（零 AI、可测）
- 复用 `ChallengeSupplier` / `ChallengeProject`（与质疑函同构）
- `ComplaintChallengeContext`：质疑函编号 + 质疑提出日期 + 答复情况（no_reply|unsatisfied）+ 答复日期——落实第十八条「前置程序」要素
- `ComplaintItem`：投诉事项 + 请求 + 事实依据 + 法律依据 + **evidence 证据材料**
- `REPLY_STATUS_LABEL`：两种法定可诉情形的正式文书措辞
- `EVIDENCE_SOURCE_HINT`：证据来源标注模板（采购文件/沟通记录/截图/质疑函/质疑答复函）
- `complaintReplyDeadline7WorkingDays` / `complaintFilingDeadline15WorkingDays`：答复期满 +7 工作日、投诉截止 +15 工作日（内部 addWorkingDays 跳周末）
- `buildComplaintLetter`：五段式正式投诉书，落款签字/盖章留空
- `validateComplaintFields`：缺失项校验（含质疑函编号前置 + 逐条证据）
- 单测 `complaintLetter.test.ts`：10 例全绿

### 2. UI `ComplaintLetterPanel.tsx`
- 表单：投诉人信息（5）/项目信息（3）/质疑情况（编号·日期·答复情况下拉·条件答复日期）/投诉事项（动态多条，每项 5 子段含证据材料）/提出日期（预填今天）
- 顶部第十八条时限提示（答复期满 + 投诉截止双档，工作日推算）
- 「生成投诉书」：校验缺项则 toast 提示，否则本地组装预览
- 「AI 兜底补全」：`runWithCostConfirm` 费用门禁 → `chatViaGateway` JSON 数组 → 容错解析 → **仅回填空缺项**（事实/法律/证据）
- 「复制 / 下载」（.txt 带 BOM）

### 3. 挂载 `QuickToolsPanel.tsx`
- 新增「投诉书生成」入口卡（Scale 图标）+ Dialog，透传 `toolMaterial` 上下文、`costConfirm.runWithCostConfirm`

## 门禁
| 门禁 | 结果 |
|---|---|
| tsc --noEmit | 0 错误 |
| vitest run | 1741 passed / 2 skipped（+10 投诉书单测，无 FAIL/无回归）|
| eslint | complaintLetter.ts/test/ComplaintLetterPanel 0；QuickToolsPanel:98 仅 baseline（零新增）|
| npm run build | 成功 3.27s |

## 实机回归（快捷工具场景）
1. 标书工作台 → 快捷工具 → 「投诉书生成」→ 打开投诉书六要素生成器
2. 空表单点「生成投诉书」→ toast 列出全部缺失项（含「质疑函编号（投诉前置）」「投诉事项1（证据材料）」）✓
3. 填六要素点「生成投诉书」→ 预览完整五段式：一、投诉人信息 / 二、项目信息 / 三、质疑情况（答复情况=不满意 + 答复日期）/ 四、投诉事项·事实·法律·请求·证据材料 / 五、日期与签章（签字盖章留空）✓
4. 顶部答复期满 2026-10-20、投诉截止 2026-10-30（工作日推算），第十八条 15 工作日 + 质疑前置注、证据来源标注均正确 ✓
5. 无 console error；截图存 .qoder/r235_complaint_preview.png ✓
