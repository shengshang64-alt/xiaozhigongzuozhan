# 小智工作站 · UI/UX 升级 - GLM-5.3-Flash 速查卡

## 🚀 启动指令（直接复制此段给 AI）

```
任务：小智工作站 UI/UX 升级 Phase 1 止血期

目标：解决 P0 问题，降低首页信息密度至 50%

输入材料：
- 诊断报告：docs/UI-UX-Diagnosis-and-Optimization-Recommendations.md
- 交互原型：docs/redesign/UI-UX-Redesign-Prototypes.html

核心任务（按顺序执行）：
1. 重构工作台首页（NewKeyMetrics + PriorityTasksBoard + QuickActionButtons）
2. 清理全站军事化黑话（作战→导航，制胜→完成等）
3. 增加基础交互反馈（loading + 二次确认 + toast）

约束条件：
- 零破坏性重构
- 增量式发布
- 度量驱动验证

验收标准：
✅ 首页高度从 2958px 降至 1200px
✅ 用户能找到"当天最重要的 3 件事"
✅ 所有按钮有 hover/focus 效果
✅ 所有异步操作显示 loading
✅ 所有删除操作有二次确认
```

---

## 📦 交付物清单

### 代码层
- [ ] `src/components/home/NewKeyMetrics.tsx` ✅
- [ ] `src/components/home/PriorityTasksBoard.tsx` ✅
- [ ] `src/components/home/QuickActionButtons.tsx` ✅
- [ ] `src/components/home/CompactProgressPanel.tsx` ✅
- [ ] `src/pages/Home/index.tsx` (更新) ✅
- [ ] `scripts/check-prohibited-words.js` (新增) ✅
- [ ] `src/components/common/LoadingOverlay.tsx` ✅
- [ ] `src/components/common/ConfirmDialog.tsx` ✅

### 文档层
- [ ] 诊断报告完整 ✅
- [ ] 静态原型可运行 ✅
- [ ] 实施规范详细 ✅
- [ ] 术语规范表 ✅

### 测试层
- [ ] 单元测试覆盖率 ≥ 80% ✅
- [ ] E2E 测试脚本 ✅
- [ ] 性能基线对比 ✅

---

## ⚠️ 常见陷阱与规避

| 陷阱 | 表现 | 规避方案 |
|------|------|---------|
| 过度设计 | 试图一次性重构整个导航体系 | 每次只改一个组件，小步快跑 |
| 忽略兼容 | 删除旧组件导致其他功能失效 | 保留旧组件注释，逐步移除 |
| 没有度量 | 改了但不知道有没有效果 | 为每个改动设定 KPI |
| 缺少测试 | 上线后 bug 频发 | 先写测试再写代码 |

---

## 💡 快速决策树

**Q: 首页改造是否要保留原 WelcomeBanner？**  
A: ❌ 不要，完全替换为新欢迎横幅

**Q: 左侧菜单要不要扁平化？**  
A: ⏸️ Phase 1 暂不，Phase 2 再处理

**Q: 是否需要引入新的 UI 组件库？**  
A: ❌ 只用 Tailwind + Radix UI（已安装）

**Q: TypeScript 类型是否要全面增强？**  
A: ✅ 是，为每个新组件添加完整 type definition

**Q: 是否可以批量替换禁用词？**  
A: ✅ 是，使用全局搜索替换工具，但要人工复核

---

## 🎯 成功判断标准

Phase 1 成功的 5 个指标：
1. **首页滚动高度 ≤ 1200px**（原 2958px）
2. **用户找到首要任务时间 < 30 秒**
3. **新用户困惑度下降 50%**（问卷评分）
4. **误操作事件减少 70%**（删除确认覆盖）
5. **团队维护成本降低 40%**（代码可读性提升）

---

## 🔧 工具准备检查清单

在执行前确认：
- [ ] VSCode 已安装 ESLint + Prettier
- [ ] Tailwind IntelliSense 插件已激活
- [ ] Chrome DevTools Lighthouse 可用
- [ ] Storybook（如有）可以查看组件状态
- [ ] Git 分支命名规范：`feature/ui-phase1-homepage`

---

## 📞 遇到问题的求助路径

1. **UI 样式问题** → 查阅 Tailwind docs + 原项目现有组件
2. **TypeScript 错误** → 检查 type definition 是否完整
3. **组件通信问题** → 参考 `src/components/home/` 内已有模式
4. **性能问题** → 使用 React DevTools Profiler 分析
5. **架构决策疑问** → 回看诊断报告 §四 整体架构问题

---

**祝执行顺利！** 🎉
