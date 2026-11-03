// ---------------------------------------------------------------------------
// 知识原子冲突检测（2026-11-01，需求 §8.2）
//
// 需求原文：
//   | 冲突类型 | 判定方式 | 处理 |
//   | 数值冲突 | 同 subject_key，attributes.value 差异 > 5% | 自动保留 valid_from 晚的，旧的标 superseded，记日志 |
//   | 时效冲突 | 同 subject_key，valid_until 不同且都未过期 | 保留 valid_until 晚的，旧的标 superseded |
//   | 极性冲突 | 同 subject_key，attributes.polarity 相反 | 挂 conflict_group，两条都置 conflict，必须人工裁决 |
//   | 密级冲突 | 同 subject_key，confidentiality 不同 | 取最高密级，低的标 superseded |
//
// 「极性判断才用 LLM，其余全用规则」——本模块只做规则部分（纯函数、零 AI、可单测）。
//
// 为什么先做规则：三类规则冲突可以直接判定且结果确定，不留人工负担；
// 极性冲突是"这条到底支持还是不支持"的语义判断，误判代价高，留给人工（§8.3 裁决 UI）。
// ---------------------------------------------------------------------------

/** 参与冲突检测的原子最小字段 */
export type ConflictAtom = {
  id: string
  subjectKey: string
  /** 数值型原子的取值（metric 类） */
  value?: number | string | null
  /** 单位（"万元"、"级"、"%"） */
  unit?: string | null
  /** 极性：positive=达标/支持/有，negative=未达标/不支持/无 */
  polarity?: "positive" | "negative" | "neutral" | null
  /** 有效期起止 */
  validFrom?: string | null
  validUntil?: string | null
  /** 密级 */
  confidentiality?: string | null
  /** 当前状态 */
  contentStatus?: string
  confidence?: number
}

export type ConflictKind = "numeric" | "temporal" | "polarity" | "confidentiality"

export type ConflictResolution =
  | { action: "supersede"; keepId: string; supersedeIds: string[]; reason: string }
  | { action: "markConflict"; atomIds: string[]; conflictGroup: string; reason: string }
  | { action: "none"; reason: string }

export type ConflictFinding = {
  kind: ConflictKind
  subjectKey: string
  atomIds: string[]
  resolution: ConflictResolution
}

/** 数值差异阈值（需求：> 5% 才算冲突） */
const NUMERIC_DIFF_RATIO = 0.05
/** 密级排序（数字越大越密） */
const CONF_RANK: Record<string, number> = { public: 0, internal: 1, client_only: 2, secret: 3 }

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(/[^\d.-]/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** 比较两个日期的先后（无效日期视为最旧） */
function dateValue(s: string | null | undefined): number {
  if (!s) return 0
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

/**
 * 检测一组同 subject_key 的原子之间的冲突。
 *
 * 优先级：极性冲突（必须人工）> 数值冲突 > 时效冲突 > 密级冲突。
 * 一次只返回一个结论——避免多个规则同时改写同一条原子导致状态打架。
 */
export function detectConflict(atoms: ConflictAtom[], subjectKey: string): ConflictFinding | null {
  const group = atoms.filter((a) => a.subjectKey === subjectKey)
  if (group.length < 2) return null

  const ids = group.map((a) => a.id)

  // ---- ① 极性冲突：必须人工裁决（需求要求"两条都置 conflict"）----
  const polarities = group
    .map((a) => a.polarity)
    .filter((p): p is "positive" | "negative" | "neutral" => p === "positive" || p === "negative" || p === "neutral")
  const hasPos = polarities.includes("positive")
  const hasNeg = polarities.includes("negative")
  if (hasPos && hasNeg) {
    return {
      kind: "polarity",
      subjectKey,
      atomIds: ids,
      resolution: {
        action: "markConflict",
        atomIds: group.filter((a) => a.polarity === "positive" || a.polarity === "negative").map((a) => a.id),
        conflictGroup: `cg:${subjectKey}`,
        reason: "极性相反（有支持/不支持两种说法），必须人工裁决",
      },
    }
  }

  // ---- ② 数值冲突：差异 > 5% 时保留 valid_from 晚的 ----
  const valued = group
    .map((a) => ({ atom: a, num: toNum(a.value) }))
    .filter((x): x is { atom: ConflictAtom; num: number } => x.num !== null)
  if (valued.length >= 2) {
    // 按数值找最大差异对
    let maxDiff = 0
    let pair: [typeof valued[0], typeof valued[0]] | null = null
    for (let i = 0; i < valued.length; i += 1) {
      for (let j = i + 1; j < valued.length; j += 1) {
        const a = Math.abs(valued[i].num)
        const b = Math.abs(valued[j].num)
        const base = Math.max(a, b, 1e-9)
        const diff = Math.abs(a - b) / base
        if (diff > maxDiff) {
          maxDiff = diff
          pair = [valued[i], valued[j]]
        }
      }
    }
    if (pair && maxDiff > NUMERIC_DIFF_RATIO) {
      // 保留 valid_from 更晚的；同日期则保留置信度高的
      const sorted = valued
        .slice()
        .sort((x, y) => {
          const d = dateValue(y.atom.validFrom) - dateValue(x.atom.validFrom)
          if (d !== 0) return d
          return (y.atom.confidence ?? 0) - (x.atom.confidence ?? 0)
        })
      const keep = sorted[0].atom
      return {
        kind: "numeric",
        subjectKey,
        atomIds: ids,
        resolution: {
          action: "supersede",
          keepId: keep.id,
          supersedeIds: group.filter((a) => a.id !== keep.id).map((a) => a.id),
          reason: `数值差异 ${(maxDiff * 100).toFixed(1)}% > 5%，保留有效日期较晚的（${keep.validFrom ?? "无日期"}）`,
        },
      }
    }
  }

  // ---- ③ 时效冲突：valid_until 不同且都未过期 ----
  const now = Date.now()
  const alive = group.filter((a) => {
    const u = dateValue(a.validUntil)
    return u === 0 || u > now
  })
  if (alive.length >= 2) {
    const untils = new Set(alive.map((a) => a.validUntil ?? ""))
    if (untils.size >= 2) {
      const sorted = alive.slice().sort((x, y) => dateValue(y.validUntil) - dateValue(x.validUntil))
      const keep = sorted[0]
      return {
        kind: "temporal",
        subjectKey,
        atomIds: ids,
        resolution: {
          action: "supersede",
          keepId: keep.id,
          supersedeIds: sorted.slice(1).map((a) => a.id),
          reason: "同主题但有效期不同且都未过期，保留有效期更晚的",
        },
      }
    }
  }

  // ---- ④ 密级冲突：取最高密级 ----
  const ranks = group.map((a) => ({ atom: a, r: CONF_RANK[a.confidentiality ?? "internal"] ?? 1 }))
  const maxRank = Math.max(...ranks.map((x) => x.r))
  const minRank = Math.min(...ranks.map((x) => x.r))
  if (maxRank !== minRank) {
    const keep = ranks.find((x) => x.r === maxRank)!.atom
    return {
      kind: "confidentiality",
      subjectKey,
      atomIds: ids,
      resolution: {
        action: "supersede",
        keepId: keep.id,
        supersedeIds: ranks.filter((x) => x.r !== maxRank).map((x) => x.atom.id),
        reason: `密级不一致，统一取最高密级（${keep.confidentiality ?? "internal"}）`,
      },
    }
  }

  return null
}

/** 批量检测：按 subject_key 分组，返回所有发现的冲突 */
export function detectAllConflicts(atoms: ConflictAtom[]): ConflictFinding[] {
  const byKey = new Map<string, ConflictAtom[]>()
  for (const a of atoms) {
    if (!a.subjectKey) continue
    const arr = byKey.get(a.subjectKey) ?? []
    arr.push(a)
    byKey.set(a.subjectKey, arr)
  }
  const out: ConflictFinding[] = []
  for (const [key, group] of byKey) {
    if (group.length < 2) continue
    const f = detectConflict(group, key)
    if (f) out.push(f)
  }
  return out
}

/** 冲突统计（给界面/日志用） */
export function summarizeConflicts(findings: ConflictFinding[]): {
  total: number
  byKind: Record<ConflictKind, number>
  autoResolvable: number
  needHuman: number
} {
  const byKind: Record<ConflictKind, number> = { numeric: 0, temporal: 0, polarity: 0, confidentiality: 0 }
  let autoResolvable = 0
  let needHuman = 0
  for (const f of findings) {
    byKind[f.kind] += 1
    if (f.resolution.action === "markConflict") needHuman += 1
    else if (f.resolution.action === "supersede") autoResolvable += 1
  }
  return { total: findings.length, byKind, autoResolvable, needHuman }
}
