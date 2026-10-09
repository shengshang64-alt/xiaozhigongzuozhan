# R188 PII 二次掩码接入其余 AI 上下文装配点（闭环 r186 挂账）

- 轮次：R188（round 187 → 188）
- 选题：backlog `r186-pii-redact-ai-assembly-wiring`（P3·A 类）——R186 交付 piiRedact 内核并接入 `kbPolicy.contextSnippetOf` 时，明确挂账「其余装配点待稳定后接线」。
- 优先级核对：用户点名的 `quote-history-01`（R102 已 closed）、`prompt-fabscan-03`（R89/R101/R103 已 closed）经账本核实均已收口，本轮另择实质项。

## 一、选题依据与红线复核

R186 当年绕开装配点的唯一理由是「kbAssemble.ts/kbCore.ts 本轮 git M，疑用户未提交在途」。本轮先复核这些 git M 的真实来源：

- `git diff src/lib/kbCore.ts` → 仅 R161 死码清理删除的 `scoreKbDoc`（hunk 在 523 行）。
- `git diff src/lib/kbAssemble.ts` → 仅 R161 删除的 `formatAssembleHits`（hunk 在 176 行）。
- `competitorEvidence.ts` / 其 test → git 完全 CLEAN。

结论：这些 git M 是**历轮自主迭代积累、从未 commit 的产物**，而非用户并发手写的新功能代码，误伤红线前提解除，可安全接线。

## 二、本轮发现并封堵的三处真实泄漏

| # | 装配点 | 泄漏形态 | 修复 |
|---|--------|----------|------|
| 1 | `kbPolicy.contextSnippetOf` | `original` 档逐字返回 `hit.snippet`，即便文档被显式标 `is_sensitive=true` 也原文进 AI | `policy.is_sensitive ? redactPii(hit.snippet) : hit.snippet`；非敏感 original 档逐字不变 |
| 2 | `kbCore.formatKbHitsForAssistant`（小智取数回填） | 「命中片段」走 contextSnippetOf 已脱敏，但「摘要」字段直接塞 `h.doc.summary` 原文**绕过脱敏**——敏感档泄漏 | `redactPii((h.doc.summary || "").slice(0, 120))` |
| 3 | `competitorEvidence.formatKbSection`（竞品事实聚合 → user message） | 原始 doc 片段 `h.snippet` 原样拼进发往第三方云的事实串 | 片段串 `redactPii(h.snippet)`；本地 `EvidenceBundle.kb.snippet` 数据逐字不变，仅云端文案脱敏 |

三处均只处理高置信、低误伤 PII（手机 / 身份证 / 银行卡 / 统一社会信用代码 / 邮箱 / 座机），脱敏口径复用 R186 已 17 单测锁死的 `redactPii`。

## 三、变更文件

- `src/lib/kbPolicy.ts` — contextSnippetOf original 敏感档二次掩码
- `src/lib/kbCore.ts` — `import { redactPii }` + formatKbHitsForAssistant 摘要脱敏
- `src/pages/Competitors/competitorEvidence.ts` — `import { redactPii }` + formatKbSection 片段脱敏；顺带清 L332 `no-useless-assignment` 死存储（`let hits: KbSearchHit[] = []` 初值从未被读，try 重赋、catch 早返回，行为等价）
- `src/lib/kbPolicy.test.ts` — +2 用例
- `src/lib/kbCoreAssistant.test.ts` — 新建，2 用例
- `src/pages/Competitors/competitorEvidence.test.ts` — +1 用例
- `scripts/r188_pii_assembly_wiring.py` / `scripts/r188_ledger_writeback.py`

## 四、测试增量

- `contextSnippetOf original 敏感档二次掩码（R188）`：① original+is_sensitive=true 命中片段的手机号 13800138000→138****8000、邮箱 lisi@hospital.cn→l***@hospital.cn；② original 非敏感档命中片段逐字原样（回归锁，含数字也不动）。
- `formatKbHitsForAssistant 摘要 PII 二次掩码（R188）`：① 敏感档摘要含手机号被掩码；② 无 PII 摘要逐字保留（零行为变更）。
- `assembleEvidenceContext 知识库片段 PII 二次掩码（R188）`：KB 片段含手机号时进入 AI 的事实串被掩码。

端到端安全语义由**真实调用三个装配函数**断言，属不可见脱敏变换，非浏览器截图可替代。

## 五、四门验证

| 门 | 结果 |
|----|------|
| `npx tsc -b` | exit0，0 错误（删死存储后 `hits` 变量定值分析通过） |
| `npx vitest run` | **1273 passed / 2 skipped**（109 文件；基线 R187=1268，净增 **+5** = kbPolicy 2 + kbCoreAssistant 2 + competitorEvidence 1，零回退） |
| `npx eslint`（触及 6 文件） | **0 error / 0 warning**（净新增 0，且顺带把 competitorEvidence.ts 既有 no-useless-assignment 由 1→0） |
| `npx vite build` | 5959 modules，3.06s |

## 六、维持裁定与边界

- 零提示词（无 B 类，PROMPT_VERSION 不变）、零 collection、零 pb_hooks、会话零 state、未 commit。
- 维持：编造未清零禁导出=只报不拦（R89）、lint-debt-01 有意保留残余不重构——本轮未触碰其范围。
- `r169-ppt-template-master-fidelity` 切片② 经勘察判定为「母版保真通道与 pptxgenjs 图表/图片页混合单文件」的重组难题 + 需持久化模板原始字节（存储/数据模型改动）+ 需真实公司模板自测，不属单轮安全可诚实自测范围，继续挂账不强行开工。

## 七、后续挂账

- `r186` 已闭环。若后续出现新的进 AI 文本装配点（如新增技能写回路径），沿用本轮「凡发第三方云的 KB/客户派生文本统一 redactPii」口径。
