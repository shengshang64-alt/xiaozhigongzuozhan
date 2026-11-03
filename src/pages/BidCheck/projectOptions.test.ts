// P1-6：标书检查项目下拉整备纯函数的单元测试（排序 / 去重 / 过滤）。
import { describe, expect, it } from "vitest"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import { dedupeProjectOptions, excludeDeletedProjects, filterProjectOptions, sortProjectOptions } from "./projectOptions"

function rec(id: string, name: string, updated: string, tenderNo = ""): BidProjectRecord {
  // 夹具只填本模块消费的字段（排序/去重/过滤只读 project_name/tender_no/updated/created/id）
  return {
    id,
    project_name: name,
    tender_no: tenderNo,
    updated,
    created: "2026-01-01 00:00:00.000Z",
  } as unknown as BidProjectRecord
}

describe("sortProjectOptions", () => {
  it("按 updated 倒序，最近更新的排最前", () => {
    const out = sortProjectOptions([
      rec("a", "旧项目", "2026-10-01 10:00:00.000Z"),
      rec("b", "新项目", "2026-10-24 09:00:00.000Z"),
      rec("c", "中项目", "2026-10-12 08:00:00.000Z"),
    ])
    expect(out.map((p) => p.id)).toEqual(["b", "c", "a"])
  })
  it("updated 缺失回退 created，再相同按名称稳定排", () => {
    const a = rec("a", " Beta", "")
    a.created = "2026-02-01 00:00:00.000Z"
    const b = rec("b", "Alpha", "")
    b.created = "2026-03-01 00:00:00.000Z"
    const out = sortProjectOptions([a, b])
    expect(out.map((p) => p.id)).toEqual(["b", "a"])
  })
  it("不改原数组", () => {
    const list = [rec("a", "A", "2026-01-01 00:00:00.000Z"), rec("b", "B", "2026-02-01 00:00:00.000Z")]
    sortProjectOptions(list)
    expect(list.map((p) => p.id)).toEqual(["a", "b"])
  })
})

describe("dedupeProjectOptions", () => {
  it("同名项目保留 updated 最新一条", () => {
    const out = dedupeProjectOptions([
      rec("old", "三明市中西医结合医院", "2026-09-01 00:00:00.000Z"),
      rec("new", "三明市中西医结合医院", "2026-10-20 00:00:00.000Z"),
      rec("other", "安徽中医药大学第一附属医院一体化核心", "2026-10-01 00:00:00.000Z"),
    ])
    expect(out).toHaveLength(2)
    expect(out.find((p) => p.project_name.includes("三明"))?.id).toBe("new")
  })
  it("名称首尾空白归一后再比对；空名不参与去重", () => {
    const out = dedupeProjectOptions([
      rec("a", "  项目X  ", "2026-09-01 00:00:00.000Z"),
      rec("b", "项目X", "2026-08-01 00:00:00.000Z"),
      rec("c", "", "2026-07-01 00:00:00.000Z"),
      rec("d", "", "2026-06-01 00:00:00.000Z"),
    ])
    // a/b 同名收敛为 a（最新）；c/d 空名各自保留
    expect(out.map((p) => p.id).sort()).toEqual(["a", "c", "d"])
  })
})

describe("filterProjectOptions", () => {
  const list = [
    rec("a", "三明市中西医结合医院信息化整体提升项目", "2026-10-20 00:00:00.000Z", "CGXM-2026-350401"),
    rec("b", "厦门市海沧医院互联互通测评", "2026-10-01 00:00:00.000Z"),
  ]
  it("按名称子串命中（大小写不敏感）", () => {
    expect(filterProjectOptions(list, "三明").map((p) => p.id)).toEqual(["a"])
    expect(filterProjectOptions(list, "海沧").map((p) => p.id)).toEqual(["b"])
  })
  it("按招标编号命中", () => {
    expect(filterProjectOptions(list, "cgxm-2026").map((p) => p.id)).toEqual(["a"])
  })
  it("空查询原样返回；无命中返回空数组", () => {
    expect(filterProjectOptions(list, "  ")).toHaveLength(2)
    expect(filterProjectOptions(list, "不存在的项目")).toHaveLength(0)
  })
})

// 2026-10-28（DS-R04）：后端列表路由只按 rh_user_id 过滤，不过滤 deleted_at，
// 回收站过滤必须由页面自己做。标书检查页原先漏了这一步，实测下拉混入 8 个回收站项目。
describe("excludeDeletedProjects", () => {
  const withDeleted = (id: string, name: string, deletedAt?: string) => {
    const r = rec(id, name, "2026-10-20 00:00:00.000Z") as unknown as Record<string, unknown>
    if (deletedAt !== undefined) r.deleted_at = deletedAt
    return r as unknown as BidProjectRecord
  }

  it("deleted_at 非空的项目被剔除，正常项目保留", () => {
    const out = excludeDeletedProjects([
      withDeleted("live", "正常项目", ""),
      withDeleted("trash", "回收站项目", "2026-10-22T06:24:46.891Z"),
    ])
    expect(out.map((p) => p.id)).toEqual(["live"])
  })

  it("deleted_at 缺失（存量记录无此列）按未删除保留", () => {
    const out = excludeDeletedProjects([withDeleted("legacy", "存量项目")])
    expect(out.map((p) => p.id)).toEqual(["legacy"])
  })

  it("只有空白字符的 deleted_at 视为未删除", () => {
    const out = excludeDeletedProjects([withDeleted("blank", "空白删除位", "   ")])
    expect(out.map((p) => p.id)).toEqual(["blank"])
  })

  it("顺序契约：先剔回收站再去重，回收站的同名新记录不能顶掉正常项目", () => {
    // 真实数据形态——「三明市中西医结合医院」回收站件 updated 比正常件新
    const trashNewer = withDeleted("trash", "三明市中西医结合医院", "2026-10-27T07:02:45.325Z")
    ;(trashNewer as unknown as Record<string, unknown>).updated = "2026-10-27 07:02:45.325Z"
    const liveOlder = withDeleted("live", "三明市中西医结合医院", "")
    ;(liveOlder as unknown as Record<string, unknown>).updated = "2026-10-15 06:02:03.716Z"
    const out = dedupeProjectOptions(
      sortProjectOptions(excludeDeletedProjects([trashNewer, liveOlder])),
    )
    expect(out.map((p) => p.id)).toEqual(["live"])
  })
})
