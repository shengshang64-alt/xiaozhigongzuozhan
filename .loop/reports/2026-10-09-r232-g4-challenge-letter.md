# R232 · G4 质疑函六要素生成器（验收报告）

## 背景
《医疗信息化投标全流程规范（整合版）V1.0》第十二条要求质疑函须完整包含六要素。经与用户确认，本轮 **只做质疑函**（投诉书留后续），载体为「标书工作台·快捷工具」，口径「模板为主 + AI 兜底」，与 G1-G3 一致。

## 交付物
### 1. 纯模块 `challengeLetter.ts`（零 AI、可测）
- 类型：`ChallengeSupplier` / `ChallengeProject` / `ChallengeItem` / `ChallengeLetterInput`
- `STANDARD_LEGAL_REFS`：内置常见质疑场景法条引用模板（规模/地域/品牌/授权/权属/软著/源码/范围/付款/维保/未公开实质条款/通用）
- `challengeDeadline7WorkingDays(date)`：顺延 7 个工作日（跳周末）返回 YYYY-MM-DD
- `buildChallengeLetter(input)`：六要素组装正式质疑函，多条质疑事项逐条编号「质疑事项N」，落款签字/盖章留空
- `validateChallengeFields(input)`：返回缺失要素列表
- 单测 `challengeLetter.test.ts`：8 例全绿

### 2. UI `ChallengeLetterPanel.tsx`
- 六要素表单：供应商信息（5）/项目信息（3）/质疑事项（动态增删，每项 4 子段：事项·事实依据·法律依据·请求）/提出日期（预填今天）
- 顶部 7 工作日时限提示
- 「生成质疑函」：校验缺项则 toast 提示，否则本地组装预览
- 「AI 兜底补全」：经 `runWithCostConfirm` 费用门禁 → `chatViaGateway` 输出 JSON 数组 → 容错解析 → **仅回填空缺项**（不覆盖人工已填）
- 「复制 / 下载」（.txt 带 BOM，UTF-8）

### 3. 挂载 `QuickToolsPanel.tsx`
- 新增「质疑函生成」入口卡（Scale 图标）+ Dialog，透传 `toolMaterial` 作招标文件上下文、`costConfirm.runWithCostConfirm`

## 门禁
| 门禁 | 结果 |
|---|---|
| tsc --noEmit | 0 错误 |
| vitest run | 1689 passed / 2 skipped（+8 质疑函单测，无回归）|
| eslint | ChallengeLetterPanel/challengeLetter.ts/test 0；QuickToolsPanel:96 仅 baseline（零新增）|
| npm run build | 成功 3.07s |

## 实机回归（建阳区总医院场景）
1. 标书工作台 → 快捷工具 → 「质疑函生成」→ 打开质疑函六要素生成器
2. 空表单点「生成质疑函」→ toast 列出全部缺失项（供应商名称、注册地址、联系人、联系电话、项目名称、项目编号、质疑事项1 内容/请求/事实依据/法律依据）✓
3. 填六要素点「生成质疑函」→ 预览完整输出：一、供应商信息 / 二、项目信息 / 三、质疑事项·事实依据·法律依据·请求（事项1 逐条）/ 四、日期与签章（提出日期、签字盖章留空）✓
4. 顶部 7 工作日截止提示（起算今天则为 2026-10-20）、预填日期「2026年10月9日」✓
5. 复制 / 下载按钮渲染 ✓

## 未做（用户确认留后续）
- 投诉书（第十三条）生成器：留后续轮次。
