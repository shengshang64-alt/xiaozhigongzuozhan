// P2 解析模型探活（2026-11-01）：解析启动前对当前解析通道做一次「实质输出」探针，
// 防《三模型真实数据审计 2026-10-28》发现的「0% 命中但全员全绿」——模型静默退化
// （嵌入全零/抽取空壳）时，解析照跑、四道门全绿、产出全是垃圾。
//
// 设计口径：
// - 探针复刻解析任务的真实形态（temperature=0 + disableThinking + 多行条款输出），
//   不是「请介绍你自己」那种通用探活——解析通道坏的方式恰恰是通用探活测不出来；
// - 只花一次 ~200 tokens 的小调用；判定信号是「有实质多行内容」，不判内容对错；
// - 探活失败按既有 failover 设施挂账（recordCallFailure），让 resolveRoleModelRef
//   在解析真正开跑时自动避开该通道——**切换靠既有设施，探活只提供信号源**。
import { chatViaGateway, modelRefKey, type ModelRef } from "@/lib/modelGateway"
import { recordCallFailure, recordModelSuccess } from "@/lib/modelHealth"

export type ProbeVerdict = { ok: boolean; reason: string }

/**
 * 解析形态探针：给一段微缩「招标须知」文本，要求以「条款：」逐条提取废标情形。
 * 判定：返回含 ≥2 个「条款：」行才算通过——空回复/散文/单行敷衍都判失败。
 */
export async function probeParseModel(ref: ModelRef | null): Promise<ProbeVerdict> {
  const messages = [
    {
      role: "system" as const,
      content:
        "你是标书解析助手。任务：从给定文本中提取「无效投标/废标」情形，每行一条、行首加「条款：」，只输出条款行。",
    },
    {
      role: "user" as const,
      content:
        "【文本】投标人未按要求密封的，其投标无效。投标报价超过最高限价的，其投标无效。请提取。",
    },
  ]
  try {
    const r = await chatViaGateway({
      modelRef: ref,
      messages,
      page: "bid-parse-probe",
      max_tokens: 200,
      temperature: 0,
      disableThinking: true,
    })
    const userId = null // 探活挂账走全局健康档案（与 recordModelSuccess 调用方一致口径）
    if (!r.ok || !r.text) {
      const reason = r.error ?? "空回复"
      recordCallFailure(userId, ref ? modelRefKey(ref) : "platform", `parse_probe: ${reason}`)
      return { ok: false, reason }
    }
    const clauseLines = r.text.split("\n").filter((l) => l.trim().startsWith("条款：")).length
    if (clauseLines < 2) {
      const reason = `实质输出不足（仅 ${clauseLines} 行条款，期望 ≥2）`
      recordCallFailure(userId, ref ? modelRefKey(ref) : "platform", `parse_probe: ${reason}`)
      return { ok: false, reason }
    }
    recordModelSuccess(userId, ref ? modelRefKey(ref) : "platform")
    return { ok: true, reason: "" }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    recordCallFailure(null, ref ? modelRefKey(ref) : "platform", `parse_probe: ${reason}`)
    return { ok: false, reason }
  }
}
