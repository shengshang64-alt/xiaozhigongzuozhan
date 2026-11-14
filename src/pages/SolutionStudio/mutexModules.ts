// 互斥模块：说明里写了「与 XX 模块互斥」时，确认/勾选要提示，不自动两个都留下还一声不吭。
// 当前标准表已标明的一对：住院床位预约 vs 全院一张床。

const KNOWN_PAIRS: [string, string][] = [["住院床位预约", "全院一张床"]]

function normName(s: string): string {
  return String(s ?? "").replace(/\s+/g, "").trim()
}

/** 从模块说明中解析互斥对象名称 */
export function parseMutexPartners(remark: string, selfName: string): string[] {
  const text = String(remark ?? "")
  if (!text.includes("互斥")) return []
  const names: string[] = []
  const re = /与\s*[“”"'「」]?([^“”"'「」与模块]{1,40}?)[“”"'「」]?\s*模块互斥/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const n = normName(m[1] ?? "")
    if (n && n !== normName(selfName)) names.push(n)
  }
  return names
}

export type MutexNamed = { module_name: string; remark?: string; description?: string }

function remarkOf(p: MutexNamed): string {
  return `${p.remark ?? ""} ${p.description ?? ""}`
}

/** 从产品说明与内置对中收集互斥对（名称已去空白） */
export function collectMutexPairs(products: MutexNamed[]): [string, string][] {
  const pairs = new Map<string, [string, string]>()
  const put = (a: string, b: string) => {
    const na = normName(a)
    const nb = normName(b)
    if (!na || !nb || na === nb) return
    const key = [na, nb].sort().join("§")
    if (!pairs.has(key)) pairs.set(key, [na, nb])
  }
  for (const [a, b] of KNOWN_PAIRS) put(a, b)
  for (const p of products) {
    const self = normName(p.module_name)
    for (const other of parseMutexPartners(remarkOf(p), p.module_name)) put(self, other)
  }
  return [...pairs.values()]
}

export type MutexConflict = { a: string; b: string }

/** 当前已勾选的模块名里有哪些互斥对 */
export function findMutexConflicts(selectedNames: string[], products: MutexNamed[] = []): MutexConflict[] {
  const selected = new Set(selectedNames.map(normName).filter(Boolean))
  const out: MutexConflict[] = []
  for (const [a, b] of collectMutexPairs(products)) {
    if (selected.has(a) && selected.has(b)) out.push({ a, b })
  }
  return out
}

export function mutexWarningText(conflicts: MutexConflict[]): string {
  if (!conflicts.length) return ""
  const parts = conflicts.map((c) => `「${c.a}」与「${c.b}」`)
  return `${parts.join("、")}在说明中互斥，请确认只保留其一，不要两个都留下。`
}
