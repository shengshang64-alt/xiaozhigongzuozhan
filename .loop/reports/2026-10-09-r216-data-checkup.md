# R216 报告 · 客户数据体检面板（「系统再优化」轮）

**轮次**：R216｜**模块**：/customer-management

## 背景与体检
用户要求「系统再优化」。基于 r214/r215 两轮亲手测试的发现做系统体检，候选与结论：
- ~~region「华东」脏值修复~~ → **撤销**：读 `customerNormalize.ts` 确认「华东」在 `CANONICAL_REGIONS` 七大分区白名单内，属设计口径，显示层已归一，改库反而破坏设计；
- ~~情报源失败一键停用~~ → **撤销**：`SourceManagerPanel` 已有 T3「一键重试全部失败源」+ 行级停用/启用，O-011 已覆盖；
- **客户数据体检面板** → **落地**：r215 批量补全遗留 147 个「AI 补的官网待核实」+ 569 个待核实字段，散在各档案无集中核对入口（上轮报告的用户可选建议之一）。

## 实现
新增 `src/components/customer-management/CustomerDataCheckupDialog.tsx`：
- 纯前端本地计算（160 家已全量在内存，零请求零写库）；
- 统计卡：官网待核实 147 / 已核实 1 / 无官网 12 / 待核实字段总数 569；
- **官网待核实清单**：医院/地区/域名三列表 + 行内「打开官网」外链 + 「核对」按钮（关面板并定位到该客户档案，走既有 `selectCustomer`）；
- **待核实字段分布**：缺失排行条形图（address 缺 115、院长缺 138、信息化负责人缺 160…），并明示「IT 负责人/ICU 床位/联系人官网从不公开，需线下录入」的口径；
- 「导出核对清单」CSV（复用 exportToCsv）。
入口：客户列表工具栏新增「数据体检」按钮（CustomerListPanel + CustomerManagementPage 接线）。

## 四门验证
| 门禁 | 结果 |
|---|---|
| `tsc -b` | EXIT=0 |
| `eslint`（触及 3 文件） | EXIT=0 |
| `vitest` | 134 files / 1599 passed |
| `vite build` | 4.49s ✅ |

## 实机验证（1600×1000 截图）
- 「数据体检」按钮 → 面板打开，统计卡数字与审计一致（147/1/12/569）；
- 官网待核实列表逐行展示（大量政府门户脏数据如实暴露，正是需要用户核对的）；
- 「待核实字段分布」Tab 渲染缺失排行；
- 「核对」点击 → 面板关闭并定位打开该医院档案详情 ✅（首行点击被 sticky 表头遮挡属滚动位置问题，滚动后正常）。

## 影响文件
- 新增：`src/components/customer-management/CustomerDataCheckupDialog.tsx`
- 修改：`src/components/customer-management/CustomerListPanel.tsx`（按钮+prop）、`src/pages/CustomerManagement/CustomerManagementPage.tsx`（state+Dialog+接线）
