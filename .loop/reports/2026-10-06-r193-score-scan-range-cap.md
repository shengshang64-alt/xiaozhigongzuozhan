# R193 · 评分项本地扫描：区间/上限权重归一（漏报与误报修复）

## 选题依据
两个点名候选（quote-history-01 二期、prompt-fabscan-03 按章聚合回注）经核账本均已 closed（R176/R102 报价每床折算、R103 回注），不重复实现。
按用户优先级（标书 > 方案 > PPT，弱化报价）转入标书链路巡检。对零 AI 费用的「评分项本地交叉核对」`scanScoreItems` 做真实评分表形态探针（临时 vitest harness，11 条形态逐条 dump，验证后删除），暴露三类确定性漏报/误报：

| 真实评分行形态 | 修复前 | 期望 |
|---|---|---|
| `技术方案比选 10-20分`（区间式） | 整行漏报 items=[] | 取上界 20，入项 |
| `技术参数逐条响应（每项2分，最高20分）`（逐条带上限） | 项名截残「技术参数逐条响应（每项」+ 误取 2 分 | 取上限 20，项名干净 |
| `同类项目业绩：每个5分，满分15分`（逐条带满分上限） | 误判为总分 total=5（正确上限应为 15） | 作为评分行取 15，total 保持 null |

## 变更（纯函数、零 AI、零 collection、零提示词、零 pb_hooks）
`src/pages/BidWorkspace/scoreItemsScan.ts`：
- 新增按「有效权重」归一的 `pickScoreHit(line)`，取代原 `pickScore` + `SCORE_MARKER`/`cleanName` 两段割裂逻辑（原实现分值与名字分别用不同正则取，区间/上限完全无分支）。优先级：明确上限（最高/最多/至多/上限/不超过）> 逐条+满分上限 > 净括号（N分）> 冒号（：N分）> 区间取上界（a-b分→b）> 贴身汉字（排除得/加/减/扣/每/值/足假阳性）> 空格裸分。单位一律仅认「分」，`分(?!数|钟)` 延续 R47/F7「分钟≠分值」护栏。
- `nameFromHead(head)`：项名先按首个分隔标点（（(：:，,、；;）截断，再去序号前缀/空白，杜绝「（每项」这类括号碎片残留。
- 总分分支加 `!hasPerUnit(line)` 门槛：含逐条计量（每…N分）的「…每个5分，满分15分」不再被误置 total，交回评分项抽取按上限取分。
- 行为保持：单值形态（净括号/冒号/贴身/空格）、真总分（总分：100分/满分100分/合计…）、206 建设范围行虚报护栏（无「分」单位则 total=null）、类目表头行归类，全部与修复前逐字一致。

`src/pages/BidWorkspace/scoreItemsScan.test.ts`：+7 用例（区间取上界、逐条带上限取上限且名不截残、每…满分归为评分行且 total 保持 null、上限式直接入项、净括号不被区间夺优先级、回归护栏「30-40分钟」不误报、真总分正常采信）。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：**113 files / 1349 passed | 2 skipped**，基线 1342 → +7 全为本轮新增，零回退。（forks 池一次 worker 启动崩溃属 Windows 并发资源抖动、非断言失败；同套用例 `--pool=threads` 全绿 exit 0。）
- `npx eslint src/pages/BidWorkspace/scoreItemsScan.ts src/pages/BidWorkspace/scoreItemsScan.test.ts`：exit 0，零 problem。
- `npx vite build`：exit 0，5964 modules，built in 3.76s。

## 边界与维持裁定
- 未触碰「编造嫌疑未清零禁导出」硬门禁（维持只报不拦）。
- 未动 lint-debt-01 有意保留残余。
- 类目标题行（技术评分/价格分等）作为分节头被 skip 的既有语义未改（避免过度扩大改动面）；本轮仅修复「真实评分行」被误当表头丢弃之外的区间/上限漏报。
- 零数据模型变更、零 PocketBase collection/pb_hooks 改动、零提示词改动（B 类流程不适用）。
- 未 git commit。

## 落地文件
- `src/pages/BidWorkspace/scoreItemsScan.ts`
- `src/pages/BidWorkspace/scoreItemsScan.test.ts`
- 补丁脚本（MedPreSales 侧）：`scripts/r193_score_scan.py`、`scripts/r193_score_tests.py`
- 备份：`.loop/backup_r193/`
