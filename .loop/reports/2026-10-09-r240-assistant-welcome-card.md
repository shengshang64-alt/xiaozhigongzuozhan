# R240 — 助手「记忆/技能」可发现性欢迎卡（docs13-3.8 关闭）

日期：2026-10-09 ｜ 轮次：R240 ｜ 优先级：P3 ｜ 选题来源：backlog docs13-3.8-assistant-memory-discoverability

## 成果摘要
- 小智助手页：空会话且用户未手动关闭过时，聊天区 header 下方展示一次性欢迎卡——
  一句话说明长期记忆与技能指令能力，并内嵌「记忆」「技能」两个入口按钮（点击直达左栏对应 Tab）。
- 关闭（X）后写 localStorage 标记 assistant.welcomeDismissed，全站仅出现一次，零打扰；
  一旦当前会话有消息即不再展示（showWelcome = 空会话 && 未关闭过）。
- 入口按钮直接复用 p.setLeftTab，未新增任何 hooks 状态；面板本体（MemoryPanel/SkillsPanel）一字未动。

## 关键决策
- **零 schema**：一次性标记走 localStorage，仿 bidkit.compose.asideCollapsed 既有惯例
  （try/catch 包裹读与写，隐私模式/禁用存储时静默降级为每次可见）。
- **避让在途**：r2-r012 剩余两侧（BidWorkspacePage/QualCertsPage 均 M）继续挂账；Assistant 目录 git-clean。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/pages/Assistant/AssistantPage.tsx | +useState/Brain/X 导入、WELCOME_KEY+readWelcomeDismissed、welcomeDismissed/showWelcome/dismissWelcome、聊天区欢迎卡 JSX |

补丁脚本：scripts/r240_welcome_card.py（4 处锚点断言一次通过，零修复）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| eslint | npx eslint AssistantPage.tsx | exit 0，零 error |
| vitest | npx vitest run | 148 files / 1731 passed / 2 skipped（基线持平） |
| build | npx vite build | exit 0，built in 3.15s |

实机点击验证：本机无 dev/preview 服务在跑，未做浏览器留证（新增为纯展示卡 + 既有 setLeftTab 调用）。

## 挂账
- docs13 残余 open 仅 §3.9 风格细节（双滚动条/骨架屏/AI 徽章 hover）；
- r2-r012 剩余两侧继续等待在途清出。
