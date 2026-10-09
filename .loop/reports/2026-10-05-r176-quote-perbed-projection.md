# R176 · 报价历史二期：每床单价归一化投影（按床位数智能推荐名实相符）

日期：2026-10-05　轮次：R176　优先级：P2　模块：PptQuote

## 选题依据
objective 点名的首要实质 backlog 项 = `quote-history-01 报价历史二期`（按医院等级/床位数/模块组合智能推荐区间）。
勘察确认 R102 已落 `recommendFromHistory`（三维相似度打分 → total_range + module_ranges）、R79 已落 won_sample 沉淀、
最小切片已落同商机历史导入——**推荐器骨架完整，但「按床位数智能推荐」名不副实**：床位只进了相似度打分，
`total_range` 仍直接取相似成交样本的**原始总价**。当当前项目床位规模与样本差异大时区间系统性失真。

## 定位的缺陷
样本池里同为三甲的两笔成交：一笔 200 床 ¥12万、一笔 1000 床 ¥80万。给一家 **500 床** 医院报价时，
`total_range` = ¥12万 ~ ¥80万（横跨 6.7 倍）——对 500 床项目毫无参考价值，用户无法据此判断报价是否合理。
床位数本应是推荐的核心维度，却在最终区间里被完全忽略。

## 修复（纯函数、零 AI、零 collection、零提示词）
`quoteRecommend.ts`：
1. `SimilarMatch` 增加 `beds`（样本床位数，>0 才参与归一化）。
2. `Recommendation` 增加：
   - `per_bed_range`：匹配样本（无匹配则全部成交样本）的**每床单价**区间——对规模不敏感、跨床位尺度可比；
   - `projected_total`：`per_bed_range × 当前床位数` 折算的**推荐总价区间**（缺当前床位或每床区间则 null）；
   - `current_beds`：当前报价床位数（口径展示）。
3. 无床位数据样本自动跳过不污染；note 追加「已按当前 N 床、历史每床中位 ¥X 折算」。

`QuoteEditor.tsx`「成交参考区间」面板新增一行：
「**按当前 N 床折算**：建议总价 ¥low ~ ¥high（中位 ¥median）· 历史每床 ¥a~b（k 样本）」。

## 验证
- 四门：tsc 0 错误；vitest 1166 passed + 2 skipped（quoteRecommend 13→19，净增 6）；eslint 触及 3 文件 0 problem；vite build 3.55s。
- 浏览器实测（localhost:8000/ppt-quote → 报价清单 → 500 床三甲编辑报价；样本 200/1000 床各一）：
  原始「相似成交总价 ¥120,000 ~ ¥800,000（中位 ¥460,000）」误导；投影后正确显示
  **「按当前 500 床折算：建议总价 ¥300,000 ~ ¥400,000（中位 ¥350,000）· 历史每床 ¥600~800（2 样本）」**。
  截图：`.qoder/r176_perbed_projection.png`。
- 临时数据治理：验证用 3 份 `ZZ-TEST-*` 报价（`rh_user_id=local-user`）验证后全部 DELETE，库恢复 `totalItems=0`，零残留。

## 裁定与影响面
- 语义等价红线：新增字段全部向后兼容（缺数据时为 null，不改变既有 total_range/module_ranges/matches 行为）；
  旧调用点无需改动。零 collection/迁移、零提示词。
- `quote-history-01` 二期核心（等级/床位/模块推荐区间）经 R102 + R176 完备，账本标注 done。
- 后续：`quote-history-3-mining`（本地 4085 份 docx 挖掘历史报价样本）维持「用户需要时再立项」，非本轮范围。
