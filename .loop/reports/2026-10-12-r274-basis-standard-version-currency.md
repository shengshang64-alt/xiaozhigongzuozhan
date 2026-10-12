# R274 · 编制依据「标准版本时效体检」（易标 R-027 解析项质量补强 · 零 AI）

## 选题依据
账本 round=273，P0 伞项 `bidkit-global-opt-p0` 明确挂有「待续（零 AI 成本优先）：R-027 补 5 解析项」。
其余 open 项按既有裁定/性质不动：`lint-debt-01` 有意保留不重构、`quote-history-3-mining` 独立立项评估、
`r177-followup-generation-parallel-resume` 受控并发属高风险单独立项、`r261-bidcheck-followons` 剩余子项触发数据模型/pb_hooks。
且 `src/pages/BidCheck/` 整个目录为未跟踪在途（R262-R273 活跃开发区），本轮避开，改从标书编制依据侧切入。

巡检标书解析层发现一个确定性质量缺口：`parseBasisLines`（bidTypes）用**整串编号（含年份）**对照 `MEDICAL_STANDARDS` 库
（`normalizeStdCode` 只去空格+大写、不剥年份），**只有编号整串相同**才取库内现行条目。当招标文件/正文引用同一标准的
【旧年份版本】（如 `GB/T 22239-2008`，库内现行为 `GB/T 22239-2019`）时，整串不匹配 → 该条被当作「库外条目」原样并入
`basisMergedItems`，**悄悄注入正文生成的「编制依据」**，用户无从知晓所引标准已被替代。医疗信息化标书引用废止/旧版国标
是常见失分点，属实质性价值项，零 AI、零成本，优先做。

## 方案
新建纯函数模块 `standardCurrency.ts`，以 `MEDICAL_STANDARDS`（37 条，编号均可公开核验、禁止编造）作为「现行版本」事实源，
对规范条目做确定性比对：
- `splitCodeYear(code)`：去空格大写后剥离结尾 `[-|—]?(19xx|20xx)` 四位年份 → `{base, year}`；点分序号结尾（`.51`）不误判为年份；
- `buildCurrentVersionMap(curated)`：编号主干 → 库内现行最高年份条目；
- `detectStaleVersionRefs(items, curated)`：同主干命中库内、且**引用年份 < 现行年份** → 判「疑似旧版」，给建议现行编号；同主干+年份去重；
- `staleRefHint(r)`：用户可见提示语（不暴露内部字段名）。

误伤防线（与全程「只报不拦」红线一致，宁可漏报不误伤）：库外编号不报、无年份不报、引用年份 ≥ 现行年份不报（库本身可能滞后，反向判定会误伤）。

## 接入
在**未修改（clean）**组件 `StandardsPickerDialog.tsx` 接入只读消费：`useMemo` 计算 `staleRefs = detectStaleVersionRefs(p.basisParsedItems)`，
仅当 `staleRefs.length > 0` 时渲染「版本提示」区块（用既有语义 `warning` token：`border-warning/40 bg-warning/10 text-warning`，主题/dark 自适应），
逐条列出「引用 XX 版 · 规范库现行 YY · 请核实」。命中前不改变对话框任何既有呈现（零涟漪）。此处正是编制依据注入正文前的编辑闸口，
提示出现在「生成正文」之前，可让售前据以核对/补选现行版本。

## 变更文件（3 个，均在标书侧；未碰任何在途 M/未跟踪文件）
- `src/pages/BidWorkspace/standardCurrency.ts`（新增，纯函数）
- `src/pages/BidWorkspace/standardCurrency.test.ts`（新增，8 单测）
- `src/components/bid-workspace/StandardsPickerDialog.tsx`（3 处增量：import / memo / 提示区块；该文件 git 状态 CLEAN，无在途 hunk）

## Git 在途核对（前置）
`git status --porcelain` 全仓 53 个 M + 89 个未跟踪（BidCheck 整目录未跟踪=活跃开发）。逐一核对：
`StandardsPickerDialog.tsx`、`SubmissionCheckPanel.tsx` 均**不在 M/未跟踪列表**（CLEAN），
`bidTypes.ts`/`useBidWorkspace.ts` 虽为 M（在途）但本轮**只读 import `MEDICAL_STANDARDS`/`StandardItem`、绝不改写**；
新增文件不与任何未跟踪文件重名。所有 `str.replace` 前置 `assert count==1`（import/memo/jsx 三锚点各命中 1 次），零误伤。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0。
- `npx vitest run`：**176 files / 1976 passed | 2 skipped**（R273 基线 175/1968+2 零回归；本轮 +1 file、+8 tests）。
  新增用例覆盖：旧版命中给现行编号 / 同版本不误报 / 无年份不报 / 库外不报 / 晚于现行不报（防反向误伤）/
  点分序号不误判年份 / 同主干+年份去重 / 多条旧版各自命中 / 注入自定义 curated 不依赖全局 / buildCurrentVersionMap 取最高年份 / 提示语无内部字段名。
- `npx eslint`（触及 3 文件）：exit 0，零 error/warn。
- `npx vite build`：成功，built in 4.40s。

## 数据模型 / 提示词
零 PocketBase collection schema、零 pb_hooks、零提示词改动（未触 B 类流程）。全程「只报不拦」，不新增任何导出拦截。

## 维持裁定不动
- 编造嫌疑未清零禁止导出：维持只报不拦；本提示为纯信息提示，不拦截生成/导出。
- `lint-debt-01` 有意保留残余不重构。

## 挂账
- `bidkit-global-opt-p0` R-027「补 5 解析项」：本轮交付的是「编制依据质量补强」这一确定性切片（标准版本时效体检），
  非新增 5 个 AI 解析任务项；新增解析任务项涉 AI 成本与 B 类提示词流程，风险更高，按伞项「零 AI 成本优先」次序另轮评估。
- `standardCurrency.detectStaleVersionRefs` 已具通用签名（可传 items + curated），后续可复用到「标书正文级」旧版扫描
  （接交卷体检 / BidCheck L1），届时避开 BidCheck 在途目录择 clean 面板接入。
- 规范库为静态 37 条：库外标准（如地方标准 DB、团体标准 T/）无现行年份基线，当前不报（防误伤）；如需扩覆盖可另行补库。
