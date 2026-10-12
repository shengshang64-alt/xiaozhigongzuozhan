# R269 · 标书检查 L1 字号/行距达标接入（闭合 bodySize/lineSpacing 零消费断链）

## 选题依据（巡检新发现）
延续「配置项/文案已声明但引擎从不消费」这一空头承诺类断链巡检（R266/R267/R268 已闭 L2/L3/L4），
本轮扫 `AnbidCheckConfig.formatStandard` 八个旋钮的消费面，坐实又一处断链：
- `bodySize`（要求字号）、`lineSpacing`（要求行距）两旋钮**已在类型声明、已在 normalizeCheckConfig 解析、
  已在检查配置对话框 BidCheckConfigDialog.tsx 暴露为「要求字号」「要求行距」输入框、已持久化 localStorage，
  但在 rules/ 全域零消费**——用户填了、存了，检查却完全无视，纯空头承诺。
- 对照同组旋钮 bodyFont（L1-11 消费）、margins（L1-10 消费）、maxPages（L1-12 消费）均已接线，唯 bodySize/lineSpacing 落单。

## 复用优先 + 单一真源
- 字号判定复用既有权威表 `DOCX_SIZE_HALFPT`（中文字号→docx 半点值，docx `w:sz` 单位即半点，
  与检查引擎 `meta.sizesUsed` 存的原始 `w:sz` 值同源，比对无需换算歧义）。该表原为 bidFiles.ts 模块私有常量；
  为避免规则层反向依赖 docx 重库、又杜绝两处口径漂移，本轮将其抽到无第三方依赖的
  `bidFormatConstants.ts`，bidFiles.ts 与 format.ts 同 import 一份（单一真源）。bidFiles.ts 该区域经 git diff 核实无在途改动，抽取零冲突。
- 行距判定需 `w:line` 与 `w:lineRule` 配对才能区分「N倍(auto)」与「固定X磅(exact/atLeast)」，
  而原 `meta.lineSpacings` 只留 w:line 丢了 lineRule。新增 `meta.lineSpacingsDetail`（{line,rule} 配对，去重），
  docxInspect 按 ECMA-376「缺 lineRule 默认 auto」提取，纯增量、不动原 variety 判定。

## 变更文件
- 新增 `src/pages/BidWorkspace/bidFormatConstants.ts`：导出 `DOCX_SIZE_HALFPT`（抽自 bidFiles.ts）。
- 改 `src/pages/BidWorkspace/bidFiles.ts`：删本地常量定义，改为 `import { DOCX_SIZE_HALFPT } from "./bidFormatConstants"`（两处引用 593/610 行为不变）。
- 改 `src/pages/BidCheck/bidCheckTypes.ts`：DocMeta 增 `lineSpacingsDetail: { line; rule }[]`。
- 改 `src/pages/BidCheck/engine/docxInspect.ts`：emptyMeta 补该字段；buildDocContextFromParts 提取 (w:line,w:lineRule) 去重配对。
- 改 `src/pages/BidCheck/rules/format.ts`：
  - 新增解析器 `resolveSizeHalfPt` / `resolveLineSpacingReq`（识别不了返回 null → 不瞎判）。
  - 新增 `L1-13 字号达标`（依赖 bodySize）/ `L1-14 行距达标`（依赖 lineSpacing），与 L1-11 bodyFont 同构。
  - **只报不拦**：命中一律 `status=warn`（非 fail）——因标题字号天然大于正文、各级行距天然可不同，
    用 fail 会误伤；severity 普通 medium / 暗标 high。未配置→`unconfigured`，要求无法识别→`unconfigured`，无 docx 包→`skipped`。
  - else（无包）分支补 L1-13/L1-14 skipped。
- 改 `src/pages/BidCheck/rules/format.test.ts`：+8 用例（bodySize 未配置/统一 pass/存非要求值 warn/无法识别 unconfigured；
  lineSpacing 1.5倍 pass/仅单倍 warn/固定28磅 exact pass；无包双 skipped）。

## 四门验证（目标项目目录）
- `npx tsc -b`：exit 0。
- `npx vitest run`：173 files 全过，**1947 passed + 2 skipped**（R268 基线 173 files/1939 passed+2 skipped，+8 用例并入现有 format.test.ts，无新增文件）。
- `npx eslint`（触及 6 文件）：exit 0，零 error/warn。
- `npx vite build`：成功，built in 4.44s。

## 数据模型 / 提示词
零 PocketBase collection schema、零 pb_hooks、零提示词改动（未触 B 类流程）。DocMeta 增字段仅前端运行时派生结构，随检查会话产生。

## 维持裁定不动
- 编造嫌疑未清零禁止导出：只报不拦——L1-13/L1-14 用 warn 而非 fail，不加任何新硬门禁；
- `lint-debt-01` 有意保留残余未重构。

## 挂账
- 字号/行距达标的「正文 vs 标题」分层判定（当前对全文 sizes/spacing 取样、以 warn 兜住误伤）待有更细段落样式数据再精修。
- 真实 docx 端到端复核（填 bodySize/lineSpacing 后跑检查）待真项目补。
- AnbidFormatStandard 余下 allowColor/allowPageNumber/requireSeparateBooklet 已在 L5 消费，bodySize/lineSpacing 本轮补齐，八旋钮至此全部有消费点。
