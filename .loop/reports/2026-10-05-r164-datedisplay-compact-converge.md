# R164 — dateDisplay 单一真源收敛（列表紧凑时间戳 + Invalid Date 泄漏修复）

- 日期：2026-10-05
- round：163 → 164
- 角度：巡检（文案一致性 / 健壮性 / 单一真源），非维持裁定项
- 优先级：P3
- 影响面：纯展示层格式化；零 AI、零 PocketBase collection / pb_hooks、零 schema

## 1. 选题背景
R114 建立了 `dateDisplay.ts` 作为「ISO 串 → 人读日期」单一真源，R117 又把整站「完整」日期时间
（`YYYY-MM-DD HH:MM`）收敛进来。但**列表卡片用的紧凑格式 `M/D HH:MM`（去年份、去秒、24h）从未纳入**，
四个列表面板各自内联：

| 文件 | 形式 | NaN 守卫 |
|---|---|---|
| components/ppt-quote/DeckListPanel.tsx | 本地 `updatedText()` | 有 |
| components/ppt-quote/QuoteListPanel.tsx | 本地 `updatedText()` | 有 |
| components/solution-studio/SolutionListPanel.tsx | JSX 内联 | **无** |
| components/solution-studio/ChapterScoreCard.tsx | 三元内联 | **无**（仅挡空串） |

缺守卫的两处：坏/无法解析的时间戳会渲染成字面量 **"Invalid Date"**，属用户可见缺陷。

## 2. 格式实测（决定能否确定性替换）
`node` 实测 `new Date(...).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" })`：

```
0  -> "1/5 00:04"
3  -> "1/5 03:04"
13 -> "1/5 13:04"   # hour:2-digit 在 zh-CN 下是 24 小时制，非「下午1」
23 -> "1/5 23:04"
invalid -> "Invalid Date"
```
即：月/日不补零、24h、无年份、无秒。故可用纯确定性拼装复现，且规避 ICU 依赖。

## 3. 改动
### 3.1 新增单一真源 `dateDisplay.formatShortDateTime`
```ts
export function formatShortDateTime(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```
有效输入与旧输出逐字节相同；空/坏输入返回 `""`（即两处泄漏的修复）。

### 3.2 四处旁路迁移
- Deck/QuoteListPanel：删除本地 `updatedText()`，调用点改 `formatShortDateTime(...)`，新增 import（保留 `localDateStamp` 因 CSV 文件名仍用）。
- ChapterScoreCard：`checkedLabel` 三元 → `formatShortDateTime(selfCheck.checked_at)`，新增 import。
- SolutionListPanel：JSX 内联 → `formatShortDateTime(rec.updated)`，新增 import。

### 3.3 测试
`dateDisplay.test.ts` 追加：
- 3 条 `formatShortDateTime` 单测（valid 精确值 / empty "" / unparsable ""）。
- 1 条防回流哨兵：递归扫描 `src` 非测试文件（排除 `dateDisplay.ts` 与 `*.test.ts`），断言无残留 `month: "numeric"`，防止该紧凑格式再次旁路自实现。

### 3.4 顺带清理
R163 遗留 `.loop/trash_r163_bak/r163_bak_complianceMatrix.test.ts` 被 vitest 默认 glob 采集（`Cannot find module`）导致 1 个 suite 红。
该文件是 R163 自身备份产物（未跟踪），重命名为 `.ts.bak` 脱离采集。根因（test 采集卫生）记于下方挂账。

## 4. 四门验证
| 门 | 结果 |
|---|---|
| `npx tsc -b` | 0 error |
| `npx vitest run` | 97 files / **1075 passed, 2 skipped**（R163 基线 1071+2，净 **+4**：3 单测 + 1 哨兵） |
| `npx eslint`（触及 6 文件） | exit 0，零新增 error/warning |
| `npx vite build` | 成功，3.62s（>500kB chunk 警告为既有） |

## 5. 实机验证（localhost:8000 运行中的 Vite dev-server）
动态 `import('/src/lib/dateDisplay.ts')` 直取真实模块，与旧内联实现 A/B：

| 输入 | formatShortDateTime | 旧 toLocaleString |
|---|---|---|
| 2026-10-05T14:23:00 | `10/5 14:23` | `10/5 14:23` |
| 2026-01-05T03:04:00 | `1/5 03:04` | `1/5 03:04` |
| 2026-12-31T23:59:00 | `12/31 23:59` | `12/31 23:59` |
| 2026-13-45T99:99:00 | `""` | `Invalid Date` |
| garbage | `""` | `Invalid Date` |
| "" | `""` | `Invalid Date` |

有效值逐字节等价（无视觉回归）；空/坏值由 `Invalid Date` → 空（修复）。列表页在团队登录后方可达，
故以运行中 dev-server 的真实模块动态 import 作为等价的运行时证据，并注入可见浮层截图存档
（`.qoder/tmp_r164_proof.png`）。

## 6. 维持裁定与边界
- 未触碰编造嫌疑导出硬门禁（只报不拦）、lint-debt-01 有意残余。
- open backlog 仍全为维持裁定项：lint-debt-01 / ui-redesign-phase3 / quote-history-3-mining / r130-price-preview-404。

## 7. 后续挂账（不阻塞本轮）
- **test 采集卫生**：vitest 默认 glob 会扫到 `.loop/**` 备份 test 文件。建议后续新增独立 `vitest.config.ts`
  （`mergeConfig` 保 alias/react）设 `test.exclude` 加 `**/.loop/**`；因 `tsconfig.node.json` 会类型检查
  `vite.config.ts`，直接向其 `defineConfig` 塞 `test` 字段有 tsc 风险，故本轮仅重命名脱离采集。
