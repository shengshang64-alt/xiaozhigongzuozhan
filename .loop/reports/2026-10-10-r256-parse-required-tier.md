# R256 报告 — 必选解析项分级 required + 失败判定 + 报告阻断提示（易标 R-030 Slice4）

日期：2026-10-10 ｜ 轮次：R256 ｜ 模块：标书工作台/BidWorkspace ｜ 优先级：P0

## 背景与缺口
易标《可复用能力分析》R-030 要求解析项区分「必选/可选」，必选关键项解析失败须显式暴露并引导补齐，避免用户带着
残缺的大纲/评分/响应进入后续编制。现状：PARSE_KEY_SECTIONS（8 项）注释虽写「必选不可取消」，但类型层无 `required` 字段、
报告层无「必选失败」聚合提示、左栏无必选/可选标识——失败只散落在单项 status，用户需逐项翻找。真实缺口 = 分级契约缺失 +
无失败聚合阻断 + 无视觉标识。

## 落地内容
1. **`bidTypes.ts`**：
   - `ParseSectionDef` 新增可选 `required?: boolean`（数据驱动既有「必选不可取消」口径）；8 个关键项各标 `required: true`。
   - `parseSectionTier(key)` → `"required"|"optional"|"other"`：required=关键必选项，optional=完整档可勾选其他项
     （void_items/qualification/lots 等），other=本地产出/非解析项（★条款 star_clauses、需求结构 req_structure）。
   - `requiredParseFailures(sections)` → 必选项中「解析失败」清单：缺席 / 空 / AI 降级（〔系统降级前缀）/ 持久化 failed。
     「原文未提及」属正常成功结果（源文件确无该维度），**不计失败**，避免对合理缺项误报阻断。
2. **`useBidWorkspace.ts`**：批量解析完成后 `requiredParseFailures(report.sections)` 结果并入既有 `warnings`（→ 持久化横幅 + toast），
   与 Slice1 needs_reparse / Slice3 parse_quality 同一 warnings 通道，零新增 ParseReport 字段（由 sections 实时派生、天然持久免迁移）。
3. **`ParseReportPanel.tsx`**：报告顶部新增「必选项解析失败」红幅（destructive，列失败项标题 + 引导「逐项重新解析」）；
   左栏每项标题前加 必选/可选 徽标（required 失败=红、required 正常=primary、optional=secondary，other 不显示）。

## 兼容与边界
- 「失败阻断」口径与既有交卷闸门 GateChecklist「不拦导航只拦导出」一致：以持久化强提示红幅 + toast + 徽标呈现，
  而非硬锁步骤流转（不矛盾、不误伤合理缺项）。
- 不新增 ParseReport JSON 字段：requiredParseFailures 从 report.sections 实时派生，老数据天然向后兼容、零 schema 迁移。

## 四门禁（WIP 基线对照，全绿）
- `npx tsc -b` exit 0。
- `npx eslint`：新 1 文件 parseRequired.test.ts 0 problem；bidTypes.ts + useBidWorkspace.ts + ParseReportPanel.tsx
  .bak-r256 前后均 8 errors · 13 warnings（计数一致 → 零新增在途既有问题）。
- `npx vitest run`：159 files / 1854 passed / 2 skipped（基线 158/1850，+1 文件 parseRequired.test.ts +4 用例均本轮）。
- `npx vite build` exit 0（3.90s）。

## 补丁
`scripts/r256_parse_required.py`（bidTypes 11 + useBidWorkspace 3 + ParseReportPanel 4 锚点，全部 count==1；新建 1 文件；
改前 .bak-r256）；`scripts/r256_fix_test.py`（修正 lots=optional / req_structure=other 分类断言）。未 commit。

## 后续
Slice5（R-026③ 废标条数下限报警 + needs_reparse/parse_quality/required UI 端到端复核 + 建阳区样例回归）待做。
