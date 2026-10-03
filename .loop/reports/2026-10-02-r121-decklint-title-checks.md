# R121 — PPT 导出前自检增强：跨页重复标题 + 内容页缺标题（并补齐 deckLint 全量单测）

## 选题依据
- 账本 round=120。quote-history-01（报价二期）、prompt-fabscan-03（按章聚合回注）已分别于 R102/R103 closed，维持裁定不重开。
- 巡检角度（文案一致性/无障碍/性能/死代码/交互断链）：
  - 无障碍：git-clean 文件内 img 缺 alt、图标按钮缺可访问名实测为 0（既有代码已覆盖，误报排除）。
  - 裸 fetch 绕过 pbJson 的组件（ChatStream/BidWarRoom/CompanyTemplateHint/BidNodesCard/SourceManagerPanel）均为 git-M 或 ?? 未跟踪在途 → 绕开。
  - UTC 时间戳站点仅剩 QualCertsPage（位于 ?? 未跟踪新目录 src/pages/QualCerts/）→ 维持 r112-datestamp-qualcerts-defer 不动。
  - ComposeStep.tsx、R119 死码清单所在 9 个 .ts/.tsx 全部仍为 git-M → money-count-defer-composestep-01 / r119-dead-export-mwip-defer 继续 defer。
- 择定 deckLint.ts（src/pages/PptQuote/deckLint.ts）：git-CLEAN、纯函数、被 usePptQuote.ts:761 导出前自检实际调用（非死代码），且此前 0 独立单测。其模块定位即「借鉴顶级 pptx skill 的 render→检查→修正自校验闭环，专治 AI 生成幻灯片常见问题」——补两条 AI 批量生成高频缺陷规则属实质自检能力增强，而非零风险小改。

## 变更内容（仅动 git-clean 的 deckLint.ts + 新增其单测）
1. 新增 `duplicate_title`（warn）：跨内容页共用同一标题的判定。归一化口径 `normalizeTitle` = trim + toLowerCase + 剔除内部所有空白；忽略分节页（layout=section）与空标题；命中一条重复标题产出一条告警，page 记最后一次出现页，msg 列出全部重复页码。
2. 新增 `missing_title`（info）：内容页有正文/图表/配图却无标题（导出后为「无头」页）。分节页不判；真空页仍由既有 empty_page 分支优先短路 return，二者互斥。
3. 既有告警清单去重 + 截断（≤6）逻辑不变；新规则按插入顺序参与既有去重与上限，不改变原有 6 条规则的判定与顺序。
4. 非阻断：全部为 warn/info，维持「只提示不拦截导出」，不改任何导出行为硬门禁。

## 未触碰 / 维持裁定
- 未动提示词文本（本轮不涉及 PROMPT_VERSION）。
- 零数据模型改动：无 PocketBase collection / pb_hooks 变更，无新增 collection，会话内 state 不变。
- 编造嫌疑未清零禁止导出硬门禁：维持 R89 裁定「只报告不拦截」，本轮 deckLint 同样只做导出前告警不拦截。
- lint-debt-01：维持有意保留残余不重构。
- 未 git commit（仅工作区文件改动）。

## 四门验证（目标项目目录）
- npx tsc -b：0 error。
- npx vitest run：761 passed | 2 skipped（75 文件）。基线 742 → +19 增量（新增 deckLint.test.ts 19 用例）。
- npx eslint src/pages/PptQuote/deckLint.ts src/pages/PptQuote/deckLint.test.ts：0 error（改动前基线亦 0）。
- npx vite build：成功 3.04s（chunk>500kB 为既有告警，非 error）。

## 文件
- 改：src/pages/PptQuote/deckLint.ts（+normalizeTitle / +missing_title / +duplicate_title）
- 新增：src/pages/PptQuote/deckLint.test.ts（19 用例，覆盖新旧 8 条规则 + lintSummaryText + 边界）
- 补丁脚本：scripts/r121_decklint.py、scripts/r121_write_test.py；备份 .qoder/tmp/deckLint.ts.bak-r121
