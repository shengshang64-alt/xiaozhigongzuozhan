# R272 · BidCheck 问题定位跳转表格内段落失效修复

## 选题依据
巡检 BidCheck/ReadingView 三栏交互逻辑发现：右栏问题条目列表点击触发 `locatePara(h.paragraphIndex, key)`，
通过 `paraEls.current.get(pi).scrollIntoView()` 定位中栏对应段落。但：
- 表格段落在 `BlockRow` 中仅当 `expandedTables.has(ti)` 时才渲染 `<li>` 子项；
- 且 `<li>` **从未注册 paraEls ref**——只有外层非表格 div 段落才走 `p.paraEls.current.set(b.pi, el)`；
- 因此凡命中位于表格内的段落，`paraEls.get(pi)` 返回 undefined → `scrollIntoView` 静默失败。

用户表现：标书含评分表/参数表等表格区域，若表格行文字命中禁则（如彩色文字、半角标点），
右栏点击该问题无反应（不滚动、不高亮），用户无法定位需整改位置。
这是 R262 三栏阅读视图上线以来一直存在的交互断链，影响所有包含表格段落命中的标书检查结果。

## 修复
### 1. locatePara 自动展开所在表格
```typescript
const para = paras[pi]
if (para?.inTable) {
  const ti = para.tableIndex ?? 0
  if (!expandedTables.has(ti)) {
    setExpandedTables(prev => { const n = new Set(prev); n.add(ti); return n })
    // 双 requestAnimationFrame 等 React commit 新 DOM
    requestAnimationFrame(() => requestAnimationFrame(doScroll))
    return
  }
}
```
- 命中段落在折叠表格中 → 自动展开 → 双帧 rAF 等 React 渲染新 li → 滚动定位。
- 已在展开表格中 → 正常走 doScroll（前提 li 有 ref，见 patch 2）。

### 2. BlockRow 表格展开 li 注册 paraEls ref + 问题段落视觉标记
```tsx
<li
  ref={(el) => { if (el) p.paraEls.current.set(c.index, el); else p.paraEls.current.delete(c.index) }}
  className={cn(
    "truncate scroll-mt-24",
    p.paraMarkers.has(c.index) && "bg-red-50 text-foreground",
    p.flashPara === c.index && "ring-2 ring-primary ring-offset-1 animate-pulse",
  )}
>
```
- 每个表格子段 li 注册 paraEls，使 locatePara 可取到 DOM 引用。
- 问题段落加红底 `bg-red-50` 与正文段落行为对齐（视觉一致性）。
- flash 高亮动画 `ring-2 ring-primary animate-pulse` 同样支持。

## 变更文件
- `src/pages/BidCheck/ReadingView.tsx`：locatePara 扩展 + 表格 li ref 注册（2 对 replace）。

## 验证
- git status：ReadingView.tsx 为 `??`（untracked, R261+ 新文件），无在途 diff。
- 四门全绿：
  - `npx tsc -b`：exit 0。
  - `npx vitest run`：174 files 1955 passed + 2 skipped（R271 基线 174/1955+2 零回归；本轮修改位于组件渲染/交互层，jsdom 不执行 scrollIntoView 故不新增单测）。
  - `npx eslint src/pages/BidCheck/ReadingView.tsx`：exit 0。
  - `npx vite build`：成功。
- 零 collection schema / 零 pb_hooks / 零提示词 / 未 commit。

## 附带：核验即关 ui-redesign-phase3
两条 `ui-redesign-phase3` backlog 项（P2 + P3）所有子项均已标 ✓：
- P2 条目："3-1 驾驶舱✓ 3-2 情报✓(核验即关) 3-3 作战室✓ 3-4 方案三栏✓ 3-5 知识库✓"
- P3 条目："3-1✓ 3-2✓(核验即关) 3-3✓ 3-4✓(核验即关) 3-5✓(核验即关)"
剩余仅为"整体视觉密度按自然迭代逐步收敛"——不属任何具体可闭合任务，
且 R271 已落地窄屏响应式收敛，后续新增页面按设计系统实现即可。
本轮一并核验关闭。

## 维持裁定不动
- 编造嫌疑未清零禁止导出：只报不拦。
- lint-debt-01 有意保留残余不重构。
