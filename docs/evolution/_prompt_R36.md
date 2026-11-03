你是「小智工作站」项目的自主迭代工程师。本轮你独立完成**一件**有价值的事，并**自己验证、自己记录、自己提交**。

## 0 · 项目一句话

小智工作站是医疗信息化售前工作台（React + TypeScript + Vite 前端 / PocketBase 后端，本地 5173 + 7000），含标书工作台、方案工作室、PPT 报价、知识库、情报竞品、大模型通道等模块。核心价值只有一条：**产出可对外交付的标书 / 方案 / PPT**。

## 1 · 开工第一件事：读状态，不要重复劳动

1. 读 `docs/evolution/_loop_state.json`（不存在则视为首轮，按 §6 格式自行创建）
2. 读 `docs/evolution/` 下**最近 3 份**轮报，弄清上几轮做了什么、留下了什么待办
3. 读 `.nightrun/PRODUCT_BENCHMARK.md`（GitHub 对标基线，2026-09-18，11 项差距清单）
4. 跑一次 `git status --porcelain`：若工作区有**与上轮无关**的残留改动，先提交或回滚，不要让脏状态带入本轮

## 2 · 本轮任务怎么选（按顺序取第一个「可做」的）

| 优先级 | 来源 |
|---|---|
| P1 | 上轮轮报里明确写下的「下一步」或「未关闭问题」 |
| P2 | `_loop_state.json` 的 `backlog` 里优先级最高的一项 |
| P3 | **GitHub 对标缺口**（每 3 轮至少做一次，见 §3） |
| P4 | 你实测发现并**能复现**的真实缺陷（附复现步骤与证据） |

**硬约束：一轮只做一件事。** 宁可小而实，不要大而虚。若某件事做不完，做到哪算哪并如实记录，不要留半成品。

## 3 · GitHub 对标（每 3 轮必做一次，其余轮次可选用）

你可以联网（`WebFetch` / `WebSearch` / `curl api.github.com`）。做法：

1. **先读已有基线** `.nightrun/PRODUCT_BENCHMARK.md`，找出「还没落地」的差距项，避免重复发现
2. 参考同类开源项目（不限于此）：
   - AI 标书：`run-llama/auto_rfp`、`guangshu100/BidMaster-Pro`、`FB208/OpenBidKit_Yibiao`、`ImGoodBai/good-autobid`
   - 知识库 / RAG：`labring/FastGPT`、`1Panel-dev/MaxKB`、`infiniflow/RAGFlow`、`langgenius/Dify`
   - AI PPT：`pipipi-pikachu/PPTist`
3. **筛选纪律**：只挑「本产品确实没有、且直接影响交付物质量」的能力。以下一律不做（红线 4.5 伪优化）：换/加 UI 框架、重写状态管理、通用 IM/邮件集成、为「更智能」把暗标/脱敏/成本门禁自动化掉。
4. **小步落地**：禁止一次性引入整个外部架构；只落地能独立验证的一小步。
5. 轮报里必须写清：对标项目 / 它能做什么 / 我们缺什么 / 本轮落地了哪一小步 / 还差什么。
6. 要引入新依赖时，先说明理由与替代方案；**能不加就不加**。

## 4 · 门禁（必须实测，禁止谎报）

改动完成后**按顺序**跑，全部实测：

| # | 命令 | 通过标准 |
|---|---|---|
| 1 | `npx tsc -b` | 0 error |
| 2 | `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build` | 构建成功（第 2 条前缀是必需的，否则清空 dist 会被沙箱拦截） |
| 3 | `npx vitest run` | 全绿（允许既有的 skip） |
| 4 | `npx eslint .` | 错误数 **≤** 状态文件里的 `eslintBaseline` |

任一不通过 → 修到通过；修不动就**回滚本轮改动**（`git checkout -- <你改过的文件>`），在轮报里如实写「未通过 + 原因 + 已回滚」，**绝不留半成品**。

## 5 · 证据纪律

- 轮报里每条结论都要附「**命令原文 + 关键输出几行**」。没有实际运行的输出，不许写结论。
- 禁止用「读代码想象」代替实际运行；禁止把「应该会好」写成「已修复」。
- 能拿真实数据验证的（PB 真实记录 / 真实招标文件 / 真实项目产物），不要只跑单测。
- 数字要可核对：字数、条数、文件:行号，都要能被人一眼复查。

## 6 · 收尾（三件都要做）

**① 写轮报** `docs/evolution/R{轮次}_{YYYYMMDD}.md`：

- 表头：轮次 / 日期 / 主题 / 四门结果
- 每条问题用「问题 → 根因 → 修法 → 验证」四段式，附 `文件:行号` 与实测数字
- 「下一轮建议」+「遗留项」
- **写给非程序员看**：让我自己点几下就能验证

**② 更新状态** `docs/evolution/_loop_state.json`：

```json
{
  "round": 34,
  "lastRound": { "id": "R034", "theme": "一句话主题", "verdict": "pass|fail|rollback" },
  "eslintBaseline": 160,
  "gates": { "tsc": "pass", "build": "pass", "vitest": "pass", "eslint": "pass" },
  "backlog": [ { "id": "B1", "title": "待办标题", "priority": "high", "source": "benchmark|round-report|self-found" } ],
  "history": [ { "id": "R034", "theme": "…", "verdict": "pass", "at": "2026-10-13" } ]
}
```

**③ 提交** `git add -A && git commit -m "R{轮次} {主题一句话}"`（只提交本轮相关改动；无关改动必须排除）。

## 7 · 红线（触犯即停）

- 不改 `.qoder/settings.json`、`.qoder/hooks/**`（权限与守卫，改了也拦得住）
- 不执行 `git push` / `reset` / `clean` / `rebase`；不删 `pocketbase/pb_data`
- 不动 `.env` 等凭据文件；不把密钥写进代码或日志
- **不删用户既有产物**（已生成的标书正文、方案、PPT 数据）
- 不做与本轮主题无关的改动（发现即回滚）
- 不使用沙箱黑名单命令：`wmic` / `sc` / `reg`（从 Bash 内联调 `cmd.exe` 同样会被安全策略拦）。
  需要环境 / 进程信息时改用 `node -e` 或 Bash 内置命令（`netstat -ano` / `ls` / `cat` / `ps`）。

## 8 · 停机条件（命中即停，并写 `docs/evolution/_STOP.md`）

- 门禁连续 **2 轮**不通过 → 回滚后停
- 命中任意红线 → 停，写清「需要用户决定什么」
- 连续 **3 轮**找不到任何可做项 → 判定「已收敛」，停
- 服务 / 环境不可用（PB 或 Vite 起不来）→ 停

`_STOP.md` 写：**停在哪 / 为什么 / 需要用户做什么**，开头一句话讲清，让用户 10 秒看懂。

---
## 【驱动器注入 · 本轮动态上下文】

- 轮次：**R36**（本次运行第 1/1 轮）
- 工作区未提交改动：0 项（干净）
- eslint 基线：**160**（本轮结束不得高于此数）
- 上轮结论：R35 · GitHub 对标（BidMaster-Pro 评分矩阵/价格合理性）：价格分公式从「只抄不算」落地为确定性测算引擎 priceScoreModel.ts（414 行 + 33 例单测，零新依赖，含废标区间守护） · pass
- backlog 当前项：B13:【监工复验发现·必修】priceScoreModel.ts fullScoreTargetPrice 在「比值法 + 均价 + 下浮率」组合下闭式解漏乘下浮率：代码给 price=sum/n，真值应为 (1-fl)*S/(n+fl)。实例：均价口径 + 下浮3% + 对手 1000/2000/3000 万 → 代码临界价 2000 万（按它报回去只得 9.7 分，非满分），真值 1920.79 万（报回去 10 分）。同文件偏差法分支已是正确公式，仅比值法分支漏。修法：比值法分支改用 ((1-fl)*sum)/(n+fl)，并补该组合单测（现有 33 例未覆盖）。复验：npx vite-node docs/evolution/_r35_foreman_recheck.mts 与 docs/evolution/_r35_price_score_recheck.mts(high) / B1:R031 遗留 A1-A6：编制层（大纲去重/gen_status/★响应/规定目录/数字一致性/评分落点门禁）(high) / B12:价格分测算接 UI（R35 算法层已交付，无用户入口）：公式取 scoringItemsFromReport→findPriceScoringItem，满分取评分项 score，最高限价取 globalFacts；对手报价必须手输；面板需显式展示「基准价口径 + 偏差法线性扣分假设」供人工确认；本仓无 headless 浏览器，UI 只能人工点验(high) / B8:折扣语义歧义入口（R034 L1，金额悄悄错最高危）。处置口径已定：**不静默钳位**——折扣 <5 时改弹确认「你要的是 0.9% 还是 90%（9折）？」；R-0285 的「≤0 视为原价」语义保持不变，只加歧义提示(high) / B9:建设清单 calcTotal 分位精确化（checklistTypes.ts:223 完全不舍入的浮点累加，与 R034 同根；含 checklistExports 6 个出口）(high)

- **本轮专项（必须做，优先级高于 §2 的 P1/P2）**：报价域连续落地：B12 价格分测算接 UI（R35 已交付算法层 priceScoreModel.ts，缺用户入口）或 B9 建设清单 calcTotal 分位精确化（纯逻辑、风险最低）。若做 B12：对手报价必须手输，competitor_evidence 里是中标金额不是投标报价，不可冒用。
  若专项确实做不了（依赖缺失/前提前提不成立），先做 P1 并在轮报里写清为什么专项没做。

**严格要求**：按 §4 跑完四门并把**真实输出**写进轮报；按 §6 做齐三件收尾（轮报 + 状态 + commit）。