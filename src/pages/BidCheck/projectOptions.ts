// P1-6（2026-10-24）：标书检查「选择标书项目」下拉的选项整备。
// 实测问题：30+ 选项同名重复（测试/演练件混入）、无排序、无搜索，多人团队下基本不可用。
// 这里做三件纯函数整备，供 BidCheckPage 使用（不改 useBidCheck 的加载逻辑）：
//   ① 排序：按 updated 倒序（缺失回退 created，再回退名称），最近在做的项目排最前；
//   ② 去重：同名项目只保留最近更新的一条（演练/重传产生的重复记录收敛为一个选项）；
//   ③ 过滤：按名称 / 招标编号大小写不敏感子串匹配。
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"

function updatedOf(p: BidProjectRecord): string {
  return p.updated || p.created || ""
}

/** 按 updated 倒序排序（原数组不改） */
export function sortProjectOptions(list: BidProjectRecord[]): BidProjectRecord[] {
  return [...list].sort((a, b) => {
    const ta = updatedOf(a)
    const tb = updatedOf(b)
    if (ta !== tb) return tb.localeCompare(ta)
    return (a.project_name || a.id).localeCompare(b.project_name || b.id)
  })
}

/** 同名去重：project_name 去空白后相同的组保留 updated 最新一条；空名按 id 各自保留 */
export function dedupeProjectOptions(list: BidProjectRecord[]): BidProjectRecord[] {
  const sorted = sortProjectOptions(list)
  const seenName = new Set<string>()
  const out: BidProjectRecord[] = []
  for (const p of sorted) {
    const name = (p.project_name || "").trim()
    if (!name) {
      out.push(p)
      continue
    }
    if (seenName.has(name)) continue
    seenName.add(name)
    out.push(p)
  }
  return out
}

/** 大小写不敏感子串过滤：命中 project_name 或 tender_no；空查询原样返回 */
export function filterProjectOptions(list: BidProjectRecord[], query: string): BidProjectRecord[] {
  const q = (query ?? "").trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (p) =>
      (p.project_name || "").toLowerCase().includes(q) ||
      (p.tender_no || "").toLowerCase().includes(q),
  )
}
