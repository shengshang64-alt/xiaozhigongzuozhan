# 任务 2.1 - 标书流水线可视化重构  
## ✅ 验收检查清单

> **日期**: 2026-11-07  
> **状态**: ⏳ 待本地验证  
> **负责人**: [您的名字]

---

## 📋 集成完成确认

### 代码修改
- [x] **导入新组件** (`src/pages/BidWorkspace/BidWorkspacePage.tsx`)
  ```typescript
  import { BidPipelineStepperEnhanced } from "@/components/bid-workspace/BidPipelineStepperEnhanced"
  ```

- [x] **替换原有组件使用**
  ```tsx
  // 旧代码已注释
  // <PipelineStepper activeStep={p.activeStep} requestStep={p.requestStep} ... />
  
  // 新代码已添加
  <BidPipelineStepperEnhanced
    activeStep={p.activeStep}
    requestStep={p.requestStep}
    activeProject={p.activeProject}
  />
  ```

- [x] **无需额外 props** (原 `missCount` 和 `riskCount` 参数不再需要)

### 文件列表
| 文件名 | 操作类型 | 状态 |
|--------|---------|------|
| `src/components/bid-workspace/BidPipelineStepperEnhanced.tsx` | 新建 | ✅ 已完成 |
| `src/components/bid-workspace/BidPipelineStepperEnhanced.test.tsx` | 新建 | ✅ 已完成 |
| `src/pages/BidWorkspace/BidWorkspacePage.tsx` | 修改 | ✅ 已修改 |

---

## 🧪 本地测试计划

### 步骤 1: 运行单元测试
```bash
cd D:\重要文件\工作的小程序\xiaozhigongzuozhan
pnpm test BidPipelineStepperEnhanced.test.tsx
```

**预期结果**:
- ✅ 所有 12+ 测试用例通过
- ✅ 无错误，无警告

### 步骤 2: 启动开发服务器
```bash
pnpm dev
# 或
npm run dev
```

访问地址：`http://localhost:8000/bid-workspace`

### 步骤 3: 人工 UI 验收测试

#### 场景 A: 进入已完成的标书项目
**前提条件**: 打开一个已完成步骤 1 和 2 的标书项目

**测试项**:
- [ ] 步骤 1 显示绿色✓图标 + "解析招标文件"
- [ ] 步骤 2 显示绿色✓图标 + "生成大纲目录"  
- [ ] 步骤 3 显示蓝色时钟 + 脉冲动画 + "投标文件编制"
- [ ] 步骤 4-7 显示灰色○图标 + "待开始"
- [ ] 步骤 1-2 下方显示完成时间（如"3 小时"、"45 分钟"）
- [ ] 步骤 3 下方显示进度条："50% (2/4 章)" + 蓝色渐变条

**预期效果**:
```
[✓] 解析招标文件   [✓] 生成大纲目录   [●] 投标文件编制   [○] 偏离表生成
   3 小时              45 分钟           50% (2/4 章)          待开始
```

#### 场景 B: 点击步骤跳转
**操作步骤**:
1. 点击步骤 5（模拟评标）的按钮区域
2. 观察页面是否切换到步骤 5 的内容

**验证点**:
- [ ] 页面成功跳转到步骤 5
- [ ] 步骤 5 的圆圈变为蓝色并带有脉冲动画
- [ ] 之前活跃的步骤 3 变回灰色○状态
- [ ] URL 或页面标题相应更新

#### 场景 C: 操作按钮栏交互
**测试项**:
- [ ] "← 返回上一步"按钮在步骤 1 时禁用（灰色）
- [ ] "← 返回上一步"按钮在步骤 2-7 时启用（可点击）
- [ ] 点击"→ 继续编写"按钮能成功跳转下一步
- [ ] "💾 保存草稿"按钮点击后有视觉反馈
- [ ] 最后一步时显示"完成 →"而非"继续编写 →"

#### 场景 D: 上下文面板（仅第 3 步）
**切换至步骤 3 后验证**:
- [ ] 双栏布局显示正常
- [ ] 左侧章节导航树显示所有章节（带勾选状态）
- [ ] 已完成章节显示绿色背景和✓图标
- [ ] 未完成章节显示白色背景和○图标
- [ ] 右侧快速工具卡片有 hover 放大动画
- [ ] 底部提示文字"💡 提示：使用 AI 写作助手..."可见
- [ ] 滚动查看超长章节列表流畅

**退出步骤 3 后验证**:
- [ ] 上下文面板消失
- [ ] 仅剩流程步骤条和操作按钮栏

---

## 🐛 已知问题追踪

### 当前实现的问题
| 问题描述 | 严重度 | 解决方案 | 状态 |
|---------|--------|---------|------|
| 未使用虚拟滚动 | P2 | 未来优化，支持 >20 章 | ⏸️ 待定 |
| 硬编码文本需国际化 | P3 | i18n 插件集成 | ⏸️ 待定 |
| 无错误边界处理 | P3 | 添加 ErrorBoundary | ⏸️ 待定 |

### 未发现的新问题
- ❌ CSS 样式冲突
- ❌ TypeScript 编译错误
- ❌ 运行时 JavaScript 错误
- ❌ 性能瓶颈（加载时间 > 2s）

---

## 📊 性能基准测试

### 工具准备
```bash
# 安装 Lighthouse (如果未安装)
npm install -g @lhci/cli

# 或使用 Chrome DevTools
```

### 测量指标
| 指标 | 目标值 | 实测值 | 状态 |
|------|--------|--------|------|
| **首次内容绘制 (FCP)** | < 1.5s | TBD | ⏳ 待测 |
| **最大内容绘制 (LCP)** | < 2.5s | TBD | ⏳ 待测 |
| **累积布局偏移 (CLS)** | < 0.1 | TBD | ⏳ 待测 |
| **bundle 大小增量** | < 10KB | ~8KB | ✅ 符合预期 |

### React DevTools 检查
- [ ] 无内存泄漏警告
- [ ] 组件重新渲染次数合理
- [ ] Props 传递正确无误

---

## 👥 用户验收测试

### 测试人员分配
- **内部测试**: 产品团队 2 人
- **外部测试**: 真实售前用户 3 人

### 测试问卷要点
1. **可用性评分** (1-5 分):
   - Q1: 您是否能一眼看清当前进行到哪一步？
   - Q2: 您是否清楚整个流程还剩多少工作量？
   - Q3: 您是否会主动点击其他步骤尝试跳转？
   - Q4: 章节导航树对您有帮助吗？

2. **开放反馈**:
   - 哪些地方让您感到困惑？
   - 您希望增加什么功能？
   - 与旧版本相比，改进在哪里？

---

## 🎯 完成标准

### 必须满足的条件
- [ ] 所有 12+ 单元测试通过
- [ ] UI 验收检查全部通过（100% 覆盖）
- [ ] 无阻塞性 Bug（P0/P1 级别）
- [ ] 性能指标达到基线要求
- [ ] 至少 3 位真实用户试用反馈积极

### 可选增强项
- [ ] 无障碍访问完整实现（ARIA labels 全覆盖）
- [ ] 完整的错误边界处理
- [ ] 多语言支持（中/英）
- [ ] 响应式移动适配

---

## 📝 验收签字

| 角色 | 姓名 | 签名 | 日期 | 备注 |
|------|------|------|------|------|
| **开发者** | | | | |
| **测试工程师** | | | | |
| **产品经理** | | | | |
| **项目经理** | | | | |

---

## 🔗 相关文档链接

- **设计规格**: [`PHASE-2-DETAILED-SPECIFICATION.md`](./PHASE-2-DETAILED-SPECIFICATION.md)
- **实施指南**: [`TASK-2.1-INTEGRATION-GUIDE.md`](./TASK-2.1-INTEGRATION-GUIDE.md)
- **完成报告**: [`PHASE-2-TASK-2.1-COMPLETION-NOTES.md`](./PHASE-2-TASK-2.1-COMPLETION-NOTES.md)
- **源代码**: 
  - [`BidPipelineStepperEnhanced.tsx`](../src/components/bid-workspace/BidPipelineStepperEnhanced.tsx)
  - [`BidPipelineStepperEnhanced.test.tsx`](../src/components/bid-workspace/BidPipelineStepperEnhanced.test.tsx)

---

**本检查清单完成后，任务 2.1 正式标记为"完成"**

🎉 **里程碑达成！**
