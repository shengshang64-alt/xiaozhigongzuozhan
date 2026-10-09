# R186 — 确定性 PII 逐字段脱敏引擎 + kbPolicy 敏感档接入（AGENTS.md #7）

日期：2026-10-06　轮次：R186　类型：A 类（清洁锚点新建 + 接线）　优先级：P2

## 1. 选题与缺口取证
巡检安全角度，锚 AGENTS.md #7「医院资料敏感：默认内网部署，禁止把文档原文发往第三方云（AI 调用仅发送必要片段）」。

- `kbPolicy.contextSnippetOf` 对敏感档（合同商务 / 资质证书，默认 `sanitized_summary`）此前只做**文档级**
  「只给摘要不给原文」：返回 `doc.summary`（或 `title`+`keywords` 兜底）。
- 但摘要 / 标题 / 关键词本身可能内嵌 **联系人手机号、法定代表人身份证、统一社会信用代码、银行账号、邮箱、座机**
  等 PII，仍会**逐字**发往第三方云。
- 全库 Grep（`脱敏|redact|mask|身份证|手机号|统一社会信用代码|银行卡|PII`）确认**无任何逐字段 masking 实现**，
  命中的 `slice(0,160)` 等均为展示截断，非脱敏。→ 真实缺口。

`kbPolicy.ts` / `kbPolicy.test.ts` 经 `git status` 核实均为**清洁文件**（非在途 M），可安全接线。
主链核心编排（useBidWorkspace/deckExports/quoteRecommend/pptQuoteTypes 等 56 个 M）本轮仍绕开。

## 2. 交付

### 2.1 `src/lib/piiRedact.ts`（新增，纯函数 · 零依赖 · 零 schema）
- `redactPii(text)`：掩码后文本。处理顺序 邮箱 → 统一社会信用代码 → 长数字串 → 座机。
- `findPii(text)`：命中列表（按位置排序、去重叠，长串优先）。`containsPii(text)`：布尔。
- **极大数字串优先**（`(?:^|\D)(\d{11,19}[Xx]?)(?=\D|$)`）：先整体吃掉 ≥11 位数字串，避免手机号在身份证 /
  银行卡内部被误切；仅用前导界定 + 前瞻，不使用 lookbehind（兼容运行时）。
- **身份证 / 银行卡 / 手机分类**：18 位→身份证（6/4）、15 位→身份证（6/3）、16–19 位→银行卡（4/4）、
  11 位且 `1[3-9]`→手机（3/4）。
- **USCC 消歧**（fix1）：`(?:^|[^0-9A-Za-z])([0-9A-Z]{2}\d{6}[0-9A-Z]{10})(?![0-9A-Za-z])` 且
  `isLikelyUscc` 要求**校验位以外仍有字母**才判 USCC；纯数字或 17 位+X 的 18 位串归身份证（CN 语料更常见）。
- 邮箱：局部首字母 + 完整域名保留（`z***@corp.com`）；座机要求连字符降误伤（区号 + 尾 2）。
- 掩码幂等：已脱敏文本（含 `*`）再跑不匹配，结果不变。

### 2.2 接入 `src/lib/kbPolicy.ts`
`contextSnippetOf` 敏感档分支的 `summary` / `title` / `keywords` 进 AI 前统一 `redactPii`：
```ts
if (summary) return `（脱敏摘要，原文不进 AI 上下文）${redactPii(summary)}`
return `（脱敏摘要，原文不进 AI 上下文）${redactPii(doc.title)}${keywords ? `；关键词：${redactPii(keywords)}` : ""}`
```
- `original` 档（非敏感）返回 `hit.snippet` **逐字不变** → 消费方行为等价、既有 25 用例零破坏。
- 消费方 `kbCore.ts` / `useKnowledge.ts` / `assistantCore` 仅调用该函数，签名与语义不变，无需改动（且 kbCore/kbAssemble 本轮在途 M，绕开）。

## 3. 测试（+20）
- `piiRedact.test.ts` 17 用例：手机 / 身份证(18·17+X·15·内含手机子串不误切) / 银行卡 / 邮箱 / USCC(含消歧) / 座机 /
  零误伤(金额·年份·章节号·ISO 编号) / 幂等 / findPii 多类与空 / containsPii。
- `kbPolicy.test.ts` 追加 R186 集成 3 用例：摘要手机号掩码且原文绝不出现 / 兜底标题·关键词掩码 / 非敏感 original 档不逐字段脱敏。

## 4. 四门
- `npx tsc -b`：exit 0，0 错误。
- `npx vitest run`：**1255 passed | 2 skipped**（108 文件；基线 R185=1235，净增 +20，零回退）。
- `npx eslint`（piiRedact.ts / piiRedact.test.ts / kbPolicy.ts / kbPolicy.test.ts）：**0 error / 0 warning**。
- `npx vite build`：5958 modules transformed，built in **3.17s**。

## 5. 遗留（入账本 P3 backlog）
`r186-pii-redact-ai-assembly-wiring`：其余进 AI 上下文装配点（assistantCore 小智注入 / kbAssemble 拼装 /
competitorEvidence）接入 `redactPii` —— 目标文件本轮多为在途 M，待稳定后接线并补单测。
