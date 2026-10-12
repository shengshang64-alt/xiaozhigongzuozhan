# R222 · R-020 商务/技术判定改按评分办法 + mustWrite 解耦（第 2 轮改造 · 标书链第三 slice）

## 选题依据
第 2 轮 M 类根因：是否编写某章此前**只看模型给的 part==="biz"**（isBizPart）。模型一旦把评分办法里的
必写技术内容误标商务骨架章，商务/技术分开出（outlineScope=tech/biz）时就被整章丢弃 → 丢分
（建阳区「售后服务/技术培训」被当商务砍掉）。R-020 是后续 R-023/022/017/018 的判定基础，排第三做。

## 变更文件
- 新增 src/pages/BidWorkspace/bidMustWrite.ts（纯本地零 AI：六级信号判 mustWrite + verdict + reason，与 part 解耦）
  · ①评分办法含对应技术评分项（最强，双向近义匹配） ②/③分值>0 且技术关键词/形态方案响应参数 ④★▲实质性
  · ⑤目录归类仅降权佐证（不作硬开关，注释说明） ⑥要求性表述兜底（须提供/应编制/需提交，用户拍板追加，判 uncertain 待人工确认）
  · 商务专属词（投标函/报价表/保证金/资质/业绩/承诺函…）命中且无技术强信号 → 判 biz 不必写
- 新增 src/pages/BidWorkspace/bidMustWrite.test.ts（6 例：评分项命中必写、误标 biz 回收 rescued、★▲必写、
  要求性兜底 uncertain、商务骨架不必写、缺省无 part 按 tech 兼容）
- 改 src/pages/SolutionStudio/solutionTypes.ts（OutlineNode 新增 mustWrite?: boolean，与 part 解耦）
- 改 src/pages/BidWorkspace/useBidWorkspace.ts（import applyMustWrite/judgeMustWrite；mustWriteRescued state；
  生成收尾建 mwCtx=技术评分项名；三处 outlineScope 过滤 tech 分支由 !isBizPart 改为 !isBizPart||judgeMustWrite().mustWrite
  ——**现算不依赖字段存活于模型重写**；cleanOutlineResidue 前 applyMustWrite 持久化 mustWrite + 回收 rescued + toast；return 暴露）
- 改 src/pages/BidWorkspace/BidWorkspacePage.tsx（activeStep===3 渲染「R-020 判定纠偏」提示条：列出被改判保留的章，可手动回退）

## 关键取舍
- 现算 vs 存储：三处过滤都在模型可能重写节点(gateFixed/fixed)之后，若依赖 n.mustWrite 字段会因重写丢失 →
  过滤时现算 judgeMustWrite(n, mwCtx).mustWrite，只在最终 setOutlineDraft 前持久化一次，稳。
- 保守判 biz：宁可漏判商务（多写一章）也不误砍技术必写章（丢分），故技术强信号优先于商务词，且商务词命中仍让位于评分项/★▲/技术关键词。
- 存量兼容：未重新生成的老项目 bid_outline 无 mustWrite → 过滤行为同现状，零回归。

## 四门验证
- tsc --noEmit：0 error
- vitest run：1615 passed | 2 skipped（基线 1609，+6 全绿，0 回归）
- eslint（bidMustWrite + 测试 + 页面 + solutionTypes 4 文件）：0 issue，零新增
- npm run build：success 4.04s

## 遗留 / 后续
- 页面逐章徽标（属技术/属商务/待人工确认可点改）留待与 R-023 双层目录 UI 合并做，本 slice 先给纠偏提示条 + 大纲手动可改归属。
- 一键补入(R-025)生成的是 tech 占位章；mustWrite 让分开出时必写技术章不被误砍，二者互补。
