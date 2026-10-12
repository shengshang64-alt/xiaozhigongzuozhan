# R246 · 底稿增量合并三项细化（bidkit-draft-refine-01 全清）

- 日期：2026-10-09
- 轮次：R245 → R246
- 优先级：P2（标书侧 · 用户实测后新开的直接接续项）
- 模块：/bid-workspace（底稿增量合并 DraftMergePanel + 落库口径 bidDraftPlan）

## 一、选题依据

用户建议优先做 quote-history-01、prompt-fabscan-03，但复核账本发现二者均已关闭：
- quote-history-01：一期 R40 / 沉淀通道 R79 / 二期区间推荐 R102 全链路交付，status=done；
- prompt-fabscan-03：P7.1 四态 R101 / 按章聚合回注 R103 / P7.2 consistencyGuard，backlog 已 closed。

且用户长期裁定「选题优先 标书 > 方案 > PPT，弱化报价」。据此改选 R245 收口当轮实测新开的
`bidkit-draft-refine-01`（P2，标书侧直接接续）——它是上一片「底稿增量合并」用户实机走查后登记
的三项细化，均为真实可用性缺陷，改造点小、锚点安全、零风险外溢，符合"实质性优化"而非零碎小改。

## 二、三项细化与实现

### ① 参考段要点择优选取（bidDraftPlan.ts · selectRefExcerpt）
旧口径：`ref_materials` 参考段每条超 900 字时机械截断开头 `body.slice(0, 900)`，长底稿常把
「质保 / 工期 / 响应时长 / 数量」这些**可核对的量化承诺**截在窗外，AI 重写时拿不到要点。
新口径：正文超上限时按「首句（保语境）+ 标题命中句 + 量化承诺句」依**原文顺序**拼到上限，
被略过的填充段以省略号示意。
- `refTitleBigrams`：标题去编号/标点取二元组，句子命中标题词加权；
- `isQuant`：含数字且命中 万/亿/%/年/月/日/台/套/人/承诺/工期/质保/免费/培训/交付/上线/响应/分钟/小时/驻场/SLA 加权；
- 单句超上限仍回退到截断 + 省略号（保持旧「超长正文截断」用例语义）。

### ② 孤儿「底稿多出章」清退（bidDraftPlan.ts · applyMergePlan）
旧缺陷：底稿多出章 id 为 `draft-extra-${idx+1}`，只靠同名节点幂等覆盖。换一份**更短**底稿重新
应用时，上一轮追加、本轮已不存在的追加章不被回收，长期残留在章节清单与大纲里。
新逻辑：`appendExtraChapter` 把本轮真实落地的 id 收进 `keptExtraIds`；应用末尾清退满足
「node_id 以 draft-extra- 开头 且 draftLocked=true 且不在 keptExtraIds」的孤儿章（章节 + 大纲同步删）。
保守边界：只动仍标记底稿保留的追加章（用户手动解标记 / 改归属的不碰）；`appendExtras=false`
视为「只重匹配、不新增追加」，保留既有追加章**不清退**。summary 新增 `pruned` 字段记账。

### ③ 空大纲引导卡（DraftMergePanel.tsx）
旧缺陷：`bid_chapters.length === 0`（大纲未确认）时面板整体 `return null`，用户误以为「底稿增量合并」
功能缺失。新逻辑：该状态下渲染一张虚线引导卡，指回「解读招标文件 → 生成大纲 → 确认章节」动线，
告知确认后再回来上传底稿。零新状态、零副作用。

## 三、变更文件
- src/pages/BidWorkspace/bidDraftPlan.ts —— selectRefExcerpt + 要点助手 / pruned 字段 / 孤儿清退
- src/components/bid-workspace/DraftMergePanel.tsx —— 空大纲引导卡 + 清退口径的 toast 与已应用卡片说明
- src/pages/BidWorkspace/bidDraftPlan.test.ts —— 新增 2 用例（要点择优 / 孤儿清退含 appendExtras=false 分支）+ 既有 summary 断言补 pruned

零 collection / 零 pb_hooks / 零提示词 / 零迁移；效果全落在既有 bid_chapters / bid_outline / ref_materials_text。

## 四、四门验证（目标项目目录）
- tsc -b：**0 error**
- vitest run：**150 files / 1769 passed / 2 skipped**（基线 1767，+2 用例）
- eslint（触及 3 文件）：**0 error**
- vite build：**✓ built in 3.22s**（6018 modules transformed）

## 五、维持的裁定（未触碰）
- 编造嫌疑未清零禁导出：维持「只报告不拦截」（R89 边界裁决）；
- lint-debt-01 有意保留残余：不重构；
- quote-history / prompt 类已关闭项：不重开。

## 六、backlog 状态
- bidkit-draft-refine-01 → **closed**（三项细化全部交付）。
