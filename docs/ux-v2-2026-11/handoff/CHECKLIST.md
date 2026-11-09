# CHECKLIST · 收尾自检清单（每批提交前必须逐条打勾，随回报一起提交）

> 用法：复制本文件内容到回报结尾，把 `[ ]` 改成 `[x]` 或 `[✗ 原因]`。
> **任何一项是 `[ ]` 或 `[✗]`，本批视为未完成。** 不许写「大部分完成」。

---

## A. 写域纪律

- [ ] 我的改动文件清单 **全部**在任务书的写域白名单内
- [ ] 我没有改 `src/pages/` 下不属于本批的模块
- [ ] 我没有改 `src/components/shell/`（除非 B1）
- [ ] 我没有改 `eslint-budget.json`
- [ ] 我没有改 `tailwind.config.js`
- [ ] 我没有改 `.qoder/`、`pocketbase/pb_data/`、`.env*`
- [ ] 我没有执行 `git push` / `reset` / `clean` / `rebase`
- [ ] 我没有删除用户既有产物（标书正文 / 方案 / PPT 数据）

> 自查命令：`git status --porcelain` + `git diff --stat`，逐行核对。

---

## B. 四门

- [ ] `npx tsc -b` → **0 error**（贴原文）
- [ ] `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build` → **exit 0**（贴原文）
- [ ] `npx vitest run` → **全绿**（贴 files/passed/skipped 数字）
- [ ] `npx eslint .` → **error ≤ 114 / warning ≤ 11**（贴原文）

> 如果任何一门比基线差：
> - [ ] 我在回报里解释了哪来的一增
> - [ ] 我没有为了过门而改预算或跳过测试

---

## C. 设计对齐

- [ ] 本批每一屏我都打开原型对照过（不是凭记忆实现）
- [ ] 每屏**只有 1 个** `variant="default"` 的 Button（弹窗内不计）
- [ ] 我没有改间距 / 颜色 / 字号（除技术约束导致的 13px→14px）
- [ ] 我没有加原型里没有的组件
- [ ] 我没有把 `DataBar` 改回统计卡（或反之）
- [ ] 徽标语义正确（red=阻断 / orange=临期 / amber=待确认 / green=完成 / blue=进行中 / gray=归档）

> 自查命令：
> ```powershell
> # 一屏多主 CTA 检查（逐个 Page 文件）
> Select-String -Path src\pages\<本批目录>\*.tsx -Pattern 'variant="default"' | Group-Object Filename
> # 硬编码色值检查
> Select-String -Path src\pages\<本批目录>\*.tsx -Pattern '#[0-9a-fA-F]{3,6}\b|rgb\('
> ```

---

## D. 三态齐全

- [ ] 每屏有**加载态**（`LoadingState` 或骨架屏）
- [ ] 每屏有**真空态**（`EmptyState`，且**带 `action`**——下一步能做什么）
- [ ] 每屏有**失败态**（`ErrorState`，且**带 `reason`**——说人话）
- [ ] 我没有把「请求失败」写成「没有数据」

---

## E. 危险操作

- [ ] 本批所有危险操作（删除 / 停用 / 清空 / 覆盖 / 导出）都有**二次确认**
- [ ] 确认弹窗里写了**后果一句话**（不是"确认操作？"）
- [ ] 危险按钮用了 `variant="destructive"` 或红色描边
- [ ] 危险按钮**不与主 CTA 视觉同权重**

---

## F. 行数与结构

- [ ] 单个页面组件 ≤ **400 行**
- [ ] 单个 hook ≤ **800 行**
- [ ] 我没有为了拆屏而重写数据层（`useXxx.ts` 的数据获取逻辑）
- [ ] 我没有把大文件拆成更大的文件

> 自查命令：
> ```powershell
> Get-ChildItem src\pages\<本批目录> -Recurse -Filter *.tsx | ForEach-Object {
>   [PSCustomObject]@{ File=$_.Name; Lines=(Get-Content $_.FullName).Count }
> } | Sort-Object Lines -Descending | Select-Object -First 5
> ```

---

## G. 路由与文案

- [ ] 新增屏都已在 `routeRegistry.ts` 注册
- [ ] `label` 与 `document/manifest.js` 的 `tab` **逐字一致**
- [ ] 屏内 Tab 能正常显示与跳转
- [ ] 旧路径仍可访问（未因拆屏而失效）
- [ ] 文档标题 / 面包屑显示正确

---

## H. 术语

- [ ] 用「标书」不用「投标文件」（导航与按钮中）
- [ ] 用「编号」不用「ID」
- [ ] 用「商机」不用「机会」
- [ ] 用「成员」不用「用户」（指团队账号时）
- [ ] 用「知识原子」不用「知识块 / 知识点」
- [ ] 用「通道」不用「接口 / provider」（指模型接入）

---

## I. 回报完整性

- [ ] 回报包含「一、改动文件清单」（新增/修改/删除分开）
- [ ] 回报包含「二、四门实测」（**原始输出**，不是估算）
- [ ] 回报包含「三、本批屏与原型对照」（逐屏 ✅/❌）
- [ ] 回报包含「四、行数体检」
- [ ] 回报包含「五、未做 / 不确定 / 需决策」（写「无」也要有这一行）
- [ ] 回报包含「六、顺带发现」（只报告不改）
- [ ] 回报包含**本清单的勾选结果**

---

## J. 跑偏自检（诚实回答）

- [ ] 我没有"顺手优化"任何不在任务书里的东西
- [ ] 我没有因为"觉得不好看"而改动设计
- [ ] 我没有因为"过不了测试"而删除或跳过测试
- [ ] 我没有把没做的说成"已完成"
- [ ] 我遇到的阻碍都在「五、未做 / 不确定 / 需决策」里如实写了

---

## 提交前最后三问（自己回答，写在回报末尾）

1. **如果 Lead 打开这一屏，第一眼会觉得"这就是原型"吗？** 如果不会，差在哪？
2. **这一屏有什么是我"猜"出来的，而不是原型里明确的？** 列出来。
3. **这一批我删掉或跳过了什么？** 为什么？
