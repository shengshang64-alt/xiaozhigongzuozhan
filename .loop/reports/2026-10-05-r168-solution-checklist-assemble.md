# R168 — 方案主链路：清单 → 标准方案骨架正向组装（2026-10-05）

## 选题
backlog `r167-solution-checklist-assemble`（P1，/solution-studio）：方案全流程要求"先对照公司系统/产品清单，
再据清单组装公司标准方案"。此前 buildOutline 与清单解耦，清单侧仅有 R162 的事后落位核验
（RequirementCoverage），缺『清单→骨架』正向组装。

## 实施（A 类：零 schema / 零 pb_hooks / 零提示词 / 零 AI 费用）

### 新纯函数模块 checklistToOutline.ts
- `SKELETON_TEMPLATES: Record<SolutionTypeKey, SkeletonChapterDef[]>`：五类方案各一套标准章节模板；
  每类含且仅含一个 `systemsChapter: true` 章（standard=核心功能模块介绍、preliminary=各分系统初步设计、
  planning=重点应用系统规划、feasibility=建设方案论证、custom=总体建设方案）。
- `normalizeSystems`：trim / 去空 / 首现去重（保持勾选顺序）。
- `checklistToOutlineSkeleton(systems, typeKey): OutlineNode[]`：systemsChapter 章的 children = 每系统一子节；
  未知 typeKey 诚实回落 standard；节点 makeUid 唯一 id、children 恒为数组、不写 part（与编制页大纲形状一致）。
- standard 模板 8 章：产品总体介绍与价值主张 / 总体技术架构 / 核心功能模块介绍(sys) / 产品亮点与差异化优势 /
  实施方案与服务体系 / 典型落地案例 / 投资估算与服务报价 / 效益分析。

### 接线
- `useSolutionStudio.ts`：`assembleOutlineFromChecklist` callback——systems 为空 toast 引导（勾选或从清单带入）；
  否则 `setOutlineDraft(checklistToOutlineSkeleton(...))` 并跳 step3，toast 成功提示；加入 return 暴露。
- `NewSolutionWizard.tsx`：step2 footer 新增『按清单组装骨架』Button（Layers 图标，variant=outline，
  disabled=outlineLoading，tooltip 明示"不走大模型、零费用"），与既有『生成方案大纲』（AI 通道）并存互补。
- `SolutionStudioPage.tsx`：prop 透传。

### 单测 checklistToOutline.test.ts（6 用例）
标准方案章节序列+系统铺子节 / systems 空仍产固定骨架 / 去空 trim 去重 / 未知 typeKey 回落 standard /
每节点唯一 id + children 数组（planning 11 章+2 子节=13）/ 五类模板各含且仅含一个 systemsChapter。

## 四门验证
| 门禁 | 结果 |
|---|---|
| npx tsc -b | 0 错误 |
| npx vitest run | 1118 passed + 2 skipped（基线 1112，+6 全为本轮新增，无回归） |
| npx eslint（触及 3 文件） | 13 error / 1 warning，与 HEAD 干净版逐字等量（行号一致下移）→ 本轮净新增 0 |
| npx vite build | 成功 |

eslint HEAD 对比法：Python `subprocess git show HEAD:path` 以二进制写临时文件再 lint（PowerShell `>` 重定向会损坏
UTF-8 中文导致误报 2 error，弃用）；临时文件 Python os.remove 清理。

## 浏览器实机验证（localhost:8000/solution-studio）
新建方案 → step1 选"标准方案" → step2 填医院"示范市人民医院"、勾选 HIS/LIS/PACS →
点『按清单组装骨架』→ 跳 step3：
- 8 章骨架完整呈现（与 SKELETON_TEMPLATES.standard 逐字一致）；
- 第 3 章"核心功能模块介绍"下 3.1 PACS / 3.2 HIS / 3.3 LIS 按勾选顺序落位；
- toast"已按清单 3 个系统组装标准方案骨架，可继续调整再确认"；
- 节点可改名/增删/上下移（复用 OutlineTreeEditor），『确认大纲，进入编制』走既有逐章生成填正文；
- console 0 error；截图存证 `d:\KFDXCX\MedPreSales\.qoder\r168_checklist_skeleton.png`。

## 裁定与边界
- 纯函数零依赖零 LLM，不涉及提示词，故无 B 类逐字对比（PROMPT_VERSION 不动）。
- 数据模型零改动：骨架仅进会话内 outlineDraft state，确认后经既有 persist 通道落库。
- 未 git commit；补丁脚本 scripts/r168_checklist_to_outline.py 9 处 str.replace 锚点 assert count==1 全命中。

## 后续
剩余 backlog：`r167-ppt-template-driven-export`（P1，上传模板按版式生成）、
`r167-ppt-skill-driven-generation`（P2）。
