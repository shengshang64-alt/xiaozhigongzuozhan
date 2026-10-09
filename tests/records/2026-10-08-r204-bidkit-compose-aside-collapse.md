# R204 场景自测记录

- 日期：2026-10-08
- 轮次：R204（BidWorkspace 优化实施计划 · 切片 0）
- 需求来源：`c:\Users\Administrator\Desktop\小智工作站-需求记录.md` O-008 / O-009
- 变更文件：`src/components/bid-workspace/ComposeStep.tsx`（唯一，1441 → 1500 行）

## 一、操作步骤

1. 打开 http://127.0.0.1:8000/ 侧栏 → 标书工作台
2. 项目列表选「贵港项目（10/10 章成稿）」→ 进入流水线；顶部步骤条点「第 3 步 投标文件编制」
3. 定位到"大纲 + 正文"3 栏区（xl 断点视口，本文献实测 chrome 视口 479 未达 xl，故通过 DOM 状态与 CSS className 值双证）
4. 观察右上角新增开关按钮、`#deviation-panel` 提示卡
5. 点击按钮 → 检查 localStorage、右栏存在性、栅格 className 三者是否同步翻转
6. 页面刷新 → 检查 localStorage 是否被读回初始态

## 二、输入与预期

| 场景 | 输入 | 预期 | 实测 |
|---|---|---|---|
| 首次进入 | `localStorage` 空 | 右栏可见，按钮文案"收起评分点面板"，栅格 className 含 `_300px` | ✓ 三项均命中 |
| 收起操作 | 点按钮一次 | `localStorage='1'`，右栏 DOM 消失，按钮文案"展开评分点面板"，栅格 className 不含 `_300px` | ✓ 四项全命中（evaluate_script 返回 JSON 佐证） |
| 再次展开 | 再点一次 | `localStorage='0'`，右栏复现，栅格回 3 栏 | ✓ |
| 刷新持久 | reload | 组件按 ls 值重建 asideCollapsed；本轮 ls='0' → 右栏默认展开 | ✓ |
| 锚点滚动 | `document.querySelector('#deviation-panel')` | 存在且文本以"技术偏离表就在下方"起手 | ✓ |

## 三、发现问题与处理

- **未遇到崩溃**：tsc / vitest / eslint / build 全绿；浏览器 evaluate_script 未捕获 pageerror 或 console.error。
- **潜在小坑（记录不修）**：localStorage 无命名空间隔离，`bidkit.compose.asideCollapsed` 若与他项目同源冲突可能污染。
  评估：项目本身就用 `bidkit.` 前缀做 key 隔离（历史 `bidkit.*` key 已有多枚），非新增风险；沿用即可。
- **视口边界**：xl 断点 1280 以下的设备上看不到开关条，但仍能通过 `md` 与 `lg` 断点的默认栅格看到 2 栏布局——
  原 3 栏布局只在 xl 才有；用户反馈"正文挤到 60%"的场景本身就是 xl 及以上，本次改动精确命中该场景，小屏不涉及。

## 四、结论

O-008 / O-009 已闭环；为后续切片 1~4 的 UI 空间与滚动锚点铺路。可推切片 1。
