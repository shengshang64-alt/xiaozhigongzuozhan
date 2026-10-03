# R125 — kbPolicy.ts 补共置单测（敏感文档脱敏隐私不变量）

- 日期：2026-10-02
- round：124 → 125
- 类型：巡检新角度（共用纯逻辑模块 0 独立单测盲区）· 实质性可靠性/隐私锁死
- 触及：仅新增 src/lib/kbPolicy.test.ts（25 用例）；**零改生产代码 / 零提示词 / 零 collection / 零 pb_hooks**

## 1. 选题依据
账本 round=124。建议的两条实质主项均已 closed：
- quote-history-01：一期 R40 / 沉淀通道 R79 / 二期 R102(r102-quote-history-phase2) 全链路交付完成；
- prompt-fabscan-03：P7.1 四态 R101 / P7.2 content-guard-03 / 按章聚合回注 R103 全部收口关闭。

四个 defer 项（r112-datestamp-qualcerts / money-count-defer-composestep / r119-dead-export-mwip /
r124-solutionstudio-docx）经 git status 复核，所在文件（ComposeStep / CompetitorCharts / aigc /
kbAssemble / kbCore / rhLogin / bidFiles / competitorScores / deckExports / pptQuoteTypes /
useSolutionStudio）**全部仍为 git M 在途**，命中在途保护，本轮不动。

巡检 src/lib 测试覆盖，定位 kbPolicy.ts：git-CLEAN、被约 13 处生产代码 import
（kbCore 检索 / useKnowledge 问答 / assistantCore 小智注入 / competitorEvidence / DocPolicySection 等），
是「三处口径唯一真相源」，却无任何独立单测——正是值得锁死的实质盲区。

## 2. 锁死点
1. **contextSnippetOf 隐私不变量（AGENTS.md #7 医院资料敏感）**：sanitized_summary 档（合同商务/资质证书默认）
   进 AI 只给『（脱敏摘要，原文不进 AI 上下文）…』；有摘要用摘要、无摘要回退标题+关键词、再无则仅标题；
   三条兜底路径均断言 `not.toContain` 原文 snippet（合同金额 / 证书编号 / 保密条款原文）。
   显式覆盖为 original 的敏感档才放行原文；original 档原样返回 hit.snippet。
2. **effectivePolicy 显式覆盖口径**：ai_context_mode 三值白名单（非法串如 'weird' 不算覆盖，整体回落分类默认）；
   retrieval_weight 仅 >0 生效（0/负/缺省回落分类默认，如资质证书 0.5）；is_sensitive 需显式 ===true；
   未知分类兜底『其他』(original / 1.0 / false)。
3. **categoryOf**：合法分类原样，非法/空/缺省/null/undefined 归『其他』。
4. **guessCategoryFromFileName**：规则优先级顺序（合同商务先于技术方案）+ 资质 / 产品 / 其他。
5. **classifyKbDoc**：ISBN 出版物守卫（文件名 97+11 位数字，即便正文含『软件著作权』仍归其他 score=0）；
   文件名命中加权 ×3 压倒正文（『产品彩页』判产品资料而非正文的技术方案）；纯正文语料判政策法规 score>0；
   全 0 回退文件名猜测且 score 记 0。
6. 词表/默认策略断言：KB_CATEGORIES 七档、敏感档默认 sanitized_summary/0.5/is_sensitive=true、
   产品资料·技术方案 original/1.2、AI_CONTEXT_MODE_LABELS 三档中文标签。

## 3. 四门验证（目标项目目录）
- `npx tsc -b`：exit 0，零错误。
- `npx vitest run`：**806 passed | 2 skipped**（基线 781，本轮 +25 = 新增用例，单文件 25/25 首跑即过）。
- `npx eslint src/lib/kbPolicy.test.ts`：exit 0，新增 0 error。
- `npx vite build`：exit 0，built in 3.05s。

## 4. 维持裁定 & 在途保护
- 编造嫌疑未清零禁止导出：维持 R89『只报告不拦截』，不实施硬门禁。
- lint-debt-01：残余 5 项有意保留，不重构。
- 四个 defer 项：所在文件本轮复核仍全部 git-M 在途，绕开并记录。
- 未执行 git commit。
