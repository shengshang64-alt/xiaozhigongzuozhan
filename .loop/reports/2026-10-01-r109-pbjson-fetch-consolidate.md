# R109 — PocketBase JSON 请求口径收敛（全站共享 src/lib/pbJson.ts）

## 背景 / 选题
接续 R105（LLM 错误码中文表 5 份去重）、R106（CSV 唯一 buildCsv）、R108（相对时间唯一核心）
的"单一来源收敛 + 漂移修正"主线，巡检新角度：**PocketBase JSON 请求封装**。

扫描发现全站存在 **4 份各抄一遍的 apiFetch JSON 封装**，围绕同一 `getPocketBaseUrl()+path`
+ `vibexAuthHeaders()` 认证头 + JSON 解析，但失败契约已分化为两类且各自漂移：

| 站点 | 签名 | 失败行为 | 额外 |
|------|------|----------|------|
| `components/shell/useGlobalSearch.ts` | `apiFetch<T>(path): Promise<T\|null>` | 静默 null（!ok 或异常） | — |
| `hooks/useActivityFeed.ts` | 同上（逐字一致） | 静默 null | — |
| `pages/BidWorkspace/useBidWorkspace.ts` | `apiFetch<T>(path, init?): Promise<T>` | `throw HTTP <status>` | 26 处调用 |
| `pages/CustomerManagement/useCustomerManagement.ts` | 同上 | `throw HTTP <status>` | 附带 `err.httpStatus`，38 处调用 |

同类"取 PB JSON"动作散落 4 份、认证头拼装各写各的，一旦 auth/header 口径调整极易漏改——
属真实的口径漂移重复。

## 方案（复用优先、不自研、零 collection / 零 pb_hooks / 零提示词）
新建全站唯一来源 `src/lib/pbJson.ts`，导出两个精确对应既有两类契约的纯函数：
- `pbJsonGet<T>(path): Promise<T|null>` —— 静默变体（非 ok 或任何网络/解析异常均返回 null），
  逐字等价于原 GlobalSearch/ActivityFeed 的 apiFetch 体；
- `pbJsonRequest<T>(path, init?, {exposeHttpStatus}?): Promise<T>` —— 抛错变体
  （`throw Error("HTTP <status>")`），默认不挂 httpStatus（= 原 useBidWorkspace 行为），
  `exposeHttpStatus:true` 时把数字状态挂到 `err.httpStatus`（= 原 useCustomerManagement 行为）；
  headers 合并顺序（init.headers 覆写 auth）、`...init` 展开均逐字照搬原实现。

**关键安全策略**：四处调用点保留各自**本地 `apiFetch` 符号名不变**，仅把其函数体改为委托
（wrapper → `return pbJsonGet(...)` / `return pbJsonRequest(...)`）。因此所有（含可能在途新增的）
调用方零感知、零改动，无论谁调用都走同一共享实现——避免在 208 个未提交在途文件里造成涟漪。
迁移后 `getPocketBaseUrl` / `vibexAuthHeaders` 在这 4 个文件仅 apiFetch 用过，随之从 import 精确
摘除（保留同 import 里仍在用的 `decodeRhToken` / `type RhAccountInfo`）。

## 四道门禁（目标项目目录）
- `npx tsc -b` → exit 0（首跑发现测试里 500 用例 `e` 为 unknown，已改为 `(await ...catch(x=>x)) as Error&{httpStatus?}` 后过）
- `npx vitest run` → **682 passed / 2 skipped**（基线 675 **+7**，全在新增 `pbJson.test.ts`：
  pbJsonGet 的 ok/非ok→null/网络异常→null/URL=base+path/认证头断言 + pbJsonRequest 的 ok 返回/
  默认抛 HTTP 不带 httpStatus/exposeHttpStatus 挂载 409/init 展开且 headers 覆写 auth 共 7 例）
- `npx eslint` 触及 6 文件 → **净新增 0**：新文件 `pbJson.ts`/`pbJson.test.ts` 各 0 error 0 warn；
  4 个迁移文件唯一 error 全为 `react-hooks/set-state-in-effect` / `no-useless-assignment` /
  `preserve-manual-memoization`，均位于 useEffect/useCallback body（行 117/147/307/448/1589/1699…），
  远离本轮只改的模块级 `apiFetch` 定义（~L28-61）与 import 行；且**无任何 `no-unused-vars`/`no-undef`**，
  反证 import 摘除精确无残留。useBidWorkspace/useCustomerManagement 的 5/9 计数与 13 warning 为既有基线。
- `npx vite build` → exit 0（2.94s）

## 运行时验证（浏览器实机，dev :8000 + PB 在线）
首页"作战驾驶舱"完整渲染真实数据（最新动态走 useActivityFeed→pbJsonGet 静默通道）；
点击顶栏「打开全局搜索（⌘K）」→ 输入「医院」→ 经共享 pbJsonGet 对 8 个集合
（customers/opportunities/intel/bid_projects/solutions/ppt_decks/quotes/kb_docs）发真实 GET，
**全部 200**、结果按客户/招标情报分组渲染、无崩溃；全程 console **0 error / 0 warn**。
（备注：cmdk combobox 用原生 value setter + input 事件写入，走组件 onChange 链路，结果确证加载。）
截图：`d:/KFDXCX/MedPreSales/test_results/browser_01_home.png`、`browser_02_search_hospital.png`、
`browser_03_search_scrolled.png`。

## 维持裁定
未动提示词（非 B 类，无 PROMPT_VERSION 变更）；未动 pb_hooks / 后端 collection；
维持 R89 编造未清零导出"只报不拦"、lint-debt-01 残余不重构；禁止 commit。

## 触及文件
- 新增：`src/lib/pbJson.ts`、`src/lib/pbJson.test.ts`
- 迁移：`src/components/shell/useGlobalSearch.ts`、`src/hooks/useActivityFeed.ts`、
  `src/pages/BidWorkspace/useBidWorkspace.ts`、`src/pages/CustomerManagement/useCustomerManagement.ts`
- 补丁脚本：`scripts/r109_pbjson_consolidate.py`
