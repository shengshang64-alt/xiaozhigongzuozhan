// AI 调用错误码对用户可见中文文案的唯一来源。
//
// 背景（R105）：同一份「错误码中文表 + 未收录码兜底」逻辑此前在 5 个模块各抄一份
// （小智助手 / 方案编制 / 报价 PPT / 情报中心 / 客户管理），口径靠注释手工对齐，
// 已经出现两类偏差：
//   1. 客户管理把未收录错误码原样拼进提示串，内部码会直接暴露给用户，违反
//      「用户可见文案禁止暴露内部字段名与错误码」；
//   2. 各模块中文表逐字重复，新增错误码时只要漏改一处就会退回裸码。
//
// 口径：
//   - 命中错误码：返回对应中文文案（模块可用 copy 覆写，保留各页既有措辞）；
//   - 未命中但本身已是可读中文（后端拼好的中文详情串）：原样透出，避免吞掉细节；
//   - 其余（裸英文码 / HTTP 串 / 空串）：统一替换为 generic 中文兜底，绝不外泄内部码。
export const LLM_ERROR_ZH: Record<string, string> = {
  timeout: "AI 处理超时（可能服务器繁忙），请稍后重试",
  not_found: "请求未能到达 AI，请检查网络后重试",
  rh_login_required: "请先登录后再使用 AI",
  insufficient_balance: "RunningHub 账户余额不足，请充值后重试",
  user_cancelled: "已取消生成",
}

/**
 * 把 LLM / 模型网关返回的错误码翻译成用户能看懂的中文。
 * @param error 网关返回的错误码或错误串，可能为空
 * @param opts.generic 未收录 / 空值时的中文兜底（各页原有专属兜底串保持不变）
 * @param opts.copy 本模块的措辞覆写（仅覆写差异项，其余回落共享表）
 */
export function localizeLlmError(
  error?: string,
  opts?: { generic?: string; copy?: Record<string, string> },
): string {
  const generic = opts?.generic ?? "AI 调用失败，请稍后重试"
  const raw = (error ?? "").trim()
  if (!raw) return generic
  const mapped = opts?.copy?.[raw] ?? LLM_ERROR_ZH[raw]
  if (mapped) return mapped
  // 后端已拼好可读中文（含余额、审核、超时详情等）时直接透出，避免吞掉真实原因
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  return generic
}
