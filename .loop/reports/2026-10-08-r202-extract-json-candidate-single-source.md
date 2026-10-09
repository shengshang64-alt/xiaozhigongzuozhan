# R202 · AI-JSON 截候选单一真源收敛（extractJsonCandidate）

日期：2026-10-08 ｜ 轮次：R202 ｜ 优先级：P2 ｜ 类型：A 类重构（零 schema / 零 collection / 零 pb_hooks / 零提示词）

## 背景与选题
中央容错解析模块 `src/lib/jsonTolerant.ts`（CLEAN）被标书 / 方案 / PPT 三条主链路共用。
其三个消费者在「把 AI 原始输出剥去 ```json 代码围栏、截出一段可解析的 JSON 候选串」这一步上，
存在**逐字节相同**的重复实现——正是本项目反复收敛的「平行实现漂移」模式
（R105 llmError、R113 money、R114 dateDisplay、R116 fileName、R117 datetime）。

- `solutionTypes.parseOutlineJson`（L389-400，MOD 文件 pristine 区，距最近 hunk 260/478 均远）
- `pptQuoteTypes.parseJsonLoose`（L568-579，MOD 文件 pristine 区，距最近 hunk 214/633 均远）
- `bidTypes.extractJsonLoose`（L4080-4096，MOD 文件 pristine 区，距最近 hunk 3708/4738 均远）

优先 backlog 两项经核实均已闭合（quote-history-01 报价历史二期 r102/r131/r176 done、
prompt-fabscan-03 残余 r103 closed）；docs/13 §3.3（429 通道自动回退）落点
modelGateway/llm/aigc 全在途，本轮真阻塞，按裁定不触碰。故选此实质项。

## 改动
### 新增单一真源 `jsonTolerant.ts`
```ts
export function extractJsonCandidate(
  text: string,
  opts?: { truncateFromOpen?: boolean },
): string
```
- trim → 剥离开头 ```/```json 与结尾 ```；
- 数组起点早于对象（或无对象）取 `[..]`，否则取 `{..}`，截到最后一个对应闭括号；
- 截不到闭括号时：默认返回空串（交由上层解析级报错）；仅当 `truncateFromOpen` 为真，
  才从首个 `{`/`[` 取到末尾交给结构修复器兜底（精确复刻 bidTypes 原有截断容错路径）。

### 三处迁移（行为等价）
- `parseOutlineJson`：截串 12 行 → `const candidate = extractJsonCandidate(text)`
- `parseJsonLoose`：同 → `extractJsonCandidate(text)`
- `extractJsonLoose`：同 → `extractJsonCandidate(text, { truncateFromOpen: true })`（保留其截断兜底）

各自的 `parseJsonTolerant(...)` 调用与错误文案（"大纲格式解析失败" /
"AI 返回格式解析失败，请重试" / "AI 返回内容不是有效 JSON，请重试"）逐字不变。

### 测试 `jsonTolerant.test.ts`
新增 `describe("extractJsonCandidate")` 7 用例：裸对象截到末 `}`、剥 ```json 围栏、
前后夹带散文、数组顶层优先、无 JSON 起点返回空串、截断双分支（默认空 vs truncateFromOpen 取到结尾）、
null/undefined 回落空串。

## 四门验证（目标项目目录）
- `npx tsc -b`：**零错误**（中途修 1 处：test 里 undefined 用例补 `as unknown as string` 转型）
- `npx vitest run`：**128 files / 1508 passed / 2 skipped**（基线 1501，本轮 +7，无回归）
- `npx eslint`（触及 5 文件）：本次改动区**零新增 error**。bidTypes 3568/3570 的 2 条
  `no-control-regex` 经核为**已提交(HEAD)既有代码**（不在任何 git-diff hunk 内、与 jsonTolerant 无关），
  按「在途/既有 error 不算」裁定不触碰。
- `npx vite build`：**✓ built in 4.25s**

## 在途安全
bidTypes / solutionTypes / pptQuoteTypes 均为 M（在途）文件，改动全部落在远离各 hunk 的 pristine 区，
每个锚点 `assert count==1`；补丁事务式（先算全部新内容并跑完断言再落盘）。未 git commit。

## 影响
标书 / 方案 / PPT 三条 AI 解析链路对脏输出（代码围栏、夹带散文、被截断）的截取行为收敛为一处，
后续任何截串修复只需改 `extractJsonCandidate` 单点，消除三处需同步维护的隐患。
