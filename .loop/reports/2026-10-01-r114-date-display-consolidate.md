# R114 全站 ISO 日期显示格式化单一来源收敛

## 背景与选题
接续 R105-R113「重复实现收敛到单一真源」主线（下载/CSV/复制/相对时间/PB JSON/日期戳/金额）。
本轮优先项 quote-history-01（R102 closed）、prompt-fabscan-03 残余（R101/R103 closed）均已收口；
维持裁定不推翻（编造未清零只报不拦、lint-debt-01 不重构）；QualCerts 在途、useIntelCenter 在途
react-hooks 存量继续绕开。择优转为巡检新角度。

## 坐实的真实缺口与漂移
「把存储的 ISO 时间戳渲染成给人看的日期」被四份平行实现重复，分布在三个模块：

| 实现 | 位置 | 输出 | 空值 | 不可解析分支 |
|---|---|---|---|---|
| fmtDateTime | customerTypes.ts:479 | YYYY-MM-DD HH:MM | "" | iso.slice(0,10) |
| fmtDate | customerTypes.ts:487 | YYYY-MM-DD | "" | iso.slice(0,10) |
| fmtIntelTime | useIntelCenter.ts:167 | YYYY-MM-DD HH:MM | "" | iso.slice(0,10)（与 fmtDateTime **逐字节相同**）|
| formatTime | QaGapPanel.tsx:16 | YYYY-MM-DD HH:MM | "" | **""（唯一漂移：吞掉原值）** |

R112 的 dateStamp.ts 只覆盖了「Date 对象入参 → localDateStamp」，ISO 字符串入口这套从未统一，
且已在失效分支上漂移（QaGapPanel 与其余 3:1 多数不一致）。

## 变更
- 新增唯一入口 `src/lib/dateDisplay.ts`：`formatDateDisplay` / `formatDateTimeDisplay`；
  纯日期渲染委托 R112 的 `localDateStamp(d)`，日历逻辑保持全仓一处；datetime 追加本地 HH:MM。
  空→""、不可解析→iso.slice(0,10)。
- `customerTypes.fmtDate` / `fmtDateTime` 改薄委托（保留导出名，customerTypes 内部 L421 自调用不受影响）。
- `useIntelCenter.fmtIntelTime` 改薄委托（保留导出名）。
- `QaGapPanel.formatTime` 改薄委托。
- 9 个消费组件（CustomerDetailPanel / OpportunityDetailPanel / CustomerOverviewSection /
  FollowTimeline / IntelDetailPanel / IntelItemCard / SourceManagerPanel 等）**零改动**。

## 行为变化点（如实记录）
- QaGapPanel 失效分支 `"" → iso.slice(0,10)`：向 3:1 多数口径统一。待补答队列时间戳为系统生成的
  PocketBase created（实际恒可解析），此分支仅对畸形脏数据生效，改为显示原始日期片段而非留空，
  信息更少→更多的良性收敛，无正常路径用户可见差异。
- 其余三处行为逐字等价（有效/空/无效三分支均与原实现一致）。

## 四道门禁
- tsc -b：exit 0
- vitest：705 passed / 2 skipped（基线 699 → +6，dateDisplay.test.ts 新增；无快照受影响）
- eslint：本轮新建/改动的非在途文件（dateDisplay.ts、dateDisplay.test.ts、customerTypes.ts、
  QaGapPanel.tsx）exit 0 零问题；useIntelCenter.ts 命中 25 error 全为该在途文件既有
  react-hooks/set-state-in-effect + preserve-manual-memoization 基线（账本 R88/R110 已登记），
  git diff -U0 实证本轮 hunk 仅 import + fmtIntelTime 函数体两行，不含任何 hook，净新增 0。
- vite build：exit 0（3.05s）

## 边界
零 collection / 零 pb_hooks / 零数据模型 / 非提示词（无 B 类流程、PROMPT_VERSION 不变）；
维持 R89 编造未清零只报不拦、lint-debt-01 有意残余不重构；禁止 git commit。
