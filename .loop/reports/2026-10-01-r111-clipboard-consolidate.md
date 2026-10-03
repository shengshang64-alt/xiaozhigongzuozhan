# R111 全站「复制文本」收敛（src/lib/clipboard.ts 唯一入口）

日期：2026-10-01　主题：单一浏览器 API 封装收敛（承接 R110 src/lib/download.ts）

## 巡检角度与坐实的真实缺陷
脚本扫描全站 `navigator.clipboard.writeText`，坐实 10 处（分布在 9 个文件）各写各的手写调用，
存在两类真实缺陷：

1. 失败静默：其中 2 处只写 `.then(成功)` 无失败分支——
   - ChatStream.tsx L356「大纲已复制」复制失败时用户毫无反馈；
   - SubmissionCheckPanel.tsx L216「复制建议」同样只处理成功。
2. 未定义即崩溃（面广）：全部 10 处都未防 `navigator.clipboard` 在非安全上下文/旧浏览器为
   `undefined` 的情形。此时 `navigator.clipboard.writeText(...)` 会**同步抛 TypeError**，
   而 `.then(onSuccess, onError)` 形式只能兜住 Promise 拒绝、兜不住同步抛出，直接崩溃；
   仅 2 处 try/catch 形式（ParseReportPanel/CompetitorCompare）能捕获但仍无回退。
3. 口径漂移：成功/失败文案 10 处 6 样（"请手动选择文本复制"/"请手动选中内容复制"/
   "请检查浏览器剪贴板权限"/"请手动选择文本"…），无统一兜底。

## 方案（复用优先、单一来源、不自研引擎）
新建全站唯一入口 `src/lib/clipboard.ts`：

- `copyTextToClipboard(text, { successMessage?, errorMessage?, onSuccess? }): Promise<boolean>`
- 内部 `writeClipboardText`：先探测 `navigator.clipboard?.writeText` 能力，命中则用 Clipboard API；
  能力缺失或抛错时**回退隐藏 textarea + `document.execCommand("copy")`**；两路都失败才返回 false。
- 成功：可选弹 `successMessage`（省略则不弹，兼容 QaDrawer 仅视觉状态反馈口径）并触发 `onSuccess`；
  失败：弹 `errorMessage`（给默认中文兜底，绝不静默）。
- 10 站点全部改为委托本入口，`successMessage`/`errorMessage` 逐字沿用各站原文案
  （处理过失败的站点行为等价；2 个静默站点新增失败反馈，属修复）；QaDrawer 的复制状态
  回调经 `onSuccess` 保留。ChatStream「复制并去方案编辑」的 `navigate` 仍在 `void` 后同步执行，
  保持跳转无条件、行为不变。

## import 精确摘除
移除各站 clipboard toast 调用后按实际 `toast` 用量决定是否保留 sonner import：
ChatStream/CompetitorCompare 仍别处使用（保留），其余 7 文件未再引用（摘除 sonner import，
就地补 clipboard import）。修正一处：SubmissionCheckPanel 因中文文案「进度见 toast。」含
`toast` token 令自动判定误报为「仍在用」，据 tsc TS6133 精确摘除其未用 sonner import
（`r111b_fix_submission_import.py`）。

## 四道门禁
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：692 passed / 2 skipped（含新增 `clipboard.test.ts` 6 用例：Clipboard API 成功、
  无 successMessage 不弹、能力缺失回退 execCommand、writeText 抛错回退、两路都失败弹默认兜底不触发
  onSuccess、自定义 errorMessage 覆写）。
- `npx eslint` 触及 11 文件：净新增 0 error。唯一 1 项为 ParseReportPanel.tsx L82
  `react-hooks/set-state-in-effect`，位于在途「Q26 切片A」`setKeyOnly` useEffect 内，
  不在本轮任一改动 hunk（本轮仅 L2 import 与 L156 copyContent），属在途既有 error，不计新增。
- `npx vite build`：exit 0（3.18s）。

## 运行时集成校验
Vite dev(:8000) 按需转译：`/src/lib/clipboard.ts` 返回 200 且含 `copyTextToClipboard` 与
`execCommand` 回退；抽查 QaDrawer/ParseReportPanel/IntelCenterPage 三消费方均 200、委托新入口、
无 `navigator.clipboard.writeText` 残留，模块图无编译错误（同 R105 惯例）。
诚实降级：回退/未定义防护/失败兜底分支在 localhost 安全上下文+真实剪贴板下无法自然触发，
与 R106/R107 同源，由 `clipboard.test.ts` 6 用例端到端锁定。

## 边界维持
零 collection / 零 pb_hooks / 零 AI 提示词（非 B 类，无 PROMPT_VERSION 变更）；
维持 R89 编造未清零导出「只报不拦」、lint-debt-01 残余不重构；禁止 commit。


## 浏览器实机验证（R111 收口，追加）
运行页 Vite :8000 动态 `import('/src/lib/clipboard.ts')` 拿到应用**实际加载的同一模块实例**，
直接驱动本轮重构代码（比点击更可控，覆盖成功与失败两路）：

- **成功路径**：`copyTextToClipboard(含引号/逗号/换行的载荷, {successMessage})` → 返回 `true`，
  `navigator.clipboard.readText()` 回读头部匹配（末尾 `\n` 被 Windows 归一为 `\r\n` 属正常），
  DOM 新增 1 条 sonner toast「R111已复制到剪贴板」。坐实 Clipboard API 分支端到端可用。
- **失败/降级路径（本轮核心健壮性修复）**：把 `navigator.clipboard.writeText` stub 成 reject、
  `document.execCommand` stub 成返回 false 后调用 → `threw:null`（旧代码此刻会未捕获同步抛 TypeError
  崩溃，新代码优雅降级）、返回 `false`、弹自定义中文兜底 toast「复制失败，请检查浏览器剪贴板权限」
  （2 个原静默站点此前无任何反馈）。
- 应用加载 + 打开小智助手 + 上述两路调用全程 console **0 error / 0 warn**。
- 首页作战驾驶舱完整渲染（真实情报/资质/待办），确认零改动前回归。
- 截图 `.qoder/tmp/r111_clipboard_verify.png`、`r111_clipboard_browser_verify.png`。

据此，回退/未定义防护/失败兜底分支不再只是"单测锁定 + 诚实降级"，已在真实浏览器执行实际模块代码验证通过。
