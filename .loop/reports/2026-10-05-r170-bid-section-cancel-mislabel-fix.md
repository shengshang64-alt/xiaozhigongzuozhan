# R170 · 标书「小节串行生成被中断误标 done」修复（技术部分只出 6 页根因）

## 用户诉求
> 「这个生成的标书不对啊！！！才生成了 6 页。和要求相差甚远！！要检查是什么原因？是模型还是哪里有问题」

## 结论：不是模型问题，是代码缺陷
模型正常写出了第 1 小节（3131 字）。根因在生成流程的状态落库逻辑。

## 实机证据（PocketBase 实时数据 + UI 截图）
演练项目「技术部分」章：
- `gen_status="done"`、`sections=11`、`section_stats=1`、`chars=3131`
- UI：生成总览「完成 1/1」，本章「3131 字 / 预算 59500 字 · 约 6 页」

即：该章是「1 章含 11 小节」结构，只生成了第 1 小节就被判为整章 done。

## 根因链路
`generateChapterContent` 的小节级串行分支（`budget > SECTION_GEN_MIN_BUDGET(4500) && sections.length >= 2`）
在 `for (let j = 0; j < k; j++)` 循环里，**只在 `cancelBulkRef.current` 为真时 break**（停止批量 / 返回列表 /
生成中刷新都会置 cancel）。第 1 小节生成后 break → 返回**部分正文**（acc=3131、section_stats=[3131]）→
调用方（单章 / 批量 / 重试三处）**无条件标 `gen_status="done"`**。于是：
- 「完成 1/1」虚高；
- 批量重跑按 done 跳过（skip 条件），永远卡在 6 页；
- 用户误以为已生成完整。

排除项：空回复会 push `chars:0` 统计（得 `[3131,0,...]` 而非 `[3131]`）；抛异常会标 failed（实际是 done）；
单次生成章 `section_stats=[]`。唯一解释是 cancel-at-j=1 后误标 done。

## 修复
### 新增纯函数模块 `chapterCompletion.ts`（+ 7 单测）
- `sectionGenStatus({cancelledMid})` → 中断时返回 `"failed"`，否则 `"done"`。
- `isIncompleteSectionChapter(ch)` → 识别「done 但 `section_stats` 非空且 `sections.length > section_stats.length`」
  的历史误标章（单次章 stats 空、完整小节章 stats==sections 均不误伤）。

### `useBidWorkspace.ts` 8 处补丁
1. 导入两个纯函数；
2. `generateChapterContent` 返回类型加 `cancelledMid?: boolean`；
3. 小节循环声明 `let cancelledMid=false`，break 处置位；
4. 小节分支 return 带 `cancelledMid`；
5. 单章入口：`cancelledMid` → 标 failed + 同步编辑视图 + toast 提示「可断点续跑」+ 早返回；正常路径经 `sectionGenStatus`；
6. 批量 skip：`done && !isIncompleteSectionChapter` 才跳过 → 历史误标章纳入重跑续补（自愈）；
7. 批量 done-mark：`cancelledMid` → failed + 记因 + continue；正常经 `sectionGenStatus`；
8. 补跑重试 done-mark：同上。

## 附带项：previewAigcPrice 本地部署短路（backlog r130-price-preview-404）
`aigc.ts` 在 `isLocalDeployHost()` 时短路返回 `{ok:false, message:"本地部署未挂 price-preview 端点，已跳过预估"}`，
不发起 fetch，消除浏览器 console 原生 404 噪音。契约不变（从不 throw、失败归一 ok:false、View 降级「按实际扣费」），
不影响真实计费（走 callAigcAndPoll）。新增 `aigc.test.ts` 4 用例。

## 恢复指引（给卡住的项目）
对已误标 done 的「技术部分」章：点「继续生成 / 批量重新生成」——修复后该章不再被 skip，
按 `resumeFrom` 断点续跑补足剩余 10 小节；或在章内点「重新生成本章」（fresh）整章重写。

## 四门验证
- `npx tsc -b`：exit 0
- `npx vitest run`：1138 passed + 2 skipped（较基线 +7：chapterCompletion 7；本轮含 aigc 4）
- `npx eslint`（触及文件）：HEAD errors=5 warnings=13 == CUR errors=5 warnings=13，**净新增 0**
  （5 error 均为 useBidWorkspace.ts 既有 setState-in-effect×4 / no-useless-assignment×1，远离本轮编辑行）
- `npx vite build`：成功（built in 3.76s）

## 浏览器验证
localhost:8000/bid-workspace → 技术部分：截图确认「3131/59500 · 约 6 页 · 完成 1/1」卡住态；
evaluate_script 复核实时数据 `{gen_status:"done", sections:11, section_stats:1, chars:3131}`，
命中 `isIncompleteSectionChapter`（done && stats>0 && secs>stats → true），证明批量重跑将续补该章。

## 维持裁定
零 AI 提示词改动（不适用 B 类流程）；未动 pb_hooks / collection（纯前端 state + 落库字段值）；
编造嫌疑「只报不拦」、lint-debt-01 有意残余——均不触碰。
