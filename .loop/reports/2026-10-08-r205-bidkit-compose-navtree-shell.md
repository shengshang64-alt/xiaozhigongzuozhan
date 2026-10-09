# R205 · 投标文件编制·左栏目录视觉对齐方案编制页（用户插队需求 切片 0.5）

日期：2026-10-08　轮次：R205　优先级：P1（用户主动提出的体验一致性需求，插队到切片 1 之前）
类型：**A 类**（零 schema / 零 collection / 零 pb_hooks / 零提示词；纯前端 UI 视觉壳）

## 一、选题与依据

来源：用户 2026-10-08 追加需求（附方案编制页截图）："我觉得方案编制这块的生成大纲和目录的展示界面比较好，
能移植到标书这块吗？"

代码核实（跨页复用可行性）：
- `solution-studio/ChapterNavTree.tsx` 左栏目录卡片：顶部「大纲目录 + X/Y 章徽标 + 进度条」、章节「第N章」前缀、
  底部「待生成/生成中/已生成 状态实时同步」提示。其 props 注释明确写「标书工作页传入，方案编制不传不受影响」——
  本就是为跨页共用设计。
- 标书侧 `bid-workspace/ComposeStep.tsx` 内部 `OutlineNavTree`（L322）功能更全（小节级重写/扩写/缩写、part 徽标、
  字数徽标），但缺三样视觉：进度条、X/Y 章计数徽标、「第N章」前缀；标题是「投标文件目录」而非「大纲目录」。
- `RequirementCoverageCard`（落位核验卡）在标书侧已有等价物 `OutlineCoverage.tsx`，且**已挂在 step4 顶部**
  （ComposeStep.tsx#L1028），本切片无需重复移植。
- `Chapter` 类型标书侧直接从 `@/pages/SolutionStudio/solutionTypes` import，两边同源，零适配成本。

用户拍板（AskUserQuestion）：粒度选 **B（左栏 + 落位核验卡）**，顺序选 **插队到切片 1 之前作为 0.5**。
因落位核验卡已在位，本切片实际落地 = 左栏视觉壳三要素补齐。

## 二、方案与口径

单文件 `src/components/bid-workspace/ComposeStep.tsx` 的 `OutlineNavTree` 定点 6 处：

1. props 解构 + 类型：新增 `doneChapterCount: number` / `techChapterTotal: number`（分子=已完成技术章、
   分母=技术章总数，与既有 `p.doneChapterCount` / `p.techChapterTotal` 同源）
2. 组件内新增 `techIndexById: Map<string, number>` —— 按 chapters 顺序给非 biz 章编号（1 起），供「第N章」前缀查表；
   biz 章不参与编号（与 ChapterNavTree 只数技术章口径一致）
3. 标题前缀：`isChapter && !isBiz` 时渲染 `第${techIndexById.get(chapterId)}章 ${node.title}`，否则原样
4. nav 根容器加 `flex h-full flex-col`；头部 `<p>` 改「大纲目录」+ `text-sm font-semibold`，右侧加
   `{doneChapterCount}/{techChapterTotal} 章` 主色胶囊徽标
5. 头部下方插入进度条（`h-1.5 rounded-full bg-muted` 轨道 + `bg-primary` 填充，width 按百分比，`transition-all duration-500`）；
   「全部展开/收起」按钮从头部行移到独立右对齐行，避免与计数徽标挤在同一行
6. 调用点（L1225 `<OutlineNavTree ... />`）补传 `doneChapterCount={p.doneChapterCount}` / `techChapterTotal={p.techChapterTotal}`

不动的部分：
- `OutlineNavTree` 的小节级重写/扩写/缩写按钮、字数徽标、part 徽标、折叠态派生逻辑全部保留（标书侧独有能力）
- `OutlineCoverage` 落位核验卡（step3 + step4 均已在位）不动
- 切片 0（R204）的右栏折叠 aside / #deviation-panel 锚点不动
- 归档只读锁、批量生成态、编辑/预览切换、打印/存 PDF 全部保留

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/components/bid-workspace/ComposeStep.tsx` | OutlineNavTree props +2 字段 / +techIndexById 映射 / 标题「第N章」前缀 / nav 头「大纲目录」+计数徽标 / +进度条 / 全部展开按钮移位 / 调用点补传 2 props |
| `src/components/bid-workspace/ComposeStep.tsx.r205bak` | 修改前原件备份（历轮 rNNN 约定留 bak 供回退） |

## 四、四门验证

- **tsc** `npx tsc --noEmit` EXIT=0
- **vitest** `npx vitest run` 130 files / **1544 passed** / 2 skipped / 0 fail（与 R204 基线完全持平——纯视觉无测试面变化）
- **eslint** `npx eslint src/components/bid-workspace/ComposeStep.tsx --max-warnings=0` EXIT=0
- **build** `npm run build` EXIT=0 3.51s（BidWorkspace chunk 617.64 kB → gzip 173.50 kB，未引入新 chunk）

## 五、浏览器实摆（http://localhost:8000/bid-workspace）

真实流程（browser-use MCP，chrome viewport 479 未达 xl 断点，用 evaluate_script 直查 DOM 佐证）：

1. 项目列表 → 点入「贵港项目（10/10 章成稿）」→ 已在第 3 步「投标文件编制」
2. **头部标题**：`<p>` 命中「大纲目录」（原「投标文件目录」已替换）✓
3. **计数徽标**：`<span>` 命中「10/10 章」✓
4. **进度条**：`div.h-1.5.rounded-full.bg-muted` 计数 = 1 ✓
5. **「第N章」前缀**：`<span>` 序列命中「第1章 项目理解与总体建设方案」…「第10章 应急响应与安全保障方案」（10 章全编号）✓
6. 截图 `.qoder/r205_slice05_outline_navtree.png` 可见「第2章 医院信息管…」+「技术」徽标 + 字数徽标渲染正常

## 六、后续挂账（open backlog）

- 用户拍板 B 粒度，**C 粒度的「素材弹药」右栏**（MaterialAmmoPanel 接入标书侧，与 ScoreMappingPanel tab 化）
  本期不做，登记新 open 项 `bidkit-plan-slice05b-material-ammo`（与切片 4 A4 预览右栏有竞争，需统筹）。

## 七、最终结果与挂账

- 标书工作台左栏目录与方案编制页视觉统一（大纲目录标题 / X-Y 章计数 / 进度条 / 第N章前缀），
  用户在两页间切换零认知成本；
- 落位核验卡经核实已在位，无需重复移植，避免功能重复；
- 无用户可见报错文案变更、无内部字段名暴露；无硬编码业务规则变更、无 AI 调用增加，符合 AGENTS.md §2/§3/§6。

## 附：截图

- `.qoder/r205_slice05_outline_navtree.png`（第N章前缀 + 技术徽标）
- `.qoder/r205_slice05_header_progress.png`（窄视口下滚动定位，头部/进度条以 DOM 佐证为准）

