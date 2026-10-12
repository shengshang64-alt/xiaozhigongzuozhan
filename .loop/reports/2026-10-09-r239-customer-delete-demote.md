# R239 — 客户详情「删除」按钮降位（docs13-3.4 关闭）

日期：2026-10-09 ｜ 轮次：R239 ｜ 优先级：P3 ｜ 选题来源：backlog docs13-3.4-customer-delete-demote

## 成果摘要
- 客户档案卡头部的红字常驻「删除」按钮收进「更多操作」⋮ 下拉（docs/13 §3.4 推荐方案一），
  与「智能补全缺失项」「编辑档案」两个常用操作物理隔离，消除误触面。
- ConfirmDialog 二次确认流原样保留（含商机归属提示文案）；删除中 loading 态迁移到菜单项（spinner + 「删除中…」）。
- 新建全站可复用 ui 基元 dropdown-menu.tsx：@radix-ui/react-dropdown-menu 薄封装（shadcn 标准，
  仅 Root/Trigger/Content/Item 四件套），样式 token 对齐 hover-card/select（bg-popover、animate-in/out 系）。

## 复用性检索结论（三选一：复用）
- 依赖清单已有 @radix-ui/react-dropdown-menu ^2.1.16 且 node_modules 实装（Test-Path True），此前仅无封装层；
- 项目内无既有 dropdown 封装、无 MoreVertical/MoreHorizontal 用例（grep 0 命中）→ 不重复自研；
- 无 jsdom/@testing-library（package.json 0 命中）→ 与全站惯例一致，组件层不做单测，逻辑零新增（仅 UI 容器）。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/components/ui/dropdown-menu.tsx | 新建（~50 行薄封装） |
| src/components/customer-management/CustomerProfileCard.tsx | +MoreHorizontal/下拉导入；头部删除按钮 → ⋮ 下拉「删除客户」destructive 项 |

补丁脚本：scripts/r239_dropdown_demote.py（3 处锚点断言 + 新文件防覆盖 assert，一次通过零修复）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| eslint | npx eslint dropdown-menu.tsx CustomerProfileCard.tsx | exit 0，零 error（含 react-refresh：大写别名导出过关） |
| vitest | npx vitest run | 148 files / 1731 passed / 2 skipped（基线持平） |
| build | npx vite build | exit 0，built in 3.23s |

实机点击验证：本机 8000/5173/3000 均无服务在跑，未做浏览器留证（纯声明式 UI 包装，状态与确认流未变）。

## 挂账
- docs13-3.4 关闭；后续若有第二处「更多操作」用例，可评估把 ⋮ 触发器样式收敛为 DropdownMenuTrigger 默认 class。
