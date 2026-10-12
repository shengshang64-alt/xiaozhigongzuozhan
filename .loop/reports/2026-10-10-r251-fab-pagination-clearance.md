# R251 报告 · 修复 r250-fab-pagination-overlap（分页页脚被浮窗助手 FAB 遮挡）

日期：2026-10-10　轮次：R251　类别：A 类（纯代码，零 collection / 零提示词 / 零 pb_hooks / 零迁移，未 commit）

## 1. 选题依据
上一轮 R250 把 DataTable 表格化推进到全站六站收口，浏览器实机发现两个体验缺陷并登记为开放 P3
`r250-fab-pagination-overlap`：
- **分页不可用（阻断级交互断链）**：全站浮窗助手按钮 `FloatingAssistant` 固定在视口右下角
  （`fixed bottom-6 right-6 z-50 h-14 w-14`，命中带约 viewport 底部 0–80px）。DataTable 分页页脚的
  「下一页」按钮右对齐，窄视口滚到底时落进 FAB 命中带，真实点击被 FAB 截走——刚上线的标书项目列表/
  资质台账分页实际点不动。这是主链路（标书/资质）的可用性缺陷，优先闭环。
- **空态文案口径错**：`BidProjectList` 已归档空态仍写「在项目卡片上点『归档』」，在表格视图下措辞与界面不符。

## 2. 变更文件
| 文件 | 变更 |
|---|---|
| `src/components/ui/dataTableLogic.ts` | 新增纯函数 `shouldReserveFabClearance(rowCount, pageSize)`（与 `usePaging` 同口径单一真源） |
| `src/components/ui/DataTable.tsx` | `usePaging` 改调纯函数；触发分页时卡片补 `mb-16` 底部避让外边距（全站六站表格统一生效） |
| `src/components/ui/DataTable.test.ts` | 追加 `shouldReserveFabClearance` describe 4 用例 |
| `src/components/bid-workspace/BidProjectList.tsx` | 已归档空态文案按 `displayMode` 自适应（表格→「操作列」/卡片→「卡片」） |

## 3. 设计说明
把「触发分页 ⟺ 需预留 FAB 避让空间」抽成一个具名纯函数，既作 `usePaging` 的单一真源（避免两处口径漂移），
又可在无 RTL 环境下直接单测。避让用 `mb-16`（64px）叠加壳层 `main pb-10`（40px）= 104px > FAB 命中带 80px，
滚到底时把右对齐的「下一页」抬到 FAB 之上；宽屏居中布局本就远离右下角 FAB，额外底部留白无副作用。

## 4. 四门验证
- `npx tsc -b` → exit 0（零错误）
- `npx vitest run` → 154 files passed；**1808 passed | 2 skipped**（R250 基线 1804，本轮 **+4 新增用例**，零失败）
- `npx eslint` 触及 4 文件（dataTableLogic/DataTable/DataTable.test/BidProjectList）→ exit 0，零新增 error
- `npx vite build` → exit 0，built in 3.79s

## 5. 浏览器实机证据（决定性 A/B）
在运行的 dev server（127.0.0.1:8000，HMR 已反映源码改动）资质台账页（34 条 > pageSize 20 → 分页激活）：
- 渲染探针：paginated 卡片含 `mb-16`，`下一页` 按钮位于该卡片内（`pagInsideClearedCard: true`）。
- 几何 A/B：窄视口 479×622 滚到底 —— 分页按钮 rect{top481,bottom509}，FAB rect{top542,bottom598}，
  `rectsOverlap: false`（33px 间隙）。
- 真实点击「下一页」：页码 `第 1 / 2 页` → `第 2 / 2 页`（`advanced: true`），分页恢复可用。

## 6. 维持裁定（未触碰）
- 编造嫌疑未清零禁导出 → 维持「只报告不拦截」。
- lint-debt-01 → 有意保留残余，不重构。
- 未 commit；物理删除/改数据模型/改硬门禁均未涉及。
