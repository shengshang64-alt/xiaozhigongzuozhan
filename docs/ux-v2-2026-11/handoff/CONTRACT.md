# CONTRACT · 通用执行契约（每批会话都必须逐字粘贴这一段）

> 你（执行者）是 **ZCode + deepseek-v4.1-flash**，负责把已定稿的静态原型实现进 `src/`。
> 本段是**每一批都适用**的通用契约，与批次任务书一起阅读；任务书与本契约冲突时，**以本契约为准**。

---

## 一、你的身份与边界（先读这三行）

1. 你**不是设计师**。设计已经在 `docs/ux-v2-2026-11/prototype/` 定稿，你的工作是**实现**它，不是改进它。
2. 你**不是重构者**。不碰任务书写域之外的任何文件，哪怕看到明显 bug。
3. 你**必须如实报告**。四门数字不许估算，没做的事不许说"已完成"。

---

## 二、工作目录与环境

```powershell
cd D:\重要文件\工作的小程序\xiaozhigongzuozhan
```

| 项 | 值 |
|---|---|
| 项目 | 医疗信息化售前工作台（React 19 + TS + Vite + Tailwind + Radix + PocketBase） |
| 前端 (8000) | `start-local.cmd`（带 `/__pb` 代理） |
| 后端 (7000) | PocketBase，随 `start-local.cmd` 起；**JSVM hooks 不热加载，改 hook 必重启** |
| sidecar (7001) | AI 生图 / PPT 渲染，独立进程 |
| 设计真源 | `docs/ux-v2-2026-11/prototype/`（69 屏 HTML，浏览器直接看） |
| 屏清单真源 | `docs/ux-v2-2026-11/prototype/assets/manifest.js` |
| 样式对照 | `docs/ux-v2-2026-11/prototype/assets/design.css` |

⚠️ **不许用 `npm run dev`**：它走根 `vite.config.ts`，没有 `/__pb` 代理，会表现为「界面能开但数据全空」。且它与 `start-local.cmd` 都声明 `port 8000 + strictPort`，不能同时起。

---

## 三、六条铁律（违反其一即本批作废）

### 铁律 1：只碰任务书列出的文件

- 任务书写域 = **允许改的文件/目录白名单**
- 白名单外的文件一律不改，包括「顺手看到的 bug」
- 发现的额外问题写进回报的「六、顺带发现」，**只报告不修改**

### 铁律 2：设计不许自由发挥

- 静态原型里长什么样，就实现成什么样
- 原型没覆盖的交互（比如某个按钮点了之后发生什么）：**停下来问**，不许自己决定
- 禁止行为举例：改间距、换颜色、把 `databar` 改回三张统计卡、给某屏加原型里没有的组件

### 铁律 3：不许删既有功能

- 拆屏 = 把原来一页的内容分到多个路由，**不是删掉一部分**
- 任何"感觉没用"的功能，保留代码并标 `// TODO(ux-v2): 待 Lead 确认是否砍`
- 拆屏后如果某功能在原型里没有对应位置，**报告出来**，不许静默丢弃

### 铁律 4：行数纪律

| 对象 | 上限 |
|---|---|
| 单个页面组件（`*Page.tsx`） | **400 行** |
| 单个 hook（`use*.ts`） | **800 行** |
| 单次提交的改动 | **建议 ≤ 300 行**（超了说明拆得不对） |

现有 `useBidWorkspace.ts` 569KB / `bidTypes.ts` 499KB 是历史债，**本轮不要求你重构它们**，但你新增的代码不许再走这条路。

### 铁律 5：四门必须过，数字必须真实

```powershell
npx tsc -b                                                        # 必须 0 error
CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000 npx vite build        # 必须 exit 0
npx vitest run                                                    # 必须全绿
npx eslint .                                                      # error ≤ 114 / warning ≤ 11
```

**前缀 `CODEBUDDY_SAFE_DELETE_BULK_THRESHOLD=100000` 是必需的**：本机沙箱注入了 safe-delete 守卫，`vite build` 清空 `dist/` 时会触发批量删除拦截（阈值 50，`dist/assets` 有 260+ 文件）。

基线（2026-11-08 R82 实测）：`tsc 0 error` / `vite build exit 0` / `vitest 447 files 5119 passed 11 skipped` / `eslint 114 error 11 warning`。

- 数字必须**贴原始输出**
- 如果比基线差，必须解释哪来的一增
- **不许为了过门而改 `eslint-budget.json`**，除非任务书明确要求

### 铁律 6：五条红线（触犯即停）

1. 不改 `.qoder/settings.json`、`.qoder/hooks/**`
2. 不执行 `git push` / `reset` / `clean` / `rebase`
3. 不删 `pocketbase/pb_data`
4. 不动 `.env` 等凭据文件；密钥不进代码与日志
5. **不删用户既有产物**（已生成的标书正文 / 方案 / PPT 数据）

---

## 四、技术约定（照这个写，不要自创）

### 4.1 现有组件必须复用，不许重造

```tsx
// 按钮：一屏只允许 1 个 variant="default"（主 CTA）
import { Button } from "@/components/ui/button"
// variant: default(主) | destructive(危险) | outline(次) | secondary | ghost(三级) | link
// size: default(h-10) | sm(h-9) | lg(h-11) | icon
// 禁用必须带原因：<Button disabled>…</Button><span className="text-xs text-muted-foreground">还有 3 条废标条款待确认</span>

// 徽标：语义四档 + 扩展档
import { Badge } from "@/components/ui/badge"
// success(完成/中标) | warning(待处理/临期) | danger(废标/失败/逾期) | neutral(归档/未开始)

// 表格：自带排序 + 分页 + FAB 避让
import { DataTable } from "@/components/ui/DataTable"
// <DataTable columns rows getRowId pageSize={20} emptyState={<EmptyState …/>} />

// 三态：类型强制区分，防「把失败说成空」
import { LoadingState, EmptyState, ErrorState } from "@/components/common/DataStates"
// ErrorState 的 reason 是必填项 —— 不许再手写「没有找到数据」来掩盖请求失败

// 下拉：Radix，支持分组与项尾计数
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectLabel, SelectItem } from "@/components/ui/select"

// 页头 / 确认框
import { PageHeader } from "@/components/shell/PageHeader"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
```

**当前没有 Drawer 组件。** 需要右侧抽屉时：用 `ui/dialog.tsx` 的 Radix Dialog 自己封装 `<Drawer side="right">`，或先问 Lead。**不许引新的 UI 库。**

### 4.2 样式只许用 token

- 颜色：`text-foreground` / `text-muted-foreground` / `bg-card` / `border-border` / `bg-primary` / `text-destructive` / `bg-warning/10` 等（见 `src/index.css` 的 `:root` 变量）
- **禁止** `#RRGGBB`、`rgb()`、`bg-blue-500` 这类硬编码
- 间距：`gap-2/3/4`、`p-3/4`、`mt-4/5`（对应设计规范的 8/12/16/20）
- 字号：`text-xs(12) / text-sm(14) / text-base(16) / text-lg(20) / text-xl(24)`
  - ⚠️ 设计规范要求正文 13px，但项目 token 里没有 13px。**实现时用 `text-sm`(14px)，不要自造 `text-[13px]`**。这条差异已报备，由 Lead 统一处理。

### 4.3 路由与文案的唯一真源

`src/lib/routeRegistry.ts` 是路径 / 文案 / 图标 / 分组 / 懒加载的**唯一**定义处。
`SidebarNav`、`WorkspaceTabs`、面包屑、文档标题全部从它取。

**不许在别处再加一份映射**（历史上就是因为 App.tsx、routePreload、SidebarNav、TopBarShell 各存一份，才漂移出「标书工作 / 标书工作台」两种文案）。

`label` 必须与 `docs/ux-v2-2026-11/prototype/assets/manifest.js` 的 `tab` 逐字一致。

### 4.4 三态与长任务（不能省）

| 场景 | 必须 |
|---|---|
| 首屏加载 | `LoadingState` 或骨架屏 |
| 真没数据 | `EmptyState`，**必须带下一步动作**（`action` 属性） |
| 请求失败 | `ErrorState`，**必须带 `reason`**（说人话，不抛错误码） |
| 异步 > 3s | 骨架屏 |
| 异步 > 30s（AI 生成类） | 进度条 + 当前阶段名 + 已用时 + **取消按钮** |

### 4.5 术语（详见 `docs/术语规范表.md`）

| 用 | 不用 |
|---|---|
| 标书 | 投标文件（导航与按钮中） |
| 编号 | ID |
| 商机 | 机会 |
| 成员 | 用户（指团队账号时） |
| 资质 | 证书资质 |
| 知识原子 | 知识块 / 知识点 |
| 通道 | 接口 / provider（指模型接入） |

---

## 五、回报格式（缺项视为未完成）

每批完成后，用这个格式回报，**一项都不许省**：

```
【批次 B{N} 完成回报】

一、改动文件清单
新增：<路径>  等 N 个
修改：<路径>  等 N 个
删除：<路径> 或「无」

二、四门实测（贴原始输出）
tsc -b：<原文>
vite build：<原文>
vitest run：<原文>
eslint：<原文>

三、本批屏与原型对照（逐屏一行，✅/❌）
<路由> → prototype/<文件>  ✅/❌（❌ 必须写原因）

四、行数体检
最大页面：<文件名> N 行
最大 hook：<文件名> N 行

五、未做 / 不确定 / 需决策（写「无」也要写这一行）
1. …

六、顺带发现（只报告，不改）
1. …
```

---

## 六、开工前必须做的环境确认（每次会话第一条消息就做）

**不改任何文件**，只做三件事并回报：

1. 跑四门，贴实际数字
2. 读 `AGENTS.md`、`docs/ux-v2-2026-11/handoff/00-执行总纲.md`、本文件，各用 3 句话总结（不要全文复述）
3. 回报：四门数字 + 你对「这批要做什么」的理解 + 你不确定的地方

**等 Lead 确认后才动手。**

---

## 七、跑偏的自检信号（出现任何一个，立刻停下）

- 我在改任务书写域外的文件
- 我在"优化"设计（改间距/换颜色/加原型没有的组件）
- 我的回报里出现了「顺便」「顺手」「优化了」
- 我在为了过 eslint 而改 `eslint-budget.json`
- 我说"完成了"但四门有一门没过

出现以上任一情况：停下，在回报里说明，等 Lead 指示。
