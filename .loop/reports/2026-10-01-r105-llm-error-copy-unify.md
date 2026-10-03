# R105 AI 错误码中文化口径收敛（消除内部错误码泄漏 + 5 份重复表漂移）

日期：2026-10-01
轮次：R105（接续 round 104）
优先级：P2（数据/文案一致性 + 用户可见报错规范）
类型：实质性优化（非零风险小改），会话内零 collection、零 pb_hooks、零提示词改动

## 背景与取证

巡检「用户可见文案是否泄漏内部字段名 / 错误码」这一既有规范红线（memory：用户可见报错文案禁止暴露内部字段名与阶段编号），
用脚本扫描全部 toast / setError / confirm / 网关错误翻译点，坐实两类真实缺陷：

1. **内部错误码直接透出给用户（泄漏）**
   `useCustomerManagement.ts` 的 `mapLlmError` 旧实现：
   ```
   return LLM_ERROR_ZH[error] ?? `AI 调用失败：${error}`
   ```
   当网关返回未收录的英文错误码（如 `rate_limit_exceeded`、`content_audit`、`user_cancelled` 等）时，
   会把裸内部码拼进用户可见提示串（"AI 调用失败：rate_limit_exceeded"），违反规范。

2. **同一份"错误码中文表 + 未收录码兜底"逻辑在 5 个模块各抄一份**（口径靠注释手工对齐，已漂移）：
   - `assistantCore.ts`（小智）
   - `studioLlm.ts`（方案编制 / 建设清单）
   - `usePptQuote.ts`（报价 / PPT）
   - `useIntelCenter.ts`（情报中心）
   - `useCustomerManagement.ts`（客户管理）
   5 份表内容基本一致，但兜底策略不同：4 份用「未收录码替换中文兜底 + 可读中文串透传」，
   唯独客户管理那份用「`AI 调用失败：${error}` 拼接」→ 正是上面第 1 点的泄漏源。
   新增网关错误码时（如 `user_cancelled` 已在 modelGateway 使用但 5 张表都没收录），只要漏改一处就退回裸码。

## 方案（复用优先，不自研引擎）

新增全站唯一来源 `src/lib/llmError.ts`：
- `LLM_ERROR_ZH`：错误码基表（timeout / not_found / rh_login_required / insufficient_balance / **user_cancelled**）。
  其中 `user_cancelled` 是本轮补齐——网关 `chatViaGatewayUncached` 早已返回该码（modelGateway L274），
  但 5 张表都未收录，取消动作会走英文泄漏分支。
- `localizeLlmError(error, { generic, copy })`：统一兜底口径
  - 命中码（含模块 copy 覆写）返回中文；
  - 未命中但本身已是可读中文（后端拼好的中文详情串）原样透出，保留真实原因；
  - 其余（裸英文码 / HTTP 串 / 空串）替换为 `generic` 中文兜底，绝不外泄内部码。
- `copy` 机制保留各页既有专属措辞（小智 / 方案 / 报价 / 情报 / 客户管理对同一码的措辞本就不同），
  只覆写差异项，其余回落基表 → 行为等价、零回归。

5 个模块的本地 `LLM_ERROR_ZH` 常量全部改为「只留专属覆写表 + 调 `localizeLlmError`」，删除重复实现。
`assistantCore` 因专属表已覆盖 4 个差异码，去掉未再引用的 `LLM_ERROR_ZH` import，保持 eslint 干净。

## 变更清单

- 新建 `src/lib/llmError.ts`（共享基表 + localizeLlmError）
- 新建 `src/lib/llmError.test.ts`（8 用例：空值/收录码不透内部码/裸英文码替换/中文详情透传/copy 覆写回落/优先级/基表覆盖全码 + 小智侧口径）
- `src/lib/assistantCore.ts`：mapAssistantLlmError 走共享口径；trim 无用 import
- `src/pages/SolutionStudio/studioLlm.ts`：删本地表，STUDIO_ERROR_ZH 覆写 + localizeLlmError
- `src/pages/PptQuote/usePptQuote.ts`：删本地表，QUOTE_ERROR_ZH 覆写 + localizeLlmError
- `src/pages/IntelCenter/useIntelCenter.ts`：删本地表，INTEL_ERROR_ZH 覆写 + 打标/周报两处错误串走共享口径；
  简化 `LLM_ERROR_ZH.rh_login_required ?? "..."`（基表必有该键，去冗余回退）
- `src/pages/CustomerManagement/useCustomerManagement.ts`：**修复泄漏点**——删本地表，mapLlmError 走共享中文兜底

## 四门验证

- `npx tsc -b`：exit 0，零错误
- `npx vitest run`：659 passed | 2 skipped（基线 651 → +8 新增 llmError.test.ts），全绿
- `npx eslint`（7 个触及文件）：新增文件 0 error / 0 warning；
  其余 4 个业务文件的报错全部为在途代码既有项（react-hooks/set-state-in-effect 等，非本轮引入），本轮净新增 0
- `npx vite build`：exit 0，3.25s 成功

## 运行时验证（browser-use 实机）

dev 服务（:8000 Vite + :7000 PocketBase）在线，用 browser-use 打开 http://127.0.0.1:8000/ 在真实页面上下文实证：

1. **核心泄漏点在浏览器内闭合**：动态 import `/src/lib/llmError.ts` 后对未收录码逐一断言，
   `rate_limit_exceeded / content_audit / HTTP 500 / user_cancelled / 空串` 全部返回中文兜底，
   脚本级 `leak_detected: []`（无任何裸码原样出现在其输出中）；`user_cancelled` 命中新收录码返回「已取消生成」；
   中文详情串「内容审核未通过，请调整措辞后重试」原样透出；copy 覆写返回「该操作当前不可用」。
2. **真实消费模块接线正确**：import `/src/lib/assistantCore.ts` 调 `mapAssistantLlmError`，
   小智专属措辞逐字保留（「请先登录 RunningHub 后再使用小智」「小智处理超时…」），未收录/空值落「小智这轮回答失败了，请稍后重试」，
   `assistant_leak_check: false`；`/src/pages/SolutionStudio/studioLlm.ts` 公共导出（llmGenerate 等）完好，import 未破坏模块图。
3. **受影响页零回归**：导航 `/customer-management`（本轮修复泄漏的 useCustomerManagement.ts 所属页）完整渲染
   （客户总数 160 / 批量补全 AI 按钮 / 导出等），console 0 error 0 warn，截图 `.qoder/tmp/r105_customer_management.png`。

## 维持裁定（未触碰）

- 编造嫌疑未清零禁止导出硬门禁：维持「只报告不拦截」（R89）
- lint-debt-01：bidTypes.ts 残余有意保留，不重构
- 未动任何 AI 提示词（无 PROMPT_VERSION 变更，非 B 类），未动 pb_hooks / 后端 collection
