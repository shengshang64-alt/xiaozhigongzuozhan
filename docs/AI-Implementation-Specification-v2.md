# 小智工作站 · UI/UX 升级实施规范（GLM-5.3-Flash 执行版）

> **版本**: v2.0  
> **目标 AI**: GLM-5.3-Flash  
> **生成时间**: 2026-11-07  
> **执行优先级**: P0 > P1 > P2  
> **预计工时**: Phase 1 (10-14 天) + Phase 2 (18-25 天)

---

## 📌 执行总则

### 核心原则
1. **零破坏性重构**：所有改动必须向后兼容，原有功能不可删除
2. **增量式发布**：每个 Phase 完成后必须有可运行的测试版本
3. **度量驱动**：为每个改动设定明确的可测量指标
4. **用户验证**：每个 Phase 结束后必须邀请真实用户试用

### 禁止事项
- ❌ 不要一次性大改导航体系（会导致全页面重写）
- ❌ 不要删除任何已有业务逻辑代码
- ❌ 不要使用未经验证的外部组件库
- ❌ 不要改变现有数据模型结构（除非特别说明）

---

## 🎯 Phase 1：止血期（10-14 天）

### 目标
解决 P0 级别问题，让用户"立刻感觉好一些"

---

### 任务 1.1：重构工作台首页信息架构

#### 文件清单
| 文件路径 | 操作类型 | 说明 |
|---------|---------|------|
| `src/pages/Home/index.tsx` | 保留 | 主入口，不删除 |
| `src/components/home/WelcomeBanner.tsx` | 重构 | 替换为新欢迎横幅 |
| `src/components/home/BidNodesCard.tsx` | 保留 | 投标节点卡，暂不动 |
| `src/components/home/FollowUpReminderCard.tsx` | 保留 | 跟进到期提醒，暂不动 |
| `src/components/home/TodoCard.tsx` | 重构 | 替换为新的待办卡片 |
| **新建** `src/components/home/NewKeyMetrics.tsx` | 新建 | 关键指标卡组（替代原 4 个指标） |
| **新建** `src/components/home/PriorityTasksBoard.tsx` | 新建 | 优先级任务看板 |
| **新建** `src/components/home/QuickActionButtons.tsx` | 新建 | 快捷操作按钮组 |
| **新建** `src/components/home/CompactProgressPanel.tsx` | 新建 | 紧凑进度面板 |

#### 改造指令

##### A. 创建新关键指标卡组件 (`NewKeyMetrics.tsx`)
```typescript
// src/components/home/NewKeyMetrics.tsx
import React from 'react';
import { AlertTriangle, FileWarning, Bell } from 'lucide-react';

interface KeyMetricData {
  title: string;
  value: number;
  unit: string;
  detail: string;
  severity: 'danger' | 'warning' | 'info';
  actionLabel: string;
  actionRoute: string;
}

const metricsData: KeyMetricData[] = [
  {
    title: '已过期证书',
    value: 1,
    unit: '张',
    detail: 'ISO20000 服务管理体系认证证书记录',
    severity: 'danger',
    actionLabel: '→ 立即处理',
    actionRoute: '/qual-certs'
  },
  {
    title: '30 天内到期',
    value: 3,
    unit: '张',
    detail: 'CMMI 证书 (7 天)、软著 (15 天)、ITSS(28 天)',
    severity: 'warning',
    actionLabel: '→ 批量查看',
    actionRoute: '/qual-certs?filter=expiring-soon'
  },
  {
    title: '待确认情报',
    value: 29,
    unit: '条',
    detail: '本周新增 40 条，其中政策类 12 条、竞品动态 8 条',
    severity: 'info',
    actionLabel: '→ 进入情报中心',
    actionRoute: '/intel-center'
  }
];

const severityColors = {
  danger: { border: '#EF4444', bg: '#FEF2F2', text: '#DC2626' },
  warning: { border: '#F59E0B', bg: '#FFFBEB', text: '#D97706' },
  info: { border: '#3B82F6', bg: '#EFF6FF', text: '#2563EB' }
};

export const NewKeyMetrics: React.FC = () => {
  return (
    <div className="space-y-4">
      {metricsData.map((metric, index) => (
        <div
          key={index}
          className="bg-white rounded-lg border-l-4 p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          style={{ 
            borderColor: severityColors[metric.severity].border,
            backgroundColor: metric.severity === 'danger' ? '#FEF2F2' : 
                           metric.severity === 'warning' ? '#FFFBEB' : '#EFF6FF'
          }}
        >
          <div className="flex justify-between items-start mb-2">
            <div className="flex items-center space-x-2">
              {metric.severity === 'danger' && <AlertTriangle size={16} color="#DC2626" />}
              {metric.severity === 'warning' && <FileWarning size={16} color="#D97706" />}
              {metric.severity === 'info' && <Bell size={16} color="#2563EB" />}
              <span className="text-xs text-gray-500 uppercase tracking-wide">
                {metric.title}
              </span>
            </div>
          </div>
          
          <div className="mb-2">
            <span className="text-3xl font-semibold text-gray-800">{metric.value}</span>
            <span className="text-gray-600 ml-1">{metric.unit}</span>
          </div>
          
          <p className="text-sm text-gray-600 mb-3">{metric.detail}</p>
          
          <a
            href={metric.actionRoute}
            className="inline-block px-4 py-1 text-xs bg-gray-100 rounded text-gray-700 hover:bg-gray-200 transition-colors"
          >
            {metric.actionLabel}
          </a>
        </div>
      ))}
    </div>
  );
};
```

##### B. 创建优先级任务看板 (`PriorityTasksBoard.tsx`)
```typescript
// src/components/home/PriorityTasksBoard.tsx
import React from 'react';
import { ArrowRight } from 'lucide-react';

interface PriorityTask {
  title: string;
  client?: string;
  dueDays?: number;
  completedChapters?: number;
  totalChapters?: number;
  priority: 'high' | 'medium' | 'low';
  statusColor: string;
  actionLabel: string;
  actionRoute: string;
}

const tasks: PriorityTask[] = [
  {
    title: '继续编写蚌埠医科大学第一附属医院智慧医疗核心平台...标书',
    client: '客户：蚌埠医科大学第一附属医院',
    dueDays: 11,
    completedChapters: 5,
    totalChapters: 11,
    priority: 'high',
    statusColor: '#1E3A5F',
    actionLabel: '→ 继续编写',
    actionRoute: '/bid-workspace?project=bb2026sqcgz052'
  },
  {
    title: '审核 CMMI 证书延期申请材料',
    client: '类型：资质管理 · 负责人：张三（行政部）',
    dueDays: 3,
    priority: 'medium',
    statusColor: '#F59E0B',
    actionLabel: '→ 立即审核',
    actionRoute: '/qual-certs?action=renew&id=cmmi-2026'
  },
  {
    title: '回复吉安市公立中医医院信息化变更澄清公告',
    client: '来源：情报中心 · 发布时间：2 小时前',
    dueDays: null,
    priority: 'high',
    statusColor: '#EF4444',
    actionLabel: '→ 立即处理',
    actionRoute: '/intel-center?id=jaszthy-clarification-2026'
  }
];

const priorityColors = {
  high: '#DC2626',
  medium: '#F59E0B',
  low: '#10B981'
};

export const PriorityTasksBoard: React.FC = () => {
  return (
    <div className="bg-white rounded-lg p-6 shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-semibold text-gray-800 flex items-center">
          <span className="w-1 h-6 bg-blue-600 mr-3 rounded"></span>
          🎯 今日优先级任务（3 项）
        </h2>
        <div className="flex space-x-2">
          <button className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors">
            全部
          </button>
          <button className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors">
            我负责的
          </button>
        </div>
      </div>
      
      <div className="grid gap-4">
        {tasks.map((task, index) => (
          <div
            key={index}
            className="group p-5 border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all cursor-pointer transform hover:-translate-y-0.5"
            style={{ backgroundColor: index % 2 === 0 ? '#F9FAFB' : '#FFFFFF' }}
          >
            <h3 
              className="text-lg font-semibold mb-3"
              style={{ color: priorityColors[task.priority] }}
            >
              {task.title}
            </h3>
            
            <div className="text-sm text-gray-600 mb-3 flex flex-wrap gap-4">
              {task.client && <span>🏢 {task.client}</span>}
              {task.dueDays !== null && task.dueDays !== undefined && (
                <span>📅 距截止 {task.dueDays} 天</span>
              )}
            </div>
            
            {task.completedChapters && task.totalChapters && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>已完成 {task.completedChapters}/{task.totalChapters} 章</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="h-2 rounded-full transition-all"
                    style={{ 
                      width: `${(task.completedChapters / task.totalChapters) * 100}%`,
                      backgroundColor: task.statusColor 
                    }}
                  ></div>
                </div>
              </div>
            )}
            
            <button
              className="w-full py-2 text-sm font-medium text-white rounded transition-colors"
              style={{ backgroundColor: task.statusColor }}
            >
              {task.actionLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
```

##### C. 创建快捷操作按钮组 (`QuickActionButtons.tsx`)
```typescript
// src/components/home/QuickActionButtons.tsx
import React from 'react';
import { Plus, FileText, FileSearch, ListPlus } from 'lucide-react';

const actions = [
  { label: '新建商机', icon: Plus, route: '/customer-management?action=new' },
  { label: '导入招标文件', icon: FileText, route: '/bid-workspace?action=new&source=upload' },
  { label: '查询资质', icon: FileSearch, route: '/qual-certs?action=query' },
  { label: '添加待办', icon: ListPlus, route: '/todo?action=new' }
];

export const QuickActionButtons: React.FC = () => {
  return (
    <div className="grid grid-cols-4 gap-4">
      {actions.map((action, index) => (
        <a
          key={index}
          href={action.route}
          className="p-6 bg-white border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-blue-400 hover:bg-gray-50 transition-all group"
        >
          <div className="text-2xl mb-3 group-hover:scale-110 transition-transform">
            <action.icon size={24} className="mx-auto text-gray-600" />
          </div>
          <div className="text-sm font-medium text-gray-700">{action.label}</div>
        </a>
      ))}
    </div>
  );
};
```

##### D. 创建紧凑进度面板 (`CompactProgressPanel.tsx`)
```typescript
// src/components/home/CompactProgressPanel.tsx
import React from 'react';

const inProgressItems = [
  { title: '【UI 测试】中医院信息化建设项目建设方案正文', status: '编写中·7/11 章' },
  { title: '安徽中医药大学第一附属医院一体化核心平台建设方案', status: '大纲中·3/8 章' },
  { title: 'R01-solution-20261004 三明市中西医结合医院智慧病房方案', status: '可导出 Word' }
];

const doneTodayItems = [
  { title: '更新 ISO27001 信息安全管理体系认证证书扫描件', time: '已完成 2 小时前' }
];

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  if (status.includes('可导出')) {
    return <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">✅ 完成</span>;
  } else if (status.includes('编写中') || status.includes('大纲中')) {
    return <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">⏳ 进行中</span>;
  }
  return <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">{status}</span>;
};

interface ProgressPanelProps {
  title: string;
  items: Array<{ title: string; status: string; time?: string }>;
  isDone?: boolean;
}

const ProgressPanel: React.FC<ProgressPanelProps> = ({ title, items, isDone }) => (
  <div className="bg-white p-6 rounded-lg border border-gray-200">
    <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
      {isDone ? '✅' : '📊'} {title}
    </h3>
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
          <span className="text-sm text-gray-700">{item.title}</span>
          <div className="flex items-center space-x-3">
            <StatusBadge status={item.status} />
            {item.time && <span className="text-xs text-gray-500">{item.time}</span>}
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const CompactProgressPanel: React.FC = () => {
  return (
    <div className="grid grid-cols-2 gap-4">
      <ProgressPanel title="工作进行中事项（3 项）" items={inProgressItems} />
      <ProgressPanel title="今日已完成（1 项）" items={doneTodayItems} isDone />
    </div>
  );
};
```

##### E. 整合新首页结构 (`index.tsx`)
在 `src/pages/Home/index.tsx` 中，注释掉旧组件，替换为新结构：

```typescript
// src/pages/Home/index.tsx

// 注释掉旧的复杂卡片
// import { WelcomeBanner } from '@/components/home/WelcomeBanner';
// import { BidNodesCard } from '@/components/home/BidNodesCard';
// import { FollowUpReminderCard } from '@/components/home/FollowUpReminderCard';
// import { TodoCard } from '@/components/home/TodoCard';
// ... 其他旧组件

import { NewKeyMetrics } from '@/components/home/NewKeyMetrics';
import { PriorityTasksBoard } from '@/components/home/PriorityTasksBoard';
import { QuickActionButtons } from '@/components/home/QuickActionButtons';
import { CompactProgressPanel } from '@/components/home/CompactProgressPanel';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* 欢迎横幅 */}
      <div className="bg-gradient-to-r from-[#1E3A5F] to-[#4A90E2] text-white rounded-lg p-8 mb-6">
        <h1 className="text-3xl font-bold mb-2">
          晚上好，系统管理员，欢迎回到售前工作台
        </h1>
        <p className="text-base opacity-90">
          今日重点工作：处理 3 项资质预警 · 完成 XXX 标书编制 · 回复 29 条新情报
        </p>
      </div>
      
      {/* 关键指标卡 */}
      <NewKeyMetrics />
      
      {/* 优先级任务看板 */}
      <div className="mt-6">
        <PriorityTasksBoard />
      </div>
      
      {/* 快捷操作按钮 */}
      <div className="mt-6">
        <QuickActionButtons />
      </div>
      
      {/* 进度面板 */}
      <div className="mt-6">
        <CompactProgressPanel />
      </div>
      
      {/* 保留旧模块但缩小展示（可选）*/}
      {/* <div className="mt-8">
        <OldModulesCompactView />  {/* 将来逐步移除 *\/}
      </div>
    </div>
  );
}
```

#### 验收标准
- [ ] 首页高度从 2958px 降至约 1200px
- [ ] 用户可以找到"当天最重要的 3 件事"
- [ ] 所有按钮都有明确的点击反馈
- [ ] 移动端适配（最小宽度 768px 无横向滚动）
- [ ] 没有控制台错误日志

---

### 任务 1.2：修复导航体系混乱

#### 改造指令

##### A. 统一左侧菜单文案
遍历所有路由定义，确保一致性：

```typescript
// src/lib/routeRegistry.ts - NAV_GROUPS 修改

// 从分组改为扁平化（暂时保留现有分组，但减少层级）
export const NAV_GROUPS: { title: string; paths: string[] }[] = [
  // 暂时保留 3 组，但准备下一步扁平化
  { title: "客户 · 线索", paths: ["/", "/customer-management", "/intel-center"] },
  { title: "方案 · 标书 · 汇报", paths: ["/solution-studio", "/product-mapping", "/ppt-quote", "/materials", "/bid-workspace", "/bid-check", "/format-tool"] },
  { title: "沉淀 · 团队", paths: ["/knowledge", "/qual-certs", "/competitors", "/assistant", "/model-config", "/ai-hot", "/team"] },
]

// ⚠️ 注意：这里先保留，下一步再扁平化
```

##### B. 建立术语规范检查工具
创建一个 ESLint rule 或 pre-commit hook 检查禁用词：

```bash
# scripts/check-prohibited-words.js
#!/usr/bin/env node

const prohibitedWords = ['作战', '制胜', '决胜', '杀手锏', '利器', '赋能', '抓手'];
const forbiddenPatterns = [
  /\b作战地图\b/g,
  /\b制胜\b/g,
  /\b决胜\b/g
];

function scanDirectory(dir) {
  // 扫描所有 .tsx/.ts 文件
  // 检查是否包含禁用词
  // 输出警告列表
}

scanDirectory('./src');
process.exit(hasErrors ? 1 : 0);
```

##### C. 全局搜索替换
在 VSCode 中使用全局替换：
- `作战地图` → `导航` / `工作区`
- `制胜` → `完成` / `交付`
- `决胜` → `成功` / `达成`
- `赋能` → `支持` / `帮助`
- `抓手` → `工具` / `方法`

**预期替换数**: 约 50-100 处

#### 验收标准
- [ ] 全站不再有"作战""制胜"等军事化词汇
- [ ] 左侧菜单文案统一（"标书"vs"标书工作台"统一为"标书工作台"）
- [ ] 建立了术语规范文档
- [ ] 运行 `node scripts/check-prohibited-words.js` 通过

---

### 任务 1.3：增加基础交互反馈

#### 改造指令

##### A. 为所有按钮添加 hover/focus 状态
Tailwind CSS 已经默认支持，确保：
```css
/* tailwind.config.js 确认 */
module.exports = {
  theme: {
    extend: {
      transitionProperty: {
        'height': 'height',
        'spacing': 'margin, padding',
      }
    }
  }
}
```

##### B. 为所有异步操作添加 loading 指示器
创建一个通用的 LoadingOverlay 组件：

```typescript
// src/components/common/LoadingOverlay.tsx
import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingOverlayProps {
  message?: string;
  fullscreen?: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ 
  message = '加载中...', 
  fullscreen = false 
}) => {
  return (
    <div 
      className={`flex items-center justify-center ${fullscreen ? 'fixed inset-0 z-50 bg-black/20' : 'relative'}`}
    >
      <div className="bg-white px-6 py-4 rounded-lg shadow-lg flex items-center space-x-3">
        <Loader2 className="animate-spin h-5 w-5 text-blue-600" />
        <span className="text-sm text-gray-700">{message}</span>
      </div>
    </div>
  );
};
```

使用示例：
```typescript
// src/components/bid-workspace/BidWorkspacePage.tsx
const handleCreateProject = async () => {
  const [showLoading, setShowLoading] = useState(false);
  
  setShowLoading(true);
  try {
    await api.createBidProject(data);
    toast.success('项目创建成功');
  } finally {
    setShowLoading(false);
  }
  
  return (
    <>
      {showLoading && <LoadingOverlay message="正在创建项目..." />}
      {/* 现有内容 */}
    </>
  );
};
```

##### C. 为所有删除操作添加二次确认
使用 Radix UI 的 AlertDialog：

```typescript
// src/components/common/ConfirmDialog.tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/dialog"

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'destructive' | 'default';
  onConfirm: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  onConfirm
}) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction 
            onClick={onConfirm}
            className={variant === 'destructive' ? 'bg-red-600' : ''}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
```

使用示例：
```typescript
// src/components/qual-certs/CertList.tsx
const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
const [certToDelete, setCertToDelete] = useState<Cert | null>(null);

const handleDeleteClick = (cert: Cert) => {
  setCertToDelete(cert);
  setDeleteDialogOpen(true);
};

const handleConfirmDelete = async () => {
  if (!certToDelete) return;
  
  await api.deleteCertificate(certToDelete.id);
  toast.success('证书已删除');
  setDeleteDialogOpen(false);
  setCertToDelete(null);
};

return (
  <>
    <ConfirmDialog
      open={deleteDialogOpen}
      onOpenChange={setDeleteDialogOpen}
      title="确定要删除这个证书吗？"
      description={`删除后无法恢复。证书名称：${certToDelete?.name}`}
      confirmText="删除"
      variant="destructive"
      onConfirm={handleConfirmDelete}
    />
  </>
);
```

#### 验收标准
- [ ] 所有按钮有 hover/focus 视觉效果
- [ ] 所有异步操作显示 loading 状态（不超过 3 秒时可用 skeleton）
- [ ] 所有删除操作有二次确认对话框
- [ ] Toast 提示覆盖所有成功/失败场景

---

### Phase 1 总结

完成 Phase 1 后，应该达到：
- ✅ 首页信息密度降低 60%
- ✅ 用户使用困惑度显著下降
- ✅ 基础交互流畅度提升
- ✅ 误操作风险降低

---

## 🚀 Phase 2：重构期（18-25 天）

### 目标
系统性解决核心流程问题

**（此处省略详细步骤，实际执行时可逐项展开）**

主要任务：
- 任务 2.1: 标书流水线可视化重构（3-4 天）
- 任务 2.2: 情报中心优化（4-5 天）
- 任务 2.3: 资质台账升级（5-6 天）
- 任务 2.4: 小智助手功能完善（5-7 天）

---

## 📋 全局配置要求

### 依赖安装
```bash
pnpm add lucide-react # 图标库
pnpm add sonner # Toast 通知
pnpm add @radix-ui/react-dialog # 对话框
pnpm add @radix-ui/react-toast # Toast 组件
```

### Tailwind 颜色扩展
```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1E3A5F',
          light: '#4A90E2',
        },
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
      }
    }
  }
}
```

### TypeScript 类型定义
```typescript
// src/types/ui.ts
export type SeverityLevel = 'danger' | 'warning' | 'info' | 'success';

export interface MetricCardProps {
  title: string;
  value: number | string;
  unit?: string;
  detail: string;
  severity: SeverityLevel;
  actionable?: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in-progress' | 'completed';
  progress: number; // 0-100
}
```

---

## 🧪 测试与验证

### 单元测试要求
每个新组件必须编写测试：
```typescript
// __tests__/components/home/NewKeyMetrics.test.tsx
import { render, screen } from '@testing-library/react';
import { NewKeyMetrics } from '@/components/home/NewKeyMetrics';

test('renders three metric cards', () => {
  render(<NewKeyMetrics />);
  expect(screen.findAllByRole('article')).toHaveLength(3);
});

test('displays correct severity colors', () => {
  render(<NewKeyMetrics />);
  const dangerCard = screen.getByText(/已过期证书/i).closest('div');
  expect(dangerCard).toHaveStyle('border-left-color: rgb(239, 68, 68)');
});
```

### E2E 测试场景
```typescript
// tests/e2e/home.spec.ts
test('user can identify top 3 priorities from homepage', async ({ page }) => {
  await page.goto('/');
  const priorityTaskCards = page.locator('.priority-task-card');
  await expect(priorityTaskCards).toHaveCount(3);
  
  const firstCard = priorityTaskCards.first();
  await expect(firstCard).toContainText('继续编写');
});
```

---

## 📊 度量指标

### Phase 1 KPIs
| 指标 | 基线值 | 目标值 | 测量方式 |
|------|--------|--------|----------|
| 首页滚动次数 | 4 次 | ≤1 次 | 用户测试 |
| 首屏可见任务数 | 0 个完整 | 3 个完整 | UX 审计 |
| 新用户理解时间 | 约 5 分钟 | < 2 分钟 | 可用性测试 |
| 页面加载时间 | 2.3s | < 1.5s | Lighthouse |

---

## 🔒 回滚策略

如果某个 Phase 上线后出现问题，快速回滚方案：

```bash
# 记录当前 Git commit hash
CURRENT_COMMIT=$(git rev-parse HEAD)
echo $CURRENT_COMMIT > .backups/phase1-base.txt

# 如果发现问题，执行回滚
git checkout $(cat .backups/phase1-base.txt)
git reset --hard $(cat .backups/phase1-base.txt)
```

---

## 📝 补充说明

### 代码风格约定
1. **组件命名**: PascalCase（如 `NewKeyMetrics.tsx`）
2. **函数命名**: camelCase（如 `handleCreateProject`）
3. **常量命名**: UPPER_CASE（如 `PROHIBITED_WORDS`）
4. **注释风格**: JSDoc 格式
5. **文件组织**: 按功能分组，每个目录一个功能模块

### PR 审查清单
- [ ] 代码符合 ESLint 规则
- [ ] 添加了必要的类型定义
- [ ] 更新了 README 或组件文档
- [ ] 通过了所有单元测试
- [ ] 包含了 E2E 测试用例
- [ ] 没有引入新的 console.log
- [ ] 没有泄露敏感信息到客户端
- [ ] 性能影响可控（无内存泄漏）

---

## ✅ 完成标志

Phase 1 完成的判断标准：
1. ✅ 所有 P0 问题已修复
2. ✅ 通过 E2E 测试
3. ✅ 用户体验调研满意度 ≥ 4.0/5.0
4. ✅ 团队成员可以独立维护新代码
5. ✅ 文档齐全（包括架构决策记录 ADR）

---

**报告结束**

请 GLM-5.3-Flash 按照此规范逐步执行，每完成一个任务都需在团队频道同步进展。
