# 设计对照：可确证的事实

> 由 `scripts/health/designdiff.mjs` 生成；原始数据来自 `scripts/health/structdiff.mjs`。

## 为什么没有「评分表」

用 DOM 结构自动判断「像不像设计」**不可靠**，两个原因：

1. **原型是设计稿**：弹窗全部展开、列表全有演示数据。原型的 h3/按钮里有大量「当前没打开」的内容（例：`qual-list` 唯一的 h3 是删除确认框标题）。
2. **实现有空态与 keep-alive**：没选项目 / 没数据时结构不渲染（例：`bid-deviation` 原型有完整偏离表，实现显示「还没有选择投标项目」）。

这两点是设计稿与真应用的固有差别，不是缺陷。

**判断「像不像」只能看截图**：`node scripts/health/shoot-ux-v2.mjs` 生成 `shots-impl/`，与 `shots/`（原型）同名对比。

---

## A. 标题缺失（真缺陷）

**无。** 69 屏全部有可见 h1。

## B. 空态屏（需先建数据才能对照，非缺陷）

共 27 屏。这些屏当前无数据，原型那套结构要等有数据才会展开。

| 屏 | 路径 | 实现标题 |
|---|---|---|
| home-tasks | `/tasks` | 待办中心 |
| home-calendar | `/calendar` | 投标节点 |
| customer-detail | `/customer-management/detail` | 客户详情 |
| customer-followup | `/customer-management/followup` | 跟进队列 |
| intel-industry | `/intel-center/industry` | 行业前沿 |
| solution-editor | `/solution-studio/editor` | 方案编辑器 |
| solution-delivery | `/solution-studio/delivery` | 交付检查 |
| mapping-library | `/product-mapping/library` | 产品库 |
| ppt-editor | `/ppt-quote/editor` | PPT 编辑器 |
| quote-editor | `/ppt-quote/quote-editor` | 报价编辑 |
| quote-preview | `/ppt-quote/quote-preview` | 报价单预览 |
| material-list | `/materials` | 素材库 |
| bid-import | `/bid-workspace/import` | ① 导入招标 |
| bid-parse | `/bid-workspace/parse` | ② 解析确认 |
| bid-outline | `/bid-workspace/outline` | ③ 大纲编制 |
| bid-draft | `/bid-workspace/draft` | ④ 正文编写 |
| bid-deviation | `/bid-workspace/deviation` | ⑤ 偏离表 |
| bid-check | `/bid-workspace/check` | ⑥ 交卷自查 |
| bid-export | `/bid-workspace/export` | ⑦ 组卷导出 |
| bid-rehearse | `/bid-workspace/rehearse` | 模拟答辩 |
| bid-archive | `/bid-workspace/archive` | 归档复盘 |
| format-preview | `/format-tool/preview` | ② 预览套用 |
| kb-review | `/knowledge/review` | 原子审核 |
| kb-upload | `/knowledge/upload` | 上传文档 |
| competitor-market | `/competitors/market` | 市场总览 |
| model-health | `/model-config/health` | 健康看板 |
| team-roles | `/team/roles` | 角色权限 |

## C. 标题本体不一致（刨掉统计数字后）

共 56 屏。多数是原型把统计数字拼进标题、实现放进页内指标卡；标「**是**」的是屏名本身不同，需人工确认。

| 屏 | 路径 | 原型 → 实现 | 屏名不同？ |
|---|---|---|---|
| home | `/` | 上午好，系统管理员 周五 · 11月8日 → 早上好，系统管理员 | 否（仅数字） |
| customer-list | `/customer-management` | 客户列表 160 家 32 家待唤醒 → 客户列表 | 否（仅数字） |
| customer-detail | `/customer-management/detail` | 厦门市中医院 A 级 需求确认 46 天未跟进 → 客户详情 | **是** |
| customer-kanban | `/customer-management/kanban` | 商机看板 12 个在跟 2 个超期 30 天+ → 商机看板 | 否（仅数字） |
| customer-followup | `/customer-management/followup` | 跟进队列 32 家超 90 天 本周计划 12 条 → 跟进队列 | 否（仅数字） |
| customer-import | `/customer-management/import` | 导入与体检 第 3 步 · 处理冲突 → 导入与体检 | 否（仅数字） |
| intel-review | `/intel-center` | 审阅 待确认 29 可转商机 6 → 审阅 | **是** |
| intel-browse | `/intel-center/browse` | 浏览 共 1,009 条 含已确认 980 → 浏览 | **是** |
| intel-detail | `/intel-center/detail` | 吉安市公立中医医院信息化建设项目变更澄清公告 → 情报详情 | **是** |
| intel-industry | `/intel-center/industry` | 行业前沿 6 条今日更新 已并入 AI 动态 → 行业前沿 | **是** |
| intel-sources | `/intel-center/sources` | 数据源 5 个正常 1 个失败 → 数据源 | 否（仅数字） |
| solution-editor | `/solution-studio/editor` | 顾县人民医院 HIS 升级改造建设方案 编写中 → 方案编辑器 | **是** |
| solution-checklist | `/solution-studio/checklist` | 建设清单 立项阶段 → 建设清单 | 否（仅数字） |
| solution-delivery | `/solution-studio/delivery` | 交付检查 3 项未通过 → 交付检查 | 否（仅数字） |
| mapping-upload | `/product-mapping` | ① 选择清单 第 1 步 / 共 3 步 → ① 选择清单 | 否（仅数字） |
| mapping-compare | `/product-mapping/compare` | ② 对照 进行中 → 逐行对照 | **是** |
| mapping-result | `/product-mapping/result` | ③ 结果 已完成 → 对照结果 | **是** |
| ppt-editor | `/ppt-quote/editor` | 蚌埠医科大一附院 · 智慧医疗核心系统 待排版 → PPT 编辑器 | **是** |
| quote-list | `/ppt-quote/quote-list` | 报价清单 2 份 30 天内到期 → 报价清单 | 否（仅数字） |
| quote-editor | `/ppt-quote/quote-editor` | Q-20261108-04 · 厦门市中医院 已发出 v3 超 100 万 · 二级审批中 → 报价编辑 | **是** |
| quote-preview | `/ppt-quote/quote-preview` | 报价单预览 已通过审批 → 报价单预览 | 否（仅数字） |
| material-import | `/materials/import` | 导入素材 第 2 步 / 共 3 步 → 本地导入 | **是** |
| material-web | `/materials/web` | 联网抓取 本月已用 42 / 200 → 联网抓取 | 否（仅数字） |
| material-settings | `/materials/settings` | 库设置 低频页面 → 库设置 | 否（仅数字） |
| bid-list | `/bid-workspace` | 投标项目 进行中 3 → 投标项目 | 否（仅数字） |
| bid-import | `/bid-workspace/import` | 【UI测试】中医院信息化建设项目 ① 导入招标 → ① 导入招标 | **是** |
| bid-parse | `/bid-workspace/parse` | 【UI测试】中医院信息化建设项目 ② 解析确认 → ② 解析确认 | **是** |
| bid-outline | `/bid-workspace/outline` | 【UI测试】中医院信息化建设项目 ③ 大纲编制 → ③ 大纲编制 | **是** |
| bid-draft | `/bid-workspace/draft` | 【UI测试】中医院信息化建设项目 ④ 正文编写 → ④ 正文编写 | **是** |
| bid-deviation | `/bid-workspace/deviation` | 【UI测试】中医院信息化建设项目 ⑤ 偏离表 → ⑤ 偏离表 | **是** |
| bid-check | `/bid-workspace/check` | 【UI测试】中医院信息化建设项目 ⑥ 交卷自查 → ⑥ 交卷自查 | **是** |
| bid-export | `/bid-workspace/export` | 【UI测试】中医院信息化建设项目 ⑦ 组卷导出 → ⑦ 组卷导出 | **是** |
| bid-rehearse | `/bid-workspace/rehearse` | 【UI测试】中医院信息化建设项目 答辩 → 模拟答辩 | **是** |
| bid-archive | `/bid-workspace/archive` | 安徽中医药大学第一附属医院一体化核心 归档 → 归档复盘 | **是** |
| check-upload | `/bid-check` | 新建检查 规则包 v3.2 → 新建检查 | 否（仅数字） |
| check-running | `/bid-check/running` | 检查中 暗标严格模式 → 检查中 | **是** |
| check-report | `/bid-check/report` | 检查报告 23 个问题（阻断 2 / 警告 8 / 提示 13） → 检查报告 | **是** |
| format-upload | `/format-tool` | 上传与模板 第 2 步 · 选择标准模板 → ① 上传与模板 | 否（仅数字） |
| kb-browse | `/knowledge` | 文档库 7,000 篇 312 条原子待审核 → 文档库 | 否（仅数字） |
| kb-atoms | `/knowledge/atoms` | 知识原子 1,842 条 3 条冲突待裁决 → 知识原子 | 否（仅数字） |
| kb-review | `/knowledge/review` | 原子审核 待审核 312 → 原子审核 | 否（仅数字） |
| kb-upload | `/knowledge/upload` | 上传文档 团队知识库 2,175 篇 → 上传文档 | 否（仅数字） |
| qual-list | `/qual-certs` | 资质台账 4 项需处理 25 张未登记有效期 → 资质台账 | **是** |
| qual-alerts | `/qual-certs/alerts` | 预警处理 4 项等你决定 → 预警处理 | 否（仅数字） |
| qual-bulk | `/qual-certs/bulk` | 批量登记有效期 25 张待补录 → 批量登记 | 否（仅数字） |
| competitor-bidview | `/competitors` | 应标视角 默认视图 → 应标视角 | 否（仅数字） |
| competitor-market | `/competitors/market` | 市场总览 行业研究视角 → 市场总览 | 否（仅数字） |
| competitor-benchmark | `/competitors/benchmark` | 能力对标 我方 vs 卫宁健康 → 能力对标 | **是** |
| competitor-profile | `/competitors/profile` | 卫宁健康 最强对手 上市公司 → 厂商档案 | **是** |
| assistant-chat | `/assistant` | 会话 上下文感知 会话自动命名 → 会话 | **是** |
| assistant-skills | `/assistant/skills` | 技能 6 个 本周调用 128 次 → 技能 | **是** |
| model-channels | `/model-config` | 通道与默认 3 个通道已连通 → 通道与默认 | 否（仅数字） |
| model-test | `/model-config/test` | 连通测试 deepseek-v4.1-flash 连通 → 连通测试 | **是** |
| team-members | `/team` | 成员 7 名 2 个测试账号 → 成员 | **是** |
| team-roles | `/team/roles` | 角色权限 3 个角色 18 项权限 → 角色权限 | 否（仅数字） |
| team-settings | `/team/settings` | 设置与审计 本机存储 → 设置与审计 | 否（仅数字） |

## D. 原型独有动作（需人工判定：设计取舍 or 遗漏）

只列「原型有、实现完全没有」的按钮文案。**数量多为正常**：原型含大量演示占位（「看案例 3 个」「复制正文」），实现需有对应接口才做。

| 屏 | 路径 | 原型独有动作 |
|---|---|---|
| home | `/` | 切换视图、消息中心 6、＋ 新建投标项目、续期登记、开始审阅、按截止日排序、建跟进 |
| home-tasks | `/tasks` | 导出待办、＋ 新建待办、按优先级、按截止、按来源、去处理、续期登记、去确认 …共18 |
| home-calendar | `/calendar` | 月视图、周视图、列表、导出日历（.ics）、＋ 新建节点、‹、今天、› …共9 |
| home-review | `/review` | 近 24 个月、导出复盘报告、导出明细、去回填、查看、‹、› |
| customer-list | `/customer-management` | 筛选 2、批量补全、导出、标记待唤醒、‹、…、›、清除筛选条件 …共10 |
| customer-detail | `/customer-management/detail` | 建档补全、＋ 新建商机、稍后提醒、一键建跟进、编辑、去补全 →、＋ 加联系人、记沟通 …共13 |
| customer-kanban | `/customer-management/kanban` | 阶段设置、改规则 |
| customer-followup | `/customer-management/followup` | 按最近跟进排序、＋ 批量生成跟进任务、导出本档、查看全部 32 家 →、展开全部、按预算排序、重排、生成任务 |
| customer-import | `/customer-management/import` | 下载导入模板、历史导入、重新选择、按「编号」匹配、自动匹配、看需要确认的 2 列 →、全部保留现有、全部用导入值 …共13 |
| intel-review | `/intel-center` | 批量模式、可转商机优先 |
| intel-browse | `/intel-center/browse` | 导出 CSV、批量确认、加入知识库、‹、…、› |
| intel-detail | `/intel-center/detail` | 忽略、仅确认、确认并转商机、看原文 →、复制正文、下载快照、重生成、一键建档 → …共13 |
| intel-industry | `/intel-center/industry` | 管理订阅、按关联度、收藏、导出 |
| intel-sources | `/intel-center/sources` | 立即全部抓取、重新测试、修选择器、测试、一键修正选择器、重新抓取、保存 |
| solution-list | `/solution-studio` | 从需求创建、按最近编辑、以此为底稿、从需求创建方案、清空筛选 |
| solution-editor | `/solution-studio/editor` | 预览、导出 docx、H1、H2、B、表格、图表、引用 …共17 |
| solution-checklist | `/solution-studio/checklist` | 导入需求原文、＋ 加系统、从知识库推荐系统、参考同类立项清单、生成大纲 |
| solution-delivery | `/solution-studio/delivery` | 导出检查报告、对比上次检查、重新检查、去补写、核实、修复后重新检查、仍然导出（会记录风险）、去编辑器补写 …共10 |
| mapping-upload | `/product-mapping` | 从历史清单选、选择文件、去粘贴、从标书抽取 |
| mapping-compare | `/product-mapping/compare` | 暂停、跳过本行、保存并看结果、看案例 3 个、接受这条、换一个、标记未匹配、逐行处理 3 条 |
| mapping-result | `/product-mapping/result` | 导出 Excel 对照表、重新对照、改、指定产品、‹、…、›、导出评分覆盖表 …共9 |
| mapping-library | `/product-mapping/library` | 导出产品清单、＋ 新建产品、导入记录、批量改厂商、‹、…、›、选择文件 …共11 |
| ppt-list | `/ppt-quote` | 模板市场、从方案生成、按最近编辑、打开编辑器、查看进度、取消、看内置模板 |
| ppt-editor | `/ppt-quote/editor` | 返回列表、重新生成本页、AI 润色本页、适应、100%、放大、思源黑体、微软雅黑 …共12 |
| quote-list | `/ppt-quote/quote-list` | 复制上次报价、从产品库导入、全部客户、‹、›、提醒客户 |
| quote-editor | `/ppt-quote/quote-editor` | 返回清单、查看历史版本、信息化整体提升、按产品库刷新单价、添加行、从产品库追加、从建设清单导入、试算 82% 折扣 …共13 |
| quote-preview | `/ppt-quote/quote-preview` | 返回编辑、复制链接给客户、导出 PDF 并生成发送邮件、查看审批单、导出 Excel（可编辑明细）、导出 PDF（盖章版）、导出 Word（可改条款）、再发一次（会记入发送记录） |
| material-list | `/materials` | 去 PPT 编辑器看命中、看全部排行、筛选 1、按引用降序、‹、…、› |
| material-import | `/materials/import` | 更换规则、改分类、跳过、未识别 · 请选择、预览、全部归入未分类、改落未分类（2 个）、上一步 |
| material-web | `/materials/web` | 返回素材库、看授权说明、搜一搜、全选、取消全选、‹、…、› …共12 |
| material-settings | `/materials/settings` | 重建缩略图、新增分类、清理未引用（61 个）、恢复全部、恢复、看使用排行、✕、取消 …共9 |
| bid-import | `/bid-workspace/import` | 保存草稿、开始解析（预计 90 秒）、选择文件、从情报中心带入、重新识别、覆盖原项目、新建版本 |
| bid-parse | `/bid-workspace/parse` | 重新解析、确认解析结果，进入大纲编制、可重新解析、全部标为「已响应」、‹、› |
| bid-outline | `/bid-workspace/outline` | 预览大纲、重新生成大纲、确认大纲并生成正文、看缺的 4 个评分点、一键补章、AI 生成、从模板、手工 …共13 |
| bid-draft | `/bid-workspace/draft` | 版本历史、导出草稿、下一步：偏离表 →、展开完整七步、H1、H2、粗、表格 …共14 |
| bid-deviation | `/bid-workspace/deviation` | 导入应答模板、导出 xlsx 核对、生成偏离表 docx、只看未应答、编辑、应答、‹、› …共10 |
| bid-check | `/bid-workspace/check` | 重新检查、定位并修复、修复、一键清理、定位、自动修复、批量自动修复（2） |
| bid-export | `/bid-workspace/export` | 仅导出预览、导出分包件、导出完整标书 docx、恢复默认 |
| bid-rehearse | `/bid-workspace/rehearse` | 导出讲标稿、开始演练、换一条问题、加入讲标稿、调整 |
| bid-archive | `/bid-workspace/archive` | 导出复盘报告、保存结果并生成复盘、保存草稿、写入 3 条 |
| check-upload | `/bid-check` | 点击选择文件 |
| check-running | `/bid-check/running` | 取消检查、继续等 26 秒、确认取消 |
| check-report | `/bid-check/report` | 导出带批注的 docx、定位、忽略、‹、›、回到问题清单、生成修复建议 |
| check-history | `/bid-check/history` | 开始对比、对比、‹、›、取消、确认删除 |
| format-upload | `/format-tool` | 上传格式样张识别、选择 docx 文件、微调这套模板、保存草稿 |
| format-preview | `/format-tool/preview` | 并排、叠加、‹ 上一页、下一页 ›、第 1 处差异、‹、›、A4（21 × 29.7cm） …共13 |
| kb-browse | `/knowledge` | 查看配置、打开、在项目中引用、抽为原子 |
| kb-search | `/knowledge/search` | 全部、标题、清空、打开、在项目中引用、加入原子、显示全部 8 条、跳到原文 …共12 |
| kb-atoms | `/knowledge/atoms` | ＋ 新建原子、裁决、通过、‹、…、› |
| kb-review | `/knowledge/review` | 批量模式、置信度 0.90、展开全文、指标、看原文、对比两条、采纳（A）、改写后采纳（E） …共15 |
| kb-qa | `/knowledge/qa` | 新建会话、打开原文、换个词再问、发送、清空会话 |
| kb-upload | `/knowledge/upload` | 开始上传、选择文件、选择文件夹、团队知识库 / 政策法规、取消、开始上传（3）、重试、看细则 …共9 |
| competitor-bidview | `/competitors` | 刷新数据、最近查询、＋ 新建查询、近 3 年、同类（HIS/EMR）、查看匹配明细、带入标书大纲 |
| competitor-market | `/competitors/market` | 导出市场简报 |
| competitor-benchmark | `/competitors/benchmark` | 切换为订单口径、导出对标表、导出对标表（用于标书技术分） |
| competitor-profile | `/competitors/profile` | 标记关注、导出档案、只看我方参与 |
| assistant-chat | `/assistant` | 导出对话、清空搜索、清空、› 厦门市中医院中标价？、› 写第 10 章方案、› 改得像人写的、› 还有哪些废标风险？、› 哪些资质 30 天内到期？ …共19 |
| assistant-memory | `/assistant/memory` | 按最近使用、类型筛选 1、批量失效、批量删除、‹、›、待确认 2 →、清空搜索 …共11 |
| assistant-skills | `/assistant/skills` | 按调用次数、在对话中使用、挂到流程节点、导入、查看、✕、取消 |
| model-channels | `/model-config` | ＋ 添加通道、刷新状态、看配置示例、glm-5.3-flash、kimi-k2、看完整生效范围 →、去处理失效模型、✕ …共11 |
| model-health | `/model-config/health` | 24 小时、7 天、30 天、全部通道、导出明细、按失败原因看、‹、› …共15 |
| model-test | `/model-config/test` | 历史记录、刷新通道状态、Open Design、重置、切换到可用模型、复制错误编号、全部记录 →、‹ …共16 |
| team-members | `/team` | 按角色、批量改角色、‹、›、清空筛选、✕、取消、保存 …共9 |
| team-roles | `/team/roles` | 恢复默认、保存变更（2）、保存并生效、看我自己的权限范围、✕、取消、确认保存 |
| team-settings | `/team/settings` | 刷新、立即备份、看数据目录、保存、从备份恢复、全部动作、导出日志、‹ …共16 |
