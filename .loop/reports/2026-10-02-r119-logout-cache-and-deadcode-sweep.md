# R119 登出缓存隐私失效接线 + git-clean 死码清扫

- 轮次：R118 → **R119**
- 日期：2026-10-02
- 选题来源：巡检新角度（死代码/隐私残留），非既有 backlog 主项（quote-history-01 / prompt-fabscan-03 均已 closed，编造扫描维持 R89「只报不拦」裁定不动）
- 类型：实质性隐私/正确性修复 + 代码质量清理；**零提示词、零 collection/会话内 state、未 commit**

## 一、核心修复：登出必须失效该用户的本机缓存（r119-logout-cache-invalidate-01）

### 问题
`clearTeamSession()` 是 logoutRhAccount / 401 失效 / 账号切换的唯一漏斗，但它只清了
localStorage 的 token/profile，**从未失效两份按登录用户分库的 IndexedDB 缓存**：

| 缓存 | 库名 | 内容 | 风险 |
|---|---|---|---|
| 知识库文档快照 | `kb-doc-cache:<uid>` | ~1700 篇含 content 的文档正文（病历/方案原文片段） | PHI 落盘滞留 |
| LLM 应答缓存 | `llm-resp-cache:<uid>` | 模型原始应答 | PHI 落盘滞留 |

两库都以登录用户 id 分库隔离（见 kbDocCache.ts / llmCache.ts 的 `dbName(userId)`）。
既有 `clearKbCache(userId)` / `clearLlmCache(userId)` 两函数功能完备、内部已 try/catch
静默降级，却因**登出漏斗忘记调用**而长期 0 引用（本轮 import-graph 探针定位到的死导出）。

后果：同机 A 账号退出后，其文档快照与模型应答仍留在磁盘；B 账号（或 A 再登录）在 TTL
窗口内可能 stale-while-revalidate 命中上一位用户的陈久数据。属真实隐私/正确性缺陷。

### 修复
`src/lib/teamAuth.ts` 的 `clearTeamSession()`：

1. 在 `removeItem` **之前**先取 `getCachedTeamProfile()?.id`（之后就读不到了）；
2. 登出事件照常派发；
3. 若拿到 uid，`void clearKbCache(uid)` + `void clearLlmCache(uid)` fire-and-forget
   失效两库。缓存是加速层，清理失败绝不阻断登出（函数内部已吞异常，不会 reject）。

新增顶栏 import：`@/lib/kbDocCache`、`@/lib/llmCache`（两者无对 teamAuth 的反向依赖，
不构成循环；仅定义函数无顶层副作用，AuthGate 首帧开销可忽略）。

### 单测（src/lib/teamAuth.test.ts，+4 用例）
node 环境下用 `vi.stubGlobal` 造 localStorage/window/Event，`vi.mock` 两份缓存模块：
1. 已登录：清 token/profile + 派发事件 + 按 uid 调 clearKbCache/clearLlmCache；
2. 未登录（无档案）：不触发清理，登出流程仍正常收尾；
3. 缓存清理 reject（fire-and-forget）：不抛错、不阻断登出；
4. 档案 JSON 损坏：按未登录处理，不误清缓存。

## 二、死码清扫（git-clean 文件，import-graph 精确核验）

用 BFS import 图 + 全仓子串终验，定位「定义文件之外零引用」的死导出；**只动 git-clean
文件**，M/未跟踪/命中在途 hunk 的一律绕开并登记 defer。本轮删除：

| 符号 / 文件 | 位置 | 说明 |
|---|---|---|
| `LoginBanner.tsx` 整文件 | components/common | 全站 0 引用孤儿组件（已被门禁/横幅体系取代）|
| `tooltip.tsx` 整文件 | components/ui | shadcn 遗留原语，0 引用（@radix-ui/react-tooltip 唯一使用点）|
| `extractAmountYuan` | lib/intelToOpp.ts | 0 引用 wrapper，核心 `extractAmountDetail` 保留且被深链使用 |
| `listLlmModels` + `LlmModelInfo` | lib/llm.ts | 0 外部引用；buildHeaders/getPocketBaseUrl 仍被其它调用点使用 |
| `hasImageSearchKey` | pages/PptQuote/imageSearch.ts | 0 引用；`getImageSearchKey` 由 SlideEditor 直接用，保留 |
| `isTeamLoggedIn` | lib/teamAuth.ts | 0 引用 wrapper；getTeamToken 内部别处仍用 |
| `teamRoleLabel` + `TEAM_ROLE_BADGE` + `ROLE_BADGE` | components/team-auth/TeamAuthGate.tsx | 「门禁外按需引用」的假想 API 从未被用；连带删掉变为未使用的 ROLE_BADGE const 与 TeamProfile import，避免 noUnusedLocals 报错 |

净变更：**7 文件 -116 行 / +12 行**（AuthGate/teamAuth 有新增注释与接线），另新增测试 1 文件。

## 三、在途代码保护（绕开并登记）

git status 显示全仓大量 M（未提交在途）。以下死导出虽经探针判定 0 引用，但**定义文件为 M
状态、含用户未提交改动**，按红线绕开，登记 `r119-dead-export-mwip-defer`：
- aigc.ts（9 个 0 引用函数）、kbCore.scoreKbDoc、kbAssemble.formatAssembleHits、
  rhLogin.openRhRechargeWindow、bidFiles.stageOf、competitorScores.compareColor/saveScoreOverride、
  deckExports.DOCX_TABLE_HEADER_FILL、pptQuoteTypes.DEFAULT_TAX_NOTE/parseMaterialRef；
- 整文件 `CompetitorCharts.tsx`：0 代码引用（仅 ledger/report/_qa 提及），但 git 为 M 且
  R118 上轮刚编辑过（软著 tooltip 等 5 站点），属活跃在途，**不删**。

## 四、维持既有裁定不动

- prompt-fabscan-03 / content-guard 的「疑似编造未清零禁导出」硬门禁：维持 R89 裁定「只报告不拦截」，不动；
- lint-debt-01 bidTypes 残余：有意保留不重构，不动；
- quote-history-01：一期/结单沉淀/二期区间推荐均已 closed，无残余。

## 五、四门验证（目标项目目录）

| 门 | 结果 |
|---|---|
| `npx tsc -b` | exit 0，零错误 |
| `npx vitest run` | 73 files，**727 passed / 2 skipped**（基线 723 → +4=teamAuth 新用例）|
| `npx eslint` 触及文件 | **新增 0 error**。llm.ts:111（initialFailed 无用赋值）、imageSearch.ts:81（\x00 控制字符正则）经确认为既有基线：本轮对这两文件仅做删除，未触碰该行、不可能新增此类错误 |
| `npx vite build` | exit 0，built in 2.80s |

## 六、回滚与安全

- 改动前 7 文件字节备份于 `d:\KFDXCX\MedPreSales\.qoder\tmp\r119_backup\`；
- 账本 `ledger.json.bak-r119`；
- 全程未 `git commit`；删除的两个源码文件均为 git-clean 已跟踪，可经 git 恢复（源码卫生，
  非 AGENTS#7 所指的 data/documents 敏感资料物理删除）。
