# R115 PocketBase 取数克隆收编：4 处 pbJsonRequest 平行实现回归单一入口

日期：2026-10-02 ｜ 类别：A 类可维护性/可靠性（纯前端，零 AI 零费用）｜ 数据模型：零 collection / 零 pb_hooks ｜ 提示词：未改（非 B 类）

## 选题与取证
巡检 R109 建立的单一入口 `src/lib/pbJson.ts`（`pbJsonRequest`）落地情况后，发现当年收编
并不彻底——仓库里仍散落着 **4 份对它的私有克隆**，各自把「base+path 拼接 + Content-Type +
vibexAuthHeaders 头装配 + `HTTP <status>` 抛出」这段逻辑复制粘贴了一份：

| 文件 | 私有包装 | 契约细节 |
|------|----------|----------|
| `src/pages/Competitors/competitorsCore.ts` | `compFetch` | 抛出时挂 `err.httpStatus`（= `exposeHttpStatus:true`） |
| `src/lib/kbQa.ts` | `qaFetch` | 抛出时挂 `err.httpStatus`（= `exposeHttpStatus:true`） |
| `src/pages/SolutionStudio/checklistLogic.ts` | `apiFetch` | 纯 `throw new Error(HTTP)`（默认契约） |
| `src/components/bid-workspace/FormatSettingsPanel.tsx` | 内联 `fetch` | 纯 `throw`，仅取 `.items` |

这正是 `pbJson.ts` 头注里点名要消除的「auth/header 装配漂移」风险源：一旦 `vibexAuthHeaders`
语义变化（如换鉴权方案），四处都要同步，漏一处即静默产生不一致。R114 之后沿单一来源收敛专题
继续推进，本轮把这最后 4 份克隆收编回 `pbJsonRequest`。

## 复用性检索结论（AGENTS 前置）
单一入口 `pbJsonRequest` 已在仓库内且被 20+ 既有调用点复用（R109 交付、`pbJson.test.ts` 全覆盖），
本轮为「复用项目内已有模块」——把重复实现委托回它，不引入任何外部依赖、不自研新库。

## 变更（薄委托，保函数名、保调用点零改动）
- `compFetch` → `return pbJsonRequest<T>(path, init, { exposeHttpStatus: true })`
- `qaFetch`  → `return pbJsonRequest<T>(path, init, { exposeHttpStatus: true })`
- `apiFetch` → `return pbJsonRequest<T>(path, init)`
- `fetchFormatTemplates` → 用 `pbJsonRequest<{ items? }>("/api/format_templates")` 取 `.items ?? []`
- 四文件删除随之失效的 `getPocketBaseUrl` / `vibexAuthHeaders` 直接 import（收编后各文件内 0 引用），
  新增 `import { pbJsonRequest } from "@/lib/pbJson"`；`competitorsCore.ts` 头注同步更新为单一入口口径。
- 行为逐字节等价：`pbJsonRequest` 的实现（`...init` 展开 → Content-Type → auth → init.headers 覆盖 →
  `!ok` 抛出 → `res.json()`）与原四处克隆完全一致，`exposeHttpStatus` 精确对应「是否挂 httpStatus」。

## 明确不并入（有意保留）
- `useCompetitorAnalysis.ts` `postJson`：带 `AbortController` 超时，契约不同 → 不动。
- `competitorEvidence.ts`：分页 GET 返回 `{rows,error}` 自定义降级（非 throw），语义不同 → 不动。
- `copyrightCore.ts` / `imageSearch.ts`：取静态本地 JSON / 外部 URL，非 PocketBase 鉴权路由 → 不动。
- `teamAuth.ts`：走 PB 原生 users auth（token 交换），语义不同 → 不动。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：**711 passed / 2 skipped（71 文件）**；基线 705 → +6 增量，零回归。
  新增 `src/lib/pbFetchDelegation.test.ts`（6 用例）锁死委托后的可观测契约：
  base+path 拼接、Content-Type+vibex auth 头合并、POST body 透传、`HTTP <status>` 抛出携带
  `err.httpStatus`（`exposeHttpStatus` 保留）、列表分页短页即止。
- `npx eslint` 触及四文件：净新增 **0** error（当前 9 error 全为 `react-hooks/set-state-in-effect`
  与 `react-hooks/refs` 既有告警；对同四文件的 HEAD 基线版本实测同为 9 error，逐一核对报错行均在
  未触碰的 useEffect / ref 区域，本轮改动仅在 fetch 包装函数与 import 段）。
- `npx vite build`：exit 0，2.87s 成功。

## 浏览器实机验证（R115 收口）

- 环境：本地 PocketBase(:7000) + Vite(:8000) 均 HTTP 200，复用已登录的「系统管理员」会话。
- 触发委托路径：导航到 `/competitors`（竞品分析页），该页数据经 `competitorsCore.listCompetitors →
  compFetch → pbJsonRequest`（本轮收编的委托链）拉取。
- 实机结果：
  - 网络请求 `GET /__pb/api/competitors?page=1&perPage=200 → 200 success`（委托后的鉴权头装配 +
    base+path 拼接在真实 PocketBase 往返下正常）。
  - 页面渲染真实数据：2025 百万级市场 181.9 亿、其中运营商 42.2 亿、15 家核心厂商 53.7 亿、
    千万级大单 23.7 亿、五年中标金额排行（卫宁健康 58.8 亿…），非空态。
  - `list_console_messages(error,warn)` = 0 条，证明 `src/lib/pbJson.ts` 单一入口 + 委托后的
    competitorsCore 运行时无异常。
- 截图：`d:/KFDXCX/MedPreSales/.qoder/tmp/r115_competitors_live.png`。
- 说明：本轮为行为等价的前端数据层收编，无用户可见 UI 变更；kbQa/checklistLogic/FormatSettingsPanel
  三处委托与 competitorsCore 走同一 `pbJsonRequest` 实现，其契约已由 `pbFetchDelegation.test.ts` 6 用例
  + `pbJson.test.ts` 全量覆盖，实机以 competitors 页作为该共享委托链的实时代表验证通过。

## 红线自检
未改提示词语义（非 B 类）；零 PocketBase collection / pb_hooks 变更；无物理删除；纯前端零 AI 零费用。
四个目标文件开工前均为 git-clean（无用户在途未提交改动），锚点命中前先 `git status` 核对，未误伤在途代码。
本轮补丁全部经 `d:\KFDXCX\MedPreSales\scripts\r115_*.py`（pathlib utf-8 读改写 + `assert count==1`）落地，
未 commit。
