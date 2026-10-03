# R140 方案侧逐章批量生成有限并发移植（生成链路 D2）

## 选题
账本 backlog 项 `r139-solution-bulk-concurrency-defer`（P2 实质项，方案编制链路 = 用户优先级 #1）。
R139 挂账理由：方案侧 `runBulkGenerate` 仍为纯串行 for；标书侧生成链路 D2 已上 `BULK_CONCURRENCY=2`
worker 池（12 章×小节串行 + 续写下整本时长以小时计的直接修复）。方案侧照搬可把 20 章级批量腰斩。
R139 判定需独立轮次评估的三个前提，本轮逐一取证并确认已解除：

1. **章间衔接依赖**：读 `solutionTypes.ts:511 buildChapterMessages` 实证——各章 prompt 仅注入
   恒定的【医院项目事实基线】+【全文大纲】+ 本章小节/kbMaterial，**不依赖前序章已生成正文**
   （源码注释即「同份方案跨章恒定，可命中服务端前缀缓存」）。故并发不损章间衔接质量。
2. **updateChapter 并发写安全**：`updateChapter` → `cur.chapters.map(node_id 命中才 patch)` →
   `updateSolution` → `applySolutionState` **同步**写 `activeSolutionRef.current`（在任何 await 之前），
   不同 node_id 的并发写各自读最新快照、只改自己那章，互不覆盖；PATCH 请求体为字段级 `{chapters}`
   /`{doc_status}`，PocketBase 逐字段合并，late-arriving 章 PATCH 不会冲掉 doc_status。
3. **进度计数语义**：改用池层 `processed`（已派发任务数）驱动 `setGenProgress({current: processed})`，
   并发下单调递增，规避「current 并发生成下非单调」问题（原串行用 `i+1`，索引即序）。

## 变更
- 新增纯函数模块 `src/lib/bulkPool.ts`：`runBulkPool({total, concurrency, isCancelled, onTaskStart,
  runTask, onTaskError})`。框架无关、可独立单测的有限并发池，收敛调度语义（派发一次 / 并发上限 /
  取消闸门 / 单任务异常隔离 / 单调进度）。`total<=0` 直接返回 0。
- 改 `src/pages/SolutionStudio/useSolutionStudio.ts:runBulkGenerate`：主串行 `for` 换成
  `await runBulkPool({total, concurrency:2, ...})`，`runTask(i)` 内含原单章逻辑；skip 条件由
  `done` 扩为 `done || generating`（对齐标书侧 R126，杜绝与手动单章同章双写）；收口后的失败补重试
  循环（R139）**保持串行不变**。新增 `import { runBulkPool } from "@/lib/bulkPool"`。
- 新增单测 `src/lib/bulkPool.test.ts`（6 用例）。
- 零 collection / 零 pb_hooks / 零会话新 state / 不改提示词（非 B 类）。未触碰 blocked/hook-security-01 红线。

## 单测（+6 增量）
`runBulkPool` 调度不变量：①索引 [0,total) 恰好各派发一次；②在途并发严格不超过上限（peak==2）；
③取消只拦截未派发任务、在途任务自然结束（派发数 < total 且 ≥ 阈值）；④单任务抛错被隔离、
其余继续、onTaskError 收到且 processed 仍为 total；⑤total=0 不派发返回 0；⑥concurrency 夹取到
total 且 processed 进度序列单调 [1,2]。

## 四门验证
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：942 passed | 2 skipped（基线 936 + 本轮新增 6 bulkPool 用例）。
- `npx eslint src/lib/bulkPool.ts src/lib/bulkPool.test.ts`：exit 0，零问题。
  `useSolutionStudio.ts` 触及文件 12 error 全部落在 249/289/317/432/665/666/737/741/752/764/808/1196
  ——均为在途/既有 `set-state-in-effect`、`preserve-manual-memoization`、`access-before-declare`，
  无一落在我改动区（1418–1457）或新增 import 行，净新增 0（新增 import 使下方行号整体 +1，同错误非新增）。
- `npx vite build`：exit 0，5.02s。

## 实机降级说明（honest note）
整本批量并发生成的实机验证需真实 AI 密钥 + 20 章级方案 + 以十分钟计的跑时，本机不具备稳定复现条件；
且并发正确性的风险点（调度语义 / 写安全）已由 `bulkPool` 纯函数单测锈死，改动本身是对已上线并通过
实机的标书侧 D2 worker 池形态的同口径移植。故本轮以「纯函数单测覆盖调度不变量 + 门禁用 + 源码逐点
取证（buildChapterMessages 无跨章依赖 / applySolutionState 同步写 ref）」替代整本压测，符合既往
R40/R102「降级注：待真实数据即可见」口径。

## 浏览器实机验证（收口补记）
本机 Vite(:8000) + PocketBase(:7000) 均在监听。以系统管理员登录，经路由直达 `/solution-studio`
（该页 `runBulkGenerate` 即本轮改动落点，且 SolutionStudio 为 lazy chunk，加载即执行新
`import { runBulkPool } from "@/lib/bulkPool"`）：
- `list_console_messages(error,warn)`：0 条——新模块 import 在运行时正确解析，未破坏 lazy chunk。
- a11y 快照：页面完整渲染（banner「方案编制」、模型选择器、方案类型五档筛选、「新建方案」按钮、
  行业系统库 chips、方案统计卡），非白屏非崩溃。
- `evaluate_script` 佐证：`{title:"方案编制 · 小智工作站", h1:"方案编制", vite-error-overlay:false,
  新建方案按钮:true, url:"/solution-studio"}`。
截图工具本次超时（环境侧，非页面问题），以上快照 + 控制台零错 + DOM 状态 JSON 为等价且更强的运行时证据。
整本并发逐章生成需真实 token 扣费 + 20 章十分钟级跑时，本机不宜压测；调度不变量由 `bulkPool` 6 单测锈死，
路由加载与渲染由本实机检查覆盖。

## 维持裁定（未触碰）
编造嫌疑未清零禁导出硬门禁维持「只报告不拦截」；lint-debt-01 有意保留残余不重构；
r112/money-count-composestep/r119/r124/r130-price-preview 等 defer 项继续挂账（其锚点仍含
用户/R89–R139 未提交在途改动）。
