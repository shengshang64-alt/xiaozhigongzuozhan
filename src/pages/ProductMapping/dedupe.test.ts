/**
 * 2026-10-29 · 公司库「同身份重复行」去重的行为网
 *
 * 守的是什么：模块选择器里同一条「胸痛中心」不得重影成两个可勾选项。
 * 根因是历史两批导入叠加——10-08 早期行只有 3 个非空字段，10-28 ONE-LINK 完整行 7 个字段，
 * 但三者的 模块名/标准名/产品名 完全相同，`products.filter(p => p.in_company)` 会把两行都渲染出来。
 *
 * 「删掉实现即变红」：
 *   - 把 dedupeProducts 改成直接 return products → 第 1、2 条变红（重影回来）
 *   - 把完整性比较去掉、只留首次出现 → 第 2 条变红（留下的是残缺行，标准名/模块分类丢失）
 *   - 把 keepIds 优先逻辑去掉 → 第 3 条变红（已映射的 id 被收掉）
 *   - 把 toCompareRows 的身份回退去掉 → 第 5 条变红（历史映射显示成未匹配）
 */
import { describe, expect, it } from "vitest"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"
import { dedupeProducts, sameIdentity, remapIdsToDeduped, toCompareRows } from "./mappingCore"

function mk(over: Partial<CheckProduct> & { id: string }): CheckProduct {
  return {
    is_builtin: false,
    in_company: true,
    category: "智慧医疗",
    product_line: "",
    product_name: "",
    module_name: "",
    module_func: "",
    description: "",
    charge_mode: "",
    unit_price: 0,
    status: "在售",
    rating_tags: {},
    ...over,
  } as CheckProduct
}

/** 10-08 早期导入的残缺行：只有 category + product_name + module_name */
function legacyRow(id: string, moduleName: string): CheckProduct {
  return mk({
    id,
    category: "智慧医疗",
    product_name: "急危重症专病平台",
    module_name: moduleName,
    created: "2026-10-08 07:34:43.000Z",
  })
}

/** 10-28 ONE-LINK 完整导入行：7 个业务字段齐全 */
function oneLinkRow(id: string, moduleName: string): CheckProduct {
  return mk({
    id,
    category: "智慧医疗",
    product_belong: "总部",
    product_name: "急危重症专病平台",
    module_name: moduleName,
    module_category: "急危重症专病平台",
    standard_name: moduleName,
    recommendation: "可选",
    created: "2026-10-28 06:06:26.000Z",
  })
}

describe("dedupeProducts · 同身份重复行收敛", () => {
  it("1. 同身份两行只留一行（重影消失）", () => {
    const pool = [legacyRow("old1", "胸痛中心"), oneLinkRow("new1", "胸痛中心")]
    const out = dedupeProducts(pool)
    expect(out).toHaveLength(1)
    // 留下的行与原始两行同身份（空类别通配，不因完整度差异被当成两个模块）
    expect(sameIdentity(out[0], pool[0])).toBe(true)
    expect(sameIdentity(out[0], pool[1])).toBe(true)
  })

  it("2. 保留的是信息最完整的那行（不是先出现的那行）", () => {
    // 残缺行放在前面——旧实现按首次出现保留会留下它
    const pool = [legacyRow("old1", "胸痛中心"), oneLinkRow("new1", "胸痛中心")]
    const out = dedupeProducts(pool)
    expect(out[0].id).toBe("new1")
    expect(out[0].standard_name).toBe("胸痛中心")
    expect(out[0].module_category).toBe("急危重症专病平台")
    expect(out[0].recommendation).toBe("可选")
  })

  it("3. 被引用的 id 优先保留（已映射项不会变成找不到的幽灵）", () => {
    // 旧 id 被映射记忆引用：即便它更残缺，也必须保留，否则映射指向悬空
    const pool = [legacyRow("old1", "胸痛中心"), oneLinkRow("new1", "胸痛中心")]
    const out = dedupeProducts(pool, ["old1"])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("old1")
  })

  it("4. 不同身份的模块各自保留；输出顺序按首次出现稳定", () => {
    const pool = [
      legacyRow("a", "胸痛中心"),
      oneLinkRow("b", "卒中中心"),
      legacyRow("c", "卒中中心"),
      oneLinkRow("d", "创伤中心"),
    ]
    const out = dedupeProducts(pool)
    expect(out.map((p) => p.module_name)).toEqual(["胸痛中心", "卒中中心", "创伤中心"])
    // 卒中中心：c 与 b 同身份，b 更完整 → 留 b
    expect(out[1].id).toBe("b")
  })

  it("5. 标准名不同但模块名+产品名相同 → 视为同身份（标准名只是同一模块的另一种叫法）", () => {
    // 真实数据形态：10-08 行 standard_name 为空、10-28 行为「标准甲」
    // 若把标准名纳入身份，这两行永远不相等，去重失效
    const pool = [
      mk({ id: "x1", product_name: "P", module_name: "模块A" }),
      mk({ id: "x2", product_name: "P", module_name: "模块A", standard_name: "标准甲" }),
    ]
    const out = dedupeProducts(pool)
    expect(out).toHaveLength(1)
    expect(out[0].standard_name).toBe("标准甲")
  })

  it("5b. 模块名不同 → 一定是不同模块（不误合并）", () => {
    const pool = [
      mk({ id: "y1", product_name: "P", module_name: "模块A" }),
      mk({ id: "y2", product_name: "P", module_name: "模块B" }),
    ]
    expect(dedupeProducts(pool)).toHaveLength(2)
  })

  it("5c. 产品名不同 → 一定是不同模块（同模块名挂在不同产品下不合并）", () => {
    const pool = [
      mk({ id: "z1", product_name: "产品A", module_name: "模块X" }),
      mk({ id: "z2", product_name: "产品B", module_name: "模块X" }),
    ]
    expect(dedupeProducts(pool)).toHaveLength(2)
  })

  it("6. 空池 / 单行池原样返回", () => {
    expect(dedupeProducts([])).toEqual([])
    const one = [oneLinkRow("solo", "胸痛中心")]
    expect(dedupeProducts(one)).toHaveLength(1)
  })

  it("7. 空格/大小写差异算同一身份（归一化生效）", () => {
    const pool = [
      mk({ id: "n1", product_name: "LIS", module_name: "标本采集" }),
      mk({ id: "n2", product_name: " lis ", module_name: "标本 采集" }),
    ]
    expect(dedupeProducts(pool)).toHaveLength(1)
  })

  it("8. 同模块名+产品名、但产品类别不同的多行，不得误合并（真实库的「电子签名」8 行）", () => {
    // 实测真实数据：module_name='电子签名' product_name='院内移动诊疗系统' 有 8 行，
    // module_category 分别是 移动医生/移动护理/门诊移动输液/掌上医护 各 1 行 + 4 行历史空值。
    // 正确结果：4 个具体类别各保留 1 行，4 行空值并入其中一个（不能并成 1 个）。
    const cats = ["移动医生", "移动护理", "门诊移动输液", "掌上医护"]
    const pool: CheckProduct[] = []
    for (const c of cats) {
      pool.push(mk({ id: `legacy-${c}`, product_name: "院内移动诊疗系统", module_name: "电子签名" }))
      pool.push(mk({ id: `full-${c}`, product_name: "院内移动诊疗系统", module_name: "电子签名", module_category: c, standard_name: "电子签名" }))
    }
    const out = dedupeProducts(pool)
    // 4 个不同类别各自成组；历史空值行按通配并入（组内保留完整行）
    const keptCats = out.map((p) => p.module_category).sort()
    expect(out.length).toBeGreaterThanOrEqual(4)
    expect(keptCats).toContain("移动医生")
    expect(keptCats).toContain("移动护理")
    expect(keptCats).toContain("门诊移动输液")
    expect(keptCats).toContain("掌上医护")
    // 具体类别行必须保留完整版本（不是历史空值版）
    for (const c of cats) {
      const row = out.find((p) => p.module_category === c)
      expect(row?.id).toBe(`full-${c}`)
    }
  })

  it("9. 历史空类别行与完整行认成同一身份（10-08 行能被 10-28 行吸收）", () => {
    const pool = [
      mk({ id: "legacy", product_name: "院内移动诊疗系统", module_name: "电子签名" }),
      mk({ id: "full", product_name: "院内移动诊疗系统", module_name: "电子签名", module_category: "移动医生" }),
    ]
    const out = dedupeProducts(pool)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe("full")
    expect(out[0].module_category).toBe("移动医生")
  })
})

describe("remapIdsToDeduped · 历史 id 映射到去重后的等价 id", () => {
  it("被收掉的 id 通过身份映射到保留行", () => {
    const original = [legacyRow("old1", "胸痛中心"), oneLinkRow("new1", "胸痛中心")]
    const deduped = dedupeProducts(original)
    const ids = remapIdsToDeduped(["old1"], original, deduped)
    expect(ids).toEqual(["new1"])
  })

  it("无法解析的 id 被丢弃而不是产生悬空", () => {
    const original = [oneLinkRow("new1", "胸痛中心")]
    const deduped = dedupeProducts(original)
    expect(remapIdsToDeduped(["ghost"], original, deduped)).toEqual([])
  })

  it("去重保序且不重复", () => {
    const original = [legacyRow("old1", "胸痛中心"), oneLinkRow("new1", "胸痛中心"), oneLinkRow("new2", "卒中中心")]
    const deduped = dedupeProducts(original)
    expect(remapIdsToDeduped(["old1", "new1", "new2"], original, deduped)).toEqual(["new1", "new2"])
  })
})

describe("toCompareRows · 去重后历史映射仍能解析出产品", () => {
  it("映射 id 被去重收掉时，按身份回退到保留行（不显示未匹配）", () => {
    const original = [legacyRow("old1", "胸痛中心"), oneLinkRow("new1", "胸痛中心")]
    const deduped = dedupeProducts(original)
    const rows = [
      {
        row_id: "r1",
        raw: "胸痛中心",
        norm: "胸痛中心",
        product_name: "胸痛中心",
        product_id: "old1",
        product_ids: ["old1"],
        kind: "manual" as const,
        resolution: "company" as const,
      },
    ] as unknown as Parameters<typeof toCompareRows>[0]
    const out = toCompareRows(rows, deduped, {}, original)
    expect(out[0].product).not.toBeNull()
    expect(out[0].product?.id).toBe("new1")
    expect(out[0].products).toHaveLength(1)
  })

  it("不传原始池时行为不变（向后兼容）", () => {
    const deduped = [oneLinkRow("new1", "胸痛中心")]
    const rows = [
      {
        row_id: "r1",
        raw: "胸痛中心",
        norm: "胸痛中心",
        product_name: "胸痛中心",
        product_id: "old1",
        product_ids: ["old1"],
        kind: "manual" as const,
        resolution: "company" as const,
      },
    ] as unknown as Parameters<typeof toCompareRows>[0]
    const out = toCompareRows(rows, deduped)
    expect(out[0].product).toBeNull()
  })
})
