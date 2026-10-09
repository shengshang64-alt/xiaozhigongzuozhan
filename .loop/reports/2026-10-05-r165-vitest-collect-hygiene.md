# R165 — test 采集卫生结构修复（闭环 R164 挂账：独立 vitest.config.ts 杜绝 .loop 备份假红）

- 日期：2026-10-05
- round：164 → 165
- 角度：承接上轮报告明确挂账的根因修复（健壮性 / 采集卫生），非维持裁定项
- 优先级：P3
- 影响面：仅测试发现配置；零 AI、零 PocketBase collection / pb_hooks、零 schema、未动提示词（免 B 类）

## 1. 选题背景
R164 报告第七节「后续挂账（不阻塞本轮）」原文：
> vitest 默认 glob 会扫到 `.loop/**` 备份 test 文件。建议后续新增独立 `vitest.config.ts`
> （`mergeConfig` 保 alias/react）设 `test.exclude` 加 `**/.loop/**`；因 `tsconfig.node.json` 会类型检查
> `vite.config.ts`，直接向其 `defineConfig` 塞 `test` 字段有 tsc 风险，故本轮仅重命名脱离采集。

即 R164 只做了治标（把肇事备份文件重命名 `.ts.bak`），**根因未除**：只要后续任何一轮在
`.loop/trash_rNN_bak/` 落下一个 `*.test.ts`，全量测试就会再次出现 `Cannot find module` 假红
（R163→R164 已实际踩过一次）。本轮将该挂账一次性清偿。

用户点名的两优先项均早已收口（quote-history-01 → R102/R131、prompt-fabscan-03 → R101/R103），
open backlog 余下全部为维持裁定项（lint-debt-01 / ui-redesign-phase3 / quote-history-3-mining /
r130-price-preview-404），故按流程择优承接此结构修复。

## 2. 修复设计
新建 `vitest.config.ts`（仓库根）：

```ts
export default mergeConfig(
  viteConfig,                                     // 复用 vite.config：alias(@) 与 react plugin 单一真源
  defineConfig({
    test: {
      include: [
        "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",     // 单元/交互测试主域
        "scripts/**/*.{test,spec}.?(c|m)[jt]s?(x)", // intelShared.test.ts（pb_hooks 情报中枢回归）
      ],
      exclude: ["**/node_modules/**", "**/dist/**", "**/.loop/**"],
      environment: "node",
    },
  }),
)
```

要点：
1. **白名单而非黑名单兜底**：默认 glob 是全仓 `**`，任何目录（`.loop`/`dist`/临时散件）都可能在
   未来产生假红；把发现域锁到两个**既有真实测试落位**（src + scripts），未来新增旁路目录默认可见性为零。
2. **mergeConfig 复用 vite.config**：不在本文件重复声明 `resolve.alias` 与 `react()` plugin，避免与
   构建侧漂移（`.test.tsx` 依赖 alias 解析 `@/`）。
3. **`test` 字段不塞进 `vite.config.ts`**：正是 R164 指出的 tsc 风险路径——`tsconfig.node.json` 只对
   `vite.config.ts` 做类型检查，而 `vite` 的 `defineConfig` 类型不含 `test`。独立配置文件 + 不加入
   tsconfig.node include，使 `tsc -b` 门不受该文件影响（零风险）。
4. `environment: "node"` 显式固化既有默认行为（现存 97 个测试文件均跑在 node 环境，无一使用 jsdom
   全局设定），把隐式默认变成显式契约，防后续误改默认。

### 2.1 中途发现并修正的采集面收窄（诚实记录）
首版 include 只写 `src/**`，`npx vitest run` 立即 **97 → 96 files**——漏采了
`scripts/intelShared.test.ts`（已跟踪文件，20 个用例，以「读源提取共享段 + eval」方式回归校验
PocketBase `pb_hooks/intel_center.pb.js` 的情报中枢算法）。已把 `scripts/**` 补进白名单，
恢复 **97 files / 1075 passed + 2 skipped** 与基线逐数等价。

## 3. 判别性负控验证（证明修复真实生效）
在 `.loop/trash_r165_probe/probe_broken.test.ts` 放置一个**必然崩**的测试文件
（`import { nopeFromNowhere } from "@/lib/does-not-exist-r165"`）——这正是 R163 踩中假红的同型制品。

| 状态 | 结果 |
|---|---|
| 修复前行为（默认全仓 glob） | 该文件会被采集 → `Cannot find module` → 整个 suite 变红 |
| 修复后实测（探针在场） | `Test Files 97 passed (97)` / `Tests 1075 passed \| 2 skipped`，输出中 `probe_broken` 出现 0 次、`does-not-exist-r165` 出现 0 次 |

探针验证后已删除，不留残余。

## 4. 四门验证
| 门 | 结果 |
|---|---|
| `npx tsc -b` | exit 0，零 error |
| `npx vitest run` | **97 files / 1075 passed, 2 skipped**——与 R164 基线逐数等价（本轮零测试增减，属纯配置修复） |
| `npx eslint vitest.config.ts` | exit 0，零新增 error/warning |
| `npx vite build` | 成功，built in 3.75s（>500kB chunk 警告为既有） |

## 5. 在途保护与边界
- 改动前 `git status` 核对：37 个 `M` 在途文件（BidWorkspace/Competitors/PptQuote/SolutionStudio/aigc/kb* 等）
  与 13 个未跟踪 WIP 文件；本轮**只新增根目录 `vitest.config.ts`**，未触碰任何在途文件与在途行。
- 未触碰维持裁定：编造嫌疑导出硬门禁「只报不拦」、lint-debt-01 有意保留残余、r130 不碰 pb_hooks。
- 未 commit；账本回写前先落 `.loop/ledger.json.bak-r165`。

## 6. 后续挂账（不阻塞本轮）
- Vitest 5 提示 transform 占全跑时长 62%、可开 `fsModuleCache` 做跨次缓存：属长跑性能项，
  与采集卫生无关，留待后续按需评估（改缓存语义需另行验证不影响用例隔离）。
