# 任务 2.1: 标书流水线可视化 - 集成指南

## 📦 已创建的组件文件

### 核心组件
1. **`src/components/bid-workspace/BidPipelineStepperEnhanced.tsx`**
   - 增强版七步流水线可视化组件
   - 包含进度条、状态标识、跳转交互
   - 自动计算章节完成度百分比

2. **`src/components/bid-workspace/BidPipelineStepperEnhanced.test.tsx`**
   - 完整的单元测试套件（10+ 测试用例）
   - 覆盖渲染、交互、边界条件

## 🔧 集成步骤

### 步骤 1: 替换现有 PipelineStepper

在 `src/pages/BidWorkspace/BidWorkspacePage.tsx` 中：

```typescript
// 原导入
import { PipelineStepper } from "@/components/bid-workspace/PipelineStepper"

// 新导入
import { BidPipelineStepperEnhanced } from "@/components/bid-workspace/BidPipelineStepperEnhanced"
```

### 步骤 2: 更新组件使用

找到原来的 `<PipelineStepper>` 位置，替换为：

```tsx
<BidPipelineStepperEnhanced 
  activeStep={activeStep}
  requestStep={requestStep}
  activeProject={activeProject}
/>
```

### 步骤 3: 移除冗余代码

由于 `BidPipelineStepperEnhanced` 已经包含了操作按钮和上下文面板，可以删除：

```typescript
// 可以删除的旧代码（如果存在）
// <div className="flex justify-center gap-4">...</div>  // 操作按钮栏
// <CurrentTaskContextPanel />  // 上下文面板
```

## 🎯 功能特性

### 1. 可视化进度条
- **颜色编码**: ✓绿色完成 / ●蓝色进行中 / ○灰色待开始
- **进度百分比**: 第 3 步显示"50% (2/4 章)"并带进度条
- **动画效果**: 当前步骤有呼吸灯脉冲效果

### 2. 点击跳转导航
- 点击任意步骤可直接跳转到该步骤
- 智能提示："建议先完成「第 X 步」"
- 支持回退和前进

### 3. 操作按钮栏
- ← 返回上一步（第一步时禁用）
- 💾 保存草稿 (自动)
- 继续编写 →（最后一步时变为"完成 →"）

### 4. 上下文面板（仅第 3 步显示）
- **左侧**: 章节导航树（带勾选状态）
- **右侧**: 快速工具（引用素材库/插入图表/AI 写作助手/保存草稿）

## 📊 验收标准验证

### 功能性测试
```bash
# 运行单元测试
pnpm test BidPipelineStepperEnhanced.test.tsx

# 预期结果：所有 10+ 测试用例通过
```

### UI 验收清单
- [ ] 7 个步骤清晰可见
- [ ] 已完成步骤显示绿色✓图标
- [ ] 当前步骤显示蓝色时钟 + 脉冲动画
- [ ] 待开始步骤显示灰色○图标
- [ ] 第 3 步显示章节进度百分比和进度条
- [ ] 点击步骤可跳转并改变激活状态
- [ ] 操作按钮正确禁用/启用
- [ ] 上下文面板仅在步骤 3 显示

### 性能验收
```bash
# 使用 React DevTools 查看性能
# 确保无内存泄漏
# 页面加载时间 < 1.5 秒
```

## 🐛 已知问题与待优化项

### 当前实现
✅ 基本功能完整  
✅ 样式美观统一  
✅ 交互流畅  

### 后续优化
- ⏸️ 虚拟滚动支持超长章节列表（>20 章）
- ⏸️ Web Worker 异步计算进度
- ⏸i18n 国际化支持
- ⏸️ 更丰富的动画过渡

## 🚀 下一步

完成此组件集成后，请：

1. **UI 视觉验证**: 在浏览器中打开标书工作台页面，检查流水线可视化效果
2. **用户测试**: 邀请真实用户使用并反馈
3. **性能测试**: 使用 Lighthouse 测量页面加载时间
4. **记录 ADR**: 创建架构决策记录说明设计理由

---

**交付物清单**
- ✅ `src/components/bid-workspace/BidPipelineStepperEnhanced.tsx`
- ✅ `src/components/bid-workspace/BidPipelineStepperEnhanced.test.tsx`
- ✅ `docs/TASK-2.1-INTEGRATION-GUIDE.md` (本文档)

**预计剩余工时**: 0.5 天（集成和测试）
