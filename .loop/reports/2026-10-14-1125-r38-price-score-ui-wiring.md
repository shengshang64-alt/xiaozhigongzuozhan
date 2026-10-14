# R38 · 2026-10-14T11:25+08:00 · 价格分测算接 UI（B12）

**完整轮报见 `docs/evolution/R38_20261014.md`。**

## 一句话

R38（账本 round 37→38 / _loop_state round 38→39）：把 R35 交付、R36 修对的价格分算法层第一次接成用户入口——新增 priceScoreBrief.ts 确定性视图模型 + PriceScorePanel.tsx 本地零 AI 面板，挂在第 6 步「模拟评标」之下。我方报价取关联商机报价单总额（单源，numeric-consistency-02 做法 B 同源），对手报价强制手输（竞对情报存的是中标金额不可冒用），单位歧义不静默换算只点破，临界价踩进废标区间时红字守护。零新 collection、零 pb_hooks、零提示词改动。验证：vitest 218 files / 2593 passed（+2 files +38 用例）；build exit 0；eslint 触及文件本轮新增 0 error（首轮 3 处已修）；浏览器真实库审计 23 项目（8 可算 / 6 拒算 / 4 无价格分项）+ 安庆二院真实公式出数（基准价 550 万、得分 27.5、临界价 -8.33%）。全仓 tsc 现存 5 error 全在在途文件（model-config×3 + 并发 bidDocxFormatExtract×2），本轮按红线未碰。

## 门禁

- `tsc`：本轮 7 文件 0 error；全仓 exit 2，5 error 全在在途文件（model-config×3 + 并发新增 bidDocxFormatExtract×2）
- `vitest`：pass（218 files / 2593 passed / 2 skipped；本轮 +2 files +38 用例，算法层 34 例未回归）
- `eslint`：pass（触及文件本轮新增 0 error；首轮曾新增 3 处 set-state-in-effect / no-useless-assignment，已修）
- `build`：pass（npx vite build exit 0，6076 modules / 4.85s；价格分测算落在 BidWorkspace 路由 chunk）

## 变更文件

- src/pages/BidWorkspace/priceScoreBrief.ts（新增，确定性视图模型：parseMoneyInput / parsePriceListInput / buildPriceScoreView / fmtPriceText / fmtScore）
- src/components/bid-workspace/PriceScorePanel.tsx（新增，第 6 步面板：口径卡 + 四路输入 + 结果四卡 + 临界价守护 + 敏感性阶梯）
- src/pages/BidWorkspace/priceScoreModel.ts（+listPriceScoringCandidates，认不出也逐项说明；findPriceScoringItem 行为不动）
- src/pages/BidWorkspace/useBidWorkspace.ts（报价单快照并置 state 并导出；setState 全部移入异步回包）
- src/pages/BidWorkspace/BidWorkspacePage.tsx（第 6 步挂载 PriceScorePanel，key 按项目重挂载）
- src/pages/BidWorkspace/priceScoreBrief.test.ts（新增 27 例）
- src/pages/BidWorkspace/priceScoreWiring.test.ts（新增 11 例源码扫描哨兵）
- docs/evolution/R38_20261014.md（新增轮报）

## 需知悉

- **F38-1**（P1（阻塞 tsc/build 门禁判读））：并发在途扩大：除 R37 已登记的 model-config 批次外，本轮期间 BidWorkspace 域又出现 DraftMergePanel.tsx（+40，中途语法错误）、FormatSyncDialog.tsx（新）、bidDocxFormatExtract.ts（新，2 处类型 error） → 本轮未碰这些文件；仍需用户拍板各批次 提交/继续/回滚，否则全仓 tsc 门禁持续假阳性
- **F38-2**（info（正面证据））：真实语料全库审计：23 个投标项目中价格分口径可机械复算 8 个、被明确拒算 6 个、无价格分项 4 个；拒算原因主要是「不属于比值法/偏差扣分法」与「未标明评标基准价如何确定」 → R35「认不出就不算」在真实库上无一例误算；若要把拒算的 6 例纳入测算，属 B13 口径扩充，需真实条款驱动
- **F38-3**（P2）：第 6 步准入门槛（dup_report || void_check）使真实库仅 1 个项目可进入模拟评标，且该项目无评分办法 → 新面板的出数态无法走正常点击进入做人工点验 → 留待产品判断：是给演示项目补本地查重/废标报告，还是放宽准入；本轮不擅自改门禁
