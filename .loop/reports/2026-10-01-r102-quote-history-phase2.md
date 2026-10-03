# R102 报价历史二期：相似成交项目参考区间智能推荐

日期：2026-10-01 ｜ 类别：A 类功能（纯本地零 AI）｜ 数据模型：零 collection / 零 pb_hooks ｜ 提示词：未改（非 B 类）

## 选题与授权
账本 backlog `quote-history-01`（P2，二期）：项目结单沉淀报价明细 + 按医院等级/床位数/模块组合给智能推荐区间。
用户已授权「提示词、数据模型都可调整，优先实质性优化」。一期（同商机历史报价 + 一键导入）R40 交付、
结单沉淀通道（won_sample + hospital_level/beds_total/modules_summary）R79 交付，本轮补齐"智能推荐"环节。
先读现有实现（historyQuotesFor / toggleWonSample / QuoteEditor 历史面板 / won_sample 字段）再设计，复用既有沉淀样本池，不新建集合。

## 复用性检索结论（AGENTS 前置）
- PyPI/npm/GitHub：报价区间推荐属"小样本内部经验数据"，无通用可复用库；核心是三维相似度打分 + 分位数统计，逻辑轻量。
- 项目内已有模块：直接复用 quoteTotal/groupSubtotal/formatMoney、customerNormalize.normalizeHospitalLevel 思路、
  toggleWonSample 的客户档案派生口径。判定：**本地叠加**（自研轻量纯函数，复用既有金额计算与沉淀通道），不引入外部依赖。

## 口径设计
### 相似度打分（recommendFromHistory，纯函数）
样本池 = won_sample===true 且 总价>0 且 非当前单。三维加权：
- 医院等级：`parseLevel` 兼容全称(三级甲等)与简称(三甲)；同级且同甲乙 same=+2，仅同级 near=+1，跨级/缺级=0。
- 床位规模：`bedsRatio = min/max ∈ (0,1]`，任一缺床位记 0；贡献 `ratio*1.5`。
- 模块组合：分组名集合 `jaccard`；贡献 `overlap*2`。
- 命中阈值 minScore=1.5（需至少一个维度实质匹配），按分降序取 top 8。

### 输出
- `total_range`：达标相似项总价的 [low=min, median, high=max]；无达标项降级为全部成交样本总价分布并写 note。
- `module_ranges`：跨全部成交样本按 product_name/item_name 聚合单价，仅保留出现≥2 次的模块（top 10）。
- 维度来源优先报价自身沉淀元数据，缺失时经商机名匹配客户档案派生（异步，effect 仅按 activeQuote?.id/quoteMode 触发）。

### UI（QuoteEditor 可折叠面板「成交参考区间」）
区间摘要 + 当前合计落位提示（低于区间=primary 提示复核漏项 / 落在区间=foreground / 高于区间=warning 超预算风险）
+ 相似项清单（同等级/同级/跨级徽章 + 模块重合% + 床位相近% + 成交额）+ 逐模块单价 chip。样本<3 显示"相似项目较少，区间仅供参考"。

## 变更文件
- 新建 `src/pages/PptQuote/quoteRecommend.ts`（纯函数 + 类型）
- 新建 `src/pages/PptQuote/quoteRecommend.test.ts`（11 用例：parseLevel/levelSimilarity/bedsRatio/jaccard/median/buildRange/recommend 排序·降级·逐模块·筛选排除）
- `usePptQuote.ts`：wonSampleDims state + 派生 effect + quoteRecommendation memo + 导出
- `QuoteEditor.tsx`：recommendation prop + 成交参考区间面板
- `PptQuotePage.tsx`：透传 recommendation

## 四门验证
- `npx tsc -b`：0 错误（修复 1 处：测试 helper source 需 as const 字面量）
- `npx vitest run`：641 passed / 2 skipped（基线 630，+11 增量）
- `npx eslint` 触及文件：0 新增 error（quoteRecommend.ts/.test/QuoteEditor/PptQuotePage 全 0；
  修 1 处本轮 no-useless-assignment；usePptQuote 残余 4 error 全为在途既有 effect 行 215/1340/1415/2125，不在插入区间）
- `npx vite build`：3.05s 成功

## 未一并实施（继续挂账）
- quote-history-3-mining（4085 份本地 docx 报价数据挖掘）：P3，需独立立项，本轮不触。
- prompt-fabscan-03 残余「按章聚合回注改进建议」：属标书工作台新交互范式，下一轮评估。

## 红线自检
未改提示词语义（非 B 类）；零 PocketBase collection/pb_hooks 变更（推荐为会话内计算 state）；
无物理删除；数据仅本地检索统计，不发第三方云。


## 浏览器实机验证（R102 收口）

- 环境：本地 PocketBase(:7000) + Vite(:8000) 起服，登录测试/管理员。
- 造样本：/ppt-quote 新建报价「R102验证-甲医院成交样本」→新增分组→手工加行→行项单价填 580000（total>0）→列表「标记为成交参考样本」（won_sample）。
- 触发推荐：新建第二份报价「R102验证-乙医院新报价」进编辑器，当前报价 id 被排除于样本池外，推荐面板读取上一样本。
- 实机结果：
  - 「成交参考区间」面板渲染，头部 `相似成交总价 ¥580,000.00 ~ ¥580,000.00（中位 ¥580,000.00）`，徽章 `0 相似 / 1 样本`。
  - 因第二份报价无模块/等级/床位重合（score<minScore=1.5），正确走降级分支，note：`未找到足够相似的历史成交，以下为全部成交项目的总价分布作参考。`
  - 「当前合计 ¥0.00」落位提示正常。
  - 全程 `list_console_messages(error,warn)` = 0 条，证明新模块 quoteRecommend + usePptQuote hook + QuoteEditor 面板运行时无异常。
- 清理：两份测试报价均经 UI「删除」移除，列表回 0 套，无数据残留。
- 截图：`d:/KFDXCX/MedPreSales/.qoder/tmp/r102_recommend_panel_top.png`。

结论：R102 二期推荐功能四门全绿 + 浏览器实机验证通过，quote-history-01 全链路 closed。
