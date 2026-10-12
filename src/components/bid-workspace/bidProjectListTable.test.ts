// R250（r2-r012 收尾·标书项目站）：投标项目列表新增「卡片/表格」双视图。
// 哨兵沿用 R136/R248 源码扫描风格：钉住表格分支确实复用全站 DataTable、默认视图仍是卡片
// （既有行为零变化）、回收站倒计时 chip 单一来源（卡片与表格共用，杜绝平行实现漂移）。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const code = readFileSync(path.join(SRC, "components/bid-workspace/BidProjectList.tsx"), "utf-8")

describe("R250 投标项目列表表格视图（接线防回流）", () => {
  it("复用全站 DataTable，并保留卡片分支", () => {
    expect(code).toContain('from "@/components/ui/DataTable"')
    expect(code).toContain("<DataTable<BidProjectRecord>")
    expect(code).toContain("<ProjectCard")
  })

  it("默认仍是卡片视图（既有行为零变化）", () => {
    expect(code).toContain('useState<"card" | "table">("card")')
    expect(code).toContain('displayMode === "table" ?')
  })

  it("表格带分页且行点击进入流水线，与卡片同动作", () => {
    expect(code).toContain("pageSize={20}")
    expect(code).toContain("onRowClick={(proj) => p.openProject(proj)}")
  })

  it("列全取卡片既有字段（名称/医院/编号/阶段/开标/成稿/操作）", () => {
    for (const key of ["project_name", "hospital", "tender_no", "stage", "bid_open_date", "chapters", "actions"]) {
      expect(code, `缺少列 ${key}`).toContain(`key: "${key}"`)
    }
  })

  it("回收站不显示成稿进度，与卡片同口径", () => {
    expect(code).toContain('p.listView === "trash" ? [] : [chaptersColumn]')
  })

  it("剩余天数 chip 单一来源：卡片与表格都走 TrashRemainChip", () => {
    expect(code).toContain("function TrashRemainChip(")
    expect(code.match(/<TrashRemainChip deletedAt=\{proj\.deleted_at\} \/>/g) ?? []).toHaveLength(2)
    // 卡片不再自行计算 remain / 内联渲染倒计时，天数口径只在 chip 内一处
    expect(code).not.toContain("const remain = view === \"trash\"")
    expect((code.match(/trashRemainDays\(/g) ?? []).length).toBe(2) // 定义 1 + chip 内调用 1
  })
})
