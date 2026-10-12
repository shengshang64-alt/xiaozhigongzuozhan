# R264 标书检查整改清单导出与三栏阅读视图对齐（单一真源）

## 选题依据（巡检·交互断链 + 口径分叉）
R262 给 BidCheck 三栏阅读视图（ReadingView）落地了两个核心呈现约定：
1. 右侧问题清单按严重度优先排序（`SEV_RANK`：critical→high→medium→info）；
2. 正文类命中经 `resolvePositions` 解析出 `chapterTitle / sectionHint / lineNo` 锚点后，
   位置用「章节 / 小节 / 第 N 段」精确呈现（ReadingView.tsx 原第 478 行内联表达式）。

但团队分工的主交付物——**Excel 整改清单**（`report/toExcel.ts`）两条都没对齐：
- `buildRows` 仍按检查项原始顺序（L1→L5）逐条铺开，废标级必改项埋在中间，
  拿着清单的人必须自己筛选排序；
- 位置列只写粗粒度 `hit.location`（多为「正文」/章标题），把 R262 精算出的段落锚点整个丢弃，
  整改人回到 Word 里只能模糊定位。

即：屏幕上看得见、排好序的精确信息，导出即失真——典型交互断链，且两处口径各写各的（分叉）。

## 变更（A 类·零 AI / 零 schema / 零 pb_hooks / 零提示词 / 未 commit）
把两处口径抽成 `bidCheckTypes.ts` 的单一真源，ReadingView 与 toExcel 同时消费：

1. `bidCheckTypes.ts`
   - 新增 `SEVERITY_RANK: Record<Severity, number>`（与 ReadingView 内联 `SEV_RANK` 同值，作 canonical）；
   - 新增 `formatHitLocation(h: CheckHit): string`——把 ReadingView 第 478 行的内联表达式原样上移为共享函数，
     行为逐字等价（解析出锚点用「章 / 节 / 第 N 段」，未解析回退 `location`）。
2. `report/toExcel.ts`
   - `buildRows` 先剔除 pass 项、再按 `SEVERITY_RANK` 稳定排序（同档保持原检查项顺序，filter 生成新数组不改 `result.items`）；
   - 位置列由 `h.location` 改为 `formatHitLocation(h)`；汇总 sheet 维持按层级分组不变。
3. `ReadingView.tsx`
   - 第 478 行内联表达式替换为 `formatHitLocation(hit)`，消除重复、坐实单一真源（呈现逐字等价）。

## 四门验证（目标项目目录内跑）
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：169 files 全绿，**1911 passed / 2 skipped**（基线 1909 +2，本轮 `toExcel.test.ts` 新增 2 条）。
  - 追加回归①：整改清单按严重度优先排（critical→high→medium），废标级排最前；
  - 追加回归②：正文命中位置用解析锚点（章节 / 小节 / 第 N 段）精确呈现。
  - 定向首跑 `toExcel.test.ts` = 5 passed（原 3 + 新 2）。
- `npx eslint`（触及 4 文件 bidCheckTypes/toExcel/ReadingView/toExcel.test）：exit 0，零输出（零新增 error）。
- `npx vite build`：exit 0，构建成功（约 43s）。

## 边界与维持裁定
- 纯呈现层派生：不改任何规则判定（format/anbid）、不改检测逻辑、不改数据模型、不接 AI。
- 「只标不改」红线不动；「编造/暗标未清零只报不拦」（R89）不动；lint-debt-01 残余不重构。
- HTML 体检报告（toHtml.ts）维持按 L1→L5 层级分组——那是归档/转发复核的文档结构，非分工 worklist，不纳入本轮。

## 交付物
- 源码：bidCheckTypes.ts / report/toExcel.ts / ReadingView.tsx
- 测试：report/toExcel.test.ts（+2）
- 补丁脚本：d:/KFDXCX/MedPreSales/scripts/r264_bidcheck_export_parity.py、r264_bidcheck_export_parity_tests.py
- 备份：三源文件 + 账本各留 .bak-r264；未 git commit。
