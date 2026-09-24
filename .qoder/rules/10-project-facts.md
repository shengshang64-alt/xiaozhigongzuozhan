---
trigger: always_on
---
# 项目事实（直接用，不要重新探索）

## 位置与技术栈

| 项 | 值 |
|---|---|
| 项目根 | `D:\重要文件\工作的小程序\xiaozhigongzuozhan` |
| 产品名 | 小智工作站（医疗信息化售前工作台）· PRESALES DESK |
| 前端 | React 19.2.5 + TypeScript 6 + Vite 8 → `http://127.0.0.1:8000/` |
| 后端 | PocketBase v0.40.4 → `http://127.0.0.1:7000`，自定义路由在 `pocketbase/pb_hooks/`（37 个 `*.pb.js`） |
| UI | Radix UI + Tailwind + shadcn/ui 模式；图表 ECharts / recharts |
| 包管理 | pnpm |
| 代码规模 | 产品源码约 20 万行；1909 个文件（含非源码目录） |

## 常用命令

```bash
pnpm build      # = tsc -b && vite build —— 最强单一校验（类型 + 构建）
pnpm lint       # eslint
pnpm test       # vitest run（已有 20 个 *.test.ts）
```

**已知坑（踩过的，不要再踩）**

1. `pnpm` v10/v11 曾因 `ERR_PNPM_IGNORED_BUILDS` 卡死。已在 `pnpm-workspace.yaml` 用 `allowBuilds` 显式把 5 个包设为 `false` 解决。若再次出现，回退命令是 `npx tsc -b && npx vite build`。
2. `tsconfig.app.json` 开了 `noUnusedLocals` 与 `noUnusedParameters` —— **留下死代码会直接导致构建失败**。删代码时必须连带清引用。
3. **改 `pocketbase/pb_hooks/` 后必须重启 PocketBase 才生效**（PB v0.40.4 行为）。不重启会表现为"改了没反应"。
4. 启动服务用根目录 `start-local.cmd`（同时拉起 PB:7000 与 Vite:8000）。
   该脚本里有一处**不可删除**的处理：启动 Vite 前清空 `NODE_OPTIONS`。因为沙箱的 safe-delete 守卫会在 Vite 重建依赖缓存（一次性删除上百个 `deps_temp_*` 文件）时误杀 dev server（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）。
5. `vite.config.ts` 的 `plugins[0]` 必须是 `rhSourcePlugin()`，且**禁止整体覆盖该文件**（见平台契约）。

## 双身份体系（调接口必带）

| 身份 | 头 | 说明 |
|---|---|---|
| 业务数据身份 | `X-Rh-User-Id: local-user` | 缺此头 → 401 `login_required` |
| 团队认证 | `Authorization: Bearer <teamToken>` | 角色 admin / editor / viewer |

登录门禁 `TeamAuthGate` **只在 localhost / 127.0.0.1 / ::1 生效**。

## 12 个业务模块路由

`/` 工作台首页 · `/solution-studio` 方案编制 · `/bid-workspace` 标书工作 · `/ppt-quote` PPT 与报价 · `/format-tool` 格式刷新 · `/intel-center` 情报中心 · `/competitors` 竞品分析 · `/customer-management` 客户管理 · `/knowledge` 知识库 · `/model-config` 模型配置 · `/assistant` 小智助手 · `/team` 团队管理

## 高危大文件（改前必读全貌，**禁止顺手重构**）

| 文件 | 规模 | 说明 |
|---|---|---|
| `src/pages/BidWorkspace/bidTypes.ts` | 7048 行 | 全部标书提示词构造器 |
| `src/pages/BidWorkspace/useBidWorkspace.ts` | 6319 行 | 全部标书业务逻辑 |
| `src/pages/PptQuote/usePptQuote.ts` | 2210 行 | PPT 与报价逻辑 |
| `pocketbase/pb_hooks/intel_center.pb.js` | 1982 行 | 情报中心后端 |

## 状态与账本（每轮开工必读，一个都不能漏）

| 来源 | 角色 |
|---|---|
| `AI-ITERATION.md` | **唯一迭代入口手册**（v3，含 R1–R10 回归/专项轮/归因纪律），协议以它为准；`Qoder迭代提示词.md` 只是场景启动器 |
| `.loop/ledger.json` | **主账本**（round / backlog / closed / blocked / noProgressStreak） |
| `.nightrun/state.json` + `.nightrun/MORNING_REPORT.md` | 历史夜跑，**只读**，未结项并入主账本 |
| `.nightrun/ledger.json` | 历史夜跑缺陷账本，**只读** |
| `.loop/reports/` | 历次轮次报告 |
| `docs/05` `docs/06` `docs/测试报告-售前工作台全面检查.md` | 需求与缺口来源 |

`docs/循环测试与循环提升提示词.md` 是 **v1，已降级为验收标准附录**，不再是入口。
其【可量化验收标准 A/B/C/D】与【对标基准】仍然有效，被 `AI-ITERATION.md` 引用。

## 实机验证方法（浏览器自动化）

- 已有辅助脚本 `_qa/ab.sh`，封装自动登录（账号 `1971600574@qq.com` / `sgh199761`）。
- **关键经验 1**：agent-browser 会话**不跨 bash 调用保持**，每次调用都要重新 open + 登录；同一调用内 ref 才有效。
- **关键经验 2**：必须用 `agent-browser click @ref`。在 `eval` 里写 `.click()` 对 Radix 按钮**不可靠**，会造成"点了没反应"的假阳性。
- **关键经验 3**：`open` 与 `eval` 必须压在**同一个 bash 调用内**（`&&` 串联）。分成两次调用会导致 `eval` 漂移到 `about:blank`，返回"0 个标签/标题为空"的**假结果**，从而误判为"页面坏了"。
- 若浏览器不可用，退而用接口直调（带身份头）+ 代码静态核对，但**必须在报告里注明"验证方式已降级"**。
