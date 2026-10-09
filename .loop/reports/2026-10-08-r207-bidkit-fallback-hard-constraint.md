# R207 · 无底稿兜底强化·响应文件组成硬约束 + 缺失告警（切片 2 / R-003）

日期：2026-10-08　轮次：R207　优先级：P0（用户四条 P0 之一，切片计划第 2 片）
类型：**A 类小改 + B 类提示词流程**（PROMPT_VERSION 2→3；零 schema / 零 collection / 零 pb_hooks）

## 一、选题与依据

来源：需求记录 R-003——无底稿兜底要显式对齐招标文件的响应文件组成与评分要求。
现状定性（代码核实）：`generateOutline` 已按 `parse_report.response_req`（含 composition 数组）出大纲，
但【响应文件要求】段只软说"逐条落实"，**没有强制"章节顺序与命名严格按 composition"**，
且缺 composition 时无任何警告——用户会以为是"系统乱编"。

## 二、方案与口径

- **提示词硬约束**（bidOutline.ts / outlineLevel1.ts）：当 `respText`（response_req 摊平文本）非空时，
  向硬性要求注入一条「响应文件组成硬约束」——组成列出的每个部分必须逐项映射为对应顶层章/专门小节，
  **顺序与命名保持一致，不允许合并或改名**；未列出但编制必需的常规章可在末尾补充。
  PROMPT_VERSION 2→3。缺组成时不注入（避免误导模型对齐不存在的组成）。
- **运行时非阻断告警**（useBidWorkspace.runGenerateOutline）：过完 `OUTLINE_DEPEND_KEYS` 硬门后，
  若 `hasBidComposition(report)` 为假 → `toast.info` 提示"未解析到响应文件组成，将按评分办法+常规骨架兜底；
  建议回第 2 步补勾解析该项"，**不阻断**（用户可继续）。
- **数据层纯判据**（bidTypes）：`hasBidComposition(report)` = `sectionText(report,"response_req")` 非空。
- **UI 文案**（ComposeStep）：顶部副标题改为"未上传底稿时，按招标文件解析出的响应文件组成与评分要求自动编排
  全部内容；可从方案编制引入底稿"，明确兜底语义。
- **ParseConfigDialog 必勾**：经核实 `response_req`（响应文件要求=组成）、`tech_score`、`biz_score`
  **已在 PARSE_KEY_SECTIONS 八项必选内**（弹窗渲染为 disabled+checked「必选」徽标），该项**现状即满足，无需改动**。

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/pages/BidWorkspace/bidTypes.ts` | +hasBidComposition 纯判据 |
| `src/pages/BidWorkspace/useBidWorkspace.ts` | import hasBidComposition；runGenerateOutline 缺组成非阻断 toast 告警 |
| `src/pages/BidWorkspace/prompts/bidOutline.ts` | PROMPT_VERSION 2→3；respText 存在时注入响应文件组成硬约束 |
| `src/pages/BidWorkspace/prompts/outlineLevel1.ts` | 同上（call1 顶层章口径一致） |
| `src/components/bid-workspace/ComposeStep.tsx` | 顶部副标题点明兜底语义 |
| `src/pages/BidWorkspace/prompts/outlineGate.test.ts` | +3 用例（hasBidComposition 判据 / 有组成注入 / 缺组成不注入） |

（各源文件改前留 `.r207bak` 备份。）

## 四、四门验证

- **tsc** `npx tsc --noEmit` EXIT=0
- **vitest** `npx vitest run` **131 files / 1554 passed / 2 skipped**（R206 基线 1551 → +3 用例）
- **eslint** 改动文件对比 `.r207bak` 基线：新增 error/warning = **0**（`outlineLevel1:58` 的 `no-useless-escape`
  为 R206 `part=\"tech\"` 模板串遗留，pre-patch 备份同样命中；useBidWorkspace 9 errors/13 warnings 全为
  set-state-in-effect/exhaustive-deps 仓库长期 baseline）
- **build** `npm run build` EXIT=0 3.77s
- **快照** `promptsSnapshot.test.ts` 31 用例**无 -u 通过**（既有快照 fixture 无 response_req，硬约束按 `if(respText)`
  门控不触发，字节保留；PROMPT_VERSION 不入快照）

## 五、浏览器实摆（http://localhost:8000/bid-workspace）

真实项目「安庆市第二人民医院智慧医院信息化系统项目」（已解析）第 3 步「投标文件编制」：

1. evaluate_script：新副标题命中「未上传底稿时，按招标文件解析出的响应文件组成与评分要求自动编排全部内容；
   可从方案编制引入底稿」，旧文案「按解析出的评分办法与响应要求组织技术标…」已消失 ✓
2. 截图 `.qoder/r207_fallback_subtitle.png` 可见「投标文件编制」标题下新副标题渲染正常 ✓
3. 组成缺失告警路径与硬约束注入由单测覆盖（告警在 AI 调用前触发，实摆不发起付费生成，避免无谓成本）

## 六、最终结果与挂账

- 无底稿默认路径显性化：有组成→大纲逐项映射其顺序命名；缺组成→诚实告警引导回第 2 步，不阻断；
- 副标题点明兜底语义，降低"系统乱编"误解；必勾项现状即满足，零多余改动；
- 引擎隔离/AI 入口/配置化约束维持（AGENTS.md §2/§3/§6）。
- 下一片：切片 3（R208 / R-001 mammoth 底稿增量补写）。
