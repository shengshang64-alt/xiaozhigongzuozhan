# B6 · PPT 与报价 5 屏 + 素材库 4 屏

> 批次：B6 / 10　预计轮次：2
> 前置：B0、B1
> 风险：中（`usePptQuote.ts` 141KB 是全站第二大 hook，但拆屏是纯视图重组）
> 粘贴顺序：CONTRACT.md → 本文件 → CHECKLIST.md

---

## 一、这一批要交付什么

### PPT 与报价（5 屏）—— **两条业务必须解耦**

| 屏 | 目标路由 | 原型文件 | 属于 |
|---|---|---|---|
| 汇报 PPT 列表 | `/ppt-quote` | `ppt/list.html` | PPT 线 |
| PPT 编辑器 | `/ppt-quote/editor` | `ppt/editor.html` | PPT 线 |
| 报价清单 | `/ppt-quote/quote-list` | `ppt/quote-list.html` | 报价线 |
| 报价编辑 | `/ppt-quote/quote-editor` | `ppt/quote-editor.html` | 报价线 |
| 报价单预览 | `/ppt-quote/quote-preview` | `ppt/quote-preview.html` | 报价线 |

### 素材库（4 屏）

| 屏 | 目标路由 | 原型文件 |
|---|---|---|
| 素材总览 | `/materials` | `material/list.html` |
| 导入 | `/materials/import` | `material/import.html` |
| 联网抓取 | `/materials/web` | `material/web.html` |
| 库设置 | `/materials/settings` | `material/settings.html` |

---

## 二、写域

```
✅ src/lib/routeRegistry.ts
✅ src/pages/PptQuote/index.tsx                改为渲染「汇报 PPT」屏
✅ src/pages/PptQuote/ppt-list/**
✅ src/pages/PptQuote/ppt-editor/**
✅ src/pages/PptQuote/quote-list/**
✅ src/pages/PptQuote/quote-editor/**
✅ src/pages/PptQuote/quote-preview/**
✅ src/pages/MaterialLibrary/index.tsx          改为渲染「素材总览」屏
✅ src/pages/MaterialLibrary/list|import|web|settings/**
✅ src/components/ppt-quote/**、src/components/material*/**   按需
✅ 相关测试

❌ usePptQuote.ts（141KB）数据层
❌ useMaterialLibrary.ts（21KB）数据层
❌ 其它模块
```

---

## 三、核心设计决策：PPT 与报价必须解耦

原页面的两个硬伤：

1. **数据与上下文错位**：报价清单的统计卡（总金额 0.00）在「汇报 PPT」Tab 下依然显示
2. **标题不随 Tab 变化**：在「报价清单」Tab 里，页面标题仍是「医疗售前汇报 PPT 生产线」

**拆屏后必须做到**：
- `ppt/*` 只说「汇报 PPT」「页」「模板」「讲标」
- `quote*` 只说「报价清单」「明细」「折扣」「税」「有效期」
- **两条线的统计、术语、主 CTA 完全不混用**

---

## 四、PPT 线 2 屏

### 4.1 汇报 PPT 列表（`/ppt-quote`）

| # | 改造 |
|---|---|
| 1 | `DataBar`：全部 PPT 4 · 生成中 1 · 待排版 2 · 已导出 1 |
| 2 | 卡片网格 g3，每卡：封面缩略（**用 CSS 渐变块表示，不许外链图片**）+ 标题 + 关联项目 + 页数/主题 + 状态 + 操作 |
| 3 | 卡片操作：打开编辑器（主）+ 复制 + 导出 pptx + `⋯` |
| 4 | 右上角「模板」小卡：3 个内置模板（医疗科技蓝 / 简约白 / 政务规范） |
| 5 | 空态演示放折叠区「草稿箱（0）」 |

### 4.2 PPT 编辑器（`/ppt-quote/editor`）

**必须一屏装下**（原型 1100px，不许滚动找右栏）：

| 栏 | 宽 | 内容 |
|---|---|---|
| 左 | 200 | 12 页缩略序（当前第 4 页高亮） |
| 中 | 1fr | 16:9 画布（标题 + 3 个层次块 + 底部注释） |
| 右 | 320 | 版式选择（6 个小方块）/ 主题色 4 选 / 字体 / 图片素材 / 备注 |

底部条：页数 4/12 · 一致性检查「3 处标题字号不一致」· 导出 pptx（主 CTA）

⚠️ **画布是静态示意**，不许真做富文本编辑器。这一批只做布局。

---

## 五、报价线 3 屏

### 5.1 报价清单（`/ppt-quote/quote-list`）

| # | 改造 |
|---|---|
| 1 | `DataBar`：清单 6 · 报价总额 1,286.4 万 · 平均折扣 92% · 30 天内到期 2（橙） |
| 2 | 表格：报价单号 / 客户 / 项目 / 金额 / 折扣 / 有效期 / 状态 / 操作 |
| 3 | 状态四档：草稿 / 已发出 / 已确认 / 已过期 |
| 4 | 顶部：新建报价（主）+ 从产品库导入 + 复制上次报价 |
| 5 | 右侧「价税与规则」`spec-card`：税率 13% / 最低折扣 85% / 超 100 万需二级审批 |

### 5.2 报价编辑（`/ppt-quote/quote-editor`）

左 1fr：明细表（8 行：序号/产品/型号/数量/单位/单价/折扣/小计）+「＋ 添加行」
右 380：金额汇总（设备/软件/实施/服务/税=合计）+ 折扣滑杆 + **毛利提示**（"当前毛利率 21.4%，低于建议 25%" `alert--warning`）+ 价格建议 3 条

**折扣超限必须弹确认**：折扣 < 85% 时触发，弹窗写清「低于公司底线，需二级审批」。

现有实现：`quoteDiscount.ts` / `quoteRecommend.ts` / `quoteTotalCapital.ts`。**复用。**

### 5.3 报价单预览（`/ppt-quote/quote-preview`）

左 1fr：A4 版式预览（抬头/致客户/表格 8 行/合计大小写/有效期/签名盖章位）
右 340：导出设置（Excel/PDF/Word）+ 用印信息 + 发送记录 3 条

顶部 `alert--success`：「该报价单已通过审批（二级审批 · 张经理 · 2026-11-06）」
主 CTA：「导出 PDF 并生成发送邮件」

---

## 六、素材库 4 屏

### 6.1 素材总览（`/materials`）

| # | 改造 | 原状态 | 目标 |
|---|---|---|---|
| 1 | **Tab 收敛** | 4 个 Tab（素材总览/联网抓取/本地导入/库设置） | 单视图 + 右上两个动作按钮 |
| 2 | **回收站弱化** | 「回收站 4」与「素材 0」并列，视觉怪异 | 回收站为 0 时隐藏；非 0 时灰化 |
| 3 | **使用排行** | 无 | 右侧「被 PPT 引用 Top5」，让素材价值可见 |
| 4 | **空态引导** | 空态提到两个路径但不可点 | 两个实体按钮卡片（📁 本地导入 / 🌐 联网抓取） |

**布局**：左 240 分类树 / 右素材网格（4 列）。

### 6.2 导入（`/materials/import`）

3 步：① 选择文件 → ② 分类与去重 → ③ 完成
自动分类结果表（含 2 个 MD5 重复 / 2 个未识别需手动分类）
底部影响范围：「将新增 6 个，跳过 2 个重复，占用 18.4MB」+ 执行导入（主 CTA）

### 6.3 联网抓取（`/materials/web`）

关键词输入 + 来源多选（Pexels / Unsplash / 内部图库）+ **版权提示 `alert--warning`**
结果网格 6 张（缩略 + 来源 + 授权标识 + 勾选）
右侧：抓取记录 3 条 + 配额（本月 42/200）

### 6.4 库设置（`/materials/settings`）

三卡片：① 分类体系（12 个可增删）② 存储占用（bar：图片 1.2GB / 总 2.0GB / 磁盘剩余 78GB）③ 回收站（4 个，30 天自动清除）

**「清空回收站」必须**：`variant="destructive"` + 二次确认 + `.danger-box` 说明不可恢复。

---

## 七、共用要求

### 7.1 三态齐全（每屏）
### 7.2 一屏一主 CTA
### 7.3 危险操作
- 清空回收站
- 折扣超限
- 删除 PPT / 报价单

### 7.4 技术约束

1. **`pptxgenjs` / `xlsx` 必须保持动态 import**（守卫测试 `onDemandHeavyLibs.test.ts`）
2. **不许引图片外链**（原型里的缩略图是 CSS 渐变块）
3. **`usePptQuote.ts` 不动**（141KB）

---

## 八、完成标准

- [ ] 9 条路由可访问
- [ ] PPT 线与报价线的标题/统计/术语完全不混用
- [ ] PPT 编辑器一屏装下三栏（≤1100px，截图证明）
- [ ] 报价编辑的折扣超限弹窗可用
- [ ] 素材库回收站为 0 时隐藏
- [ ] 清空回收站有 destructive + 二次确认
- [ ] 每屏 1 个主 CTA
- [ ] 页面文件 ≤ 400 行
- [ ] `pptxgenjs` / `xlsx` 仍动态 import（守卫测试绿）
- [ ] 四门全过

---

## 九、这一批故意不做的事

- ❌ 不做真 PPT 富文本编辑器（只做布局）
- ❌ 不改 `usePptQuote.ts` 数据层
- ❌ 不改导出逻辑（`deckExports.ts` / `quoteExports.ts`）
- ❌ 不引任何图片资源
- ❌ 不做移动端
