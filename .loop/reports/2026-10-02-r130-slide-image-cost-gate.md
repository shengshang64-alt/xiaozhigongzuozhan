# R130 PPT 逐页「AI 生图」接入成本确认闸门（计费契约违规实修）

日期：2026-10-02 ｜ 轮次：R130 ｜ 模块：/ppt-quote ｜ 优先级：P1

## 缺陷定位（巡检新角度：付费调用闸门覆盖率审计）

`src/hooks/useCostConfirm.ts` 头注契约：任何调用付费 RHAPI helper
（callAigcAndPoll / callAiApp(.../run) / 付费 callLlmWithFallback）的页面必须经
`runWithCostConfirm` 包裹，禁止裸调。全仓探针（import-graph + 调用点扫描）比对
闸门覆盖率：

| 付费入口 | 是否 gated |
| --- | --- |
| PPT 整份生成 startDeckGeneration (usePptQuote.ts:632) | ✓ |
| PPT 逐页精修 refineSlide (:743) | ✓ |
| 报价 AI 初稿 generateQuoteDraft (:1765) | ✓ |
| 标书 AI 位图 generateAiFigures (useBidWorkspace.ts:2536，先 previewAigcPrice 再确认) | ✓ |
| 标书智能编排 (:2410) 及其余 35 处 runWithCostConfirm | ✓ |
| **PPT 逐页手动「AI 生图」aiGenerateImageForSlide (:997 裸调 callAigcAndPoll("nano-banana-pro"))** | **✗ 唯一漏网点** |

批量自动配图(runAutoFigure AI 分支)只从 doGenerateDeck 尾段触发，已被整份生成
确认覆盖，不构成独立漏网；逐页手动按钮（SlideEditor.tsx:496 →
DeckEditorWorkspace.tsx:266 → hook）是全站唯一裸调付费生图的交互。本部署
`visitorPaysForAi = true`（auth.ts:22），弹窗真实生效——点击即静默消耗 RH 币。

## 修复方案（对齐标书侧 AI 位图既有口径，非新发明）

1. 原实现逐字改名 `doAiGenerateImageForSlide`（内部，逻辑零变更）；
2. 新增同名 gated 包装：`previewAigcPrice`（从不 throw，失败归一 {ok:false}，
   绝不挡生成）→ `costConfirm.runWithCostConfirm`，文案「将调用 AI 为本页生成
   实景配图（1 次生图调用，预估单价 …），实际扣费以 RunningHub 为准」；
3. 消费侧类型同步：包装为 fire-and-forget（与 gated 先例 refineSlide 同型），
   DeckEditorWorkspace.tsx prop 类型与 SlideEditor.tsx onAIGenerateImage 类型
   `Promise<boolean>` → `void`（调用点本就是 `void` 丢弃返回值，行为等价）。

## 在途代码保护

usePptQuote.ts 为 git-M（用户 313 文件在途未提交），改前 `git diff -U0` 核对：
WIP hunk 位于新行 5/15/25/26/64/121-124/141-147/764/1125/1443/1776/1789/1977/2245，
本轮触碰 import 行 20 与 983-1024 区间，全部不在任何 WIP hunk 内。
SlideEditor.tsx / DeckEditorWorkspace.tsx 均 git-CLEAN。补丁
scripts/r130_slide_image_cost_gate.py 每 hunk assert count==1，备份验证后清理。

## 四门验证（目标项目目录）

- npx tsc -b：exit 0
- npx vitest run：869 passed + 2 skipped（= R129 基线，82 文件全绿；本轮为
  hook 接线修改，逻辑体零变更，单测增量 0，以实机验证代替）
- npx eslint 触及 3 文件：改前 5 error(set-state-in-effect)+1 warn(exhaustive-deps)
  = 改后逐规则逐文件一致，净新增 0（全部为既有 react-hooks 基线）
- npx vite build：exit 0（3.74s）

## 实机验证（dev :8000，真实登录态）

新建测试 deck → 逐页编辑 → 第 1 页（imageHint=医院门诊大厅，文左图右）点
「AI 生图」：
- 弹出「确认运行」成本对话框，文案逐字命中「将调用 AI 为本页生成实景配图
  （1 次生图调用），实际扣费以 RunningHub 为准」✓（截图 _shots/R130/）
- 点「取消」：弹窗关闭、页面无成功 toast、网络层无任何生图请求发出 ✓
- 验证后测试 deck 已删除（列表归 0），零数据残留
- 未点「确认运行」，零真实扣费

## 已知观察（如实记录，非本轮引入）

console 唯一 error 为 `POST /__pb/api/aigc/price-preview 404`——本机 PocketBase
未实现价格预估端点。previewAigcPrice 契约本就「从不 throw、预估失败不挡生成」，
弹窗正确降级为不带单价。标书侧 generateAiFigures 走同一 helper、同表现，属
既有环境缺口而非新缺陷；补端点需动 pb_hooks（受 hook-security-01
deferred-by-user 裁定约束），已挂账 r130-price-preview-404。

## 维持裁定不动

编造门禁只报不拦(R89)、lint-debt-01 残余不重构、r112/r118/r119/r124 四个
defer 项锚点文件本轮复核仍全部在途继续绕开。零提示词、零 collection、零
pb_hooks、未 commit。
