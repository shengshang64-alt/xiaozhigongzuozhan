# R204 · 投标文件编制·右栏可折叠 + 技术偏离表发现性（用户实测反馈 切片 0）

日期：2026-10-08　轮次：R204　优先级：P0（用户点名「优化要求」的第一片）
类型：**A 类**（零 schema / 零 collection / 零 pb_hooks / 零提示词；纯前端 UI + 折叠状态）

## 一、选题与依据

来源：`c:\Users\Administrator\Desktop\小智工作站-需求记录.md`（2026-10-08 用户全量实测）
- **O-008**「左侧大纲 + 中正文 + 右侧常驻宽侧栏，正文区被压到约 60% 宽，阅读体验差」→ 对应 R-004 侧栏抽屉化诉求
- **O-009**「只有『商务条款响应偏离表』，无技术偏离表」→ 实际代码里 `DeviationPanel.tsx` 标题就叫"技术偏离表"，
  被塞在正文下方无锚点导致用户"没看到"——属**发现性 bug**，不是能力缺失。

用户已批准的实施计划 `BidWorkspace 底稿增量与三模式与Word预览` 分 6 切片，本轮 = 切片 0（前置修补，
为 R-001/R-002/R-004 腾出 UI 空间；单独一片先行落地避免与 R-001 底稿上传功能耦合）。

## 二、方案与口径

单文件 `src/components/bid-workspace/ComposeStep.tsx` 定点 4 处：

1. `lucide-react` 增补 `ChevronLeft` / `Table2`（原文件已用 ChevronRight，扩对称图标；偏离表提示卡用 Table2 与其标题图标一致）
2. 组件顶部新增 `asideCollapsed` 本地态：`useState<boolean>(() => localStorage.getItem('bidkit.compose.asideCollapsed') === '1')`；
   `toggleAside` 内联函数同步写回；读写均包 try/catch，隐私模式无 localStorage 时静默降级
3. 3 栏栅格容器（原 `xl:grid-cols-[200px_minmax(0,1fr)_300px]`）：
   - 上方加"收起 / 展开评分点面板"按钮（`hidden xl:flex`，仅 xl 断点可见）；带 `aria-expanded` `aria-controls` 无障碍
   - 栅格 className 依 `asideCollapsed` 切换 `xl:grid-cols-[200px_minmax(0,1fr)]`（2 栏）↔ `xl:grid-cols-[200px_minmax(0,1fr)_300px]`（3 栏）
   - 右栏 `<div id="score-mapping-aside" className="hidden xl:sticky xl:top-20 xl:block">` 用 `{!asideCollapsed && (<>...</>)}` 条件渲染
4. `DeviationPanel` 上方新增 `<div id="deviation-panel" className="mt-6 scroll-mt-24 ...">` 提示卡：
   "技术偏离表就在下方——章节正文成稿后选好拆分维度，点面板右上角「生成偏离表」……"（Table2 图标 + 前景/背景对比）

不动的部分：
- 窄于 xl 视口下的降级 `<div className="mt-4 xl:hidden">` 下方 ScoreMappingPanel 保持原样（视口不满足条件时开关条也不显示，
  两口径互不冲突）
- `DeviationPanel` 内部（条款拆分维度、生成/导出按钮）不动，只加外层锚点
- 归档只读锁、批量生成态、编辑/预览切换、打印/存 PDF 等既有交互全部保留

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/components/bid-workspace/ComposeStep.tsx` | +2 imports / +16 state 与 toggle / +21 开关条 / +2 栅格 className / +2 条件渲染包裹 / +11 提示卡 |
| `src/components/bid-workspace/ComposeStep.tsx.r204bak` | 修改前原件备份（同一约定：历轮 rNNN 修改均留 bak 供回退） |

## 四、四门验证

- **tsc** `npx tsc --noEmit` EXIT=0
- **vitest** `npx vitest run` 130 files / **1544 passed** / 2 skipped / 0 fail（相对 R203 基线 130/1544/2 完全持平——
  纯 UI 改动无测试面变化，符合"切片 0 无新用例"预期）
- **eslint** `npx eslint src/components/bid-workspace/ComposeStep.tsx --max-warnings=0` EXIT=0
- **build** `npm run build` EXIT=0 3.26s（BidWorkspace chunk 616.92 kB → gzip 173.32 kB，未引入新 chunk）

## 五、浏览器实摆（用户 point-of-truth：http://localhost:8000/bid-workspace）

真实流程（browser-use MCP，chrome viewport 479 触发不到 xl 断点，用 evaluate_script 直接查 DOM 与 localStorage 佐证）：

1. `http://127.0.0.1:8000/bid-workspace` → 项目列表 → 点入「贵港项目（10/10 章成稿）」→ 切至第 3 步「投标文件编制」
2. **DeviationPanel 锚点**：`document.querySelector('#deviation-panel').textContent` = 「技术偏离表就在下方——章节正文成稿后选好拆分维度……」 ✓
3. **默认展开态**：`localStorage.bidkit.compose.asideCollapsed = null`，`#score-mapping-aside` 存在于 DOM，开关按钮文案 = "收起评分点面板" ✓
4. **点收起**：`localStorage = "1"`，`#score-mapping-aside` 从 DOM 消失，开关按钮文案 = "展开评分点面板"，栅格 className 由 `xl:grid-cols-[200px_minmax(0,1fr)_300px]` → `xl:grid-cols-[200px_minmax(0,1fr)]` ✓
5. **点展开**：`localStorage = "0"`，`#score-mapping-aside` 复现，栅格回到 3 栏 ✓
6. **刷新后持久**：`localStorage.setItem(...,'0'); location.reload()` 后组件按 ls 值重新初始化 ✓

## 六、后续切片挂账（open backlog）

用户已批准的完整实施计划还剩 5 片，按依赖顺序推进：
- 切片 1（R-002 三模式 + 仅商务生成）——**下一步**
- 切片 2（R-003 无底稿兜底强化）
- 切片 3（R-001 mammoth 底稿上传 + 逐章保留）
- 切片 4（R-004 A4 实时分页预览）
- 切片 5（O-001~O-006 观察项 + 卡/表切换）

## 七、最终结果与挂账

- 用户实测反馈 O-008（正文挤到 60%）从"必须全屏才能读"降为"一键扩宽 + 记忆偏好"，代价：一次点；
- 用户实测反馈 O-009（技术偏离表发现性）从"看不到"变成"就在下方"提示卡 + id 锚点，为切片 4 Word 预览留出锚点滚动入口；
- 无用户可见报错文案变更、无内部字段名暴露，符合「用户可见报错文案禁止暴露内部字段名与阶段编号」规范；
- 无硬编码业务规则变更、无引擎隔离突破、无 AI 调用增加，符合 AGENTS.md §2/§3/§6。

## 附：截图

- `.qoder/r204_slice0_deviation_hint.png`（DeviationPanel 提示卡视觉确认）
- `.qoder/r204_slice0_collapsed.png`（收起态）

