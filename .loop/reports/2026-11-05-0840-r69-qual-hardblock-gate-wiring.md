# R69 · 2026-11-05 08:40 · 导出闸门接入资质硬拦截单一真源（B42 闭合）

## 一句话结论

R66 修了资质台账那半边、但导出闸门那半边一直是内联 `!== "0"`（因为文件在别人未提交批次里碰不了）—— **这个被堵了 4 轮的 B42 本轮终于闭合**：在途文件全部落地，BidWorkspace 域干净了，把 `useBidWorkspace.ts` 的内联判定换成 `readQualHardBlock()`，哨兵从「允许两种形态」升级为「必须走单一真源、不许再内联」。

## 本轮做了什么 / 为什么做

**问题**：`useBidWorkspace.ts:9612` 的导出闸门一直用 `window.localStorage.getItem("qual_hard_block") !== "0"` 判定硬拦截是否开启，而 R66 已经把同一个键的判定收进了 `src/lib/qualHardBlock.ts`（`readQualHardBlock()`），台账页也改调了它。两处口径虽然语义等价（都是「只有 "0" 才放行」），但闸门没接入单一真源意味着：以后改默认值或降级策略，只改 lib 不会自动同步到闸门——这正是 R66 的 bug 复发条件。

**为什么现在能做**：R68 收尾时工作区有 248 个别人未提交的文件（BidWorkspace 占 79），B42 被堵。本轮开工 `git status --porcelain` 只有 **7 个**（1 个已改 + 6 个临时文件），在途文件已全部落地。

**定级**：S3 / A 类（修）。口径不变、语义不变，只是把内联判定换成函数调用 + 哨兵升级。属收尾接线，不是新功能。

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/pages/BidWorkspace/useBidWorkspace.ts` | +1 import / -3 +3 行（内联 `!== "0"` → `readQualHardBlock()` + 注释更新） |
| `src/lib/qualHardBlock.test.ts` | 哨兵断言升级：从「允许 `readQualHardBlock()` 或 `!== "0"` 两种形态」改为「必须走 `readQualHardBlock()`、不许再内联 `!== "0"`」 |

**业务数据 / schema / pb_hooks / 提示词 / 导出格式 / 认证逻辑 / 依赖：0 改动。**

## 你怎么自己验证

1. 这个改动不影响界面外观，验证方式是跑测试。
2. 打开终端，在项目根目录跑：`npx vitest run src/lib/qualHardBlock.test.ts`
3. 应该看到 `10 passed`。
4. 想确认哨兵真的在盯着：在 `src/pages/BidWorkspace/useBidWorkspace.ts` 里找到 `hardBlock = readQualHardBlock()` 这行，临时改回 `hardBlock = window.localStorage.getItem("qual_hard_block") !== "0"`，再跑同一条命令 → 应该看到 `1 failed | 9 passed`（失败信息是「导出闸门未调用 readQualHardBlock()——B42 接线已回退」）。改回来就恢复全绿。

## 验证结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| tsc | `npx tsc -b` | exit 0 |
| build | `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build` | exit 0 |
| vitest | `npx vitest run` | **418 files passed / 3 skipped (421)，4824 tests passed / 11 skipped (4835)** |
| eslint | `npx eslint .` | **116 error / 11 warning = 基线零新增**（开工前 116/11，改后 116/11，逐文件比对零变化） |

**反证**：把 `readQualHardBlock()` 临时改回内联 `!== "0"` → `1 failed | 9 passed`（失败项正是哨兵「导出闸门已接入单一真源」）；还原后 10/10 passed。

**vitest 基线变化**：R68 是 376/4400/2，本轮 421/4835/11。增量来自在途批次落地（他人在 R64-R68 期间积累的未提交测试现在全部进了仓库），本轮自身贡献 +0 文件 / +0 例（只改了已有测试的断言文案与判定逻辑）。

## 遗留与新发现

1. **B46（列表倒计时 chip 仍走 UTC 口径）**：BidWorkspace 域现在干净了，下一轮可以做。`bidTypes.ts:8235` 的 `daysUntil` 用 `new Date()` + `Math.ceil`，和 R68 修的三个面是同一个「00:00–08:00 多算一天」的毛病。改法：内部改调 `lib/bidOpenDay.ts` 的 `daysUntilLocalDay`，或让 `BidProjectList` 直接用它。注意 `daysUntil` 还被回收站保留天数用（`30 + daysUntil(deleted_at)`），改口径会让负数档位差 1 天，需一并核对文案。
2. **工作区状态大幅改善**：R68 的 248 个在途文件 → 本轮开工只有 7 个（1 改 + 6 临时）。R64-R68 连续五轮被堵的 BidWorkspace 全域现在可碰了。
3. **vitest 基线大涨**：421 files / 4835 passed（vs R68 的 376/4400），全部来自在途落地。`AGENTS.md` 的 vitest 基线行（写 301/3513）和 `eslint-budget.json` 需要同步，但属 B38 的延续，本轮不碰。
4. **`deckReshape.ts` 有 1 个他人改动（+35/-3）**未提交——不是本轮范围，未碰。

## 下一轮建议

1. **B46**（列表倒计时 chip 接 `lib/bidOpenDay`）：域已干净，一行改动 + 哨兵，和 B42 同款收尾。
2. **B38**（AGENTS.md vitest 基线同步）：现在在途已落地，可以准确同步了。
3. **B44**（资质台账 25 条「未登记有效期」不可见）：需用户点头，属展示口径变更。

## 需要你决定的事

- **B43**：导出闸门的资质核验是 fail-open（台账接口挂了就静默跳过、照常导出）。现在闸门已接单一真源，但 fail-open/fail-closed 的取舍仍需你拍板。
- **B44**：资质台账 34 条里 25 条不参与到期预警，页面看不出。补一张卡或一行提示？措辞要区分「长期有效」与「漏填」。
