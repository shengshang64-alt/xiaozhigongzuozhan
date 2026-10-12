# R243 — 方案工作室列表表格化（slice5 O-004 方案侧 + O-005 核验关闭）

日期：2026-10-09 ｜ 轮次：R243 ｜ 优先级：P1 ｜ 选题来源：bidkit-plan-slice5 O-004 + r2-r012-list-tableize（用户偏好：方案域优先）

## 成果摘要
1. **方案列表表格视图（O-004 方案工作室侧）**：SolutionListPanel 在类型 chips 行下新增「计数 + 卡片/表格」切换行，
   表格分支接全站 DataTable（复用第五站：客户→情报→竞品→(dropdown 非表)→方案）：
   - 6 列：方案名称（截断+排序）/ 类型（Badge，96px）/ 医院（截断）/ 状态（语义色 pill，96px）/
     正文 x/y 章（右对齐数值排序，64px）/ 更新时间（128px，默认倒序）
   - 行点击 = 打开编辑（与卡片「打开编辑」同动作）；底稿复用/入素材库/删除保留在卡片视图
   - 默认卡片视图不变，零打扰；窄列 px-2 padding 覆盖（twMerge），pageSize=0 客户端全量不分页
2. **O-005 知识库空态引导：核验即关闭**。勘察 DocListPanel.tsx 发现空态已有完整引导
   （图标 + 搜索态/团队库/个人笔记三分支文案 + 「上传第一批文档」按钮），代码属 R89-R148 累积 commit 已入库；
   slice5 实测快照早于该改造，判为已解决（沿用账本 ui-redesign-phase3 「核验即关」惯例）。
3. **slice5 六项观察至此全部关闭**：O-001/O-002(R242) O-003(R236) O-004 方案侧(R243)+标书侧(r2-r012 避让挂账)
   O-005(核验) O-006(R210)。

## 关键决策
- 避让边界：SolutionListPanel/useSolutionStudio/SolutionStudioPage 均 git-clean；在途的 ChapterEditor/solutionTypes
  本轮零触碰（列定义所需 typeLabel/DOC_STATUS_LABEL/statusTone 全走既有导出，无需改类型文件）。
- vitest 基线漂移甄别：本轮跑出 149 files/1741 passed（+1 文件/+10 用例），来自用户 BidWorkspace 在途新增
  complaintLetter.test.ts（未跟踪文件，16:37 落盘），非本轮产物；全绿，tsc/eslint/build 均 exit 0。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/components/solution-studio/SolutionListPanel.tsx | +listView state、+solutionColumns(6 列)、+计数/切换行、+表格三元分支 |

补丁脚本：scripts/r243_solution_datatable.py（5 处锚点断言一次通过，模板收尾零修复）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| eslint | npx eslint（SolutionListPanel.tsx） | exit 0，零 error |
| vitest | npx vitest run | 149 files / 1741 passed / 2 skipped（+1/+10 系用户在途 complaintLetter.test.ts，非本轮） |
| build | npx vite build | exit 0，built in 3.34s |

## 挂账
- r2-r012 全站表格化：客户✓情报✓竞品✓方案✓，仅剩标书工作台项目列表 + 资质明细——BidWorkspacePage/QualCertsPage
  仍为用户未提交在途（M），持续每轮复查清出即接。
- slice5 关闭；O-004 标书侧并入 r2-r012 同因挂账。
