# R250 — 标书项目列表 + 资质明细表格化收口（DataTable 全站六站落成，P1 r2-r012 闭环）

- round: 249 → 250
- 优先级: P1
- 类别: **A 类纯代码**（零 collection / 零 pb_hooks / 零提示词 / 零迁移）
- 选题依据: 用户点名 quote-history-01（R102/R131 closed）、prompt-fabscan-03（R101/R103 closed）均已收口；
  按流程转巡检，择优 backlog 唯一 P1 实质项 `r2-r012-list-tableize` 的最后两站。

## 1. 变更概览

| 文件 | 变更 | 关键 |
|---|---|---|
| `src/components/bid-workspace/BidProjectList.tsx` | 卡片/表格双视图 + TrashRemainChip 抽单一来源 | 默认 card，既有行为零变化 |
| `src/pages/QualCerts/qualsCore.ts` | 新增 `filterQualRows` 多词 AND 跨字段检索（纯函数） | 全角/半角空格分词 |
| `src/pages/QualCerts/QualCertsPage.tsx` | 手搓 table→DataTable + keyword 搜索 + qualDueBadge 单一来源 | 在途 R228 预警 hunk(115-156) 绕开 |
| `src/components/bid-workspace/bidProjectListTable.test.ts` | 新增 6 例源码扫描哨兵 | 钉接线防回流 |
| `src/pages/QualCerts/qualCertsTable.test.ts` | 新增 12 例（filterQualRows 单测 + 哨兵） | |

## 2. 设计要点

### 标书项目列表（BidProjectList）
- `displayMode: "card" | "table"`（useState，**默认 card**，不改既有交互）。
- 表格列 7：project_name / hospital / tender_no / stage / bid_open_date / chapters / actions；`pageSize=20`；行点击 `openProject`。
- 回收站视图去掉 chapters 列（回收站项目无章节语义）。
- **TrashRemainChip**：把「N 天后自动清除」倒计时抽成组件，卡片/表格共用，消除卡片内联重复计算 —— 单一真源收敛（延续 R105-R158 主线）。

### 资质明细（QualCerts）
- `filterQualRows(rows, keyword)`：按 `[\s\u3000]+` 分词，多词 AND，跨 cert_name/category/cert_no/issuer/scope/notes 匹配；空关键词返回全部（新数组，不改入参）。
- DataTable 6 列，5 个 `sortAccessor`（actions 列不参与排序）；`initialSort={{key:"valid_to",dir:"asc"}}`（**行为变化点**：最急证照默认置顶）。
- `qualDueBadge(row, todayMs)` 抽到期分档单一来源；搜索命中数外显；`QualRow`→`QualRowActions`（含 ConfirmDialog）。

## 3. 四门验证（目标项目目录，当前状态复测）

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b` | exit 0，零错误 |
| 单测 | `npx vitest run` | **154 files / 1804 passed + 2 skipped**（基线 152 files·1786+2，增量 +2 文件 +18 用例） |
| Lint | `npx eslint` 触及 5 文件 | exit 0，零 error（在途代码既有 error 不计） |
| 构建 | `npx vite build` | exit 0，built in 4.02s |

## 4. 浏览器实机验证（三甲医院场景登录态）

- **A 资质台账**：表头排序图标 ✓、搜索 `ISO`→命中过滤 ✓、三态排序（升→降→取消）✓、34>20 触发分页 ✓。
- **B 标书项目列表**：默认卡片 ✓、卡片/表格切换 ✓、7 列齐 ✓、排序 ✓、回收站去 chapters 列 ✓、倒计时「20 天后自动清除」✓、行点击进入详情 ✓。
- **C 控制台**：0 error / 0 warning。

## 5. 在途保护
- `BidProjectList.tsx` 落地前 git CLEAN，无在途代码。
- `QualCertsPage.tsx` 存在用户未提交 hunk（115-156 行，R228 预警口径校验徽标），本轮改动全部落在 imports + 台账列表块（158+），与在途区**零交集**，未触碰。

## 6. 遗留挂账（新 P3）
- `r250-fab-pagination-overlap`：窄视口下「小智快捷问答」FAB 与 DataTable 分页「下一页」按钮位置重叠，真实点击命中 FAB；表格视图空态文案仍写「在项目卡片上点『归档』」（措辞与视图不符）。P3 体验缺陷，非阻断，本轮未修。

## 7. 维持裁定（未触碰）
- 编造嫌疑未清零禁导出 → 维持「只报告不拦截」。
- lint-debt-01 → 有意保留残余，不重构。
