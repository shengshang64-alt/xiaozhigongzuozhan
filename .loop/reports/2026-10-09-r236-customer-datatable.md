# R236 — r2-r011-customer-table：可复用 DataTable 基元 + 客户管理「表格」视图

## 选题依据
账本 open 项 `r2-r011-customer-table`（P1，/customers）：177 张客户卡片信息密度低，无法像表格那样
一眼横向比对医院等级/床位/区域/最近跟进，也缺排序与分页。其同族 `r2-r012-list-tableize`（P1，情报/竞品/
标书列表/资质明细）依赖同一能力。既有裁定「客户+情报一起改、避免各页各造割裂表格」——本轮据此不做一次性
硬编码表格，而是先落地**单一可复用 DataTable 基元**（排序/分页/纯逻辑可单测），在客户管理页接线验证，
为 r2-r012 的其余页面提供统一组件与列约定。属实质性交互/信息密度优化，非零风险小改。

## 避让在途
本轮触及区为客户管理与 UI 基元，全部 git-clean。刻意避开被 R220–R235 连续在途改动的 bid-workspace /
solution-studio 等域。slice3（P0 底稿增量）引擎内核已在 R235 落地，其 UI/schema 接线仍被在途堵死，本轮不碰。

## 变更（5 文件，零 collection / 零 pb_hooks / 零提示词 / 零 schema）
- 新建 `src/components/ui/dataTableLogic.ts`：纯函数 `sortRows`（单列排序；数值按大小、其余按中文 locale；
  空值恒排最后与升降无关；相等键以原索引兜底保持稳定；不改入参）+ `paginate`（页码收敛 [1,pageCount]；
  pageSize<=0 返全部；不改入参）+ 列/属性类型。逻辑与组件分文件以满足 react-refresh 约束。
- 新建 `src/components/ui/DataTable.tsx`：泛型可访问化表格组件（表头 aria-sort、按钮式排序三态循环
  升→降→取消、行 onClick、选中行高亮、分页页脚、空态、sr-only caption）；仅导出组件（类型经
  `export type` 转发，不触发 react-refresh）。
- 新建 `src/components/ui/DataTable.test.ts`：sortRows/paginate 13 例纯逻辑单测（升/降/稳定/空值恒后/
  越界页码收敛/pageSize<=0/空数组/不改入参）。字符串比较用确定性 ASCII 断言，不锁中文拼音顺序（依赖 ICU）。
- 改 `useCustomerManagement.ts`：`view` 联合类型 `"list" | "board"` → `+ "table"`（单点，会话内 state，不持久化）。
- 改 `CustomerManagementPage.tsx`：抽出右侧详情面板为 `detailPanel` 常量（列表/表格两视图复用，消除重复实现）；
  分段控件新增「客户表格」按钮；新增三分支渲染 list / board / table；表格列全部取既有字段
  （医院名称/类型/等级/区域/床位数/最近跟进/更新于），等级复用 `normalizeHospitalLevel`、日期复用 `localDateStamp`，
  点行 `selectCustomer(id)` 直接复用既有详情流。

## 列设计说明
r2-r011 备注「列设计待用户确认」。本轮列口径锚定项目既有 CSV 导出口径
（hospital_name/hospital_type/region/level/last_follow_at/updated），并增补床位数（医疗售前核心比对维度）
提升密度——沿用产品既决定，非新造，符合「按判断自主推进」授权。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0
- `npx vitest run`：1731 passed / 2 skipped（基线 1718 + 新增 DataTable 13，增量 +13）
- `npx eslint`（DataTable.tsx / dataTableLogic.ts / DataTable.test.ts / CustomerManagementPage.tsx）：exit 0
  注：useCustomerManagement.ts 报 10 处 error 全在 229/309/450/553/676/717/1443/1630/1740 行，属既有
  react-hooks/set-state-in-effect 与 React-Compiler 规则残余（`lint-debt-01` 有意保留不重构）；本轮仅改 434 行
  字面量类型，不可能引出别处此类错误，判定非新增。
- `npx vite build`：exit 0（chunk>500kB 为既有告警，非 error）

## 最终结果与挂账
- 关闭 `r2-r011-customer-table`：客户管理已提供 卡片/看板/表格 三视图，表格含排序+分页+搜索复用+行点击详情。
- `r2-r012-list-tableize` 记 progress：可复用 DataTable 已在 /customers 跑通并附单测；情报中心/竞品/标书列表/
  资质明细的接线留作后续切片（各页数据形状不同，逐页接线并避让在途）。
- 未 commit；R220–R235 全部在途文件一律未动。
