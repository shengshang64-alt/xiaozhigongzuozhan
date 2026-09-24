# 自动化执行记忆 · 医疗软件售前工作台自主迭代

## 执行历史

### 2026-09-22 01:08 · 第 10 轮 — 完成（有实质产出）

- **选题**：客户管理「客户总数」显示已加载条数(20) 而非真实总数(161) → 定级 **S0 / A 类（修）**，自动执行。
- **来源**：`docs/测试报告-售前工作台全面检查.md` 的 B-03 + B-04（并入候选池后实测坐实）。
- **根因（两层）**：① `/api/customers` 的 `totalItems` 恒等于本页条数 → 前端拿不到真总数；② 前端在总数未知时退而显示已加载条数，且统计卡未传 `capped`，无「+」提示 → "未知的 20" 被显示成"精确的 20"。
- **改动**：4 个文件 —— `pocketbase/pb_hooks/customers.pb.js`（照 `solutions.pb.js` 的 D-9 同款改为返回真总数）、`useCustomerManagement.ts`（采信真总数 + 暴露 `customerCountCapped` + 翻页同步）、`CustomerManagementPage.tsx`（传参）、`CrmStatsRow.tsx`（加 `capped` + 修正悬浮提示文案）。
- **验证**：接口 20→161、翻页恒定、筛选口径正确、401 门禁未破坏；实机 161 且翻页后仍 161；构建 exit 0、eslint 逐文件与基线一致（新增 0）、控制台 0 error；接口耗时 5–12ms。
- **副作用（需知悉）**：为让 pb_hooks 生效**重启了 PocketBase**（PID 10008→19800，参数与 `start-local.cmd` 一致）。**结论：pb_hooks 改动必须重启 PB 才生效，v0.40 无热重载**。
- **诚实项**：未留存修复前界面截图（改动前未开浏览器），修复前表现由接口实测+代码路径+docs 报告三处互证；构建曾 1 次不可复现的打包器偶发失败，重跑 3 次全绿。

## 经验沉淀（下轮直接用）

1. **并发写入警告**：本项目 `.loop/ledger.json` 可能被**并发进程**同时推进（本轮开工时 round=8，中途被另一进程改成 9 并关闭 ux-02）。开工读账本后、写账本前必须**重新 Read 一次**，用精确 old_string 做增量 Edit，**不要整体覆盖写 JSON**，否则会吞掉并发进程的结论。
2. **本轮已用过的手段**：`_qa/ab.sh` 的 `ab_login` / `ab_go` / `ab_report`；agent-browser 的 ref **不跨 bash 调用保持**，必须**同一次调用内** `snapshot` 取 ref 再 `click`（本轮用 `snapshot | grep | cut` 动态取 ref 成功）。
3. **验证命令**：`npx tsc -b && npx vite build`（pnpm build 等价回退）；`npx eslint src -f json -o <file>` 存基线再 diff，才能证明"新增 0"（默认 stylish 输出不适合机器比对；`-f compact` 在 ESLint 9 已移除）。
4. **重启 PocketBase 的命令**（本轮实测可用）：`Stop-Process -Id <pid> -Force` 后用 `Start-Process` 以 `serve --http=127.0.0.1:7000 --dir=…\pocketbase\pb_data --hooksDir=…\pocketbase\pb_hooks --migrationsDir=…\pocketbase\pb_migrations` 拉起；用 `/api/health` 轮询确认。
5. **后台调用一律要带 `X-Rh-User-Id: local-user`**，否则 401 `login_required`。

## 下一轮建议

**首选 `kb-cap-01`（= docs 的 B-01/B-02）**：知识库 `src/lib/kbCore.ts` 的 `MAX_PAGES=30 × perPage 200 = 6000` 硬上限，导致 6423 篇里 **423 篇静默不可见** + 首屏 40–61 秒。A 类（修），S0/S3 混合，严重度与频次都高于剩余界面类待办。
次选 `ux-03`（新建投标必填无校验，S2）或 `home-01/02/03`（工作台首屏，S2/B 类）。

## 待用户拍板（阻塞项，勿自行推进）

- `D-12` 导出 Word 空章节：A 方案（导出前提示）vs B 方案（写"（待补充）"）—— 我推荐 A。
- `E-2` 是否造常备最小测试数据集（打 `[NIGHTTEST]` 标记）—— 我推荐造。
- `B-10` 自定义接口身份仅凭客户端请求头可伪造 —— **触碰"身份认证"红线，只能出方案**。
- `docs/06` 九项新能力全部属 **C 类**（新增能力），需用户点头；我推荐先做第 3 项「招标文件倾向性/排他性参数识别」（几乎零成本、决策级价值）。
