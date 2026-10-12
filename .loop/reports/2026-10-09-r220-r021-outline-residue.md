# R220 · R-021 残句治理（第 2 轮改造 · 标书链第一 slice）

## 选题依据
第 2 轮交付指令 §二 实测：《建阳区总医院设备及信息化建设》32 个技术章里 20 个（62%）是
把招标原文句子/评分说明切成碎片当章节标题，另有「术语管理/术语维护管理/术语细项管理/
术语校验管理」4 个 AI 冗余顶层章。用户拍板：本轮先做标书链，顺序 R-021→R-025→R-020/023
→R-022→R-017/018；R-021 最独立、见效最快，先做。

## 变更文件
- 新增 src/pages/BidWorkspace/outlineResidue.ts（纯本地零 AI：残句识别 + 顶层残句并入主题父章 +
  子级残句合并回父章 + 同后缀冗余兄弟章合并；叶子正文一律保留不删除）
- 新增 src/pages/BidWorkspace/outlineResidue.test.ts（6 例：14 条建阳区残句全命中、14 条合法章节零误伤）
- 改 src/pages/BidWorkspace/useBidWorkspace.ts（import；新增 outlineResidueFixes state；大纲收尾
  setOutlineDraft 前调 cleanOutlineResidue + toast「已自动修正 N 处」；hook 返回值暴露 outlineResidueFixes）
- 改 src/pages/BidWorkspace/BidWorkspacePage.tsx（activeStep===3 大纲上方渲染「原→新」留痕 <details>，
  零涟漪不改 ComposeStep 百余项 props）

## 残句识别特征（可配置，命中显式表才判残句，宁漏勿误伤）
- 起头片段：投标人在/投标人所/小时内/必须为/必须针对/应在/费用应/保证提供/收到/交货条件/
  根据当地/评分项提及/培训对象分为/培训内容包括/所有系统均需/与培训相关/业务系统操作
- 悬空结尾：在/的/基础上/未解决的/等提出/之前/之内/之中/以及
- 含「应/须/需」要求性动词且不足 14 字、或过短且非名词性后缀
- 合法名词后缀白名单豁免（方案/设计/表/期/测试/响应/条款…）：避免误伤「质保期」「信创符合性测试」

## 四门验证
- tsc --noEmit：0 error
- vitest run：1605 passed | 2 skipped（基线 1599，+6 全绿，0 回归）
- eslint（4 文件）：新增文件 0 issue；useBidWorkspace 报错全在未触碰的历史行（setState-in-effect
  L1132/1196/1282/2989、no-useless-assignment L7992），零新增
- npm run build：success 3.48s

## 遗留 / 后续
- 实机 AI 回归按用户选择走「另建演练项目」，不动建阳区已生成正文；拟在标书链后段合并一次实机验证。
- 顶层残句并入的主题父章是 R-021 保守落地，R-023 双层目录会按评分表要点进一步细化父章与子节。
