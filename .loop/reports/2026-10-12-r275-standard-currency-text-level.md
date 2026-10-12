# R275 正文级标准版本时效检测 + 交卷体检告警卡

## 背景
R274 交付了 `standardCurrency.ts` 纯函数模块，解决「编制依据候选面板」的旧版国标无感知注入问题。
R274 报告挂账："detectStaleVersionRefs 已具通用签名，后续可复用到「标书正文级」旧版扫描（接交卷体检 / BidCheck L1）"。
本轮 R275 闭环该挂账。

## 选题理由
- P0 伞项 `bidkit-global-opt-p0` 剩余 "R-027 补 5 解析项"——R274 完成 1/5（编制依据级），R275 完成 2/5（正文级）
- R274 挂账明确、自然延续、零 AI、零 collection
- SubmissionCheckPanel.tsx 为 CLEAN 文件（不在 in-flight 修改列表中），安全修改
- 实质价值：真正为售前用户提供「交卷前一次性发现正文所有过时标准引用」的能力

## 变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/pages/BidWorkspace/standardCurrency.ts` | 追加函数 | `scanStaleVersionInText(text, curated?)` |
| `src/pages/BidWorkspace/standardCurrency.test.ts` | 追加 6 用例 | 命中/同版不报/去重/空文本/自定义curated/跨行 |
| `src/components/bid-workspace/SubmissionCheckPanel.tsx` | 4 处替换 | import + useMemo + badge + 告警卡 |

### scanStaleVersionInText 设计
```ts
// 正则：匹配「2-6大写字母(/1-4大写字母)? 空格 数字(.数字)* - 19xx|20xx」
const STALE_PAT = /\b([A-Z]{2,6}(?:\/[A-Z]{1,4})?[ \t]+\d+(?:\.\d+)*[-\u2014](?:19\d{2}|20\d{2}))\b/gi;
```
- 提取所有命中 → 归一化（去多余空格、统一连字符）→ 用 `buildCurrentVersionMap` 做比对
- 引用年份 < 现行年份 → 命中；≥ 现行 → 放过（防误伤新版/修订版）
- 去重（同一编号只报一次）
- 可选 `curated` 参数允许外部注入自定义规范库（单测用）

### 交卷体检接入
- `useMemo` 拼接 `activeProject.bid_chapters.map(c => c.content).join("\n")` 调 `scanStaleVersionInText`
- 顶栏摘要新增「标准时效 N 处」badge（仅 hits > 0 时渲染）
- 独立告警详情卡：列出每条命中所在章节 + 编号 + 建议替换（`staleRefHint`）
- 位置：formatReport 卡片之后、factConflicts 卡片之前

## 四门验证
| 门禁 | 结果 |
|------|------|
| `npx tsc -b` | exit 0，零错误 |
| `npx vitest run` | 176 files, **1982** passed / 2 skipped（基线 1976，+6 新增用例） |
| `npx eslint` 触及文件 | exit 0，零 error/warning |
| `npx vite build` | 成功 5.00s |

## 约束遵守
- 零 AI 调用、零 collection、零 pb_hooks、零提示词变更
- 只报不拦（红线裁定）
- 跨工作区通过 Python 补丁脚本实施
- 未 git commit
- 在途代码保护（53 M 文件 + 89 未跟踪，均避开）

## 挂账/后续
- R-027 剩余 3/5 解析项（需新增 AI 调用 + B 类流程，风险较高留后续轮次）
- BidCheck L1 正文级复用（待 BidCheck 在途代码稳定后评估）
