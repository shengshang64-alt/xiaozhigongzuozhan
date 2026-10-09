# R153 · ★/▲ 重点条款行内式定义约定句残留修复

- 轮次：round 152 → 153
- 优先级/类别：P2 · A 类（纯逻辑噪声清洗，零提示词/零 schema/零 pb_hooks）
- 模块：/bid-workspace（标书主链路）
- 关闭挂账：r149-bid-star-defline-residual
- 日期：2026-10-04

## 一、问题（R149 专项轮 D 实数据复验发现）

`extractStarClauses` 从招标原文本地扫描 ★/▲ 重点条款。R143/R144 已把「目录行」与「标注含义解释句」
判定收敛到单一真源 `starClauseNoise.ts`，目录行过滤在真实三明招标上生效（15 条 → 6 条，8 条目录噪声清零）。

但复验发现真实 6 条重点条款中仍有 2 条是**定义说明约定句**混入清单：

```
2.本文件中标注"▲"的条款为重要技术指标/服务指标，负偏离将按第六章评分标准扣分
本文件标注"▲"的条款为实质性要求，任一条负偏离按无效投标处理
```

它们**不以 ▲/★ 开头**（以编号起头、标记在行内），而 R143 的 `looksLikeStarDefinitionLine`
正则 `^[★☆▲△]…` 只匹配标记开头行 → 这两句以「行内含标记」被当作参数条款起条，
其后的常规条款行（"3.本文件所称…"）被吸收进条体。真实 6 条中噪声占 33%（修复前 60%）。

## 二、修复（单一真源，一处改四通道受益）

`starClauseNoise.ts · looksLikeStarDefinitionLine` 增加**行内式约定句分支**：

```
const STAR_INLINE_CONVENTION_RE = /标注\s*["'"“”‘’「」『』]?\s*[★☆▲△]\s*["'"“”‘’「」『』]?\s*的\s*(?:条款|内容|要求|指标|项目)/

export function looksLikeStarDefinitionLine(line: string): boolean {
  if (STAR_DEFINE_RE.test(line)) return true
  if (line.includes("|")) return false        // 表格行按结构内容保留，不误判为噪声
  return STAR_INLINE_CONVENTION_RE.test(line)
}
```

- 用 `标注 <引号>? ★/▲ <引号>? 的（条款/内容/要求/指标/项目）` 这一**强约定语**精确判别行内式定义句；
- `含 | 的表格行` 直接返回 false，避免把表格里偶现该短语的结构内容误删；
- 真实参数条款（`▲ 某系统须支持…`）不含 `标注…的条款` 结构，**不会被误伤**。

因起条判定（`extractStarClauses` → `isStarClauseNoiseLine`）与按条丢弃
（`cleanStarClauseContent`）、合规矩阵归行都经同一 `looksLikeStarDefinitionLine`，
本地扫描 / AI 整文 / 存量 parse_report 打开即清洗 / 补扫 四条通道**一并受益**，无重复规则。

命中噪声行后，`extractStarClauses` 走 `flush(); continue`：不建条，其后未含标记的常规行因
`buf` 为空不被吸收——「起条 + 吸收后续行」两问题同步消除。

## 三、变更文件（2 个，均为既有文件）

| 文件 | 变更 |
|---|---|
| `src/pages/BidWorkspace/starClauseNoise.ts` | `looksLikeStarDefinitionLine` 增行内式约定句分支 + 表格行排除 |
| `src/pages/BidWorkspace/starClauseNoise.test.ts` | 补 3 组用例：行内式命中 / 真实参数条款防误伤 / 表格行保留 |

## 四、四门验证（目标项目目录）

| 门禁 | 结果 |
|---|---|
| `npx tsc -b` | exit 0，零错误 |
| `npx vitest run`（单文件） | starClauseNoise.test.ts 7 passed（原 4 +3） |
| `npx vitest run`（全量） | **998 passed / 2 skipped**（基线 995 +3 新增，零失败零回退） |
| `npx eslint`（触及 2 文件） | exit 0，零 error 零 warning |
| `npx vite build` | exit 0，5947 modules，BidWorkspace chunk 560.77 kB（gzip 154.38 kB），3.59s |

## 五、维持裁定（未触碰）

- 编造嫌疑扫描「只报告不拦截」的硬门禁维持不变；
- lint-debt-01 有意保留的残余不重构；
- 未 commit（沿用自主循环禁 commit 纪律）。

## 六、边界与后续

- 本修复精确覆盖 R149 证据中的「标注X的条款」行内式约定句；其它未见过的约定句变体（如"带▲标记的内容…"）
  不在本次最小改动范围，如后续真实数据复现再按同口径扩展约定语，不预先扩大正则以免误伤。
- 相关但独立的观察 `r152-star-symbol-loss`（检索通道 response_req 引文中 ★ 符号丢失，P3）仍挂账 open，属符号级保真、非本条款起条问题，另轮处理。
