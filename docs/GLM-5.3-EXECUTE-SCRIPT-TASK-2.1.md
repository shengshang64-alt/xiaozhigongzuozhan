# GLM-5.3-Flash 执行脚本：任务 2.1 测试修复与 UI 验证

> **执行者**: GLM-5.3-Flash  
> **任务编号**: TASK-2.1-FIX  
> **生成时间**: 2026-11-07  
> **预计耗时**: 30-40 分钟  
> **执行顺序**: 严格按步骤执行，不要跳过

---

## ⚠️ 前置条件检查（必须先做）

在开始任何修改前，先执行以下命令验证环境：

```bash
cd "D:\重要文件\工作的小程序\xiaozhigongzuozhan"

# 1. 确认工作目录正确
pwd
# 预期输出: D:\重要文件\工作的小程序\xiaozhigongzuozhan

# 2. 确认依赖完整
pnpm install --frozen-lockfile

# 3. 确认 TypeScript 编译通过
npx tsc -b

# 4. 确认当前开发服务器没有在运行（避免端口冲突）
# 如果有 8000 端口被占用，先杀掉：
# netstat -ano | findstr :8000
# taskkill /PID <PID> /F
```

如果上述任何一步失败，先解决环境问题再继续。

---

## 🔧 Part 1：修复测试文件（15 分钟）

### 步骤 1.1：完整替换测试文件

**文件路径**: `src/components/bid-workspace/BidPipelineStepperEnhanced.test.tsx`

**操作**: 用以下内容**完整替换**现有文件：

```typescript
import { render, screen, fireEvent, within } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { BidPipelineStepperEnhanced } from "./BidPipelineStepperEnhanced"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

// ---------------------------------------------------------------------------
// Mock 数据工厂：每次调用返回全新对象，避免测试间状态污染
// ---------------------------------------------------------------------------
function makeChapters(count: number, doneCount: number): BidProjectRecord["bid_chapters"] {
  return Array.from({ length: count }, (_, i) => ({
    chapter_index: i,
    title: `第${i + 1}章 测试章节`,
    content: i < doneCount ? `第${i + 1}章的正文内容` : "",
  }))
}

function makeProject(overrides: Partial<BidProjectRecord> = {}): BidProjectRecord {
  return {
    id: "test-proj-001",
    project_name: "测试项目",
    opportunity_id: null,
    hospital_id: null,
    tender_text: "招标文件全文内容",
    parse_report: { summary: "已解析" } as BidProjectRecord["parse_report"],
    bid_chapters: makeChapters(2, 1), // 默认 2 章，1 章完成
    dup_report: null,
    void_check: null,
    ai_review: null,
    stage: "in_progress",
    stage_gates: [],
    price_score: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 渲染辅助：每次都渲染一个全新的容器，避免 DOM 残留
// ---------------------------------------------------------------------------
function renderStepper(opts: {
  activeStep?: number
  project?: BidProjectRecord
  requestStep?: (step: number) => void
} = {}) {
  const {
    activeStep = 1,
    project = makeProject(),
    requestStep = vi.fn(),
  } = opts
  return {
    requestStep,
    ...render(
      <BidPipelineStepperEnhanced
        activeStep={activeStep}
        requestStep={requestStep}
        activeProject={project}
      />
    ),
  }
}

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------
describe("BidPipelineStepperEnhanced", () => {
  beforeEach(() => {
    // 每个测试前清理 DOM，防止上一个测试的渲染残留
    document.body.innerHTML = ""
  })

  // -----------------------------------------------------------
  // 1. 基础渲染
  // -----------------------------------------------------------
  it("渲染全部 7 个流程步骤", () => {
    renderStepper({ activeStep: 1 })

    // 通过步骤标签文本查找，每步一个
    const stepLabels = [
      "招标文件",
      "AI 解析报告",
      "投标文件编制",
      "查重",
      "废标与合规检查",
      "模拟评标与答辩",
      "归档导出",
    ]
    for (const label of stepLabels) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  // -----------------------------------------------------------
  // 2. 完成态标记
  // -----------------------------------------------------------
  it("已完成步骤显示绿色文字", () => {
    // tender_text 非空 → 步骤 1 完成
    const project = makeProject({ tender_text: "有内容" })
    renderStepper({ activeStep: 2, project })

    const step1Label = screen.getByText("招标文件")
    expect(step1Label).toHaveClass("text-green-600")
  })

  // -----------------------------------------------------------
  // 3. 第 3 步进度信息
  // -----------------------------------------------------------
  it("第 3 步显示章节进度百分比与进度条", () => {
    const project = makeProject({
      bid_chapters: makeChapters(4, 2), // 2/4 = 50%
    })
    renderStepper({ activeStep: 3, project })

    // 百分比文本
    expect(screen.getByText("50% (2/4章)")).toBeInTheDocument()
    // 进度条容器存在（用 role=progressbar 或通过类名查找）
    const progressBar = document.querySelector(".bg-gradient-to-r")
    expect(progressBar).not.toBeNull()
  })

  // -----------------------------------------------------------
  // 4. 当前步骤高亮
  // -----------------------------------------------------------
  it("当前步骤标签显示蓝色高亮", () => {
    renderStepper({ activeStep: 3 })

    const currentLabel = screen.getByText("投标文件编制")
    expect(currentLabel).toHaveClass("text-blue-600")
  })

  // -----------------------------------------------------------
  // 5. 点击步骤触发跳转
  // -----------------------------------------------------------
  it("点击步骤可触发 requestStep 回调", () => {
    const requestStep = vi.fn()
    renderStepper({ activeStep: 1, requestStep })

    // 点击步骤 2 的容器（通过标签文本向上找到可点击元素）
    const step2Label = screen.getByText("AI 解析报告")
    const clickable = step2Label.closest("[class*='cursor-pointer']")
    expect(clickable).not.toBeNull()
    fireEvent.click(clickable!)

    expect(requestStep).toHaveBeenCalledWith(2)
  })

  // -----------------------------------------------------------
  // 6. 上一步按钮在第一步禁用
  // -----------------------------------------------------------
  it("activeStep=1 时「返回上一步」按钮禁用", () => {
    renderStepper({ activeStep: 1 })

    const prevBtn = screen.getByRole("button", { name: /返回上一步/ })
    expect(prevBtn).toBeDisabled()
  })

  // -----------------------------------------------------------
  // 7. 下一步按钮在非最后一步可用
  // -----------------------------------------------------------
  it("activeStep=3 时「继续编写」按钮可用", () => {
    renderStepper({ activeStep: 3 })

    const nextBtn = screen.getByRole("button", { name: /继续编写/ })
    expect(nextBtn).not.toBeDisabled()
  })

  // -----------------------------------------------------------
  // 8. 最后一步按钮文案变为「完成」
  // -----------------------------------------------------------
  it("activeStep=7 时按钮文案为「完成」", () => {
    renderStepper({ activeStep: 7 })

    const doneBtn = screen.getByRole("button", { name: /完成/ })
    expect(doneBtn).toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // 9. 上下文面板仅在第 3 步出现
  // -----------------------------------------------------------
  it("activeStep=3 时显示章节导航与快速工具", () => {
    renderStepper({ activeStep: 3 })

    expect(screen.getByText(/章节导航/)).toBeInTheDocument()
    expect(screen.getByText(/快速工具/)).toBeInTheDocument()
  })

  it("activeStep≠3 时不显示章节导航", () => {
    renderStepper({ activeStep: 1 })

    expect(screen.queryByText(/章节导航/)).not.toBeInTheDocument()
    expect(screen.queryByText(/快速工具/)).not.toBeInTheDocument()
  })

  // -----------------------------------------------------------
  // 10. 章节完成态样式
  // -----------------------------------------------------------
  it("已完成章节显示绿色左边框与绿色背景", () => {
    const project = makeProject({
      bid_chapters: makeChapters(2, 1), // 第 1 章完成
    })
    renderStepper({ activeStep: 3, project })

    // 找到章节标题对应的容器 div
    const chapterTitle = screen.getByText("第1章 测试章节")
    const chapterRow = chapterTitle.closest("[class*='border-l-4']")
    expect(chapterRow).toHaveClass("border-green-500")
    expect(chapterRow).toHaveClass("bg-green-50")
  })

  // -----------------------------------------------------------
  // 11. 空章节数组容错
  // -----------------------------------------------------------
  it("空章节数组时上下文面板不渲染（不崩溃）", () => {
    const project = makeProject({ bid_chapters: [] })
    renderStepper({ activeStep: 3, project })

    // 组件不应崩溃；上下文面板因为 !project?.bid_chapters?.length 不渲染
    // 所以章节导航与快速工具都不应出现
    expect(screen.queryByText(/章节导航/)).not.toBeInTheDocument()
  })
})
```

### 步骤 1.2：运行测试验证

```bash
cd "D:\重要文件\工作的小程序\xiaozhigongzuozhan"
pnpm test BidPipelineStepperEnhanced.test.tsx --run
```

**预期结果**: `11 passed, 0 failed`

**如果有失败**:
- 读取具体失败信息
- 常见问题：组件中的文本与测试期望不完全匹配（如空格、全角/半角括号）
- 对照组件源码 `BidPipelineStepperEnhanced.tsx` 中的实际文本调整测试断言
- 重复运行直到全部通过

---

## 🔍 Part 2：修复组件中的已知 Bug（10 分钟）

在运行测试的过程中，你可能发现组件源码 `BidPipelineStepperEnhanced.tsx` 存在以下问题，请逐一检查并修复：

### Bug 2.1：`!step.status === 'current'` 逻辑错误

**位置**: 约第 108 行

**问题代码**:
```tsx
{!step.status === 'current' && !chapterProgress && (
  <span>...</span>
)}
```

**问题分析**: `!step.status` 先将字符串转为布尔值再取反，结果永远是 `false`，这个分支永远不会渲染。原意应该是 `step.status !== 'current'`。

**修复为**:
```tsx
{step.status !== 'current' && !step.progress && (
  <span className={`absolute font-semibold ${
    step.status === 'completed' ? 'text-green-600' :
    'text-gray-400'
  }`}>
    {step.id}
  </span>
)}
```

同时检查同一行中引用的 `chapterProgress` 变量——它在外层 map 作用域中未定义（应该是 `step.progress`），一并修正。

### Bug 2.2：`!step.status === 'current'` 同类检查

用全局搜索在整个文件中搜索 `!step.status`，确认只有这一处，且已全部修复。

### Bug 2.3：`isGateConfirmed` 与 `stepDone` 的位置

这两个辅助函数在组件外部定义，但被 JSX 内部引用。确认它们的定义在组件**之前**（或者使用函数声明提升），避免 `Cannot access before initialization` 错误。

**正确顺序**:
```tsx
// 1. 先定义辅助函数
function isGateConfirmed(...) { ... }
function stepDone(...) { ... }
function handleSaveDraft() { ... }

// 2. 再定义组件
export function BidPipelineStepperEnhanced(...) { ... }

// 3. 最后定义内部子组件
function CurrentTaskContextPanel(...) { ... }
```

如果 `CurrentTaskContextPanel` 在主组件之后定义，JSX 中引用时 JavaScript 函数声明提升（hoisting）可以保证它可用，但**保持一致的定义顺序更安全**。

### Bug 2.4：`ArrowRight` 导入了但未使用

**位置**: 文件顶部 import

**问题**:
```tsx
import { CheckCircle, Circle, Clock, ArrowRight } from "lucide-react"
```

`ArrowRight` 未使用会导致 ESLint 报 warning。

**修复**: 移除未使用的导入：
```tsx
import { CheckCircle, Circle, Clock } from "lucide-react"
```

### Bug 2.5：`UseBidWorkspace` 导入了但未使用

**位置**: 文件顶部 import

**问题**:
```tsx
import type { UseBidWorkspace } from "@/pages/BidWorkspace/useBidWorkspace"
```

该类型未在组件中使用。

**修复**: 移除未使用的导入。

### 修复后验证

```bash
# TypeScript 编译检查
npx tsc -b --noEmit

# 预期：0 errors
```

---

## 🖥️ Part 3：本地 UI 验证（10 分钟）

### 步骤 3.1：启动开发服务器

```bash
cd "D:\重要文件\工作的小程序\xiaozhigongzuozhan"
# 使用项目标准的启动脚本（带 PocketBase 代理）
# 如果 start-local.cmd 存在：
./start-local.cmd

# 如果没有，使用 vite local config：
# npx vite --config vibex-local/vite.local.config.ts --host 0.0.0.0 --port 8000
```

**注意**: 不要用 `pnpm dev`，因为根配置没有 `/__pb` 代理，数据会为空。

### 步骤 3.2：登录系统

1. 打开浏览器访问 `http://localhost:8000`
2. 使用管理员账号登录：`admin@team.local` / `Admin#12345`
3. 确认成功进入工作台总览

### 步骤 3.3：进入标书工作台

1. 左侧导航点击「标书工作台」
2. 确认页面正常加载，项目列表显示
3. **点击任意一个进行中的项目**进入详情页

### 步骤 3.4：验证新流水线组件

进入项目详情页后，逐项检查：

| # | 检查项 | 通过标准 |
|---|--------|---------|
| 1 | 七步流程条显示 | 7 个步骤圆圈一字排开，有连接线 |
| 2 | 已完成步骤 | 绿色圆圈 + ✓ 图标 + 绿色文字 |
| 3 | 当前步骤 | 白色圆圈 + 蓝色边框 + 蓝色文字 + 脉冲动画 |
| 4 | 待开始步骤 | 灰色圆圈 + ○ 图标 + 灰色文字 |
| 5 | 第 3 步进度 | 显示 "X% (N/M章)" + 蓝色渐变进度条 |
| 6 | 步骤可点击 | 点击任意步骤圆圈，页面切换到对应步骤 |
| 7 | 上一步按钮 | 第 1 步禁用，其他步骤可点击 |
| 8 | 下一步按钮 | 文字为"继续编写 →"，最后一步变为"完成 →" |
| 9 | 保存草稿按钮 | 存在且可点击（点击后 console 有日志） |
| 10 | 上下文面板 | 仅第 3 步显示（章节导航 + 快速工具双栏） |
| 11 | 章节导航 | 已完成章节绿色背景 + ✓，未完成白色背景 + ○ |
| 12 | 快速工具 | 4 个卡片（引用素材库/插入图表/AI 写作助手/保存草稿），hover 放大 |
| 13 | 其他步骤 | 切到步骤 1/2/4/5/6/7 时上下文面板消失 |
| 14 | 旧功能完好 | 步骤内容区（TenderStep/ComposeStep 等）正常显示 |
| 15 | 控制台无报错 | F12 打开 Console，无红色 error |

### 步骤 3.5：截图存档

对以下场景各截一张图，保存到 `_shots/` 目录：

1. `task2.1-stepper-step1.png` — 项目在第 1 步的全景
2. `task2.1-stepper-step3.png` — 项目在第 3 步（含上下文面板）
3. `task2.1-stepper-step5.png` — 项目在第 5 步（上下文面板消失）
4. `task2.1-chapters-tree.png` — 章节导航树特写
5. `task2.1-quick-tools.png` — 快速工具卡片特写

---

## 📝 Part 4：门禁验证（5 分钟）

所有修改完成后，执行项目的四道门禁：

```bash
cd "D:\重要文件\工作的小程序\xiaozhigongzuozhan"

# 门禁 1: TypeScript 编译
npx tsc -b
# 预期: 0 error

# 门禁 2: Vite 构建
CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build
# 预期: 构建成功，exit 0

# 门禁 3: 全量测试
npx vitest run
# 预期: 全绿（基线 301 files / 3513 passed / 7 skipped）
# 注意：由于沙盒 2 核限制，如果一次跑不完，分片跑

# 门禁 4: ESLint
npx eslint src/components/bid-workspace/BidPipelineStepperEnhanced.tsx src/components/bid-workspace/BidPipelineStepperEnhanced.test.tsx src/pages/BidWorkspace/BidWorkspacePage.tsx
# 预期: 新增文件 0 error 0 warning（总预算 ≤116 error ≤11 warning 不被推高）
```

**如果门禁 4 报出新增 error/warning**，修复后重新运行直到通过。

---

## 📋 Part 5：产出验收报告（5 分钟）

完成上述全部步骤后，创建验收报告文件：

**文件路径**: `docs/TASK-2.1-FIX-REPORT.md`

**内容模板**:

```markdown
# 任务 2.1 修复验证报告

> 执行时间: [填写实际时间]
> 执行者: GLM-5.3-Flash

## 环境信息
- Node: [node -v 输出]
- pnpm: [pnpm -v 输出]
- OS: Windows

## Part 1: 测试修复
- [x] 测试文件已替换
- [x] 测试结果: __ passed, __ failed
- 失败项处理: [如有失败，描述修复过程]

## Part 2: 组件 Bug 修复
- [x] Bug 2.1 逻辑错误已修复
- [x] Bug 2.2 同类检查完成
- [x] Bug 2.3 函数顺序确认
- [x] Bug 2.4 未使用导入移除
- [x] Bug 2.5 未使用类型移除
- [x] tsc -b: 0 error

## Part 3: UI 验证
| # | 检查项 | 结果 |
|---|--------|------|
| 1 | 七步流程条显示 | ✅/❌ |
| 2 | 已完成步骤样式 | ✅/❌ |
| 3 | 当前步骤样式 | ✅/❌ |
| 4 | 待开始步骤样式 | ✅/❌ |
| 5 | 第 3 步进度显示 | ✅/❌ |
| 6 | 步骤可点击跳转 | ✅/❌ |
| 7 | 上一步按钮逻辑 | ✅/❌ |
| 8 | 下一步按钮逻辑 | ✅/❌ |
| 9 | 保存草稿按钮 | ✅/❌ |
| 10 | 上下文面板条件渲染 | ✅/❌ |
| 11 | 章节导航样式 | ✅/❌ |
| 12 | 快速工具卡片 | ✅/❌ |
| 13 | 其他步骤面板隐藏 | ✅/❌ |
| 14 | 旧功能完好 | ✅/❌ |
| 15 | 控制台无报错 | ✅/❌ |

截图:
- [ ] task2.1-stepper-step1.png
- [ ] task2.1-stepper-step3.png
- [ ] task2.1-stepper-step5.png
- [ ] task2.1-chapters-tree.png
- [ ] task2.1-quick-tools.png

## Part 4: 门禁
- [x] tsc -b: 0 error
- [x] vite build: exit 0
- [x] vitest run: [实际结果]
- [x] eslint: [实际结果]

## 遗留问题
[列出发现但未修复的问题，如无则写"无"]

## 签字
执行者: GLM-5.3-Flash
日期: [填写日期]
```

---

## ⚠️ 重要提醒

1. **不要修改 `BidWorkspacePage.tsx` 中除流水线组件之外的任何代码**——旧功能必须完好
2. **不要删除或修改 `PipelineStepper.tsx`（旧组件）**——保留作为回滚备份
3. **不要修改其他页面的文件**——本次只动标书工作台
4. **如果遇到无法解决的问题，停止并在报告中如实记录**，不要强行绕过
5. **所有截图必须真实截取**，不要用旧图充数

---

**脚本结束。请 GLM-5.3-Flash 严格按步骤执行。**
