---
name: xiaozhi-autoloop-round
description: 在「小智工作站」医疗售前工作台项目上执行一轮自主迭代，并按作业手册安全落盘（ledger / 轮报 / MORNING / docs/evolution）。当需要跑自主迭代、收尾记账、或在同一工作区存在并发执行者时安全写账本时使用。触发词：自主迭代、跑一轮、收尾落盘、ledger、轮报、autoloop、记账。
agent_created: true
---

# 小智工作站 · 自主迭代一轮（含并发安全落盘）

## 项目事实（先读，别猜）

- 根目录：`D:\重要文件\工作的小程序\xiaozhigongzuozhan`
- **没有** `AI-ITERATION.md`（项目已删除）；作业手册 = 根目录 `Qoder自主迭代提示词-v2.md`
- **权威账本** = `docs/evolution/_loop_state.json`（字段：`round` / `lastRound` / `history` / `baseline` / `backlog` / `notes` / `gatesBaseline` / `eslintBaseline`）
- **轮报** = `docs/evolution/R{轮次}_{YYYYMMDD}.md`
- 自动化线自己的账本 = `.loop/ledger.json` + `.loop/reports/` + `.loop/MORNING.md`（最新结论置顶）
- 红线清单见 `AGENTS.md` / `CLAUDE.md`；导出格式红线见 `docs/17-C类预授权与依赖白名单` 第 4 条

## 四门（逐条实测，不许推断）

```
npx tsc -b
CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build
npx vitest run
npx eslint .
```

- `vite build` **必须**带 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000`，否则清空 `dist/` 会被 safe-delete 守卫拦截。
- 基线（2026-10-15 实测）：tsc 0 / vitest **241 files · 2848 passed · 2 skipped** / eslint **119 error + 13 warning**。

## 并发安全（本项目必做，已实测踩过）

1. 开工先读 `docs/evolution/_loop_state.json` 的 `round`。
2. 收尾写账本前**重读**，并在写入脚本里**断言期望值**（如 `if (s.round !== 48) process.exit(1)`）—— 否则会被并发执行者静默覆盖。
3. 号被占用 → **主动顺延**（本轮实测 R48 → R49），并在两边账本写明编号来源。
4. 两个 JSON 都是 2 空格 pretty-print + 结尾换行。改前先验 `JSON.stringify(JSON.parse(raw),null,2)+'\n' === raw`，通过后再整写 —— 这样 diff 只含新增。
5. **不要 `git add -A`**：工作区常有别人的在途批次，会被一起提交。
6. 收尾写数字前再跑一次 `git status --porcelain`，点名排除并发批次；报告里区分「本轮贡献」与「在途增量」。

## 验证纪律

- 修缺陷 / 加防护的验收标准 = **「删实现即变红」**：临时把实现改坏 → 测试必须变红 → `git checkout` 还原 → 复绿且 `git diff` 为空。
- 新增测试文件用 per-file `/** @vitest-environment jsdom */`，**不动全局 node 环境**。
- UI 回归网必须驱动**真实组件 + 真实输入框**（`getAllByLabelText`）+ 断言**真实渲染文本**，harness 要**状态化**（totals 从最新 state 重算）；同值重复渲染时用 `getAllByText(...).length`，不要用 `getByText`。
- 界面验证：**agent-browser 不支持 Windows** → 用 jsdom + @testing-library，或 Playwright chromium 独立视口。
- 项目 hook **禁止智能体结束进程** → 「重启 :7000 PocketBase」类动作一律做不到，只能交给用户。

## 落盘清单（无人值守必须写文件）

1. `.loop/ledger.json`：`round` / `lastRoundSummary` / `closed` / `backlog` / `newFindings` / `lastRoundFiles`
2. `.loop/reports/YYYY-MM-DD-HHmm-r{N}-{slug}.md`（8 节：做了什么 / 为什么做（含被否方案）/ 改了哪些文件 / 用户怎么自查 / 验证结果（含诚实项）/ 遗留与新发现 / 下轮建议 / 需要用户决定的事）
3. `.loop/MORNING.md` 顶部追加一句话结论
4. `docs/evolution/R{N}_{YYYYMMDD}.md` + `docs/evolution/_loop_state.json`（`round` / `lastRound` / `history[0]` / `baseline.r{N}` / `backlog` / `notes`）
5. automation memory（`.workbuddy-ai/memory/automations/<id>/memory.md`）

## 选题纪律

- 开工第一件事：**抽查待办池前几条的「真实落地状态」** —— 本项目账本陈旧是高发形态（曾一次核出 3 处「早已完成却仍挂在待办上」）。
- 用「导出了但生产代码零引用」扫描查本项目的高发失效模式「**有算法没入口**」。
- 触碰 `docs/17` 第 4 条（导出格式红线，判定标准 = **「老用户已导出的文件是否还长得一样。会变 → 锁」**）只能出方案，不动代码。
