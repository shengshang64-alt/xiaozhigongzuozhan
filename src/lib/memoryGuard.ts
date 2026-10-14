// ---------------------------------------------------------------------------
// R009（D-2 修复）：脏记忆护栏。
// 总纲 1.4 记忆协议明确规定「一次性状态、元话术禁止沉淀为 fact」，本模块把该条款
// 落成两层：① 提示词准入规则文本（MEMORY_FACT_RULES，拼入 system prompt）；
// ② 解析侧确定性过滤（isOneOffFact / filterMemories），拦住明确的一次性表述。
// 只对 fact 生效；preference / habit 不受影响；格式与触发条件不变（红线 4.1）。
// ---------------------------------------------------------------------------

/** 拼入记忆抽取协议的 fact 准入规则（与 isOneOffFact 保持同一口径） */
export const MEMORY_FACT_RULES = `fact 准入检验（必须通过「时间无关测试」：去掉时间词后三个月内仍然成立）。以下一律不得沉淀为 fact：
- 一次性状态：正在生成/正在解析/刚上传/刚创建/当前打开的某项目
- 本次对话细节：本轮任务、临时数字、中间结论
- 绝对时间事件：今天/明天/下周几要做什么（那应记入待办，不是长期记忆）
- 元话术：用户问了什么、你回答了什么
正例：fact|用户主营电子病历与互联互通方向的三甲医院项目
反例：fact|用户正在编辑第3章方案正文 ✘\u3000fact|今天上传了一份招标文件 ✘`

/** 判断一条 fact 是否为明确的一次性/元话术表述（只拦无争议信号，宁缺勿滥） */
export function isOneOffFact(content: string): boolean {
  const s = (content ?? "").trim()
  if (!s) return true
  if (/^(今天|今天早上|今天下午|昨天|刚才|刚刚|现在|此刻|这次|本次|当前会话)/.test(s)) return true
  if (/正在(生成|解析|上传|创建|编辑|打开|处理|编写|运行|加载)/.test(s)) return true
  if (/刚刚\s*(上传|创建|删除|打开|导出)/.test(s)) return true
  if (/(这轮|这次|本次)(对话|提问|任务|会话)/.test(s)) return true
  if (/^(用户)?(问了|问过)/.test(s)) return true
  return false
}

/** 解析侧过滤：剔除一次性 fact；preference / habit 原样保留 */
export function filterMemories<T extends { group: string; content: string }>(
  memories: T[],
): T[] {
  return memories.filter((m) => m.group !== "fact" || !isOneOffFact(m.content))
}
