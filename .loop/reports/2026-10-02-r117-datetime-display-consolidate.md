# R117 全站时刻戳显示口径收敛（datetime display consolidate）

日期：2026-10-02 ｜ 轮次：R117 ｜ 类型：文案一致性 / 单一真源收敛（承接 R112 dateStamp、R114 dateDisplay 主线）

## 背景与取证
R114 已把「ISO 字符串 → 人读日期」收进 src/lib/dateDisplay.ts（YYYY-MM-DD HH:MM），
但巡检发现全站仍有 15 处绕过该单一真源、直接用原生 Intl 口径渲染日期时刻：

- A 类（ISO 时刻戳，10 处）：`new Date(x).toLocaleString("zh-CN")` 渲染「检查时间/审计时
  间/评标时间/留档于/确认时间/导出时间」，输出 `2026/10/2 15:04:05`（斜杠+月日不补零+带
  秒），与 App 其余时间显示 `2026-10-02 15:04` 肉眼可见地割裂（同一 SubmissionCheckPanel
  内甚至新旧两种格式并存）。Intl zh-CN 输出还随宿主环境/浏览器版本漂移（12 小时制风险）。
- B 类（斜杠日期，4 处）：quoteExports「导出日期」、exportTemplate「编制日期」、
  usePptQuote 报价单默认名、SessionListPanel 会话超 30 天回退显示。默认名 `报价单 2026/10/2`
  把 `/` 带进文件名（依赖 R116 sanitize 兜底成下划线，源头就该干净）；会话超 30 天显示
  `2026/1/2` 与同族 DocListPanel（R108 迁移时即用 YYYY-MM-DD）漂移。
- C 类（平行复刻，1 处）：ResultRegisterCard.fmtSyncedAt 是 formatDateTimeDisplay 的
  逐分支克隆（空串→""、不可解析→slice(0,10)），只差 Intl 斜杠格式，删除本地实现改为委托。

## 变更内容
1. src/lib/dateDisplay.ts 新增 `formatDateTime(d: Date)`：Date 对象 → 本地
   `YYYY-MM-DD HH:MM`，Invalid Date → ""；formatDateTimeDisplay 的时分拼接改为委托它
   （pad 逻辑全库仅一份）。头注释追加 R117 说明。
2. A 类 10 处 → `formatDateTimeDisplay(iso)`：DupCheckPanel / GateChecklist /
   MockEvalPanel / StageHistoryPanel / VoidCheckPanel / SubmissionCheckPanel(×3) /
   bidFiles(错字审计报告描述) / useBidWorkspace(阶段留档 toast)。
3. B 类 → 单一真源：quoteExports 导出时间=`formatDateTime(new Date())`、导出
   日期=`localDateStamp()`；exportTemplate 编制日期=`localDateStamp()`；usePptQuote 默认名
   =`报价单 ${localDateStamp()}`（斜杠从源头消失）；SessionListPanel >30 天回退
   =`localDateStamp(d)`（与 DocListPanel 同族对齐）。
4. C 类：ResultRegisterCard 删除 fmtSyncedAt（6 行），调用点直接用 formatDateTimeDisplay。
5. quoteExports「导出时间」丢秒（15:04:05→15:04）为有意口径统一，与 R114 全库分钟级一致。

## 有意保留（不动，登记理由）
- HomePage todayLabel：`10月2日 星期四` 大字报格式，另一展示维度（同 R112 QaGapPanel 裁定）。
- useBidWorkspace:7325 留档 `MMDD` 紧凑文件名后缀：紧凑维度，dateStamp.ts 头注已释。
- ChapterScoreCard:49 `M/D HH:MM` 短格式：卡片内刻意紧凑，收敛会破坏密度设计。
- QualCertsPage L33 UTC 日期戳：维持 backlog r112-datestamp-qualcerts-defer 裁定（用户
  在途改动未提交，继续绕开）。
- 数字类 `toLocaleString` 绕过 money.ts 的站点（BidReviewSummary 中标金额、
  ProductLibraryPanel 单价、竞品图表软著计数等）：属 R113 money 主线，另立 backlog
  `money-bypass-sites-01` 下轮处理（涉及小数位行为差异，需逐点甄别）。

## 在途代码保护
- 改前 git status/diff 核对：SubmissionCheckPanel L470、bidFiles L993 两条锚点位于
  r101/r103 等早前 loop 轮次的未提交 hunk 内（账本 closed 记录佐证），非用户 WIP，且为
  单行精确替换；用户 WIP 热点 QualCertsPage 未触碰。
- 未 git commit；触及 16 文件均先落字节备份 .qoder/tmp/r117_backup/ 可整轮回滚。
- 未动提示词（无 B 类流程需要）、未动数据模型/零 collection/零 pb_hooks。
- 维持裁定：编造未清零只报不拦；lint-debt-01 残余不重构。

## 四门验证
- npx tsc -b：exit 0。
- npx vitest run：720 passed / 2 skipped（基线 718 + 增量 2：dateDisplay.test.ts 新增
  formatDateTime 两例——Date 对象渲染与时分补零、Invalid Date 降级空串）。
  relativeTime.test.ts 的 SessionListPanel 对照同步更新（>30 天分支有意从斜杠格式切换到
  破折号单一真源，其余档位仍逐字对账 pre-R108 oracle）。
- npx eslint（触及 16 文件）：9 errors 全部位于 useBidWorkspace(937/1001/1087/2593/7064)
  与 usePptQuote(218/1343/1418/2128)，均 set-state-in-effect / no-useless-assignment 在途
  基线既有；difflib 备份对比证明本轮两文件仅改 2 行（1 import + 1 内容行），与 error 行
  零交集 → 本轮新增 error 0。
- npx vite build：exit 0（3.07s）。

## 实机验证（dev:8000 热加载 + PB:7000 在跑，测试账号已登录）
- 运行时动态 import 真实 dev 模块（?t= 破缓存）断言 6/6 全过：
  formatDateTime(pad/Invalid)、formatDateTimeDisplay(委托/空串/不可解析 slice0-10)、
  localDateStamp；SessionListPanel / ResultRegisterCard / SubmissionCheckPanel /
  quoteExports 四模块加载 OK（import 改道无运行时断裂）；当前时刻样例输出
  `2026-10-02 04:46`。
- 真实数据 UI 点位：/bid-workspace 贵港项目 → 第5步废标项检查页，innerText 扫描命中
  `审计时间：2026-09-30 20:36`（SubmissionCheckPanel L849 委托点）与
  `检查时间 2026-09-30 20:35`（VoidCheckPanel L406 委托点），全页斜杠日期 0 处
  （R117 前该两处为 `2026/9/30 20:36:xx` 口径）；console 0 error / 0 warn。
- 截图：test_results/r117_ui.png（废标项检查页）、r117_ui2.png（审计时间行入镜）。

## 影响文件（16）
src/lib/dateDisplay.ts、src/lib/dateDisplay.test.ts、src/lib/relativeTime.test.ts、
components/bid-workspace/{DupCheckPanel,GateChecklist,MockEvalPanel,StageHistoryPanel,
VoidCheckPanel,SubmissionCheckPanel,ResultRegisterCard}.tsx、
components/assistant/SessionListPanel.tsx、pages/BidWorkspace/{bidFiles,useBidWorkspace}.ts、
pages/PptQuote/{quoteExports,usePptQuote}.ts、pages/SolutionStudio/exportTemplate.ts
