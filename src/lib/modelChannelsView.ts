/**
 * 「通道与默认」屏的派生数据（纯函数，无 DOM / 无 IO）。
 *
 * 这一屏要展示的每个格子都必须能指回一个真源，否则宁可不显示：
 *   通道连通状态 → GatewayConfig.last_check_status（**后端目前从不写入**，见下）
 *   通道模型数   → config.models（真）
 *   最近测试     → lib/modelTestLog 的本地台账（用户点过测试才有）
 *   今日调用     → 无真源（网关不落调用台账）→ 显示「—」
 *   默认来源     → buildAvailableModels 的 defaultRef（真）
 *
 * 关于 last_check_status：字段在类型里存在，但全仓搜不到写入方（pb_hooks 侧没有），
 * 实测每个配置回来都是空串。所以「已连通」不能由它推导——空串就是「未测过」，
 * 这条规则写在 channelStatusOf 里，避免有人把「空」当「通」。
 */
import type { GatewayConfig } from "@/lib/modelGateway"
import type { ModelTestLogEntry } from "@/lib/modelTestLog"

/** 通道连通状态：ok / error 来自后端字段，untested = 一次都没测过（最常见的真实情况） */
export type ChannelStatus = "ok" | "error" | "untested"

export interface ChannelView {
  id: string
  name: string
  isPlatform: boolean
  /** Key 是否已配置（平台内置无 Key，恒 false） */
  hasKey: boolean
  baseUrl: string
  apiKeyMasked: string
  modelTotal: number
  modelEnabled: number
  status: ChannelStatus
  /** 后端记录的错误原文（仅 status=error 时有意义） */
  lastCheckError: string
  /** 该通道最近一次**真实测试**（来自本地台账）；没测过为 null */
  lastTest: ModelTestLogEntry | null
  /** 该通道是否被声明为当前默认来源 */
  isDefaultSource: boolean
  /** 模型列表为空（拉取失败或还没拉） */
  noModels: boolean
}

/**
 * 通道状态口径：
 *  - 显式 error → error
 *  - 显式 ok → ok
 *  - 其余（含空串、未知值）→ untested
 * 不许把空串当 ok：那会把「从没验证过」显示成「已连通」。
 */
export function channelStatusOf(raw: string | null | undefined): ChannelStatus {
  if (raw === "ok") return "ok"
  if (raw === "error") return "error"
  return "untested"
}

/** API Key 回显：后端已脱敏（sk-***woQ7 这类），这里只做空值与超长的兜底 */
export function describeKey(cfg: Pick<GatewayConfig, "has_key" | "api_key_masked" | "is_platform">): string {
  if (cfg.is_platform) return "无需 Key"
  if (!cfg.has_key) return "未配置 Key"
  const masked = (cfg.api_key_masked ?? "").trim()
  return masked || "已配置（掩码不可用）"
}

/** 把配置 + 台账摊成一张通道卡数据 */
export function buildChannelViews(
  configs: GatewayConfig[],
  testLog: ModelTestLogEntry[],
  defaultSourceConfigId: string | null,
): ChannelView[] {
  // 每个配置只取最近一次测试（台账已按时间倒序）
  const latestByConfig = new Map<string, ModelTestLogEntry>()
  for (const e of testLog) {
    if (!e.configId) continue
    if (!latestByConfig.has(e.configId)) latestByConfig.set(e.configId, e)
  }
  return configs.map((cfg) => {
    const models = cfg.models ?? []
    return {
      id: cfg.id,
      name: cfg.config_name || (cfg.is_platform ? "平台内置" : "未命名通道"),
      isPlatform: cfg.is_platform,
      hasKey: cfg.has_key,
      baseUrl: cfg.base_url ?? "",
      apiKeyMasked: describeKey(cfg),
      modelTotal: models.length,
      modelEnabled: models.filter((m) => m.enabled).length,
      status: channelStatusOf(cfg.last_check_status),
      lastCheckError: cfg.last_check_error ?? "",
      lastTest: latestByConfig.get(cfg.id) ?? null,
      isDefaultSource: !!defaultSourceConfigId && cfg.id === defaultSourceConfigId,
      noModels: models.length === 0,
    }
  })
}

/** 页头统计：可用/不可用通道数、可用模型数 —— 全部由真实字段算，不去猜 */
export function summarizeChannels(views: ChannelView[]): {
  total: number
  connected: number
  errored: number
  untested: number
  usableModels: number
} {
  let connected = 0
  let errored = 0
  let untested = 0
  let usableModels = 0
  for (const v of views) {
    if (v.status === "ok") connected += 1
    else if (v.status === "error") errored += 1
    else untested += 1
    // 平台内置在本机不可用：不计入「可用模型」。判定在调用方（需要 hostname），
    // 这里只报「已启用模型数」，避免两处各判一套。
    usableModels += v.modelEnabled
  }
  return { total: views.length, connected, errored, untested, usableModels }
}

/**
 * 默认模型链的「层级」口径。
 *
 * ⚠️ 原型画了三层（全局默认 / 方案生成 / 标书正文），但现网**没有按功能指定模型**的字段：
 * 方案、标书、PPT、助手全部读同一个 defaultRef。所以本屏只渲染一行「全局默认」，
 * 并明说「其余功能均跟随全局默认」——不画三行假的层级，也不提供改不动的下拉。
 * 该能力的真实名称是「按功能路由」，需要后端新增字段，属于 TODO:routing。
 */
export const DEFAULT_CHAIN_LEVELS = [
  {
    key: "global",
    label: "① 全局默认",
    scope: "兜底：任何未单独指定的功能",
    affects: "方案生成 / 标书正文 / 助手对话 / 情报摘要 / 客户跟进建议 / 记忆提取",
  },
] as const
