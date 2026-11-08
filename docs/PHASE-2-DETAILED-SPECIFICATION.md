# 小智工作站 · Phase 2 详细技术实施方案

> **版本**: v1.0  
> **执行者**: GLM-5.3-Flash  
> **生成时间**: 2026-11-07  
> **总工时**: 25-30 天

---

##  Phase 2 总体目标

系统性解决核心流程问题，让用户在七步流水线工作流中感觉"更加顺畅和可控"

---

## 📋 任务分解与实施顺序

### 🔄 并行执行策略
```
┌─────────────────────────────────────────────────────────────┐
│ Week 1-2:                                                    │
│ ├─ 任务 2.1: 标书流水线可视化（负责人：AI_Lead）             │
│ └─ 任务 2.3: 资质台账升级（负责人：AI_Helper）               │
├─────────────────────────────────────────────────────────────┤
│ Week 3:                                                       │
│ └─ 任务 2.2: 情报中心优化（负责人：AI_Lead + AI_Helper 协作）│
├─────────────────────────────────────────────────────────────┤
│ Week 4-5:                                                     │
│ └─ 任务 2.4: 小智助手完善（负责人：AI_Helper）                │
└─────────────────────────────────────────────────────────────┘
```

---

## 任务 2.1: 标书流水线可视化重构（3-4 天）⭐⭐⭐

### 背景诊断
从原诊断报告发现的核心问题：
1. **PipelineStepper 组件进度可视化不足** - 无法直观看到每步进度
2. **不支持回退修改** - 完成某步后无法返回调整
3. **当前步骤标识不明显** - 用户不知道现在进行到哪一步

### 核心改造点

#### A. 新建 BidPipelineStepper.tsx

```typescript
// src/components/bid-workspace/BidPipelineStepper.tsx
import React from 'react';
import { CheckCircle, Circle, Clock } from 'lucide-react';

interface PipelineStepData {
  id: number;
  label: string; // "1. 解析招标文件"
  status: 'completed' | 'current' | 'pending';
  progress?: { completed: number; total: number }; // 如 {completed: 5, total: 11}
  duration?: string; // 如 "3 小时"
  onJumpToStep?: (stepId: number) => void;
}

export const BidPipelineStepper: React.FC<{ steps: PipelineStepData[] }> = ({ 
  steps 
}) => {
  return (
    <div className="relative">
      {/* 连接线 */}
      <div className="absolute top-20 left-0 right-0 h-1 bg-gray-200"></div>
      
      <div className="flex justify-between relative z-10">
        {steps.map((step, index) => (
          <div 
            key={step.id} 
            className="flex flex-col items-center cursor-pointer group"
            onClick={() => step.onJumpToStep?.(step.id)}
          >
            {/* 状态圆圈 */}
            <div 
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                step.status === 'completed' ? 'bg-green-100' :
                step.status === 'current' ? 'bg-blue-100 ring-4 ring-blue-200' :
                'bg-gray-100'
              }`}
            >
              {step.status === 'completed' && <CheckCircle size={20} className="text-green-600" />}
              {step.status === 'current' && <Clock size={20} className="text-blue-600 animate-pulse" />}
              {step.status === 'pending' && <Circle size={20} className="text-gray-400" />}
            </div>
            
            {/* 标签 */}
            <div className="mt-3 text-center">
              <div 
                className={`font-medium ${
                  step.status === 'current' ? 'text-blue-600' :
                  step.status === 'completed' ? 'text-green-600' :
                  'text-gray-500'
                }`}
              >
                {step.label}
              </div>
              
              {/* 进度/时长信息 */}
              {step.progress && (
                <div className="text-xs text-gray-500 mt-1">
                  {step.progress.completed}/{step.progress.total} 章
                </div>
              )}
              
              {step.duration && !step.progress && (
                <div className="text-xs text-gray-500 mt-1">{step.duration}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

#### B. 使用示例 - 集成到 BidWorkspacePage.tsx

```typescript
// src/pages/BidWorkspace/BidWorkspacePage.tsx

// 假设从 API 获取项目数据
const projectData = useBidProject(projectId);

// 定义七步数据
const pipelineSteps: PipelineStepData[] = [
  { 
    id: 1, 
    label: '解析招标文件', 
    status: 'completed',
    duration: '3 小时'
  },
  { 
    id: 2, 
    label: '生成大纲目录', 
    status: 'completed',
    duration: '45 分钟'
  },
  { 
    id: 3, 
    label: '编制投标文件', 
    status: 'current',
    progress: { completed: 5, total: 11 },
    onJumpToStep: (stepId) => handleJumpToStep(stepId)
  },
  { 
    id: 4, 
    label: '偏离表生成', 
    status: 'pending'
  },
  { 
    id: 5, 
    label: '模拟评标', 
    status: 'pending'
  },
  { 
    id: 6, 
    label: '文档检查', 
    status: 'pending'
  },
  { 
    id: 7, 
    label: '归档导出', 
    status: 'pending'
  }
];

// 在页面中渲染
return (
  <div className="p-8">
    <BidPipelineStepper steps={pipelineSteps} />
    
    {/* 下方操作栏 */}
    <div className="flex justify-center gap-4 mt-8">
      <button 
        disabled={projectData.currentStep <= 1}
        className="px-6 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
      >
        ← 返回上一步
      </button>
      
      <button 
        onClick={handleSaveDraft}
        className="px-6 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        💾 保存草稿 (自动)
      </button>
      
      <button 
        onClick={handleContinue}
        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
      >
        继续编写 →
      </button>
    </div>
    
    {/* 当前任务上下文面板 */}
    <CurrentTaskContextPanel currentStep={projectData.currentStep} />
  </div>
);
```

#### C. CurrentTaskContextPanel.tsx 设计

```typescript
// src/components/bid-workspace/CurrentTaskContextPanel.tsx
import React from 'react';

interface Chapter {
  id: number;
  title: string;
  status: 'completed' | 'in-progress' | 'pending';
}

export const CurrentTaskContextPanel: React.FC<{ 
  currentStep: number;
}> = ({ currentStep }) => {
  // 假设为步骤 3（编制投标文件）
  const chapters: Chapter[] = [
    { id: 1, title: '第 1 章 项目概述', status: 'completed' },
    { id: 2, title: '第 2 章 需求分析', status: 'completed' },
    { id: 3, title: '第 3 章 总体设计方案', status: 'in-progress' },
    { id: 4, title: '第 4 章 功能模块设计', status: 'pending' },
    { id: 5, title: '第 5 章 技术架构设计', status: 'pending' },
    // ...更多章节
  ];

  return (
    <div className="grid grid-cols-2 gap-6 mt-8">
      {/* 左侧：章节导航树 */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h3 className="text-lg font-semibold mb-4">📑 章节导航</h3>
        <div className="space-y-2">
          {chapters.map((chapter) => (
            <div 
              key={chapter.id}
              className={`p-3 rounded border-l-4 cursor-pointer ${
                chapter.status === 'completed' ? 'border-green-500 bg-green-50' :
                chapter.status === 'in-progress' ? 'border-blue-500 bg-blue-50' :
                'border-gray-300 bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-3">
                {chapter.status === 'completed' && '✓'}
                {chapter.status === 'in-progress' && '●'}
                {chapter.status === 'pending' && '○'}
                <span className="text-sm">{chapter.title}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* 右侧：快速工具 */}
      <div className="bg-white p-6 rounded-lg border border-gray-200">
        <h3 className="text-lg font-semibold mb-4">⚡ 快速工具</h3>
        <div className="grid grid-cols-2 gap-4">
          <button className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 text-left">
            📚 引用素材库
          </button>
          <button className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 text-left">
            🎨 插入图表
          </button>
          <button className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 text-left">
            🤖 AI 写作助手
          </button>
          <button className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 text-left">
            💾 保存草稿
          </button>
        </div>
      </div>
    </div>
  );
};
```

### Phase 2.1 验收标准
- [ ] 用户可以直观看到整体进度百分比（5/11 章 = 45%）
- [ ] 点击任意步骤可以跳转（需测试跳转到不同步骤是否正常）
- [ ] 支持返回上一步修改（需测试回退后数据不丢失）
- [ ] 虚拟滚动长列表（超过 20 章时性能不受影响）
- [ ] 页面加载时间 < 1.5 秒

---

## 任务 2.2: 情报中心优化（4-5 天）⭐⭐

### A. IntelMetricDashboard.tsx 完整实现

```typescript
// src/components/intel-center/IntelMetricDashboard.tsx
import React from 'react';
import { TrendingUp, TrendingDown, ArrowUpRight } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: number | string;
  trend?: {
    value: number;
    isPositive: boolean; // true 表示上升/好转，false 表示下降/恶化
    unit?: string;
  };
  secondaryInfo?: string;
  actionLabel: string;
  actionRoute: string;
  variant?: 'primary' | 'warning' | 'danger' | 'neutral';
}

export const IntelMetricDashboard: React.FC = () => {
  const metrics: MetricCardProps[] = [
    {
      title: '本周待确认',
      value: '29 条',
      trend: {
        value: 15,
        isPositive: false, // 数量减少是好事
        unit: '% 较上周'
      },
      actionLabel: '查看详情',
      actionRoute: '/intel-center?filter=pending'
    },
    {
      title: '本月已抓取总数',
      value: '980 条',
      trend: {
        value: 15,
        isPositive: true,
        unit: '% 同比'
      },
      secondaryInfo: '增长趋势良好',
      actionLabel: '历史趋势',
      actionRoute: '/intel-center/stats'
    },
    {
      title: '本月新增',
      value: '40 条',
      secondaryInfo: '昨日新增 7 条',
      actionLabel: '分源统计',
      actionRoute: '/intel-center/source-stats'
    },
    {
      title: '已转报团队',
      value: '0 条',
      secondaryInfo: '本周 3 条',
      actionLabel: '进入转报中心',
      actionRoute: '/intel-center/transfer'
    }
  ];

  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {metrics.map((metric, index) => (
        <div 
          key={index}
          className={`bg-white p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer ${
            metric.variant === 'danger' ? 'border-l-4 border-red-500' :
            metric.variant === 'warning' ? 'border-l-4 border-yellow-500' :
            metric.variant === 'primary' ? 'border-l-4 border-blue-500' :
            'border-l-4 border-gray-500'
          }`}
        >
          <div className="text-sm text-gray-500 mb-2">{metric.title}</div>
          
          <div className="text-3xl font-bold text-gray-800 mb-2">{metric.value}</div>
          
          {metric.trend && (
            <div className="text-sm">
              <span className={metric.trend.isPositive ? 'text-green-600' : 'text-red-600'}>
                {metric.trend.isPositive ? <TrendingUp size={14} className="inline" /> : <TrendingDown size={14} className="inline" />}
                {' '}{Math.abs(metric.trend.value)}%
              </span>
              {metric.trend.unit && <span className="text-gray-500 ml-2">{metric.trend.unit}</span>}
            </div>
          )}
          
          {metric.secondaryInfo && (
            <div className="text-sm text-gray-500 mt-2">{metric.secondaryInfo}</div>
          )}
          
          <a 
            href={metric.actionRoute}
            className="inline-block mt-4 text-sm text-blue-600 hover:text-blue-800 flex items-center"
          >
            {metric.actionLabel} <ArrowUpRight size={14} className="ml-1" />
          </a>
        </div>
      ))}
    </div>
  );
};
```

### B. IntelListCard.tsx 双模式实现

```typescript
// src/components/intel-center/IntelListCard.tsx
import React, { useState } from 'react';
import { Copy, Share2, FileText, Bot } from 'lucide-react';

interface IntelItem {
  id: string;
  sourceType: 'policy' | 'media' | 'competitor' | 'bid';
  title: string;
  summary: string;
  hasAiSummary: boolean;
  tags: string[];
  source: string;
  publishTime: string;
}

export const IntelListCard: React.FC<{
  item: IntelItem;
  mode: 'standard' | 'compact';
  onAiSummarize?: () => void;
  onShare?: () => void;
}> = ({ item, mode, onAiSummarize, onShare }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (mode === 'compact') {
    return (
      <div className="bg-white p-4 border-b border-gray-200 hover:bg-gray-50 transition-colors">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">
                {getSourceTypeLabel(item.sourceType)}
              </span>
              {item.tags.slice(0, 2).map((tag, i) => (
                <span key={i} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded">
                  {tag}
                </span>
              ))}
            </div>
            
            <h4 className="text-sm font-medium text-gray-900 truncate">
              {item.title}
            </h4>
            
            <p className="text-xs text-gray-500 mt-1">
              {item.source} • {item.publishTime}
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {!item.hasAiSummary && (
              <button 
                onClick={onAiSummarize}
                className="p-1.5 hover:bg-gray-200 rounded"
                title="生成摘要"
              >
                <Bot size={16} />
              </button>
            )}
            <button 
              onClick={onShare}
              className="p-1.5 hover:bg-gray-200 rounded"
              title="分享"
            >
              <Share2 size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Standard mode
  return (
    <div className="bg-white p-6 border-b border-gray-200 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-3 py-1 text-sm bg-blue-100 text-blue-800 rounded font-medium">
            {getSourceTypeLabel(item.sourceType)}
          </span>
          {item.tags.map((tag, i) => (
            <span key={i} className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded">
              {tag}
            </span>
          ))}
        </div>
        
        <div className="flex items-center gap-2">
          {!item.hasAiSummary && (
            <button 
              onClick={onAiSummarize}
              className="px-3 py-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 text-sm flex items-center gap-1"
            >
              <Bot size={14} /> AI 摘要
            </button>
          )}
          <button 
            onClick={onShare}
            className="p-2 hover:bg-gray-100 rounded"
            title="分享"
          >
            <Share2 size={18} />
          </button>
        </div>
      </div>
      
      <h3 className="text-xl font-semibold text-blue-800 mb-2 line-clamp-2 hover:text-blue-600 cursor-pointer">
        {item.title}
      </h3>
      
      <p className={`text-gray-600 ${!isExpanded && item.summary.length > 200 ? 'line-clamp-3' : ''}`}>
        {item.summary}
      </p>
      
      {item.summary.length > 200 && (
        <button 
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm text-blue-600 hover:text-blue-800 mt-2"
        >
          {isExpanded ? '收起' : '展开全文'}
        </button>
      )}
      
      <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
        <div className="flex items-center gap-4">
          <span>{item.source}</span>
          <span>{item.publishTime}</span>
        </div>
      </div>
    </div>
  );
};

function getSourceTypeLabel(type: IntelItem['sourceType']): string {
  const labels = {
    policy: '政策法规',
    media: '媒体资讯',
    competitor: '竞品信息',
    bid: '中标公示'
  };
  return labels[type];
}
```

### Phase 2.2 验收标准
- [ ] 指标卡改为文字说明而非数字堆砌
- [ ] 支持标准/紧凑双模式切换
- [ ] AI 摘要按钮在右上角更显眼
- [ ] 标题超长时自动截断并 tooltip 显示全文
- [ ] 一屏显示从 3-4 条提升至 6-8 条（紧凑模式）

---

## 任务 2.3: 资质台账升级（5-6 天）⭐⭐

### A. CertAlertQueue.tsx 分级预警队列

```typescript
// src/components/qual-certs/CertAlertQueue.tsx
import React from 'react';
import { AlertTriangle, Bell, CheckCircle } from 'lucide-react';

interface AlertItem {
  id: string;
  certName: string;
  certType: string;
  expiryDate: string;
  daysUntilExpiry: number; // 负数表示已过期
  severity: 'critical' | 'high' | 'medium'; // critical=已过期或≤7 天，high=≤30 天，medium=≤90 天
  assignedTo?: string;
  status: 'pending' | 'in-progress' | 'resolved';
}

export const CertAlertQueue: React.FC<{ alerts: AlertItem[] }> = ({ alerts }) => {
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const highAlerts = alerts.filter(a => a.severity === 'high');
  const mediumAlerts = alerts.filter(a => a.severity === 'medium');

  const AlertCard: React.FC<{ alert: AlertItem; severityColor: string }> = ({ alert, severityColor }) => (
    <div className="bg-white p-4 rounded-lg border-l-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-1 text-xs font-medium rounded ${
              alert.severity === 'critical' ? 'bg-red-100 text-red-800' :
              alert.severity === 'high' ? 'bg-orange-100 text-orange-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {alert.severity === 'critical' ? '🔴 已过期/7 天内到期' :
               alert.severity === 'high' ? '🟠 30 天内到期' :
               '🟡 90 天内到期'}
            </span>
            <span className="text-sm text-gray-500">{alert.certType}</span>
          </div>
          
          <h4 className="font-semibold text-gray-800 mb-1">{alert.certName}</h4>
          
          <div className="text-sm text-gray-600 mb-2">
            有效期至：{alert.expiryDate}
            <span className="ml-2 text-red-600 font-medium">
              (仅剩{alert.daysUntilExpiry >= 0 ? alert.daysUntilExpiry : Math.abs(alert.daysUntilExpiry)}天)
            </span>
          </div>
          
          {alert.assignedTo && (
            <div className="text-sm text-gray-500">
              负责人：{alert.assignedTo}
            </div>
          )}
        </div>
        
        <div className="flex flex-col gap-2">
          <button className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
            处理
          </button>
          <button className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
            分配给他人
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {criticalAlerts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="text-red-600" size={20} />
            <h3 className="text-lg font-semibold text-gray-800">
              🔴 紧急 ({criticalAlerts.length}项)
            </h3>
          </div>
          <div className="grid gap-3">
            {criticalAlerts.map(alert => (
              <AlertCard key={alert.id} alert={alert} severityColor="#EF4444" />
            ))}
          </div>
        </div>
      )}
      
      {highAlerts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Bell className="text-orange-600" size={20} />
            <h3 className="text-lg font-semibold text-gray-800">
              🟠 优先 ({highAlerts.length}项)
            </h3>
          </div>
          <div className="grid gap-3">
            {highAlerts.map(alert => (
              <AlertCard key={alert.id} alert={alert} severityColor="#F59E0B" />
            ))}
          </div>
        </div>
      )}
      
      {mediumAlerts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="text-yellow-600" size={20} />
            <h3 className="text-lg font-semibold text-gray-800">
              🟡 关注 ({mediumAlerts.length}项)
            </h3>
          </div>
          <div className="grid gap-3">
            {mediumAlerts.map(alert => (
              <AlertCard key={alert.id} alert={alert} severityColor="#FCD34D" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
```

### B. CertBulkOperationsPanel.tsx 批量操作

```typescript
// src/components/qual-certs/CertBulkOperationsPanel.tsx
import React, { useState } from 'react';
import { CheckSquare, Square, Upload, Download, Trash2 } from 'lucide-react';

interface Certificate {
  id: string;
  name: string;
  isSelected?: boolean;
}

export const CertBulkOperationsPanel: React.FC<{ 
  certificates: Certificate[];
  onSelectAll?: (checked: boolean) => void;
  onDeleteSelected?: () => void;
}> = ({ certificates, onSelectAll, onDeleteSelected }) => {
  const [selectAll, setSelectAll] = useState(false);

  const selectedCount = certificates.filter(c => c.isSelected).length;

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-200 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setSelectAll(!selectAll)}
            className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded hover:bg-gray-200"
          >
            {selectAll ? <CheckSquare size={18} /> : <Square size={18} />}
            <span className="text-sm">{selectAll ? '取消全选' : '全选'}</span>
            {selectedCount > 0 && <span className="text-xs text-gray-500">({selectedCount}项)</span>}
          </button>
          
          {selectedCount > 0 && (
            <>
              <button className="px-3 py-1.5 bg-red-50 text-red-600 rounded hover:bg-red-100 text-sm flex items-center gap-1">
                <Trash2 size={14} /> 批量删除
              </button>
              <button className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 text-sm">
                批量导出
              </button>
              <button className="px-3 py-1.5 bg-green-50 text-green-600 rounded hover:bg-green-100 text-sm">
                批量延期待办
              </button>
            </>
          )}
        </div>
        
        <div className="flex gap-2">
          <button className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm flex items-center gap-1">
            <Download size={14} /> Excel 模板下载
          </button>
          <button className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm flex items-center gap-1">
            <Upload size={14} /> 上传导入
          </button>
        </div>
      </div>
    </div>
  );
};
```

### Phase 2.3 验收标准
- [ ] 所有即将过期的证书都在预警队列中可见
- [ ] 可以批量操作多条证书记录
- [ ] Excel 导入成功率 ≥ 95%
- [ ] 支持 OCR 识别扫描件（可选进阶功能）

---

## 任务 2.4: 小智助手功能完善（5-7 天）⭐

### A. AssistantSkillDirectory.tsx 技能目录

```typescript
// src/components/assistant/AssistantSkillDirectory.tsx
import React from 'react';
import { BookOpen, FileCheck, Shield, TrendingUp, DollarSign } from 'lucide-react';

interface SkillCategory {
  name: string;
  icon: React.ReactNode;
  skills: Array<{
    name: string;
    description: string;
    example: string;
    rating?: number;
  }>;
}

export const AssistantSkillDirectory: React.FC = () => {
  const categories: SkillCategory[] = [
    {
      name: '常用技能',
      icon: <BookOpen size={20} />,
      skills: [
        {
          name: '生成大纲',
          description: '根据招标文件自动生成标书大纲',
          example: '帮我生成一个针对三级甲等医院的智慧门诊方案大纲',
          rating: 4.8
        },
        {
          name: '检查偏离',
          description: '检查技术参数响应是否满足招标要求',
          example: '帮我检查这份技术标书的参数偏离情况',
          rating: 4.6
        },
        {
          name: '查询证书',
          description: '查询公司资质证书信息',
          example: '我们公司的 ISO9001 证书有效期到什么时候？',
          rating: 4.9
        }
      ]
    },
    {
      name: '高级技能',
      icon: <FileCheck size={20} />,
      skills: [
        {
          name: '倾向性参数识别',
          description: '识别招标文件中的倾向性/排他性参数',
          example: '帮我分析这个招标文件有哪些倾向性参数',
          rating: 4.7
        },
        {
          name: '毛利测算',
          description: '基于成本估算项目的毛利率',
          example: '这个项目报价 300 万，成本大概多少，毛利空间多大',
          rating: 4.5
        },
        {
          name: '风险预判',
          description: '预判投标过程中的潜在风险点',
          example: '这个标书有哪些潜在风险需要注意',
          rating: 4.6
        }
      ]
    }
  ];

  return (
    <div className="grid gap-6">
      {categories.map((category, catIndex) => (
        <div key={catIndex} className="bg-white p-6 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-blue-600">{category.icon}</span>
            <h3 className="text-lg font-semibold text-gray-800">{category.name}</h3>
          </div>
          
          <div className="grid gap-4">
            {category.skills.map((skill, skillIndex) => (
              <div 
                key={skillIndex}
                className="p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-gray-800">{skill.name}</h4>
                  {skill.rating && (
                    <span className="text-xs text-yellow-600">⭐ {skill.rating}</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mb-2">{skill.description}</p>
                <div className="text-xs text-gray-500 bg-white p-2 rounded border border-gray-200">
                  <strong>你可以这样问我：</strong><br />
                  "{skill.example}"
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
```

### Phase 2.4 验收标准
- [ ] 用户可以找到所有可用技能及示例
- [ ] 会话历史记录完整可检索
- [ ] 回答中包含来源标注
- [ ] 用户对答案的信任度提升（通过问卷调研）

---

## 🧪 测试策略

### 单元测试覆盖率要求
每个新组件必须包含：
- [ ] 基本渲染测试
- [ ] 交互功能测试（点击、输入等）
- [ ] Props 变化时的行为测试
- [ ] 边界条件测试

### E2E 测试场景
关键用户路径必须覆盖：
- [ ] 用户在首页能够找到当天的 3 个重点任务
- [ ] 用户在标书工作台能够清楚看到当前步骤和下一步操作
- [ ] 用户能够成功导入 Excel 格式的证书记录
- [ ] 用户能够通过 AI 助手成功查询资质证书信息

---

## 📊 度量指标（Phase 2 KPIs）

| 指标 | 基线值 | 目标值 | 测量方式 |
|------|--------|--------|----------|
| 标书生产效率 | 基准 | +30% | 用户任务完成时间 |
| 情报利用率 | 低 | +50% | 日均浏览条数 |
| 资质管理效率 | 手动 | +40% | 单张证书录入时间 |
| AI 助手使用频次 | 未知 | ×2 | 日均对话次数 |

---

## ✅ Phase 2 完成标志

1. ✅ 所有 P1 问题已修复
2. ✅ 通过 E2E 测试套件
3. ✅ 用户体验满意度 ≥ 4.0/5.0
4. ✅ 团队成员可以独立维护新代码
5. ✅ 文档齐全（包括 ADR）

---

## 🔄 后续建议

Phase 2 完成后，可以考虑进入：
- **Phase 3: 细节打磨**（2-3 周）- 视觉体系规范化、性能优化、无障碍访问
- **Phase 4: 新功能探索** - 根据用户反馈决定是否需要开发新功能

---

**报告结束**

请确认您准备开始执行哪个任务，我将提供详细的代码实施指南。
