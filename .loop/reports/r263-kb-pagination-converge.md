# R263 · 知识库 listKbDocs 翻页过度预取收敛（kb-docs-pagination-loop · P2 · A 类）

## 选题与安全
- 起始 BidCheck 二期 L2 → 检测到并发 agent 全量热写 BidCheck 模块（round 已占 262）→ 依「在途避让」放弃并清理残留。
- 改选冷模块 kb-docs-pagination-loop：kbCore.ts mtime ~3.3 天、git status 干净，无在途代码。
- 账本 round 避让：并发 agent 占 262，本轮独立修复顺延为 r263，不覆盖其条目。

## 根因
listKbDocs 用自定义路由 `/api/kb_docs`（服务端 hook 钳 perPage=200、回显 totalItems）。
旧循环 `for(start=1; start<=60; start+=3)` 每批一次性并发 3 页，此时 totalItems 尚未知：
- 空库(total=0)：首页拿 0 行设 done，但批内第 2/3 页请求已发出 → 2 个越界空页。
- 单页(150)：同理多发 2 页。
- 250：批[1,2,3]，第 3 页越界；6423：批到 [31,32,33]，第 34 页不发（凑巧，中小库仍浪费）。
净效果 = 小/空库也发 3 请求、末页落批中间多发越界空页、loading 期请求浪费。

## 方案（新口径）
首页单独串行取 → 学习 effectivePerPage + totalItems → `lastPage=min(MAX_PAGES, ceil(totalItems/epp))`
→ 从第 2 页起按 KB_LIST_PAGE_BATCH 并发批取，严格取到 lastPage 即停（start 上限=lastPage，天然不越界）。
- 截断告警改判 `all.length < totalItems && lastPage >= MAX_PAGES`（与 useKnowledge「>=MAX*PER_PAGE 提示」口径一致）。
- totalItems 缺失(-1) → 保守降级：lastPage=MAX_PAGES，靠「返回不满一页」不再触发（rows.length>=epp 时继续），
  行为等价旧「拉满上限」，无越界额外请求。
- 未动服务端、未动 useKnowledge（onBatch 语义/上限提示兼容：批间仍回调，首页即回调=渐进直显更快）。

## 新旧逐字行为对比（请求页号）
| 库规模 | 旧 | 新 |
|---|---|---|
| 空(0) | [1,2,3] | [1] |
| 150 | [1,2,3] | [1] |
| 250 | [1,2,3] | [1,2] |
| 6423 | …[31,32,33] | …[31,32,33]（恰 33，不发 34） |

## 测试（新增 src/lib/kbCore.test.ts，+5 用例）
假 fetch 服务端（钳 200、回显 totalItems、记录请求页号）：空库只发[1]；单页只发[1]；
250 精确停第 2 页且无重复页；6423 逐页取全、最大页=33、不含 34、id 严格递增保序；onBatch 首批即 200。

## 收益
越界空页归零、中小库冷加载请求数下降（少 1–2 个 / 库）、loading 期网络浪费减少、渐进直显首屏更早一批。

## 四门
tsc 0 · vitest 169/1909+2skip（+1文件/+5用例）· eslint 触及文件 0 · vite build ok。

## 回滚
kbCore.ts.bak-r262 / kbCore.test.ts.bak-r262（目标项目 src/lib 下）；验证通过后可清理。
