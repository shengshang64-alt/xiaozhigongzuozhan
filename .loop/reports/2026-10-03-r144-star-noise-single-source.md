# R144 · ★/▲ 重点条款噪声清洗统一为单一真源，覆盖三条产出通道（承接 R143）

- 日期：2026-10-03　轮次：144　主攻：`/bid-workspace`（重点条款 / 合规矩阵）
- 选题来源：R143 修复 `extractStarClauses` 目录行污染后复盘发现的**残余缺口**——同一噪声只在一处过滤，另两条通道仍污染下游。

## 一句话结论
R142 F-A 指出噪声会灌进「合规矩阵 / 关键项响应清单」。R143 只在**本地扫描通道**（`extractStarClauses`）起了过滤作用，
但 `star_clauses` 还有两条产出路径没被覆盖：
1. **AI 整文解析**通道 → 经 `normalizeParseReport` 入库/读取，目录行原样保留；
2. **AI 补扫**通道（`ComplianceMatrixPanel` 的 runScan）直接把 AI 返回的行组成 `ParseSection` 写进内存态报告，**绕过 normalize**，
   矩阵立即读到污染行（交完 AI 费那一刻就中招）。
本轮把噪声判定抽成**单一真源** `starClauseNoise.ts`，在三处消费者共用同一口径，AI 两通道与存量数据一并干净。

## 改了什么（纯函数层，零 AI、零 schema、零 pb_hooks、未改提示词）
- **新增 `src/pages/BidWorkspace/starClauseNoise.ts`**（零依赖单一真源）：
  `looksLikeTocClauseLine` / `looksLikeStarDefinitionLine` / `isStarClauseNoiseLine` / `cleanStarClauseContent`（按「条」丢弃噪声标记行**及其续行**，幂等）。
- **`bidTypes.ts`**：撤除 R143 内联的两段判定（约 18 行），改 `import` 单一真源；`extractStarClauses` 起条处改调 `isStarClauseNoiseLine`（行为等价）；
  `normalizeParseReport` 读路径对 `star_clauses`（非手改段）加 `cleanStarClauseContent` → **AI 整文通道 + 存量报告打开即清洗**。
- **`complianceMatrix.ts`**：`clausesOf` 归行时对噪声标记行置空 `cur`（连同其续行不并入）→ **AI 补扫的内存态报告矩阵/关键项清单即时干净**，无需等存盘重载。

## 为什么合规矩阵不 import bidTypes
`complianceMatrix` 既有注释即「避免为读一个正则引高危大文件」——故它 import 的是**极小零依赖的 `starClauseNoise`**，不新增对大模块 `bidTypes` 的运行时依赖，边界不破。

## 误删防护（与 R143 同，且更严）
目录行强判别仍靠「行尾裸页码」（真实条款不以裸数字收尾）；含义句关键词收敛到标注约定专用语。
`complianceMatrix.test.ts` 既有用例「评分规则行（正文含★）」首字为「评」非标记、不被误判；「★1 硬件要求」等非 TOC/非含义句——全部保持通过，无回归。

## 增量单测
- 新增 `starClauseNoise.test.ts`（4 用例）：目录行判定 / 标注含义句判定 / `cleanStarClauseContent` 按条丢弃含续行 / 干净内容幂等。
- `complianceMatrix.test.ts` +1 用例：AI 补扫未经 normalize 的目录行+含义句不进矩阵、真实条款保留。
- 合计 **+5 测试、+1 文件**。

## 四门验证
- `npx tsc -b`：0 error。
- `npx vitest run`：90 test files，**949 passed | 2 skipped**（基线 944，+5 增量=本轮新用例，完全自洽）。
- `npx eslint`（触及 starClauseNoise.ts/.test、complianceMatrix.ts/.test、bidTypes.ts）：仅 2 error 在 bidTypes L3494/3496 `no-control-regex`（\x00 控制符，git-M 在途 + lint-debt-01 有意保留，**不在本轮改动区**）；本轮新增/改动文件 0 error。
- `npx vite build`：成功 3.55s。

## 基线口径更正
R143 收轮时正值 C 盘 0 字节引发 vitest worker-fork 崩溃，其汇报里引用的 927 是被截断计数的瞬时值；
R143 末次稳定运行实为 **944 passed | 2 skipped**。本轮以此为基线，949=944+5。

## 未触碰 / 维持裁定
未 commit；未动 collection/pb_hooks/会话外数据；未改提示词（无 B 类快照）；未新增 CSS。
编造嫌疑硬门禁仍「只报告不拦截」不变；lint-debt-01 残余不重构。
