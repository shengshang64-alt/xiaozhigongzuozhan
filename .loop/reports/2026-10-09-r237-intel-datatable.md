# R237 — 情报中心表格视图（r2-r012 情报侧接线）

日期：2026-10-09 ｜ 轮次：R237 ｜ 优先级：P1 ｜ 选题来源：backlog r2-r012-list-tableize

## 成果摘要
- 情报中心列表新增「卡片 / 表格」视图切换（默认卡片，行为零变化），表格视图复用 R236 交付的
  `DataTable` 基元，兑现「客户 + 情报一起改」裁定中的情报侧。
- 表格 7 列：收藏(★)、标题、类型(政策/竞品/招标/媒体)、地区、来源、状态(待确认/已确认/已忽略)、发布时间；
  标题/类型/地区/来源/状态/发布 六列可排序（三态循环：升→降→取消）。
- 行点击直接打开既有详情面板（openDetail），选中行高亮与右栏详情联动（selectedRowId=detailItem）。
- 初始排序「发布↓」贴合情报时效性场景；默认排序仍由 displayItems（服务端排序）驱动，表格视图不重复排序时保留焦点项优先。

## 关键决策
- **不接内部分页**：displayItems 已走服务端分页（per_page=50 + loadMore + hasMore），DataTable 默认
  pageSize=0（不分页）恰好匹配，保留页面既有「加载更多情报」按钮，避免双重翻页。
- **零 schema / 零 pb_hooks / 零提示词**：纯前端只读呈现 + 会话内 useState，不动数据层。
- **避让在途**：仅改 IntelCenterPage.tsx 单文件；useIntelCenter.ts（1811 行）与 R220–R235 密集在途域一字未动。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/pages/IntelCenter/IntelCenterPage.tsx | +intelView state、intelColumns（useMemo 7 列）、卡片/表格切换控件、表格三元包裹卡片网格；新增 imports（useMemo/Table2/LayoutGrid/Star/DataTable/localDateStamp/ITEM_STATUS_LABEL/IntelItemRow） |

补丁脚本：scripts/r237_intel_table.py（主补丁）、r237_fix_brace.py（表达式位误加花括号修复）、r237_fix_tpl.py（模板字符串收尾 `} → }`} 修复 ×2）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| vitest | npx vitest run | 148 files / 1731 passed / 2 skipped（基线持平，本轮纯 UI 接线无新增单测，逻辑层已由 R236 13 例覆盖） |
| eslint | npx eslint IntelCenterPage.tsx DataTable.tsx dataTableLogic.ts | exit 0，零 error |
| build | npx vite build | exit 0，built in 3.01s（chunk 体积警告为既有基线） |

## 过程问题与修复
1. 卡片网格处于外层三元 `) : (` 的表达式位，包裹表格时误加 `{ }` → 去 braces 改裸三元。
2. 切换按钮 className 模板字符串收尾误写 `` `} ``（缺闭合插值的 `}`）→ 修正为 `` }`} `` 两处，tsc/eslint 归零。

## 挂账
- r2-r012-list-tableize 维持 open：情报侧已接，剩余「竞品 / 标书项目列表 / 资质明细」逐页接线（各页数据形状不同，需继续避让在途域）。
