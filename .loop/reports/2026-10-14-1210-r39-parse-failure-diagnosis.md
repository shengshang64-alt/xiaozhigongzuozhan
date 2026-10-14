# R39 · 2026-10-14T12:10+08:00 · 标书解析「一直失败」根因定位与修复（B14）

| 项 | 内容 |
|---|---|
| 触发 | 用户实机反馈：安中医项目「AI 解析报告」重新解析一直失败，界面显示 20 项降级、必选项 8 项失败、解析覆盖率 2% |
| 根因 | 所选模型 opecode 的 base_url 指向 OpenCode **GO 端点**，该端点强制要求 `x-opencode-session` 会话头；网关只带 Authorization → 每次调用 **HTTP 400 秒拒**（实测 933-1153ms），22 个分段全灭 → 整本降级为关键词检索原文 |
| 为什么看不出来 | ① 解析链路把每段真实错误 catch 成空串，只抛「分段解析全部失败，请重试」；② 配置页健康徽标来自 `/models` 连通检查（返回 200），而 400 发生在 `/chat/completions` —— 「通道健康」与「能不能对话」被混为一谈 |
| 门禁 | tsc ✓（本轮 3 文件 0 error，全仓 5 error 全在在途文件）/ vitest ✓（218 files · 2597 passed · 2 skipped，+4 用例）/ eslint ✓（新增 0 error）/ build ✓（6076 modules · 3.68s） |
| 结论 | **pass**（未 commit；pb_hooks 改动需重启 PocketBase 才生效，按项目 hook 禁令未自行重启） |

## 1 · 三通道实测（浏览器内直调统一网关）

| 通道 | 结果 | 耗时 |
|---|---|---|
| opecode / deepseek-v4.1-flash（用户所选） | ✗ HTTP 400 `Request is missing x-opencode-session and cannot be routed efficiently` | 1153ms |
| 大模型 / deepseek-v4-flash | ✗ HTTP 429 频率超限（退避可恢复） | 794ms |
| 平台 / gpt-5.5 | ✓ 正常返回 | 1506ms |

平台通道正常 → 网关、PocketBase、网络都健康，问题只在所选个人通道。

## 2 · 两处修复

**A 网关（`pocketbase/pb_hooks/model_gateway.pb.js`）**：`chatOnce` 与 `testChatOnce` 对 host 命中 `opencode.ai` 的出站补
`x-opencode-session`（同一模型 = 同一稳定会话，便于上游路由与提示缓存）与应用级 `User-Agent`；
其它 provider 的 header 组合逐字不变。**需重启 PocketBase 生效**（JSVM hooks 在 bootstrap 注册，实测重启前仍 400）。

**B 前端（`bidGenFailure.ts` + `useBidWorkspace.ts`）**：分段 `catch` 留住真实原因，全灭时抛
`parseSegmentsFailedMessage(...)` —— 归类复用 SolutionStudio R282 的 `classifyGenFailure` 单源，另加一条窄口径识别
「上游拒收请求」（HTTP 400/404/422、missing x-、not supported）。dev server 已实时生效，实测输出：

```
分段解析全部失败：接口返回异常（HTTP 400）：Request is missing x-opencode-session。
该模型通道不接受本次请求（多为上游接口契约变更或参数不支持）——先在顶部模型选择器换一路模型，再逐项重新解析
```

未改 `modelFailover` 的「HTTP 400 不冷通道」裁定（其回归守卫 37 例仍绿）：那一条防的是误挂账，
本轮加的是给人看的下一步动作，目的不同、不冲突。

## 3 · 用户当下可用的两条路

1. **立刻**：顶部模型选择器换「平台模型」或其他可用个人通道，再点重新解析（解析失败不计费，429 那路退避后可用）。
2. **要保留 opecode**：重启 PocketBase（`pocketbase serve --http=127.0.0.1:7000 --dir=pb_data --hooksDir=pb_hooks`）让 A 生效；
   或把该配置 base_url 换成 OpenCode 文档给出的常规推理端点。

## 4 · 挂账

- **B15**（high）：重启 PB 后复测 opecode；并把「模型配置健康徽标」从 `/models` 连通改为真跑一次 chat，杜绝本次这类假绿。
