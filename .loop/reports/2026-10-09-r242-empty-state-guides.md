# R242 — slice5 空态引导：AI 动态 + 产品映射（O-001/O-002 关闭）

日期：2026-10-09 ｜ 轮次：R242 ｜ 优先级：P1 ｜ 选题来源：backlog bidkit-plan-slice5-observations-misc

## 成果摘要
1. **AI 动态分类空态（O-001）**：原「该分类下暂无条目」一行裸文案升格为虚线引导卡——
   区分筛选态（给出「浏览全部分类」一键清除筛选）与无数据态（给出「刷新拉取最新动态」出路），
   图标 + 说明 + 动作，用户不再对着空白猜下一步。
2. **产品映射空态（O-002）**：「暂无招标项目」提示原深藏在 Select placeholder 里（不点开不可见），
   升格为选择区块下方的显式引导卡，两个 tab 各一张：
   - 从招标文件：空时引导「先到标书工作台解析」+ 一键跳转 /bid-workspace
   - 从方案/需求：空时引导「在方案工作室生成清单快照」+ 一键跳转 /solution-studio
   仅 !sourceLoading && length===0 时出现，有数据即消失，零干扰。

## 关键决策
- 跨页直达沿用项目内 useNavigate + navigate("/<route>") 惯例（useBidWorkspace 先例），路由存在性经 App.tsx 核验。
- 引导卡沿用全站「虚线边框空态卡 + 说明 + 内嵌小按钮」惯例（同款 border-dashed 空态先例），零新组件零新依赖。
- Knowledge 页空态引导（O-005）本轮不做：该页空态渲染不在主文件且 useKnowledge.ts 在途避让，拆至后续轮。

## 变更文件
| 文件 | 变更 |
| --- | --- |
| src/pages/AiHot/AiHotPage.tsx | visible 空态一行文案 -> 引导卡（筛选态/无数据态双分支） |
| src/pages/ProductMapping/ProductMappingPage.tsx | +useNavigate；bid/solution tab 各加空态引导卡（跨页直达） |

补丁脚本：scripts/r242_empty_state_guides.py（5 处锚点断言一次通过）。

## 四门验证
| 门 | 命令 | 结果 |
| --- | --- | --- |
| tsc | npx tsc -b | exit 0，零错误 |
| eslint | npx eslint（2 个触及文件） | exit 0，零 error |
| vitest | npx vitest run | 148 files / 1731 passed / 2 skipped（基线持平） |
| build | npx vite build | exit 0，built in 3.44s |

## 挂账（slice5 进度盘点）
- O-001 ✓ O-002 ✓（本轮）；O-003 客户管理密度 ✓（R236 表格视图）；O-006 ✓（R210）。
- O-004 残余：方案工作室/标书工作台两页表格化，继续在途避让（r2-r012 同因）。
- O-005 知识库空态引导：待 useKnowledge.ts 在途清出后与 KnowledgePage 一并做。
