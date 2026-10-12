# R241 — docs13-3.9 风格细节三项合一（docs13 走查线清零）

日期：2026-10-09 ｜ 轮次：R241 ｜ 优先级：P3 ｜ 选题来源：backlog docs13-3.9-style-details

## 成果摘要
1. **侧栏双滚动条（根因修复）**：SidebarNav 的 nav 为 flex-1 + overflow-y-auto，但缺 min-h-0——
   flex 子项默认 min-height:auto 不可压缩，内容超高时 nav 撑破 h-screen 侧栏，页面级滚动与 nav 内部
   滚动并存。补 min-h-0，并给 Logo header 与账户 footer 加 shrink-0 防挤压。导航后仅 nav 一处滚动。
2. **驾驶舱「今日必看」加载态换骨架屏**：原「正在汇总今日行动项…」纯文案在慢网下闪现偏长，
   替换为三列 animate-pulse 骨架（形状贴合逾期/今日/进行中分组行高）；role=status + sr-only 保留
   读屏语义，装饰列 aria-hidden。
3. **客户详情裸「·AI」标记补 hover 说明**：等级徽章、指标格、年营业收入、领导班子四处 AI 角标
   统一加 cursor-help + title「由 AI 补全提供，请人工核实」；已有自说明文字的（AiBadge/括注形态）不动。

## 关键决策
- 纯 CSS/属性级修复，零新状态、零逻辑变更、零依赖新增。
- 三文件均 git-clean（CustomerProfileCard 的 M 态为 R239 自家交付，锚点已知）。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/components/shell/SidebarNav.tsx | nav +min-h-0；header/footer +shrink-0 |
| src/components/home/MustSeeTodayBar.tsx | loading 文案 -> 三列骨架屏（role=status + sr-only） |
| src/components/customer-management/CustomerProfileCard.tsx | 4 处裸 ·AI 角标补 title hover（等级/指标/营收/班子） |

补丁脚本：scripts/r241_style_details.py（8 处锚点断言一次通过；初稿裸串锚点有歧义，执行前扩上下文修正）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| eslint | npx eslint（3 个触及文件） | exit 0，零 error |
| vitest | npx vitest run | 148 files / 1731 passed / 2 skipped（基线持平） |
| build | npx vite build | exit 0，built in 2.94s |

## 挂账
- docs13 走查线（§3.4/§3.8/§3.9）至此全部关闭。
- r2-r012 剩余「标书项目列表 / 资质明细」继续等待在途清出。
