# R120 AI 生成 JSON 容错解析补默认结构修复 + 补共用模块单测

- 轮次：R119 → **R120**
- 日期：2026-10-02
- 选题来源：巡检新角度（AI 输出可靠性 / 测试空白），非既有 backlog 主项
  - quote-history-01 / prompt-fabscan-03 均已 closed；prompt-fabscan-03 残余「按章聚合回注改进建议」
    属提示词 B 类改动且已在 R89 收口，本轮不重开；
  - lint-debt-01 / r112 / money-count / r119-dead-export 四条 defer 均仍命中未提交在途
    （bidTypes/pptQuoteTypes/CompetitorCharts/aigc… 全部 git M；QualCertsPage 仍 `??` 未跟踪），
    按红线绕开，不动；
  - 巡检定位到 `src/lib/jsonTolerant.ts`（标书/方案/PPT **三处共用**的 AI-JSON 容错解析入口）
    此前**零独立单测**，且两个调用方（PptQuote、SolutionStudio）**未传结构修复器**，
    对模型被 max-token 截断的半截 JSON 直接抛「不是有效 JSON」硬失败。
- 类型：实质性可靠性修复 + 测试补齐；**零提示词、零 collection/会话内 state、未 commit**

## 一、核心修复：parseJsonTolerant 缺省即兜底截断（r120-json-repair-default-01）

### 问题
`parseJsonTolerant(text, repair?)` 的「结构修复级」完全依赖调用方显式传入 `repair`：
- `bidTypes.ts` 传了自己的 `repairJsonCandidate`（补括号/去尾逗号），行为正常；
- `pptQuoteTypes.ts` / `solutionTypes.ts` 只调 `parseJsonTolerant(candidate)`，**不传 repair**。

大模型在长输出（整册报价表 / 方案 JSON）里因 token 上限被**中途截断**是高频场景，
此时原始串与「转义控制字符」两级都救不回未闭合的 `{`/`[`，直接落到末尾 `throw`，
用户看到「AI 返回内容不是有效 JSON，请重试」而前功尽弃。三处共用逻辑里两处有此短板。

### 修复（仅动 git-clean 的 jsonTolerant.ts，不碰三个 M 状态调用方）
1. 新增导出 `repairJsonStructure(s)`：把 bidTypes 私有 `repairJsonCandidate` 的成熟口径
   （去尾逗号 → 停在字符串中补闭合引号 → 按未闭合 `{`/`[` 栈逆序补全）**通用化上提**到共用层。
2. `parseJsonTolerant` 中 `const fix = repair ?? repairJsonStructure`：
   - 未传 repair 者（PptQuote/SolutionStudio）自动获得截断兜底；
   - 显式传 repair 者（bidTypes）`fix === repair`，**行为字节级不变**，无回归；
   - 修复级始终排在原始串直接解析之后（`attempts=[text, fix(text), escaped, fix(escaped)]`），
     **合法 JSON 第一尝试即命中，修复绝不篡改正确数据**。

零新 collection、零会话 state、不触碰 pb_hooks 红线；对 M 状态调用方零改动（改的是它们 import 的 clean 依赖）。

## 二、测试补齐（src/lib/jsonTolerant.test.ts，新增 15 用例）
该跨模块共用工具此前无任何测试。新增覆盖三个导出：
- `escapeControlCharsInStrings`：字符串内裸换行/制表/0x01 转义、结构区原样保留、已有合法转义不二次转义；
- `repairJsonStructure`：补未闭合括号、去尾逗号、停字符串中补引号、合法 JSON 幂等；
- `parseJsonTolerant`：合法 JSON 与 JSON.parse 完全等价、缺省兜底截断、缺省兜底尾逗号、
  裸控制字符+截断叠加组合、显式 repair 覆盖缺省（spy 命中）、彻底乱码抛可读错误、数组顶层截断。

## 三、四门验证（目标项目目录）
| 门 | 结果 |
|---|---|
| `npx tsc -b` | exit 0，零错误 |
| `npx vitest run` | 74 files，**742 passed / 2 skipped**（基线 727 → +15 = jsonTolerant 新用例）|
| `npx eslint` 触及文件 | `jsonTolerant.ts` + `jsonTolerant.test.ts` **0 error** |
| `npx vite build` | exit 0，built in 4.27s |

## 四、维持既有裁定不动
- 编造嫌疑未清零禁导出硬门禁：维持 R89「只报告不拦截」，不动；
- lint-debt-01 bidTypes 残余：有意保留不重构，不动；
- r112/money-count/r119-dead-export 三条 defer：所在文件仍为未提交在途（`??`/`M`），继续绕开。

## 五、回滚与安全
- 改动前 `jsonTolerant.ts` 备份于 `d:\KFDXCX\MedPreSales\.qoder\tmp\r120_backup\`；
- 账本 `ledger.json.bak-r120`；
- 全程未 `git commit`；仅修改 1 个 git-clean 已跟踪源码文件 + 新增 1 个测试文件，可经 git 恢复。
