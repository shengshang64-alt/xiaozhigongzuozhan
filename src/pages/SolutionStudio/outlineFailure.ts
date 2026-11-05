/**
 * 方案大纲生成失败的**用户可见归因**（纯函数，零 React / 零网络）。
 *
 * 背景（阶段 1 · 包 1「方案大纲失败可见」）：
 *   `useSolutionStudio.generateOutlineDraft` 原先只有一个 catch：
 *
 *     const reason = e instanceof Error ? e.message : "大纲生成失败"
 *     const msg = `${reason}，可直接重试`
 *
 *   ？？这个问题有三层：
 *   ① **所有**失败都被无差别追加「，可直接重试」——超时 / 鉴权失效 / 未配置模型
 *      直接重试都是白试（还要再付一次费用），这句话把用户往错的方向推；
 *   ② 错误串**未经 llmError 归一**就透出：`llmGenerate` 抛的是 `localizeLlmError` 处理过的
 *      中文串（没问题），但 `parseOutlineJson` 抛的是「大纲格式解析失败」——
 *      而**模型正常返回了 JSON、只是没有任何有效章节**也会走到同一句，把
 *      「模型返回空大纲」误报成「格式解析失败」，排查方向直接跑偏；
 *   ③ 失败原因只进 toast 与向导内联条，不区分「要不要重试 / 该改什么」。
 *
 * 本模块把 catch 到的异常归成一类可执行结论：**是什么 + 该做什么**，
 * 由调用方直接展示（不再自己拼「可直接重试」）。
 */

/** 失败归因分类：每一类对应一个不同的用户动作 */
export type OutlineFailKind =
  | "no_model"
  | "auth"
  | "timeout"
  | "empty_outline"
  | "non_json"
  | "parse"
  | "quota"
  | "network"
  | "unknown"

/** 每种归因的「下一步做什么」——与 kind 一一对应，避免调用点各自编台词 */
export const OUTLINE_FAIL_ACTION: Record<OutlineFailKind, string> = {
  no_model: "请先到「模型配置」添加一条可用通道并启用模型，再回来生成大纲",
  auth: "请重新登录后再生成大纲",
  timeout: "可直接重试；若反复超时，请换响应更快的已配置模型，或减少本次勾选的系统数量",
  empty_outline: "模型这次没给出任何章节，可直接重试；多次为空请换一个模型",
  non_json: "模型返回了非结构化文本，可直接重试；反复出现请换一个更适合结构化输出的模型",
  parse: "模型返回的大纲结构无法解析，可直接重试；反复出现请换模型或精简输入",
  quota: "该模型通道额度/频率受限，请稍后重试或切换到其他已配置模型",
  network: "请检查网络与模型通道是否可用后重试",
  unknown: "请稍后重试；若反复出现，请切换到其他已配置模型",
}

/** 归因的人类可读短名（用于内联提示前缀） */
export const OUTLINE_FAIL_TITLE: Record<OutlineFailKind, string> = {
  no_model: "未配置可用模型",
  auth: "登录状态失效",
  timeout: "生成超时",
  empty_outline: "模型返回空大纲",
  non_json: "模型未按 JSON 返回",
  parse: "大纲结构解析失败",
  quota: "模型通道额度受限",
  network: "网络异常",
  unknown: "大纲生成失败",
}

/**
 * 把异常归类。
 *
 * 顺序即口径（先专用的、后泛化的）：
 *   · 未配置模型 / 鉴权 / 额度 是**确定性**失败——重试无用，必须先改配置；
 *   · 超时 → 空大纲 → 非 JSON → 解析，是「模型侧产出问题」的从具体到泛化；
 *   · 网络最后；都认不出才 unknown（宁可说不知道，也不硬塞一个错的原因）。
 *
 * 判据来自本仓真实报文，不臆造：
 *   - modelGateway `PERSONAL_TIMEOUT_MSG` / llmError `timeout`
 *   - modelGateway `PERSONAL_CONFIG_UNAVAILABLE_HINT`
 *   - solutionTypes.parseOutlineJson「大纲格式解析失败」（**注意**：该串同时覆盖
 *     「没给 JSON」与「JSON 里没有章节」，所以要先判空大纲再判解析）
 */
export function classifyOutlineFail(e: unknown): OutlineFailKind {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : ""
  const msg = (raw ?? "").trim()
  if (!msg) return "unknown"
  // 未配置 / 配置不可用：确定性失败，重试白花钱
  if (/未配置|没有可用|暂无可用|没有其他可用的已启用通道|配置不可用|personal_config_unavailable|请先到「模型配置」/.test(msg)) {
    return "no_model"
  }
  if (/登录|登录态|重新登录|rh_login_required|unauthor|401|403/i.test(msg)) return "auth"
  if (/超时|timeout|timed?\s*out|deadline/i.test(msg)) return "timeout"
  // 额度 / 限流要在「解析/网络」之前——429 的原文常同时含"接口返回异常"
  if (/额度|余额|欠费|限流|频率|quota|rate.?limit|\b429\b/i.test(msg)) return "quota"
  // 「空大纲」必须在「解析失败」之前：模型给了合法 JSON 但 chapters 为空，
  // 也会经由 parseOutlineJson 抛「大纲格式解析失败」，先判空才不会误报。
  if (/大纲为空|未产出任何章节|没有有效章节|章节为空|空大纲|模型返回空正文/.test(msg)) return "empty_outline"
  if (/未按 JSON|非结构化|散文|空内容/.test(msg)) return "non_json"
  if (/解析失败|格式解析|无法解析|JSON/i.test(msg)) return "parse"
  if (/网络|Failed to fetch|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|50[234]|网关/i.test(msg)) return "network"
  return "unknown"
}

export interface OutlineFailCopy {
  kind: OutlineFailKind
  /** 可直接展示的一行：`<短名>：<下一步>`；原报文已可读时附在末尾作证据 */
  text: string
  /** 是否值得用户「直接重试」（确定性失败为 false，避免引导重复付费） */
  retryable: boolean
}

/**
 * 生成用户可见文案。
 *
 * @param e     catch 到的异常
 * @param fallback 认不出时的兜底短名（保持各调用点原有措辞）
 */
export function outlineFailCopy(e: unknown, fallback = "大纲生成失败"): OutlineFailCopy {
  const kind = classifyOutlineFail(e)
  const raw = e instanceof Error ? e.message.trim() : typeof e === "string" ? e.trim() : ""
  const title = kind === "unknown" && fallback ? fallback : OUTLINE_FAIL_TITLE[kind]
  const action = OUTLINE_FAIL_ACTION[kind]
  // 原报文若已是可读中文（llmError 归一后的真因，如「模型服务繁忙（HTTP 503）…」），
  // 就把它保留成证据——但不能和 action 重复堆成两句话把用户绕晕。
  const detail = raw && /[\u4e00-\u9fff]/.test(raw) && !raw.includes(action) ? raw.replace(/[。；]\s*$/, "") : ""
  const text = detail && detail !== title ? `${title}：${action}（模型原文：${detail}）` : `${title}：${action}`
  return {
    kind,
    text,
    // 确定性失败不引导重试：auth / no_model / quota 重试都是白花钱
    retryable: kind !== "auth" && kind !== "no_model",
  }
}
