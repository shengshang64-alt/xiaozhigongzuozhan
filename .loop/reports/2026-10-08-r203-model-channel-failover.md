# R203 · 模型通道级自动回退（docs/13 §3.3「429 兜底」）

日期：2026-10-08　轮次：R203　优先级：P1（文档作者点名「最值得投入的三件事」之一）
类型：**A 类**（零 schema / 零 collection / 零 pb_hooks / 零提示词；纯会话内存）

## 一、选题与依据

1. **账本核对**：用户点名的两项经核实均已闭合——`quote-history-01` 报价历史二期（R102 closed，
   且属长期记忆判定的「重复选题风险」项）、`prompt-fabscan-03` 按章聚合回注（R103 closed + R89
   边界裁决）。open 项中 `lint-debt-01` 属维持裁定、`r177-followup` 章节级并发风险过高需单独立项、
   `r195-score-table-n1-merged-col` 需真实语料、`r195-skillcore-scope-count-stale` 属用户在途
   （ProductMapping）。故转「巡检新角度 + 审查清单未落地实质项」。
2. **docs/13 §3.3**（模型通道自动回退）是第三节里唯一未被 R196-R202 覆盖的高价值项：
   「助手/生成撞通道限流（429）直接报错，需要手动切换模型重试……建议：个人多通道场景下做
   通道级 failover（429 自动切下一个启用通道重试一次）」。
3. **纠正 R202 的「真阻塞」误判**：R202 报告曾把 §3.3 判为「落点 modelGateway/llm/aigc 全在途 →
   本轮真阻塞」。本轮按流程逐文件 `git diff` 复核取证：
   - 最后提交是 `e2c5c7c iter(R152)`，R153-R202 的产出**全部未 commit**（用户禁止 commit），
     因此 `git status` 的 `M` 早已不等同于「用户在途」；
   - `modelGateway.ts` 的未提交 hunk 逐行是本项目 R177/R178 自建代码（注释里逐字写着 R177/R178），
     `llm.ts` 的 hunk 是 2026-10-07 `CHAT_ABORT 25000→240000` 注释；
   - 真正的用户在途只有未跟踪的 `src/pages/ProductMapping/` 及其 `App.tsx` 路由、`skillCore`
     第 16 个 scope 等——**本轮一处都没碰**（343 条 porcelain 逐条比对，锚点区避开）。
   结论：§3.3 未被阻塞，按授权推进。

## 二、方案与口径

三层结构，决策与出站分离，保证 node 环境可测、且不动 pb_hooks 红线：

| 层 | 文件 | 职责 |
|---|---|---|
| 决策内核 | `src/lib/modelFailover.ts`（新增） | 失败分类 / 候选排序 / 会话冷却登记 / 提示去重窗 / `tryFailoverCall` 编排。零 sonner、零 DOM、零网关依赖（仅 `import type LlmCallResult`） |
| 网关接线 | `src/lib/modelGateway.ts` | 在唯一出站点 `chatViaGateway` 包一层 `chatViaGatewayWithFailover`；提供候选来源（`buildFailoverCandidates` + 60s 会话缓存）、真实出站、sonner 可见提示 |
| 结果契约 | `src/lib/llm.ts` | `LlmCallResult` 增可选字段 `actualModelRefKey`（本次真正出活的通道键） |
| 证据归位 | `src/pages/BidWorkspace/useBidWorkspace.ts` | R180 自适应预算的延迟/验证档改记 `actualModelRefKey ?? latencyKey`，避免备用通道的快慢污染用户所选通道的首调起点（三处） |

**回退触发口径**（`classifyCallFailure` 逐字对齐 `pocketbase/pb_hooks/model_gateway.pb.js`
doChat 的真实文案——红线区不可改，文案即稳定契约）：

- ✅ 可回退（明确「这一路根本没产出」的账号级不可用）：`rate_limit`（429/TPM/限流/余额不足/
  连接被对方关闭 EOF）、`auth`（认证失败/API Key 无效）、`model_disabled`（模型已停用）、
  `unavailable`（HTTP 5xx/服务暂时不可用/无法连通/网络异常）。
- ❌ 不回退：`timeout`（留给标书侧 R177/R180 降级阶梯）、`empty_reply`（留给 F1 关思考重试）、
  `cancelled`、`login_required`、`other`（内容审核/参数错误等明确失败）。
  分类顺序即口径：先专用（取消/需登录/超时/空回复）后泛化，防「超时…或切换模型」被误判为不可用。

**候选挑选**：`别的配置的默认模型 → 别的配置其它模型 → 同配置其它模型 → 平台内置`；
- 429/欠费按账号 TPM 滚动，同账号换模型同样撞窗 ⇒ 失败时同时打「配置级 + 模型级」冷却戳
  （60s 起、连击逐次拉长、封顶 5 分钟，纯会话内存），冷却中的通道/配置整条不再被选为候选；
- `model_disabled` 只冷却那一路模型；
- **本地自用域不选平台内置**（平台令牌恒空必然 412，与 `ModelSelect` 的 `platformDisabled`
  禁用口径一致，复用 `rhLogin.isLocalDeployHost()` 单一真源）；
- **平台内置通道自身失败绝不跨源回退到个人通道**——不静默改用用户的付费账户；
- 只取文本生成模态候选（复用 R88 `modelModality.isTextGenerationModel`，向量/图像/视频/语音
  模型拿去聊天必然胡说）；
- 用户所选通道**每次仍先如实尝试**（保持选择权，代价只是 429 的 ~0.7s 快失败）；
- 回退成功才改判结果并 `toast.info` 说明换了哪一路（30s 去重窗，批量逐章不刷屏）；
  回退失败原样透出首调错误（用户看到的仍是自己所选通道的真实原因）；
- 健康路径零额外请求：候选清单只在「某次调用已经失败」时才拉，并做 60s 会话缓存。

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/modelFailover.ts` | 新增（决策内核，含 `BASE_COOL_MS_FOR_TEST`/`MAX_COOL_MS_FOR_TEST` 可测口径导出） |
| `src/lib/modelGateway.ts` | +`chatViaGatewayWithFailover` 包装、+导出纯函数 `buildFailoverCandidates`、候选 60s 缓存、`notifyModelFailover`；`chatViaGateway` 两条路径（不缓存 / cacheable 未命中）均接回退 |
| `src/lib/llm.ts` | `LlmCallResult.actualModelRefKey?` |
| `src/pages/BidWorkspace/useBidWorkspace.ts` | 延迟/验证档证据归位三处（`obsKey`、F1 重试成功、R180 首调成功收口） |
| `src/lib/modelFailover.test.ts` | 新增 26 用例 |
| `src/lib/modelGatewayFailover.test.ts` | 新增 5 用例（**接线级**：stub fetch 复现网关真实返回，断言真实出站顺序） |
| `src/lib/modelGateway.test.ts` | +5 用例（`buildFailoverCandidates` 口径）；按项目既有惯例补 `vi.mock("sonner")` |

补丁脚本（跨工作区只能用 Python）：`scripts/r203_impl.py`、`scripts/r203_tests.py`、
`scripts/r203_wiring_test.py`、`scripts/r203_fix_notice_dedupe.py`。均事务式（先算全部新内容并跑完
所有 `assert count==1` 锚点断言，任一失败即中止不落盘）。**未执行任何 git commit。**

## 四、四门验证（目标项目目录）

| 门禁 | 结果 | 与基线对比 |
|---|---|---|
| `npx tsc -b` | exit 0，零错误 | 持平 |
| `npx vitest run` | **130 files passed / 1544 passed \| 2 skipped** | 基线 128 files / 1508 passed ⇒ **+2 文件 +36 用例**，全绿 |
| `npx eslint`（触及 7 文件） | 新增/改动的 lib 文件（modelFailover.ts / .test.ts / modelGateway.ts / modelGatewayFailover.test.ts / modelGateway.test.ts）**0 error**；`llm.ts` 1 error（121 `no-useless-assignment`）、`useBidWorkspace.ts` 5 error（`react-hooks/set-state-in-effect` ×4 + `no-useless-assignment`，行 1126/1190/1276/2971/7951）均为既有残留，**零新增** | 6 条既有 error 已逐一取证在 `HEAD`（R152）版本里同样存在（`initialFailed`、`void loadModelOptions/loadProjects/loadOppOptions` 三处 setState-in-effect 逐字命中），且全部落在 lint-debt-01 有意保留族、远离本轮触及区（380-500） |
| `npx vite build` | exit 0，built in 3.53s | 持平 |

关键用例（`modelGatewayFailover.test.ts`，锁「封装层是否真把决策接上」）：
1. 所选通道撞 429 → 第二枪确实打到另一路 `config_id`，结果改判并带 `actualModelRefKey`，
   提示文案含「通道一 · deepseek-chat」「备用通道「通道二 · glm-4.5」」「顶部模型选择器」；
2. 超时 → 只出一枪、不改判、不提示（证明未与 R177/R180 阶梯叠加，不会延迟翻倍/重复计费）；
3. 备用通道也不可用 → 原样透出用户所选通道的首调真实原因（认证失败），不提示；
4. 平台内置通道失败 → 零个人通道出站（不静默花用户的钱）；
5. `cacheable` 路径同样回退，且写回缓存的是改判后的结果（二次命中不再出站）。

## 五、维持裁定与红线声明

- **编造嫌疑未清零禁止导出硬门禁**：维持「只报告不拦截」，本轮未触碰。
- **`lint-debt-01`**：有意保留残余不重构，本轮未清理（上表 6 条既有 error 原样保留）。
- **pb_hooks 红线**：`model_gateway.pb.js` 一行未改；韧性全部在前端网关封装层实现，
  失败分类反而把该文件的文案当成稳定契约写进单测（改文案会被测试红灯提示）。
- **数据模型**：零 collection、零 schema、零迁移；冷却登记与候选缓存均为会话内存（刷新页面即清）。
- **提示词**：本轮未改任何 prompt（无需 B 类流程），`PROMPT_VERSION` 不变。
- **在途代码**：`src/pages/ProductMapping/`、`App.tsx` 路由、`skillCore` 第 16 scope 等用户未提交
  新功能全部绕开。

## 六、后续挂账（已登记进账本 backlog）

1. `r203-fallback-to-platform-branch`（P3）：`chatViaGatewayUncached` 里 pb_hooks 的
   `fallback_to_platform` 分支（配置被删/缺 Key/无启用模型）仍在内核之前直接回平台，本地域该平台
   令牌恒空 ⇒ 实际是 412 死路。宜纳入候选挑选统一处理（不动 pb_hooks，前端改判即可）。
2. `r203-cooling-not-surfaced`（P3）：冷却中的通道在 `ModelSelect` 里没有任何「刚失败/冷却中」
   标记，用户看不到提示里说的「暂时不可用」到底哪一路；可复用冷却登记表做只读徽标（跨模块，需评估）。
3. `r203-assistant-scope-failover`（P3）：助手/知识库走 `cacheable` 或 `chatViaGateway` 已自动受益，
   但 `aigc.ts` 的图片/语音通道另有出站路径，未纳入（非文本模态本就不该回退，故仅登记观察）。
4. `docs13-3.4-customer-delete-demote` / `docs13-3.8-assistant-memory-discoverability` /
   `docs13-3.9-style-details`：docs/13 第三节剩余小项（删除按钮降位、记忆入口可发现性、侧栏双滚动条等）。

## 七、一句话结论

撞 429 / Key 失效 / 5xx / EOF / 模型停用时，工作台自己换一路已启用的文本通道把这一枪打完，
用户不再需要「看报错 → 去顶部手动换模型 → 点重试」；超时与空回复仍归既有阶梯独占，
不重复计费、不延迟翻倍。标书/方案/PPT 三条主链路与助手、知识库问答、竞品分析、情报摘要同享。

## 八、真实环境验证（浏览器实测，2026-10-08）

`npx vite build` 产物由本机 PocketBase（`http://127.0.0.1:8000/`，账本 target）直接托管，
故浏览器打开的就是含 R203 代码的构建包：

- 首页「作战驾驶舱」正常渲染，侧栏 15 个入口齐备；
- 进入 **标书工作台**（`/bid-workspace`，`chatViaGateway` 与本轮 `modelGateway` 新 import 链
  sonner/modelModality/rhLogin 的主要消费者）：9 个投标项目列表、公司标准模版、流程条与
  **顶部模型选择器**全部正常，下拉实测列出 `bailing · Ling-3.1-flash`、`大模型 · deepseek-v4-flash`、
  `大模型 · sensenova-u1-fast`、`大模型 · sensenova-6.8-flash-lite`、`Intern · deepseek-v4-flash-vision`、
  `xiaomi · mimo-v2.6-pro`、`ange · agnes-3.0-flash` 共 7 路**跨 5 个配置**的已启用通道
  —— 说明 `resolveAvailableModels` 未被新 import 链打断，且本机真实存在多个可回退候选
  （正是 §3.3 描述的多通道场景）；
- **console 零 error / 零 warn**（`list_console_messages` types=[error,warn,assert] 返回空）：
  排除了「模块级 import sonner 在浏览器包里引入副作用/循环依赖」这一残余风险
  ——tsc 与 build 都绿并不能证明这一点，故必须实测。
- 截图存档：`d:\KFDXCX\MedPreSales\.qoder\tmp\r203_proof_bidworkspace.png`。

未做「真实烧一次 429」的端到端触发：那需要故意把某路密钥改坏或等大 prompt 撞 TPM 窗，
既动用户真实配置又不稳定；改判行为由 `src/lib/modelGatewayFailover.test.ts` 用 stub fetch
逐字复现网关真实返回来锁（出站顺序、结果改判、提示文案、不回退边界），比一次偶发 429 更可复核。
