# R108 — 相对时间显示口径收敛（全站唯一 formatRelativeTime 核心）

## 背景 / 选题
接续 R105（LLM 错误码中文表 5 份去重）、R106（CSV 导出全站唯一 buildCsv）的
"单一来源收敛 + 漂移修正"主线，巡检新角度：**相对时间显示**。

扫描发现全站存在 **4 份各抄一遍的相对时间格式化函数**，共享同一段
"刚刚 / X 分钟前 / X 小时前" 逻辑，但 ≥1 天分支口径已漂移：

| 站点 | ≥1 天行为 | 绝对兜底 |
|------|-----------|----------|
| `hooks/useActivityFeed.ts` `formatRelativeTime` | 昨天 HH:MM | X月X日 |
| `components/bid-workspace/StageHistoryPanel.tsx` `relTime` | X 天前（无上限） | 无 |
| `components/assistant/SessionListPanel.tsx` `formatSessionTime` | X 天前(<30) | toLocaleDateString |
| `components/knowledge/DocListPanel.tsx` `formatTime` | X 天前(<30) | YYYY-MM-DD |

同一概念（"这条记录多久之前"）在首页动态、标书阶段历史、助手会话列表、知识库文档
列表四处渲染出 4 种不同形态，且 30 天阈值、绝对日期格式各不相同——属真实的口径
漂移重复，非纯装饰。

## 方案（复用优先、不自研引擎、零 collection / 零 pb_hooks / 零提示词）
新建全站唯一来源 `src/lib/relativeTime.ts`：
- `formatRelativeTime(iso, afterDay?)` 收敛共享核心——空值/非法值兜底 +
  <1min→刚刚、<1h→X 分钟前、<24h→X 小时前（四处逐字一致的一段）；
- ≥24h 渲染交由调用方传入 `afterDay(date, diffMs, day)` 回调，令每页保持
  **逐字不变**的原措辞与原兜底（沿用 R105 "共享核心 + 专属覆写" 惯例）。

四处迁移（仅删重复边界分支 + parse/NaN 守卫，保留各自 day 分支语义）：
- StageHistoryPanel `relTime` → `formatRelativeTime(iso)`（默认 X 天前）
- SessionListPanel `formatSessionTime` → 核心 + `day<30 ? X天前 : toLocaleDateString`
- DocListPanel `formatTime` → 核心 + `day<30 ? X天前 : YYYY-MM-DD`
- useActivityFeed `formatRelativeTime` → 核心 + `昨天 HH:MM / X月X日`（保留导出名不变）

## 逐字等价保证（关键）
- 三处 day 分支由 `Math.floor(diff/60000/60/24)` 改为 `Math.floor(diff/86400000)`：
  正整数逐层向下取整恒等式 `floor(floor(floor(n/60000)/60)/24) === floor(n/86400000)`，
  且仅当 diff≥86400000（≥24h）才进入 day 分支，取值完全一致。
- 兜底用的 `new Date(t)` 与旧 `new Date(iso)`/`new Date(t)` 表示同一时刻，
  本地 getFullYear/getHours/toLocaleDateString/toDateString 结果一致。
- 空值/NaN 守卫上移到核心，行为等价（旧实现同样返回 ""）。

## 测试（增量 +6，全绿锁定回归）
`src/lib/relativeTime.test.ts`：
- 冻结 `Date.now`，用一段跨越所有档位与 30 天阈值两侧的 diff 电池；
- **行为或oracle 法**：把 3 个页面迁移前的原函数逐字复刻为参考实现，
  对每个 diff 断言 `formatRelativeTime(iso, cfg)` === 原函数输出——直接证明
  逐字零回归；
- 另 3 例锁共享核心：刚刚/分钟前/小时前、默认 X 天前、空/非法兜底。

## 四道门禁（目标项目目录）
- `npx tsc -b` → exit 0
- `npx vitest run` → **675 passed / 2 skipped**（基线 669 +6 新增）
- `npx eslint`（6 触及文件）→ 净新增 0：仅 `useActivityFeed.ts:156`
  `react-hooks/set-state-in-effect` 一条，位于 useEffect body（在途既有代码），
  本轮只改纯格式化函数 + 加一行 import（见 `git diff -U0` 仅命中 L5 与 L42-48），
  未触碰该行；relativeTime.ts/.test.ts 与另三组件 0 error。
- `npx vite build` → exit 0（3.05s）

## 维持裁定
- 未动提示词（非 B 类，无 PROMPT_VERSION 变更）；未动 pb_hooks / 后端 collection；
- 编造未清零导出硬门禁维持 R89 裁定"只报告不拦截"；lint-debt-01 残余不重构；
- 禁止 commit（工作树含 R89-R107 未提交在途补丁，全程未提交）。

## 触及文件
- 新增：`src/lib/relativeTime.ts`、`src/lib/relativeTime.test.ts`
- 迁移：`src/components/assistant/SessionListPanel.tsx`、
  `src/components/bid-workspace/StageHistoryPanel.tsx`、
  `src/components/knowledge/DocListPanel.tsx`、`src/hooks/useActivityFeed.ts`
- 补丁脚本：`d:/KFDXCX/MedPreSales/scripts/r108_relative_time_consolidate.py`
