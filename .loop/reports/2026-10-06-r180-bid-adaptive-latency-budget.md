# R180 标书生成自适应首轮预算：120s 红线从「首调税」变经验值编码（r177-followup 残项落地其一）

- 日期：2026-10-06　轮次：R180（round 179 → 180）
- 优先级：P2（backlog r177-followup-generation-parallel-resume 的子项落地，剩余保持 open）

## 选题依据
账本既定 P2 实质项巡检：quote-history-01（一期 R40/二期 R102/每床折算 R176）与
prompt-fabscan-03 按章聚合回注（R103 ChapterImprovementList + 整章回注）均已闭环，
残余 C 类（覆盖审计四态、编造禁导出硬门禁）按维持裁定不动。择优落到
r177-followup 明列的『按模型实测延迟自适应单次预算（把 120s 红线经验值编码为自适应上限）』——
标书主链路吞吐的实质性改进。

## 问题与动机
R177 的超时降级重试是「先交一次税再学乖」：慢模型（实测单节 ~81s、偶发 >120s）每个小节
**首轮**都要烧一次约 120s 网关红线超时（model_gateway.pb.js 不可改；客户端兜底 150s），
阶梯折半才找到可用档。同一模型在一次会话内超时高度可复现——整本 ~200 小节串行时
每章都重复交这笔税，累计以小时计。

## 变更内容
### 1. src/lib/latencyBudget.ts（新建，纯会话内存）
- `observeModelCall(key, latencyMs, outcome)`：超时证据计数；成功延迟 ≥ `SAFE_LATENCY_MS`(100s)
  记偏慢（贴红线），快成功清慢标并逐次释放超时证据。
- `noteKnownGoodBudget(key, tokens)`：记录降级后成功返回正文的 max_tokens 档位，**只升不降**
  （更大档成功即上调验证位，小档成功不回拉保守位）。
- `suggestInitialBudget(key, requested)`：无证据模型原样放行（行为与 R177 后逐字等价）；
  有超时/偏慢证据时首调直接从已验证档起步（无验证档按 `nextDegradedBudget` 折半），仅当
  建议档真低于请求才同步关思考；≤2048 请求（解析类小档）因 `TIMEOUT_RETRY_MIN_TOKENS`
  下限护栏天然不受损。
- 零持久化、零 PocketBase collection、刷新即清零；模型键用既有 `modelRefKey`，切换模型证据不串。

### 2. src/pages/BidWorkspace/useBidWorkspace.ts（llmGenerate 单一收敛点接线）
- 首调前 `suggestInitialBudget` 得 `effTokens/effDisableThinking`；首调耗时与结果记证据
  （仅超时与成功两类信号，内容审核/余额等非超时失败不记——不反映档位执行能力）。
- 降级阶梯起点从 `maxTokens` 改为 `effTokens`；阶梯成功 `noteKnownGoodBudget` 回写验证档；
  阶梯内超时同样累计证据。
- F1 空回复重试：`max_tokens` 改用 `effTokens`、守卫条件改用 `effDisableThinking`，
  避免自适应已关思考时同参重复调用多计费一次。
- `injectSkillBlock` 提为 `bidMessages` 一次构造（纯函数，等价）。

### 3. src/lib/latencyBudget.test.ts（新建 11 条契约单测）
无证据原样放行 / 首超时折半+关思考 / 已验证档直接起步 / 请求不高于验证档不压不关 /
≤2048 下限护栏 / 偏慢预降级与快成功解除 / 超时释放但验证档保留 / 验证档只升不降 /
模型间隔离 / reset 清零 / 安全窗与 120s 红线常量锁。

## 行为影响与代价说明
- 慢模型后续小节首调直接产出短一档正文——缺口由既有小节级串行 + R172 自动补足链路补齐长度
  （与 R177 降级后路径完全同型，只是不再白烧首轮 120-150s）。
- 自适应降级时关闭思考与 R177 降级重试口径一致；无证据路径零变化。
- 若建议档仍偶发超时（服务端抖动），阶梯继续折半兜底；退到下限仍超时维持既有可执行文案。

## 四门验证
| 门禁 | 结果 |
| --- | --- |
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 104 files，1192 passed / 2 skipped（R179 基线 1181 → +11） |
| latencyBudget.test.ts 单跑 | 11/11 passed |
| npx eslint 触及文件 | latencyBudget.ts/.test.ts 0 问题；useBidWorkspace.ts 5 err/13 warn 与既有基线一致（1012/1076/1162/2688 setState-in-effect + 7392 no-useless-assignment 整体平移 +29 行=本轮新增行数，均不在触及区域），净新增 0 |
| npx vite build | exit 0，3.26s（chunk >500kB 告警为既有） |

## 红线与裁定合规
- 零 PocketBase collection/pb_hooks 改动、零提示词改动（B 类流程不触发）。
- 未 git commit；跨工作区仅经 scripts/r180_apply.py + scripts/r180_fix_test.py（锚点 assert 唯一命中）落地。
- 编造扫描「只报告不拦截」、lint-debt-01 残余不重构：均维持。
- 敏感数据不出内网边界不变：仅本地计时，无任何新外发。

## 账本回写
- round 179 → 180；closed 追加 r180-bid-adaptive-latency-budget；
  backlog r177-followup-generation-parallel-resume 更新 plan（自适应预算已落地，
  剩余受控并发与断点细粒度保持 open）；lastRoundSummary 更新。
