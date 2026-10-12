# R230 验收报告 · 知识库问数冷启动性能（r219-kbqa-coldstart-perf · P1·A类性能）

## 轮次编号说明
账本 round 现为 229（`r229-g1g2-compliance-risk-scan` 已由用户在途提交占用，report/record/实现文件齐备但未落 git）。
本轮严格「绕开在途、不推翻既有裁定」，接续取 **round 230**，不与 229 撞号。

## 问题（选题依据）
`/knowledge`「问知识库」首次提问冷启动：`useKnowledge.ensureQaCorpus` 裸调 `listKbDocs()`（不带 slim）
全量拉取含正文语料（实测团队+个人 6000+ 篇 / ~300MB / 单页 24.5MB），会话内仅以 `qaCorpusRef` 去重。
而助手 / 方案工坊 / 竞品证据走的是 `kbAssemble.getCachedVisibleDocs` —— 一条带并发去重、5 分钟 TTL、
`onKbMutation` 统一失效的**模块级共享全量缓存**。源码注释（R87）宣称「与助手/方案工坊/竞品同用全量通道，
行为对齐」，但代码各拉各的：QA 通道与共享缓存互不复用，导致
**同一批全量语料在跨模块场景下被重复下载两遍**，冷启动表现为长时间 `qaIndexing` 静默等待。

## 修法（A类性能·零 collection、零 pb_hooks、仅会话内 state）
1. **`ensureQaCorpus` 改走 `getCachedVisibleDocs(userIdRef.current)`**（`src/pages/Knowledge/useKnowledge.ts`）
   - 并发去重：多入口/重复提问共享同一在飞 promise，不再触发第二次全量下载；
   - 跨模块复用：标书/方案/竞品已预热则 QA 冷启动瞬时命中；
   - 失效语义保持：`refreshDocs` 仍置 `qaCorpusRef=null`，且 `onKbMutation→invalidateKbCache` 已把共享缓存
     一并失效，下一次提问重取最新全量，正确性与原实现等价；
   - 可见性保真：`getCachedVisibleDocs` 已按 userId 过滤可见子集，消费点 `scopeDocs` 再次 `visibleKbDocs`
     为**幂等**，team/personal 作用域检索结果逐条不变。
2. **打开问答抽屉即 fire-and-forget 预热**（`prewarmKbCache(userIdRef.current)`）：把冷启动全量下载与用户
   「读抽屉 / 组织第一个问题」的时间重叠，消除提交后才开始拉取的静默等待；已热则内部跳过，失败静默。
3. 降级不变：拉取失败不缓存、`qaCorpusRef` 留 null，本轮退回 slim 列表元数据通道，下次提问自动重试。

## 落点
| 文件 | 改动 |
|---|---|
| src/pages/Knowledge/useKnowledge.ts | +import getCachedVisibleDocs/prewarmKbCache；ensureQaCorpus 换通道；qaOpen effect 预热 |
| src/lib/kbAssemble.cache.test.ts | 新建：共享缓存契约回归 5 例（并发去重 / TTL 命中 / 失效重取 / 可见性过滤 / 失败重试） |

## 四门验证
- `npx tsc -b`：exit 0（零错误）
- `npx vitest run`：1672 passed / 2 skipped，exit 0；**新增 +5**（kbAssemble.cache.test.ts）
- `npx eslint`：useKnowledge.ts 触及前后均 7 error（HEAD=7 / 现=7，行号仅随插入位移），**零新增 error**；
  新测试文件 0 error。残余 7 条属既有 lint-debt-01（setState-in-effect / memo 保留），按裁定不重构
- `npx vite build`：exit 0

## 未覆盖项（诚实标注）
- 真实 6000+ 篇 / 300MB 环境的端到端冷启动耗时未在本机实测（无可用的满量 PocketBase 数据），
  以「消除跨模块重复全量拉取」这一确定性收益为验收依据；单测锁死其依赖的缓存契约。
- 修法建议③「拉取进度 UI + 可中断」：现有 `qaIndexing` 已提供进度态；中断能力涉及在飞请求取消，
  属更大改动，本轮以「预热重叠 + 去重」把等待窗口前移/压缩，未引入 AbortController（留后续 P2）。
