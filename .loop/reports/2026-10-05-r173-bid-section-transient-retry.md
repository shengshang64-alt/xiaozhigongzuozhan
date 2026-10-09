# R173 — 标书小节串行生成加「瞬时失败重试」韧性

- 日期：2026-10-05
- 优先级：P2
- 关联：R170/R171/R172（标书小节残缺章三入口收口）；口径对齐 deckBatchRecovery（PPT/编排韧性）

## 选题与根因

承接标书主链路巡检。R170-172 已闭环"小节残缺章被误标 done / 当整章 blob 处理"的三个恢复入口。
本轮发现同链路的**韧性缺口**：小节级串行生成循环（generateChapterContent 4817+）里单个小节的
`llmGenerate` **无异常兜底**——任一小节的模型调用抛错（网络抖动 / 偶发超时 / 网关 5xx），异常冒泡
中断**整章**、本轮已生成小节增量丢失，用户须反复手点「继续生成」。R171 实测正是第 2 小节抛错→整章 failed。

代码库**既有韧性口径**（`deckBatchRecovery.ts` 注释明示"与标书侧智能编排『单批失败重试 1 次后跳过、
不让一批拖垮全局』一致"）在小节循环里**未落实**。本轮补齐。

## 方案

### 1. chapterCompletion.ts 新增纯函数 `withTransientRetry`
```ts
export async function withTransientRetry<T>(
  call: (attempt: number) => Promise<T>,
  opts: { maxAttempts?: number; isFatal?: (e: unknown) => boolean; shouldStop?: () => boolean } = {},
): Promise<T> {
  const max = Math.max(1, opts.maxAttempts ?? 2)
  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt += 1) {
    try {
      return await call(attempt)
    } catch (e) {
      if (opts.isFatal?.(e)) throw e      // 登录失效：立即上抛，绝不重试
      lastErr = e
      if (opts.shouldStop?.()) throw e     // 用户取消：本试失败后不再重试
    }
  }
  throw lastErr                             // 全部失败：重抛最后一次错误（保留本地化中文文案）
}
```

### 2. useBidWorkspace.ts 小节循环包裹
`const raw = await withTransientRetry(() => llmGenerate(buildBidSectionMessages(...), MAX_TOKENS_LONGFORM, "bid-chapter"), { isFatal: (e) => e instanceof AuthRequiredError, shouldStop: () => cancelBulkRef.current })`

**保守取舍**：只对"抛异常"重试；持久失败仍按原路径上抛 → 既有 catch 将整章标 failed、保留已生成小节前缀
（不破坏 `resumeFrom` 依赖的"已完成小节是连续前缀"不变量）。**不**在循环内联"跳过失败小节继续"——那会在
章中留 `chars:0` 空洞、破坏 resumeFrom 前缀假设、且 hasPendingSections 无法识别中段空洞。

## 改动文件
- `chapterCompletion.ts`：新增 withTransientRetry
- `chapterCompletion.test.ts`：+6 单测（首试成功 / 重试成功 / 两试都抛重抛末错 / isFatal 不重试 / shouldStop 不重试 / maxAttempts 生效）
- `useBidWorkspace.ts`：小节循环 llmGenerate 包 withTransientRetry + 扩展 import

## 四门验证
| 门 | 结果 |
|---|---|
| npx tsc -b | 0 错误 |
| npx vitest run | 1150 passed + 2 skipped（较上轮 1144 净增 6 例，无回归） |
| npx eslint（触及文件） | 5err13warn == HEAD，净新增 0；新增 chapterCompletion 两文件零 problem |
| npx vite build | 成功（4.31s） |

## 浏览器验证
dev server 加载新 bundle 无 console error。进【演练】R01-bid → 第 3 步 → 选中技术部分（secs=11/stats=1/failed）
→ 点「继续生成」→ 出现「小节 2/11」进度徽标（`setSectionGenState` 仅小节循环设置，证明经 withTransientRetry
包裹的小节循环执行、无崩溃、happy path 透明），正文 3131 → **17548 字（≈6 → 36 页）** 持续增长。返回列表触发取消
（cancelBulkRef → shouldStop 路径）停止生成。

## ⚠ 实测发现的独立异常（登记后续项，非 R173 引入）
最终落库 `content=17548 / section_stats=[3131]（仍 1 条）/ gen=done`。`updateChapter` 用 `{...c,...patch}` 全量合并、
无字段白名单，若小节循环完成路径（runGenerateChapter 4993）跑过则 section_stats 必落库；实测未落库 → 疑走了不触碰
section_stats 的 blob 续写路径（runContinueChapter 5483），但「小节 2/11」进度又确实出现过，二者矛盾。
需专门插桩 root-cause（continueChapter 路由是否在 in-memory/PB section_stats 分歧下走 else 分支）。
登记为 `r173-followup-continue-generate-stats-stale`（P2）。R173 的一行包裹只改 LLM 调用、不触碰 content/stats
持久化，与该异常无因果关系。

## 结论
R173 为标书小节生成补齐了与代码库一致的瞬时失败重试韧性（可单测、四门全绿、浏览器验证小节循环经包裹正常执行）。
用户"6 页"问题本轮进一步缓解（实测点继续生成后正文涨到 ≈36 页）。持久化异常另立后续项专门处理。
