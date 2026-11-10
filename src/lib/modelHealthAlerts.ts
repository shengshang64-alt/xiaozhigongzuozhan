/**
 * 健康看板 · 失败告警聚合（纯函数，无 DOM / 无 IO）。
 *
 * 数据源只有一个：`lib/modelHealth` 的「实测不可用」长期档案（404 已下线 / 上游停用 /
 * Key 失效 / 额度耗尽）。网关**不落按次调用台账**，所以这里不编造「失败 N 次」「成功率」，
 * 只把「哪个模型、在哪条通道、因为什么、现在是否仍启用」说成人话，并给出可执行的下一步。
 *
 * 为什么单独成文件：告警文案是用户唯一能看懂的部分，口径必须能被单测钉住——
 *   · 不许出现内部类别码（model_missing / quota_exhausted）与接口字段名；
 *   · 不许把「瞬时失败」（限流 / 超时）说成永久故障——它们根本不在档案里；
 *   · 「仍启用」与「已停用」必须分开说，否则用户不知道怎么处置。
 */
import { healthNotice, type HealthMap } from "@/lib/modelHealth"
import type { CallFailureClass } from "@/lib/modelFailover"

/** 档案里的 key（source:configId:modelId）反解出的展示信息；找不到即配置已被删 */
export type HealthAlertTarget = {
  configName: string
  modelId: string
  /** 该模型当前是否仍处于启用态（决定告警是「去处理」还是「已停用，仅留痕」） */
  enabled: boolean
}

export type HealthAlert = {
  /** 档案 key，React key 与去重用 */
  key: string
  cls: CallFailureClass
  modelId: string
  configName: string
  tone: "danger" | "warning"
  /** 一句话标题：模型 + 失效类别 */
  title: string
  /** 两句以内的人话：哪条通道、什么原因、现在是什么状态 */
  detail: string
  /** 处置入口文案（按钮） */
  actionLabel: string
  /** 挂账时间（渲染层不要再调 Date.now——组件必须纯） */
  at: number
}

/** key 反解：`personal:<configId>:<modelId>` / `platform:<configId>:<modelId>` */
export function splitHealthKey(key: string): { source: string; configId: string; modelId: string } | null {
  const parts = key.split(":")
  if (parts.length !== 3 || !parts[1]) return null
  return { source: parts[0], configId: parts[1], modelId: parts[2] }
}

const TONE_BY_CLASS: Record<string, "danger" | "warning"> = {
  // 确定性失效：不处理就必然继续失败
  model_missing: "danger",
  model_disabled: "danger",
  auth: "danger",
  // 额度耗尽：充值/提额就能恢复，所以是「warning」而不是「坏掉」
  quota_exhausted: "warning",
}

/** 失效类别 → 一句话标题主体（与 healthShortLabel 的短标签刻意不同：这里是整句） */
function titleFor(cls: CallFailureClass, modelId: string): string {
  if (cls === "model_missing") return `「${modelId}」已下线`
  if (cls === "model_disabled") return `「${modelId}」已被上游停用`
  if (cls === "auth") return `「${modelId}」的 API Key 校验失败`
  if (cls === "quota_exhausted") return `「${modelId}」额度或余额已耗尽`
  return `「${modelId}」实测不可用`
}

/** 处置动作：能点的入口只有一个——回「通道与默认」改配置 */
function actionFor(): string {
  return "去通道与默认处理"
}

/**
 * 把档案摊平成告警列表。
 * - `targets` 由调用方按当前配置列表构造（key → 通道名 / 模型名 / 是否启用）；
 * - 配置已被删除的孤儿条目仍保留（档案是唯一证据），通道名回落为「已删除的通道」；
 * - 排序：danger 在前，同类按最近一次挂账时间倒序。
 */
export function buildHealthAlerts(
  health: HealthMap,
  targets: Record<string, HealthAlertTarget> = {},
): HealthAlert[] {
  const out: HealthAlert[] = []
  for (const [key, entry] of Object.entries(health)) {
    if (!entry) continue
    const parsed = splitHealthKey(key)
    const target = targets[key]
    const modelId = target?.modelId || parsed?.modelId || key
    const configName = target?.configName || "已删除的通道"
    const enabled = target?.enabled ?? false
    const stateText = target
      ? enabled
        ? "该模型当前仍处于启用状态，选中它调用仍会失败。"
        : "该模型已在配置中停用，此处仅留痕。"
      : "该配置已被删除，此处仅留痕。"
    const advice = healthNotice(entry)
    out.push({
      key,
      cls: entry.cls,
      modelId,
      configName,
      tone: TONE_BY_CLASS[entry.cls] ?? "danger",
      title: titleFor(entry.cls, modelId),
      detail: `通道「${configName}」。${advice}${stateText}`,
      actionLabel: actionFor(),
      at: entry.at,
    })
  }
  return out.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === "danger" ? -1 : 1
    return (health[b.key]?.at ?? 0) - (health[a.key]?.at ?? 0)
  })
}

/** 页头 / 卡片徽标用的计数（待处理 = danger；warning 单列，不与「坏了」混谈） */
export function summarizeHealthAlerts(alerts: HealthAlert[]): { pending: number; warning: number; total: number } {
  let pending = 0
  let warning = 0
  for (const a of alerts) {
    if (a.tone === "danger") pending += 1
    else warning += 1
  }
  return { pending, warning, total: alerts.length }
}
