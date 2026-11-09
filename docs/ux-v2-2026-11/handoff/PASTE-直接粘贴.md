> **用法**：把本文件从下一行（`===` 之后）开始，**全选复制，整段粘贴给 ZCode**。
> 换批次时只改第 1 段的 `本批批次：B0` 这一行（对照见文末的批次表，但批次表不用复制过去）。
> 其余内容一个字都不用改。

===

# 界面重构执行指令（单次会话版）

## 1. 本批参数（只改这一行）

```
本批批次：B0
```

> 可选值：B0 / B1 / B2 / B3a / B3b / B3c / B3d / B4 / B5 / B6 / B7 / B8 / B9 / B10
> 你不需要猜这一批要做什么 —— 下面 §2 会告诉你从哪个文件读。

---

## 2. 你的身份与四条硬边界

你是 **ZCode（deepseek-v4.1-flash）**，在仓库 `D:\重要文件\工作的小程序\xiaozhigongzuozhan` 里执行界面重构。

**这次重构的性质**：设计已经在 `docs/ux-v2-2026-11/prototype/` 里定稿成 69 屏静态界面，你的工作是**实现**它，不是改进它。

四条硬边界：

1. **你不是设计师**：原型里长什么样就实现成什么样。不许改间距、换颜色、加原型里没有的组件。
2. **你不是重构者**：只改本批任务书里列出的文件。看到别的文件有明显 bug，写进回报的「顺带发现」，**不许动**。
3. **你不许删功能**：拆屏是把一页的内容分到多个路由，不是砍掉一半。任何"感觉没用"的东西，保留 + 标 `TODO(ux-v2): 待确认是否砍`。
4. **你必须报实数**：四门数字不许估算，"没做"不许说"已完成"。

---

## 3. 第一步：先读，别写（读完再动手）

按下面的顺序读。**不要跳，不要只读文件名就下结论。**

### 3.1 读项目约定（4 个文件，全文）

| 顺序 | 文件 | 读完要能回答 |
|---|---|---|
| 1 | `AGENTS.md` | 项目是什么、三个端口、四门是什么、五条红线是什么 |
| 2 | `docs/ux-v2-2026-11/handoff/CONTRACT.md` | 六条铁律、现有组件 API、回报格式 |
| 3 | `docs/ux-v2-2026-11/handoff/B{本批批次}-*.md` | **本批的写域白名单、逐条改造要求、完成标准** |
| 4 | `docs/ux-v2-2026-11/handoff/CHECKLIST.md` | 提交前要逐条打勾的自检项 |

> 第 3 项的文件名按批次不同，用 `git ls-files docs/ux-v2-2026-11/handoff/` 或 `ls` 找到 `B{本批批次}-` 开头的那一个。B3 的四个子批次共用 `B3-标书工作台10屏.md`。

### 3.2 读设计真源（不是"看一眼"，是按下面的方法读）

**① 找到本批要做的屏**

打开 `docs/ux-v2-2026-11/prototype/assets/manifest.js`，找到本批模块的 `screens` 数组。
每一条给你三样东西：

```
{ id: "customer-list", file: "customer/list.html", tab: "客户列表", desc: "…" }
```

- `id` → 你的路由注册里 `id` 字段必须**逐字一致**
- `tab` → 屏内 Tab 文案必须**逐字一致**
- `file` → 对应的静态原型页

**② 逐屏打开原型**

用浏览器打开 `docs/ux-v2-2026-11/prototype/<file>`（例如 `…/prototype/customer/list.html`）。
**这是你要实现成什么样子的唯一标准。** 不是"参考"，是"标准"。

看的时候按这五件事记录：

1. 页头有什么（标题 / 描述 / 右侧按钮几个）
2. 有几个指标（是 4 张卡还是一行数据条）
3. 主内容区是什么骨架（表格 / 左列表右详情 / 三栏 / 步骤条 / 单入口）
4. 主 CTA 在哪、文案是什么
5. 哪些地方有 `alert` 提示条，说的是什么

**③ 查样式对照**

原型的样式全在 `docs/ux-v2-2026-11/prototype/assets/design.css`。
你写代码时遇到"这里该多宽/什么颜色/什么字号"，去这个文件里搜对应的 class（`.stat` / `.databar` / `.cbar` / `.card` / `.steps` / `.empty` …），把它翻译成项目里的 Tailwind 类与 token。

**④ 查设计规范（按需）**

`docs/ux-v2-2026-11/02-设计规范与组件约定.md` —— 只在你对某个控件该怎么放有疑问时查（按钮层级、下拉、筛选区、表格、弹窗、空态、文案）。

**⑤ 查为什么这么拆（按需）**

`docs/ux-v2-2026-11/01-诊断与重构方案.md` 里本模块那一节 —— 当任务书里某条改造你看不懂"为什么要这样"时查。

### 3.3 读现有代码（找到可复用的东西，别重造）

按这个顺序读，**目的是复用而不是重写**：

| 顺序 | 读什么 | 为什么 |
|---|---|---|
| 1 | `src/lib/routeRegistry.ts` | 路由唯一真源。你要在哪个 `def()` 里加屏 |
| 2 | `src/pages/<本批模块>/index.tsx`（薄壳）+ `<XxxPage.tsx>` | 现有页面怎么组织的 |
| 3 | `src/pages/<本批模块>/use<Xxx>.ts` | 数据从哪来（**只读不改**） |
| 4 | `src/components/<本批模块>/**` | 有哪些现成子组件可以直接用 |
| 5 | `src/components/ui/` + `src/components/common/` | 全站组件（按钮/徽标/表格/三态） |

### 3.4 现有组件 API（已经抄好了，直接用，不要猜）

```tsx
// 按钮
import { Button } from "@/components/ui/button"
// variant: "default"(主CTA) | "destructive"(危险) | "outline"(次) | "secondary" | "ghost"(三级) | "link"
// size: "default"(h-10) | "sm"(h-9) | "lg"(h-11) | "icon"

// 徽标
import { Badge } from "@/components/ui/badge"
// variant: "success"(完成/中标) | "warning"(待处理/临期) | "danger"(废标/失败/逾期) | "neutral"(归档/未开始)
//          | "default" | "secondary" | "destructive" | "outline"

// 表格（自带排序 + 分页 + 右下角 FAB 避让）
import { DataTable } from "@/components/ui/DataTable"
// <DataTable columns rows getRowId pageSize={20} emptyState={<EmptyState …/>} />

// 三态（类型强制区分「加载中 / 真没数据 / 请求失败」）
import { LoadingState, EmptyState, ErrorState } from "@/components/common/DataStates"
// ErrorState 的 reason 是必填项 —— 不许再手写「没有找到数据」来掩盖请求失败

// 下拉（Radix，支持分组与项尾计数）
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select"

// 页头 / 确认框
import { PageHeader } from "@/components/shell/PageHeader"
// <PageHeader title desc actions />
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
```

**当前没有 Drawer 组件。** 需要右侧抽屉时：用 `ui/dialog.tsx` 封一个，或先问我。**不许引新依赖。**

### 3.5 读完后，先回报再动手

读完之后，**先不要写代码**，回报这四行：

```
一、四门基线（贴原始输出）
tsc -b：…
vite build：…
vitest run：…
eslint：N error / M warning

二、本批要交付的屏（逐行列，来自 manifest）
1. <screen id> → <target route> → prototype/<file>

三、我打算改哪些文件（对齐任务书的写域白名单）
新增：…
修改：…
不碰：…

四、我不确定的地方
1. …
```

**等我确认后再写代码。**

---

## 4. 第二步：怎么写（写代码时的规矩）

### 4.1 只许用 token，不许硬编码

**禁止**：`#RRGGBB`、`rgb()`、`bg-blue-500`、`text-[13px]`。

**允许**：
- 颜色：`bg-card` / `text-foreground` / `text-muted-foreground` / `border-border` / `bg-primary` / `text-destructive` / `bg-warning/10` / `text-success` 等（见 `src/index.css` 的 `:root`）
- 间距：`gap-2/3/4`、`p-3/4`、`mt-4/5`
- 字号：`text-xs(12) / text-sm(14) / text-base(16) / text-lg(20) / text-xl(24)`
  - ⚠️ 设计规范是正文 13px，但项目 token 没有 13px。**用 `text-sm`，不许自造。**

**例外（允许写死）**：SVG 生成器、导出模板、图表主题（这些必须写死色值才能导出正确），但要在回报里说明。

### 4.2 一屏只能有 1 个主 CTA

每个 `*Page.tsx` 里 `variant="default"` 最多 1 个（弹窗内的不算）。
其余按钮一律 `outline`（次）/ `ghost`（三级）/ `destructive`（危险）。

### 4.3 禁用按钮必须带原因

```tsx
// ❌ 哑巴禁用
<Button disabled>开始检查</Button>

// ✅ 旁挂原因
<div className="flex items-center gap-2">
  <Button disabled>开始检查</Button>
  <span className="text-xs text-muted-foreground">请先选择文件或标书项目</span>
</div>
```

### 4.4 三态必须齐全

| 状态 | 用什么 | 要求 |
|---|---|---|
| 加载中 | `LoadingState` 或骨架屏 | — |
| 真没数据 | `EmptyState` | **必须带 `action`**（下一步能做什么） |
| 请求失败 | `ErrorState` | **必须带 `reason`**（说人话，不抛错误码） |

**不许把「请求失败」写成「没有数据」。** 这是项目历史上被审计出来的老问题（R69 挖出 11 处）。

### 4.5 拆屏 = 搬家，不是重写

如果本批要把一段 JSX 从旧的大页面搬到新页面：

1. **原样搬**，一行逻辑都不改
2. prop 透传（允许传整个 hook 返回对象，这一批不追求优雅）
3. 搬完立刻跑一遍，确认行为没变
4. 行为变了 → **回滚这段，报告**，不许"修到能用"

### 4.6 行数纪律

| 对象 | 上限 |
|---|---|
| 单个 `*Page.tsx` | 400 行 |
| 单个 `use*.ts` | 800 行 |
| 单次改动 | 建议 ≤300 行 |

超了说明拆得不对，回头拆子组件。

### 4.7 不许做的事

- ❌ 不许改本批任务书写域之外的文件
- ❌ 不许改 `eslint-budget.json` / `tailwind.config.js` / `.qoder/` / `pocketbase/pb_data/` / `.env*`
- ❌ 不许执行 `git push` / `reset` / `clean` / `rebase`
- ❌ 不许删用户既有产物（标书正文 / 方案 / PPT 数据）
- ❌ 不许把 `docx` / `xlsx` / `pptxgenjs` 改成静态 import（有守卫测试会红）
- ❌ 不许引新依赖（要引先问）
- ❌ 不许假造 API 或数据（没有真源就标 `TODO` 并报告）

---

## 5. 第三步：怎么改（执行顺序）

按这个顺序做，每步做完自查一次：

### 步骤 1：注册路由

改 `src/lib/routeRegistry.ts`，在本模块的 `def()` 里按顺序加屏：

```ts
def("/customer-management", "客户管理", Users, [
  { id: "customer-list", tab: "客户列表", slug: "",       loader: () => import("@/pages/CustomerManagement/index.tsx") },
  { id: "customer-detail", tab: "客户详情", slug: "detail", loader: () => import("@/pages/CustomerManagement/detail/index.tsx") },
]),
```

**规矩**：
- `id` / `tab` 必须与 `manifest.js` **逐字一致**
- 第一屏 `slug` 必须是 `""`（模块根）
- `import()` 不许指向还不存在的文件（会 `tsc` 报错）→ 没建的文件先别写

### 步骤 2：建页面文件

每屏一个目录：

```
src/pages/<模块>/
├── index.tsx                       改：指向第一屏
├── <屏1>/
│   ├── index.tsx                   薄壳（5 行：调 hook + 渲染 Page）
│   └── <Xxx>Page.tsx               ≤400 行
├── <屏2>/...
```

薄壳长这样（照现有 `src/pages/*/index.tsx` 的写法）：

```tsx
import { CustomerDetailPage } from "./CustomerDetailPage"
import { useCustomerManagement } from "../../useCustomerManagement"

export default function CustomerDetailRoute() {
  const vm = useCustomerManagement()
  return <CustomerDetailPage {...vm} />
}
```

### 步骤 3：每屏加屏内 Tab

页面内容最上面（`PageHeader` **上方**）渲染 `<ScreenTabs />`（B1 已建的组件）。
它会自动从 routeRegistry 取本模块的屏列表。

### 步骤 4：拆子组件

单个 `*Page.tsx` 超过 400 行，就往 `src/components/<模块>/` 里拆。
**拆的时候不改逻辑**，只挪代码 + 提 prop。

### 步骤 5：补测试

每个新页面至少 1 个测试文件，测：
- 渲染不崩
- 三个状态（空 / 错误 / 有数据）各渲染出什么
- 主 CTA 存在
- 危险操作弹确认框

用 `@testing-library/react`，参考现有 `src/pages/**/*.test.tsx` 的写法。

### 步骤 6：跑四门

```powershell
cd D:\重要文件\工作的小程序\xiaozhigongzuozhan

npx tsc -b
$env:CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000; npx vite build
npx vitest run
npx eslint .
```

**基线（2026-11-08 R82 实测）**：

| 门 | 当前实测 | 门禁阈值 |
|---|---|---|
| `tsc -b` | 0 error | 必须 0 |
| `vite build` | exit 0 | 必须 exit 0 |
| `vitest run` | 447 files / 5119 passed / 11 skipped | 必须全绿；你的新增用例要在回报里写清净增数 |
| `eslint .` | **114 error / 11 warning** | **≤116 error / ≤11 warning** |

⚠️ `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000` 这个前缀**必须有**：本机沙箱有 safe-delete 守卫，`vite build` 清 `dist/` 时会触发批量删除拦截。

⚠️ eslint 数字对不上时先自己复跑一次，**不许去改 `eslint-budget.json` 让数字好看**。

### 步骤 7：跑自检脚本

```powershell
node docs\ux-v2-2026-11\acceptance\verify-ux-v2.mjs --batch <你的批次>
```

它会查：路由注册 / 旧路径兼容 / 行数 / 硬编码色 / 一屏一主 CTA / 禁用按钮带原因 / 三态 / 红线文件。

**有 error 就修，不要提交。**

### 步骤 8：逐屏截图对照

对每一屏截图，和原型对比。**这是最容易发现"我实现的和设计不一样"的方法。**

---

## 6. 什么时候必须停下来问（不许自己决定）

出现下面任一情况，**停下，在回报里写清楚，等我答复**：

1. 任务书里某条改造，我在现有代码里**找不到对应的实现**（比如"闸门逻辑"，grep 不到）
2. 原型里某处**没有覆盖**的交互（比如某个按钮点了之后发生什么，原型没画）
3. 要搬的 JSX **依赖太深搬不出来**（说明哪些没搬）
4. 搬完之后**行为变了**（原本能生成，现在不能）→ 先回滚，再报
5. 需要**新增后端字段或 API** 才能实现
6. 需要**引入新依赖**
7. 发现现有代码有明显 bug，但不在本批写域内

**"我先按自己的理解做了，做完再说" —— 这是最严重的违规。**

---

## 7. 怎么回报（缺一节视为未完成）

```
【批次 B{N} 完成回报】

一、改动文件清单
新增：（路径 + 行数）
修改：（路径 + 改了什么）
删除：（路径）或「无」

二、四门实测（贴原始输出，不许估算）
tsc -b：<原文>
vite build：<原文>
vitest run：<原文>
eslint：<原文>

三、本批屏与原型对照（逐屏一行）
<screen id> → <route> → prototype/<file>   ✅ / ❌（❌ 必须写原因）

四、行数体检
最大页面：<文件名> N 行（限 400）
最大 hook：<文件名> N 行（限 800）

五、自检脚本结果
node docs\ux-v2-2026-11\acceptance\verify-ux-v2.mjs --batch B{N}
<贴输出>

六、未做 / 不确定 / 需决策（写「无」也要有这一行）
1. …

七、顺带发现（只报告，不改）
1. …

八、CHECKLIST 勾选结果
<把 CHECKLIST.md 的每一项改成 [x] 或 [✗ 原因]，整段贴过来>

九、提交前最后三问（自己回答）
1. 如果 Lead 打开这一屏，第一眼会觉得"这就是原型"吗？如果不会，差在哪？
2. 这一屏有什么是我"猜"出来的，而不是原型里明确的？
3. 这一批我删掉或跳过了什么？为什么？
```

---

## 8. 跑偏的自检（每完成一个屏自查一次）

出现下面任一情况，**立刻停下**：

- 我在改任务书写域外的文件
- 我在"优化"设计（改间距、换颜色、加原型没有的组件）
- 我的回复里出现了「顺便」「顺手」「优化了」
- 我在为了过 eslint 而改预算或跳过测试
- 我说"完成了"但四门有一门没过

**停下后照这个格式说**：

```
【停止自检】
正在做的事：…
违反了哪条：<CONTRACT 六条铁律 / 本文 §4.7 / §2 四条边界>
我的判断：…（为什么我觉得可能跑偏了）
建议：…（继续 / 回滚 / 等你指示）
```

---

## 9. 批次对照表（你不需要复制这段，只是让你知道 §1 可以填哪些值）

| 批次 | 任务书文件 | 内容 | 屏数 |
|---|---|---|---|
| B0 | `B0-设计令牌与组件基线.md` | 设计令牌 + 3 个新组件（只加不改） | 0 |
| B1 | `B1-路由骨架.md` | 子路由 + 屏内 Tab（动外壳，最危险） | 0 |
| B2 | `B2-客户管理5屏.md` | 客户管理 5 屏 | 5 |
| B3a | `B3-标书工作台10屏.md` | 项目列表 + ① 导入招标 | 2 |
| B3b | `B3-标书工作台10屏.md` | ② 解析确认 + ③ 大纲编制 | 2 |
| B3c | `B3-标书工作台10屏.md` | ④ 正文编写 + ⑤ 偏离表 | 2 |
| B3d | `B3-标书工作台10屏.md` | ⑥ 自查 + ⑦ 导出 + 答辩 + 归档 | 4 |
| B4 | `B4-情报中心5屏.md` | 情报中心 5 屏 | 5 |
| B5 | `B5-方案工作室4屏+产品映射4屏.md` | 方案工作室 + 产品映射 | 8 |
| B6 | `B6-PPT报价5屏+素材库4屏.md` | PPT 报价 + 素材库 | 9 |
| B7 | `B7-知识库6屏+资质台账3屏.md` | 知识库 + 资质台账 | 9 |
| B8 | `B8-竞品4屏+标书检查4屏+格式刷新2屏.md` | 竞品 + 标书检查 + 格式刷新 | 10 |
| B9 | `B9-助手3屏+模型3屏+团队3屏.md` | 助手 + 模型 + 团队 | 9 |
| B10 | `B10-工作台4屏+导航收口+全站回归.md` | 工作台 + 导航收口 + 全站回归 | 4 |

---

## 10. 现在开始

1. 读 §3.1 的 4 个文件（全文）
2. 读 §3.2 的原型（逐屏打开）
3. 读 §3.3 的现有代码
4. 按 §3.5 的格式回报，**等我确认**
5. 确认后按 §5 的顺序做
6. 按 §7 的格式回报

**记住一句话**：你的工作不是"设计得更好"，是**把已经定稿的屏一屏不差地实现出来，并且四门全绿**。
