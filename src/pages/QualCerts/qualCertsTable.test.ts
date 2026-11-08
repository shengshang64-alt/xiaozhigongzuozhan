// R250（r2-r012 收尾·资质明细站）：资质证书台账接全站 DataTable。
// ①filterQualRows 真实单测：多词 AND / 字段并集 / 大小写 / 全角空格 / 空关键词零复制语义
// ②QualCertsPage 接线防回流哨兵：必须走 DataTable（排序+分页）、默认到期升序、搜索命中数外显，
//   且不得再退回手搓 <table>（历轮同类收敛口径，见 R236-R243 DataTable 五站）。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { filterQualRows, type QualCertRow } from "./qualsCore"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

function row(patch: Partial<QualCertRow>): QualCertRow {
  return {
    id: patch.id ?? "r1",
    cert_name: patch.cert_name ?? "",
    category: patch.category ?? "",
    cert_no: patch.cert_no ?? "",
    issuer: patch.issuer ?? "",
    valid_from: patch.valid_from ?? "",
    valid_to: patch.valid_to ?? "",
    scope: patch.scope ?? "",
    external_ok: patch.external_ok ?? false,
    file_ref: patch.file_ref ?? "",
    notes: patch.notes ?? "",
    created: patch.created ?? "",
    updated: patch.updated ?? "",
  }
}

const rows: QualCertRow[] = [
  row({ id: "a", cert_name: "CMMI5 证书", category: "体系认证", cert_no: "CMMI-2024-001", scope: "信息化建设" }),
  row({ id: "b", cert_name: "营业执照", category: "硬资质", issuer: "市市场监管局", notes: "法人变更待更新" }),
  row({ id: "c", cert_name: "ISO27001", category: "体系认证", cert_no: "ISO-7001", scope: "运维服务" }),
]

describe("filterQualRows（台账搜索口径）", () => {
  it("空关键词返回全部（新数组，不改入参）", () => {
    const out = filterQualRows(rows, "")
    expect(out).toHaveLength(3)
    expect(out).not.toBe(rows)
    expect(rows).toHaveLength(3)
  })

  it("纯空白与全角空格同样视为空关键词", () => {
    expect(filterQualRows(rows, "   \u3000 ")).toHaveLength(3)
  })

  it("命中证照名称", () => {
    expect(filterQualRows(rows, "CMMI").map((r) => r.id)).toEqual(["a"])
  })

  it("大小写不敏感", () => {
    expect(filterQualRows(rows, "iso27001").map((r) => r.id)).toEqual(["c"])
  })

  it("多词按 AND 组合，跨字段并集命中", () => {
    expect(filterQualRows(rows, "体系 CMMI").map((r) => r.id)).toEqual(["a"])
    expect(filterQualRows(rows, "体系 不存在")).toEqual([])
  })

  it("发证机关 / 备注 / 适用范围都在搜索域内", () => {
    expect(filterQualRows(rows, "市场监管局").map((r) => r.id)).toEqual(["b"])
    expect(filterQualRows(rows, "法人变更").map((r) => r.id)).toEqual(["b"])
    expect(filterQualRows(rows, "运维").map((r) => r.id)).toEqual(["c"])
  })

  it("证书编号片段可搜", () => {
    expect(filterQualRows(rows, "7001").map((r) => r.id)).toEqual(["c"])
  })

  it("空数组安全返回空", () => {
    expect(filterQualRows([], "x")).toEqual([])
  })
})

describe("R250 资质台账接 DataTable（接线防回流）", () => {
  const code = readFileSync(path.join(SRC, "pages/QualCerts/QualCertsPage.tsx"), "utf-8")

  it("复用全站 DataTable 而非手搓表格", () => {
    expect(code).toContain('from "@/components/ui/DataTable"')
    expect(code).toContain("<DataTable<QualCertRow>")
    expect(code).not.toContain("<table className=\"w-full text-left text-sm\">")
  })

  it("搜索走 qualsCore 单一真源，分页与默认排序落地", () => {
    expect(code).toContain("filterQualRows(p.rows, keyword)")
    expect(code).toContain("pageSize={20}")
    expect(code).toContain('initialSort={{ key: "valid_to", dir: "asc" }}')
  })

  it("可排序列覆盖全部展示列（操作列除外）", () => {
    const accessorCount = (code.match(/sortAccessor:/g) ?? []).length
    expect(accessorCount).toBe(5) // 证照名称 / 类别 / 证书编号 / 有效期至 / 适用范围
    const actionsCol = code.slice(code.indexOf('key: "actions"'), code.indexOf("function QualRowActions"))
    expect(actionsCol).not.toContain("sortAccessor")
  })

  it("到期分档徽标口径收敛为单一函数，表格单元格不再内联分类", () => {
    // 归类逻辑（剩 N 天正则 + badge 三档判定）全站只此一份
    expect((code.match(/function qualDueBadge\(/g) ?? []).length).toBe(1)
    expect((code.match(/\^剩 \(\\d\+\) 天\$/g) ?? []).length).toBe(1)
    expect(code).toContain("qualDueBadge(row, todayMs)")
  })
})

// ---------------------------------------------------------------------------
// UX-R2（docs/ux-review-2026-11 §十三 修复防回流，2026-11-07）：
// 统计卡危险度排序与点击过滤 / 预警逐条定位高亮 / ⋯ 菜单 / 复选框批量 + 批量登记有效期。
// 断言用子串匹配（不做行锚正则），CRLF/LF 皆稳（见 AGENTS.md 行尾纪律）。
// ---------------------------------------------------------------------------
describe("UX-R2 资质台账修复（防回流）", () => {
  const code = readFileSync(path.join(SRC, "pages/QualCerts/QualCertsPage.tsx"), "utf-8")
  const hookCode = readFileSync(path.join(SRC, "pages/QualCerts/useQualCerts.ts"), "utf-8")

  it("统计卡按危险度排序：已过期→30天内→未登记→90天内→总数", () => {
    expect(code).toContain('["expired", "critical", "unknown", "warning", "total"]')
  })

  it("统计卡可点击过滤（含未登记桶），过滤走 qualBucket 单一口径", () => {
    expect(code).toContain("setBucketFilter")
    expect(code).toContain("aria-pressed={active}")
    expect(code).toContain("qualBucket(r.valid_to, todayMs)")
  })

  it("预警条每条可定位：data-qual-row 锚点 + animate-pulse 高亮", () => {
    expect(code).toContain("locateRow")
    expect(code).toContain('"data-qual-row"')
    expect(code).toContain("animate-pulse")
  })

  it("行操作收敛为 ⋯ 菜单（旧裸删除按钮不得回流），删除保留二次确认", () => {
    expect(code).toContain("DropdownMenu")
    expect(code).toContain("ConfirmDialog")
    expect(code).not.toContain("aria-label={`删除 ${row.cert_name}`}")
    expect(code).toContain("续期登记")
    expect(code).toContain("查看扫描件")
  })

  it("批量选择 + 浮动操作条 + 批量登记有效期弹窗接线", () => {
    expect(code).toContain('aria-label="全选当前列表"')
    expect(code).toContain("已选 {selectedIds.length} 项")
    expect(code).toContain("批量登记有效期")
    expect(code).toContain("batchRegisterValidity(selectedIds, batchDate)")
    expect(hookCode).toContain("batchRegisterValidity")
    // 批量只发局部字段（valid_to），服务端 PATCH 为局部更新语义
    expect(hookCode).toContain("JSON.stringify({ valid_to: validTo })")
  })
})
