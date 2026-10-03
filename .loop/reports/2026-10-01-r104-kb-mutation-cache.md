# R104 知识库变更即时生效：kb_docs 变更广播 → 共享组装缓存失效接线

日期：2026-10-01 · 类型：数据一致性断链修复（巡检新发现，非提示词，非 B 类）

## 断链取证（死代码巡检发现）
- `src/lib/kbAssemble.ts` 的 `invalidateKbCache()` 注释写明「入库/删除/编辑 kb_docs 后调用」，
  但全项目检索 **零调用**（死导出）。
- 消费 `getCachedVisibleDocs`（5 分钟 TTL 模块级缓存）的链路有四条：
  标书交卷体检/章节组装（useBidWorkspace L2285/L4564/L4966）、方案工坊素材
  （useSolutionStudio L852）、护栏非阻塞路、标书 prewarm（R90）。
- 后果：用户在知识库上传新素材、删除错误资料、或方案一键沉淀入库
  （SolutionToKbWizard createKbDoc）后，最长 5 分钟内标书/方案侧 AI 组装仍读旧语料——
  新料不可见、删料仍在被引用。知识页自身的 refreshDocs 只刷页面状态，触不到该共享缓存。

## 修复设计（单点汇聚，零 collection / 零 pb_hooks）
所有 kb_docs 变更入口已天然汇聚在 `kbCore` 三函数（createKbDoc/updateKbDoc/deleteKbDoc，
useKnowledge 全部 14 处变更调用与 SolutionToKbWizard 均走这三函数），故：
1. `kbCore.ts`：新增 `onKbMutation(cb)` 监听器注册表（Set，返回取消函数），
   三个变更函数**成功后** `notifyKbMutation()`；失败路径不广播（未生效的变更不触发重建）。
   监听器异常静默吞掉，绝不影响变更主链路。注册方向 kbAssemble→kbCore，无循环依赖。
2. `kbAssemble.ts`：模块加载时 `onKbMutation(invalidateKbCache)` 注册——缓存就定义在
   该文件内，模块未加载则缓存不存在，不存在漏听时序问题。
3. 后续任何新变更入口只要走 kbCore 三函数即自动生效，免再次手动接线（防同类断链复发）。

## 测试（src/lib/kbMutationInvalidate.test.ts，新增 4 用例）
- create/update/delete 成功后各广播一次；取消函数生效；HTTP 非 2xx 不广播。
- 端到端：组装缓存 TTL 内复用（fetch 计数不涨）→ createKbDoc 后下一次组装重新拉全库
  （计数增长），锁定「变更即时可见」行为。

## 四门验证
- npx tsc -b：0 错误
- npx vitest run：61 files · 651 passed / 2 skipped（基线 647+4 新增，e2eRealParse 2 skipped 为既有）
- npx eslint src/lib/kbCore.ts src/lib/kbAssemble.ts src/lib/kbMutationInvalidate.test.ts：0 error 0 warning
- npx vite build：3.04s 成功（chunk>500kB 警告为既有基线）

## 边界与维持裁定
- 未动提示词文本（PROMPT_VERSION 无变化，快照测试未 -u 即通过）。
- 零 collection / 零 pb_hooks；批量删除会触发多次 invalidate（幂等置 null，代价可忽略）。
- chunkKbDoc 内容缓存（R87 已按 updated+长度校验自愈）与本缓存正交，不重复处理。

## 浏览器实机验证（R104 收口，本地 PocketBase:7000 + Vite:8000）
- 在真实运行页面上下文动态 import kbCore/kbAssemble（与应用同一模块实例），注册 spy 后依次
  走 createKbDoc → updateKbDoc → deleteKbDoc 真实 API 往返：广播计数 1→2→3，三个变更入口
  在运行时各恰好触发一次失效（kbAssemble 的 invalidateKbCache 监听与之同批同步执行）。
- 探针文档（R104实机验证-即删, id=csrrglknic1qit2）经 deleteKbDoc 删除后，
  listKbDocs({q:"R104"}) 返回 0 条——测试数据零残留。
- 回归烟测：/knowledge 页正常渲染（团队库 2173 + 个人笔记 4825，截图 r104_knowledge_page.png）；
  /bid-workspace 消费侧路由正常加载（项目列表+模型选择），console error/warn 0 条
  （截图 r104_bid_workspace.png）。全程唯一 console error 为验证脚本自身裸 fetch 缺身份头的 401，
  与应用无关。
