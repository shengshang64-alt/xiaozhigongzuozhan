# R185 · 全局错误 toast 复制动作收敛到剪贴板单一入口（globalErrorCatch.ts 漏网点）

- round：184 → 185  |  类别：A 类实施（清洁文件真健壮性缺陷修复 + 一致性收敛 + 回归测试）
- 提示词：无改动（不触发 B 类逐字对比流程）  |  数据模型：零 PocketBase collection / 零会话 state 改动
- 维持裁定：编造嫌疑硬门禁「只报告不拦截」、lint-debt-01 有意保留残余——本轮均未触及

## 1. 选题依据（巡检新角度：交互断链 / 文案一致性 / 健壮性）
- 本轮开始时目标项目仍重度在途（55 个 M + 多个 ??），标书主链编排 / PPT 导出接线 / 报价全链均为 M，
  r184 接线、r169 切片二/三、r177 并发接线、quote-history 二期接线全部命中在途区，按红线绕开并记录。
- 巡检 `src/lib/money.ts`（R113 金额显示单一来源，clean）确认 R184 currencyCn 的委托接线宜待其在途消费方
  （pptQuoteTypes/checklistTypes 均 M）稳定后一并做，本轮不动。
- 复核 R111「全站复制文本单一入口 `copyTextToClipboard`」的收敛完整性：全库检索 `navigator.clipboard` 直接调用，
  发现 **`src/lib/globalErrorCatch.ts` 是唯一残留的漏网点**——其全局错误 toast 的「复制」action 仍直连
  `navigator.clipboard.writeText(msg)`，绕开了 R111 入口（其余 intel/solution/knowledge/competitors/bid-workspace
  等 8+ 组件均已 `void copyTextToClipboard(...)`）。

## 2. 真实缺陷（影响全局错误兜底路径）
1. **非安全上下文崩溃**：本项目 AGENTS.md 明确「默认内网部署」，内网常走 http；此时 `navigator.clipboard`
   在非安全上下文为 `undefined`，用户点击「复制」即 `navigator.clipboard.writeText` 抛 TypeError。
2. **错误 toast 递归**：`registerGlobalErrorCatch` 自身监听 `unhandledrejection`；而 `writeText` 的 promise
   被拒绝时无人 `.catch`，rejection 逃逸会再次触发 `unhandledrejection` → 又弹一条错误 toast → 潜在风暴/递归。
3. **无反馈**：R111 入口的核心价值之一就是失败给可覆写中文 Toast，旧直连写法成功/失败都静默。

## 3. 修复（仅 globalErrorCatch.ts 内部，行为对外只增强不回退）
- 新增 `import { copyTextToClipboard } from "@/lib/clipboard"`。
- `action.onClick` 改为 `() => void copyTextToClipboard(msg, { successMessage: "已复制" })`：
  走单一入口的能力探测 + 隐藏 textarea/`document.execCommand("copy")` 回退 + 失败默认 Toast；
  `void` 吞掉 Promise（入口内部已 try/catch 恒 resolve，不会 rejection 逃逸递归）；`successMessage:"已复制"`
  对齐全站复制文案（文案一致性）。

## 4. 回归测试（新增 globalErrorCatch.test.ts，5 用例）
- mock `@/lib/clipboard` + `sonner`，stub `window.addEventListener` 捕获处理器后 dispatch 事件驱动私有 `showGlobalError`。
- ①复制 action 调用 `copyTextToClipboard(msg,{successMessage:"已复制"})` 且 **绝不** 触达 `navigator.clipboard.writeText`
  （regression lock，防止未来又退回直连）。②`navigator={}`（无 clipboard）点击不抛错。③window.error 分支同接入。
  ④AbortError 命中 `IGNORE_PATTERNS` → 不弹 toast、不接线复制。⑤同消息 5s 内防抖仅弹一次。

## 5. 四门验证
| 门 | 结果 |
|---|---|
| npx tsc -b | exit 0，零错误 |
| npx vitest run（新文件） | 5 passed |
| npx vitest run（全量） | 1235 passed / 2 skipped（基线 1230 → **+5 新增，零回退**，107 测试文件） |
| npx eslint（触及 2 文件） | 零 error / 零 warning |
| npx vite build | 成功，built in 3.30s |

## 6. 触及与合规
- `src/lib/globalErrorCatch.ts`（原 clean tracked，本轮编辑后转 M——是我本轮的合法改动，非误伤他人未提交在途）、
  `src/lib/globalErrorCatch.test.ts`（新建 ??）。跨工作区经 Python 补丁 `scripts/r185_clipboard_straggler.py`
  （每处 replace 前 assert count==1）。未 commit。

## 7. 记账的绕开项
- r184 currencyCn→money.ts 大写委托接线、r169 PPT 切片二/三、r177 并发接线、quote-history 二期接线：
  消费方锚点均在用户未提交 M 文件内，本轮按红线绕开，待其在途改动稳定后接续。
