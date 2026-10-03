# R101 覆盖审计三档升四态（covered=over 过度承诺）· B 类提示词修订对比报告

日期：2026-10-01 ｜ PROMPT_VERSION：1 → 2 ｜ 授权：用户「提示词、数据模型都可以调整，尽量去优化」

## 变更动因
账本 prompt-fabscan-03（P7.1）：覆盖审计只能发现"漏"，发现不了"多"——正文对招标要求加码
（更高参数、免费赠送、缩短工期、加重违约责任）是履约/废标风险，R33 已在偏离表做纯本地
undercommit（减配）子集，本项把 AI 审计侧补齐为四态 full/partial/missing/over（镜像闭环）。

## 旧口径（v1，逐字备份）
```
1. 计划要点在正文中全部有对应落实 → covered=full；
2. 部分要点落实、存在遗漏 → covered=partial，missing_points 逐条列出遗漏的计划要点；
3. 正文为空或计划几乎全部未落实 → covered=missing，missing_points 列出全部未落实要点；
4. 未设置任何计划（焦点/事实/表格均空）的节，按正文是否实质响应节标题判定。
suggestion 写不超过 60 字的补写建议（full 时可为空串）。
```

## 新口径（v2，逐字）
```
1. 计划要点在正文中全部有对应落实 → covered=full；
2. 部分要点落实、存在遗漏 → covered=partial，missing_points 逐条列出遗漏的计划要点；
3. 正文为空或计划几乎全部未落实 → covered=missing，missing_points 列出全部未落实要点；
4. 正文出现超出招标要求与写作计划的加码承诺（更高的参数指标、免费赠送、缩短工期、加重违约责任等）→ covered=over，missing_points 逐条列出加码承诺点；over 与漏项并存时按更严重档判定（有遗漏优先 partial/missing）；
5. 未设置任何计划（焦点/事实/表格均空）的节，按正文是否实质响应节标题判定。
suggestion 写不超过 60 字的修复建议（full 时可为空串；over 时给出收敛口径）。
```

## 数据与交互影响
- CoverageLevel 联合类型 +"over"（数据模型，会话内 state，零 collection 变更）
- sanitize 归一四档；非法值回退逻辑不变（有 points→partial，无→full）
- UI：汇总 chip「过度承诺 N」、徽标 destructive 描边变体、卡片 border-destructive/30 bg-card、
  按钮"补写"→ over 行显示"修正"
- supplementFromAudit：over 注入收敛删除指令，非 over 保持补漏指令
- 快照测试用例更名并 -u 更新为 v2；新增 sanitizeCoverageAudit 四态单测 3 组

## 未一并实施（继续挂账）
- P7.1 另一残余「按章聚合回注改进建议（新交互范式）」：本轮不做，下轮评估
- P7.2「编造嫌疑未清零禁止导出」硬门禁：维持 R89 边界裁定（只报告不拦截），如需拦截请明示
