# R284 · 全库表格空列占位普查（r283-table-empty-cell-placeholder）

## 选题依据
- 域：标书链路（用户优先级 标书 > 方案 > PPT）。
- 来源：R283 明确遗留 —— 只修了「编制依据表」编号列占位一类，其余表格（参数响应/材料清单/人员配置/培训计划）里
  「行内含列头/类型词、中间列却是【待填写】」的同类形态**从未普查**。backlog 要求「做成全库扫描器，判断哪些可批量消除、哪些本就该人工填」。
- 判定：这是 R283 三层修复之后必然要回答的问题（若不普查，无法证明 R283 的消除范围已完备，也无法安全外扩）。零 AI、零 schema、纯本地。

## 交付
新增两个文件（均在目标项目 scripts/ 下，无 src 改动）：
1. `scripts/bid-table-placeholder-scan.mjs` —— 只读全库普查扫描器（node:sqlite 只读，同 bid-delivery-gate 口径）。
   - 判据对齐：判定前先做与 bidTypes/gate 同源的 `normalizeBasisPlaceholders`，**R283 已修的簇不重复计入**，剩余命中才是「R283 未覆盖」的增量。
   - 三分判据：结构性空列（S1 占位紧跟类型词并以分隔收束 / S3 占位独占列位）= 可消除候选；信息位空缺（占位紧邻年限/数量/日期/编号/元等单位=须人工，**优先级高于结构性**，防止把「【待填写】年质保」误消成「／」）；其余=逐条人工判。
   - 按表格族（依据表/参数响应/人员配置/材料清单/培训计划/实施进度/未归类）汇总。
   - 带入口守卫（`import.meta.url === pathToFileURL(argv[1])`），被测试 import 时不触发扫描。
2. `scripts/bid-table-placeholder-scan.test.ts` —— 17 用例锈死上述判据边界（零 DB、零 AI）。

顺带修掉实跑中暴露的两处缺陷：
- **solutions 列名 bug**：首跑披露 `no such column: name`（真实列为 `solution_name`），方案域 0 覆盖。已改为 `solution_name as name`，修后方案 1 个、章节由 150 → 161 全覆盖。
- **表格族优先级**：`basis` 提到 `param-response` 之前 —— 否则 S1 类型词「推荐性国家标准」含「标准」会先命中参数表族，把依据行错归、普查分桶失真。
- 删去注释里未实现的 S2 判据描述（口径诚实）。

## 结论（普查给出的确定性答案）
真实全库：标书项目 19 个 / 方案 1 个 / 章节 161 个 / 含占位行 158。
经 R283 同源规整后，**结构性空列（S1/S3）命中 = 0**。
> 即：除已在 R283 修复的「编制依据表编号列」外，**全库不存在第二处可安全批量消除的结构性空列簇**。
> 剩余 158 处占位全部是「信息位空缺」或散句占位（人员姓名/证书编号/质保年限/响应时限/元每次/套数…），本质是真缺信息，
> 应由人工/商务填（其归责分流已由 bid-placeholder-owner-split 承接），**绝不能自动消除**。

因此本轮裁定：**不扩 normalizeBasisPlaceholders 的消除范围**（外扩=掩盖真问题，违背 R283 立下的「宁可不改也不掩盖」原则）。
扫描器留存为常备只读工具，后续每次真实生成都可复跑，作为「表格空列占位」这一缺陷类的回归探针。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0（scripts 下新增 .ts 纳入编译，无错）。
- `npx vitest run`：192 文件 2200 passed | 2 skipped，**本轮新增 1 文件 17 用例**（基线之上纯增量，无回归）。
  - 日志中 `globalErrorCatch.test.ts` 的「重复的事件监听」是既有测试内部对 unhandledrejection 的断言采样，非失败（该文件通过）。
- `npx eslint scripts/bid-table-placeholder-scan.mjs scripts/bid-table-placeholder-scan.test.ts`：exit 0，两文件 0 error/0 warning。
- `npx vite build`：exit 0。

## 变更文件
- 新增 `scripts/bid-table-placeholder-scan.mjs`
- 新增 `scripts/bid-table-placeholder-scan.test.ts`
- 账本 `.loop/ledger.json`、轮报本文件

## 维持的裁定（未触碰）
- 编造嫌疑未清零禁止导出硬门禁：维持「只报告不拦截」——未改动。
- lint-debt-01：有意保留残余——未重构。
- 零 collection / 零 schema / 零 AI / 零 src 业务改动；未 git commit。
