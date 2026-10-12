# R238 — 竞品厂商档案表格视图（r2-r012 竞品侧接线）

日期：2026-10-09 ｜ 轮次：R238 ｜ 优先级：P1 ｜ 选题来源：backlog r2-r012-list-tableize

## 成果摘要
- 竞品分析页「厂商档案」tab 左列新增 卡片 / 表格 视图切换（默认卡片，行为零变化），
  DataTable 基元第三处落地（R236 客户 → R237 情报 → R238 竞品），全站表格化裁定持续推进。
- 表格 4 列（针对 360px 窄列以 twMerge 压缩单元格 padding）：
  名次（RankBadge/扩/新 徽标，与卡片同语义）、厂商（截断名 + 我方 Badge）、
  中标（五年中标额 fmtYi，可排序）、软著（条数 formatCount，可排序）。
- 行点击 = 选厂商，右栏详情面板即时联动（selectedRowId=activeName 高亮选中行）。
- 默认不排序时保留页面既有顺序（按订单/按更新/按名称仍由顶部 Select 驱动），表头排序为叠加能力。

## 关键决策
- **窄列适配**：列 className/headerClassName 传 px-1.5~px-2 覆盖默认 px-4（cn=twMerge 保证覆盖生效）；
  固定列宽 名次44/中标72/软著60，厂商列弹性 + truncate。
- **不接内部分页**：约 20 家厂商一屏可扫，pageSize 默认 0。
- **零新数据层**：仅 CompetitorsPage.tsx 单文件；useCompetitors.ts / competitorsCore.ts /
  marketIntel.ts 一字未动；补一个模块级 ArchiveItem 接口固化既有推断形状（行为等价）。
- **避让在途**：QualCertsPage（资质明细，M 在途）与 BidWorkspacePage（标书项目列表，M 在途）本轮不碰，
  r2-r012 剩余两侧待其清出后接。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/pages/Competitors/CompetitorsPage.tsx | +Table2/DataTable 导入、ArchiveItem 接口、archiveView state、archiveColumns（4 列）、计数行切换控件、列表区表格三元分支 |

补丁脚本：scripts/r238_competitor_table.py（7 处锚点断言一次通过，无修复脚本）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| eslint | npx eslint CompetitorsPage.tsx | exit 0，零 error |
| vitest | npx vitest run | 148 files / 1731 passed / 2 skipped（基线持平，逻辑层由 R236 13 例覆盖） |
| build | npx vite build | exit 0（chunk 体积警告为既有基线） |

## 挂账
- r2-r012-list-tableize 维持 open：剩余「标书项目列表 / 资质明细」两侧因在途未提交改动避让，待清出后接线。
