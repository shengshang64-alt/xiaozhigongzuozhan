# 小智工作站 · UI/UX 升级 - GLM-5.3-Flash 执行摘要

## 🎯 一句话目标

**用 10-14 天时间，将首页信息密度降低 60%，让用户一眼看到"当天最重要的 3 件事"**

---

## 📥 你需要读的 3 份材料

### 1️⃣ 诊断报告（理解为什么要改）
**文件**: `docs/UI-UX-Diagnosis-and-Optimization-Recommendations.md`  
**必读章节**:
- §二.1 工作台总览（P0 问题详解）
- §三 整体架构问题
- §四 关键优化路线图（Phase 1 部分）

**核心发现**:
| 问题 | 严重程度 | 影响范围 |
|------|---------|---------|
| 首页信息过载 | P0 | 全站用户 |
| 导航混乱 | P0 | 全站用户 |
| 军事化黑话 | P0 | 品牌专业性 |
| 交互反馈缺失 | P1 | 用户体验 |

### 2️⃣ 静态原型（理解改成什么样）
**文件**: `docs/redesign/UI-UX-Redesign-Prototypes.html`  
**操作方式**: Chrome 浏览器打开 → 点击顶部标签切换不同页面  
**重点关注**:
- "工作台总览重构"标签 → 新的首页结构
- "情报中心优化"标签 → 指标卡改进方案
- "标书流水线可视化"标签 → 进度条设计

### 3️⃣ 实施规范（理解怎么改）
**文件**: `docs/AI-Implementation-Specification-v2.md`  
**必读章节**:
- Phase 1 止血期任务清单
- 全局配置要求
- 测试与验收标准

---

## 🔧 核心改造指令（按顺序执行）

### ✅ 任务 1：重构工作台首页（优先级最高）

#### A. 新建 4 个组件文件
在 `src/components/home/` 目录下创建：

1. **NewKeyMetrics.tsx** (约 60 行代码)
   - 显示 3 个关键指标卡：已过期证书、30 天内到期、待确认情报
   - 每个卡片包含：图标 + 数字 + 详情 + 操作按钮
   - 颜色编码：红/橙/蓝区分严重程度

2. **PriorityTasksBoard.tsx** (约 80 行代码)
   - 显示 3 个优先级任务卡片
   - 每个卡片有：标题、客户信息、截止日期、进度条、操作按钮
   - 支持 hover 动画效果

3. **QuickActionButtons.tsx** (约 30 行代码)
   - 4 个快捷入口：新建商机、导入招标文件、查询资质、添加待办
   - 虚线边框 + hover 放大效果

4. **CompactProgressPanel.tsx** (约 50 行代码)
   - 左右双栏：进行中事项 + 今日已完成
   - 状态徽章：绿色已完成 / 蓝色进行中 / 灰色待开始

#### B. 修改 Home/index.tsx
- 注释掉旧组件（不要删除）
- 引入新组件
- 重新排列结构为：
  ```
  欢迎横幅 (gradient background)
  ↓
  NewKeyMetrics (3 张指标卡)
  ↓
  PriorityTasksBoard (3 个任务卡片)
  ↓
  QuickActionButtons (4 个快捷按钮)
  ↓
  CompactProgressPanel (双栏进度面板)
  ```

#### C. 预期效果
- 首页高度从 **2958px → ~1200px**
- 首屏可见 **"当天最重要的 3 件事"**
- 用户可以 **一次性看完所有关键信息**

---

### ✅ 任务 2：清理军事化黑话

#### A. 创建检查脚本
在根目录创建 `scripts/check-prohibited-words.js`：
```javascript
// 检查 .tsx/.ts 文件中是否包含禁用词
const prohibitedWords = ['作战', '制胜', '决胜', '杀手锏', '利器', '赋能', '抓手'];
// 扫描 src 目录，输出警告列表
```

#### B. 全局搜索替换
使用 VSCode 批量替换：
- `作战地图` → `导航` / `工作区`
- `制胜` → `完成` / `交付`
- `决胜` → `成功` / `达成`
- `赋能` → `支持` / `帮助`
- `抓手` → `工具` / `方法`

**预计替换数**: 50-100 处

#### C. 建立术语规范文档
在 `docs/glossary.json` 中维护术语表：
```json
{
  "禁用词": ["作战", "制胜", "决胜"],
  "首选词": {
    "导航": ["导航", "工作区"],
    "完成": ["完成", "交付"],
    "成功": ["成功", "达成"]
  }
}
```

---

### ✅ 任务 3：增加基础交互反馈

#### A. 创建通用 LoadingOverlay 组件
在 `src/components/common/LoadingOverlay.tsx`:
```typescript
// 显示在异步操作期间
// 带旋转图标 + 提示文字
// 支持全屏/局部两种模式
```

#### B. 创建 ConfirmDialog 组件
在 `src/components/common/ConfirmDialog.tsx`:
```typescript
// 二次确认对话框
// 支持多种变体：default/destructive
// 可自定义标题、描述、确认文本
```

#### C. 为现有功能添加反馈
遍历以下场景，逐个添加：

| 场景 | 需要添加的反馈 | 组件 |
|------|--------------|------|
| 创建项目 | loading 状态 + toast 成功 | LoadingOverlay + toast.success |
| 删除证书 | 二次确认对话框 + toast | ConfirmDialog + toast.success/error |
| 提交表单 | 提交中 loading + 验证错误 | LoadingOverlay + field error message |
| 数据加载 | skeleton 骨架屏（<3s）或 loading | Skeleton 组件 |

**注意**: 如果加载时间 < 3 秒，优先使用 skeleton；> 3 秒用 loading spinner

---

## ⚙️ 前置准备（必须先做）

### 1. 安装依赖
```bash
pnpm add lucide-react sonner @radix-ui/react-dialog @radix-ui/react-toast
```

### 2. 扩展 Tailwind 颜色配置
在 `tailwind.config.js` 中添加：
```javascript
theme: {
  extend: {
    colors: {
      primary: { DEFAULT: '#1E3A5F', light: '#4A90E2' },
      success: '#10B981',
      warning: '#F59E0B',
      danger: '#EF4444',
      info: '#3B82F6',
    }
  }
}
```

### 3. 创建 TypeScript 类型定义
在 `src/types/ui.ts` 中添加：
```typescript
export type SeverityLevel = 'danger' | 'warning' | 'info' | 'success';

export interface MetricCardProps {
  title: string;
  value: number | string;
  unit?: string;
  detail: string;
  severity: SeverityLevel;
  actionable?: boolean;
}
```

---

## 🧪 验收标准（必须全部通过）

### 功能性验收
- [ ] 首页高度 ≤ 1200px
- [ ] 用户可以找到"当天最重要的 3 件事"
- [ ] 所有按钮有 hover/focus 视觉效果
- [ ] 所有异步操作显示 loading 状态
- [ ] 所有删除操作有二次确认对话框
- [ ] Toast 提示覆盖所有成功/失败场景

### 兼容性验收
- [ ] 没有破坏任何已有功能
- [ ] 移动端适配（最小宽度 768px 无横向滚动）
- [ ] 控制台无错误日志

### 性能验收
- [ ] Lighthouse 评分 ≥ 90
- [ ] 首屏加载时间 < 1.5 秒

### 代码质量验收
- [ ] 符合 ESLint 规则（error = 0, warning ≤ 11）
- [ ] 新增组件覆盖率 ≥ 80%
- [ ] 没有引入新的 console.log

---

## ⚠️ 常见陷阱规避

| 陷阱 | 表现 | 正确做法 |
|------|------|---------|
| 过度设计 | 试图一次性重构整个导航体系 | 每次只改一个组件，小步快跑 |
| 忽略兼容 | 删除旧组件导致其他功能失效 | 保留旧组件注释，逐步移除 |
| 没有度量 | 改了但不知道有没有效果 | 为每个改动设定 KPI 并测量 |
| 缺少测试 | 上线后 bug 频发 | 先写测试再写代码 |

---

## 🔄 回滚策略

如果遇到严重问题，快速回滚命令：
```bash
# 记录当前 commit hash（执行前）
CURRENT_COMMIT=$(git rev-parse HEAD)
echo $CURRENT_COMMIT > .backups/phase1-base.txt

# 回滚命令
git checkout $(cat .backups/phase1-base.txt)
git reset --hard $(cat .backups/phase1-base.txt)
```

---

## 📊 成功判断标准（Phase 1）

完成后的 5 个指标：
1. **首页滚动高度 ≤ 1200px**（原 2958px）
2. **用户找到首要任务时间 < 30 秒**（用户测试）
3. **新用户困惑度下降 50%**（问卷评分 ≥ 4.0/5.0）
4. **误操作事件减少 70%**（删除确认覆盖）
5. **团队维护成本降低 40%**（代码可读性提升）

---

## 💬 遇到问题的求助路径

1. **UI 样式问题** → 查阅 Tailwind docs + 参考原项目现有组件
2. **TypeScript 错误** → 检查 type definition 是否完整
3. **组件通信问题** → 参考 `src/components/home/` 内已有模式
4. **性能问题** → 使用 React DevTools Profiler 分析
5. **架构决策疑问** → 回看诊断报告 §三 整体架构问题

---

## ✅ 执行检查清单

开始前：
- [ ] 已阅读诊断报告 §二.1 工作台总览
- [ ] 已打开静态原型查看视觉效果
- [ ] 已理解 Phase 1 的核心目标（10-14 天）
- [ ] 已准备好 Git 分支命名规范

执行中：
- [ ] 每个组件完成后运行单元测试
- [ ] 每次提交前运行 ESLint
- [ ] 每完成一个任务就更新本文档进度

完成后：
- [ ] 邀请真实用户试用并收集反馈
- [ ] 对比基线指标（首页高度、用户困惑度等）
- [ ] 编写 ADR（架构决策记录）说明为什么这样做

---

## 🎁 额外资源

### 参考实现
- Radix UI Dialog: https://www.radix-ui.com/primitives/docs/components/dialog
- Tailwind 颜色系统: https://tailwindcss.com/docs/customizing-colors
- Lucide 图标库: https://lucide.dev/icons/

### 相关文档
- 项目 README: `README.md`
- 质量规范: `docs/全局质量规范 - 测试与交付门槛.md`
- 演进记录: `docs/evolution/R{轮次}_{YYYYMMDD}.md`

---

**祝执行顺利！有任何问题随时回看这份文档。** 🚀
