# R177 · 标书正文「生成不出来 / 才几页」根因修复（超时自动降级重试）

日期：2026-10-06　优先级：P1（功能缺陷）

## 用户诉求
「标书还是不能生成！才生成了 6 页，和要求相差甚远。」——要求查清是模型还是代码问题，并真正修复。
先前只做代码推测未实地验证，本轮以真实环境 + 浏览器驱动复现。

## 实地复现的根因（非推测）
1. 环境：PocketBase(127.0.0.1:7000) + Vite(localhost:8000) 真实运行，登录 local-user，贵港项目（目标 100 页）。
2. 当前选中的个人模型 Intern·deepseek-v4-flash-vision 单个长正文小节实测 ~81s，偶发 >120s。
3. 服务端 `pocketbase/pb_hooks/model_gateway.pb.js:765` 硬编码出站 120s 超时——**红线区，前端不可改**。
4. 既有 `llmGenerate` 的 F1 重试（R167）只兜「成功但空回复」（`r.ok && status==success && !text`），
   **兜不住「超时失败」**：超时结果 `!r.ok` 直接落到末尾 `throw`，逐章正文 0 字标 failed → 用户所见"才 6 页"。
5. 排除红鲱鱼：`/api/llm/chat` 本地域返回 412 是「平台内置模型」路由（令牌恒空 + ModelSelect 本地置灰），
   而用户走的是个人模型 `/api/model-gw/chat`（实测 200），故「没登录」不是根因。

## 修复（仅动可编辑前端唯一生成入口，零红线 / 零提示词 / 零数据模型）
`src/pages/BidWorkspace/useBidWorkspace.ts` · `llmGenerate`：
- 命中超时（`personalTimeoutError(r.error)`）时不再直接抛错，改为**自动降级重试**：
  关闭思考（`disableThinking`，砍掉推理模型思考耗时）+ 逐次折半缩减单次输出预算
  （下限 `TIMEOUT_RETRY_MIN_TOKENS = 2048`），让同一个小节在 120s 红线内跑完；
  小节级串行 + 自动补足链路后续把长度补齐。
- 重试命中非超时的明确失败（内容审核 / 余额等）立即透出，不盲目再试；缩到下限仍超时才抛可执行文案。
- **纯 additive**：非超时 / 成功路径完全不变（guarded by `!r.ok && personalTimeoutError(...)`）。

同轮纳入前半程超时文案归一（`src/lib/modelGateway.ts` + 单测）：
- `PERSONAL_TIMEOUT_MSG`：点明网关单请求 ~120s 上限 + 正确 remedy（切换更快的已配置模型 / 分章生成），
  移除本地域死路引导「切换平台内置模型」；`personalTimeoutError` 归一客户端 abort 与服务端超时串；+3 单测。

## 浏览器端到端实测（关键：证明"真的能生成"）
加载改后 dev bundle → 驱动真实「继续生成正文」→「确认运行」（逐章生成 3 技术章节、按小节分段、自动补足 ≤6 轮）：
- 章节可见 21，其中 **8 章已达/超篇幅预算、13 章进行中**；
- 正文累计约 **61724 字 / 预算 90021 字** 且持续增长；
- 状态：仍在生成、**0 超时 / 0 失败**；
- 之前 0 字 failed 的章节被真实正文填满——即"6 页"问题消失。
（截图受页面体积触发 15s 工具上限未能出图，交互证据以驱动 UI + DOM 字数实测为准。）

## 实测延迟参考（同一长正文 prompt，max_tokens 3500~4000）
- Intern·deepseek-v4-flash-vision ≈ 80.7s（5138 字，最慢，>120s 风险最高）
- 大模型·deepseek-v4-flash ≈ 49s（4990 字）
- 大模型·sensenova-6.8-flash-lite ≈ 34s（5509 字，最快，超时风险最低）
建议：整本长标书优先选 sensenova-6.8-flash-lite，或关字数精调/一致性核对以提速。

## 四门验证
- `npx tsc -b`：exit 0
- `npx vitest run`：1169 passed | 2 skipped（103 files，与 R176 基线一致，无回归）
- `npx eslint`（触及文件）：零新增 error（仅历史在途 set-state-in-effect / no-useless-assignment，非本轮引入）
- `npx vite build`：exit 0

## 边界与后续
- 未改服务端 120s 红线（不可改）；未动提示词与数据模型；未 commit。
- 后续 backlog `r177-followup-generation-parallel-resume`（P2）：受控并发 / 断点续跑更细粒度 / 按模型实测延迟自适应单次预算。
