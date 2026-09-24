import { describe, expect, it } from "vitest"
import {
  historyQuotesFor,
  importChecklistLines,
  isCatalogLine,
  lineKey,
  makeDefaultGroups,
  mergeItemsIntoGroups,
  normalizeDraftItemsFromCatalog,
  quoteItemFromChecklistLine,
  quoteItemFromProduct,
  sanitizeQuote,
  DEFAULT_GROUP_NAMES,
  type QuoteItem,
  type QuoteRecord,
} from "./pptQuoteTypes"
import type { CheckProduct, ChecklistLine } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// 报价数据模型（对接系统清单）：sanitize 向前兼容 + 导入合并 + AI 草案归一
// ---------------------------------------------------------------------------

function fakeProduct(over: Partial<CheckProduct> = {}): CheckProduct {
  return {
    id: "p-1",
    category: "医疗信息化",
    product_line: "智慧服务",
    product_name: "互联网医院平台",
    module_name: "在线复诊",
    module_func: "支持图文/视频复诊开药",
    description: "",
    charge_mode: "模块授权",
    unit_price: 120000,
    status: "在售",
    rating_tags: {},
    is_builtin: false,
    in_company: true,
    ...over,
  } as CheckProduct
}

function fakeLine(over: Partial<ChecklistLine> = {}): ChecklistLine {
  return {
    line_id: "l-1",
    category: "医疗信息化",
    product_line: "",
    product_name: "互联网医院平台",
    module_name: "在线复诊",
    module_func: "支持图文/视频复诊开药",
    unit: "套",
    qty: 1,
    unit_price: 120000,
    source: "company",
    rating_hits: ["电子病历-5 级"],
    remark: "",
    product_id: "p-1",
    checked: true,
    ...over,
  }
}

function fakeQuote(groups: QuoteRecord["groups"]): QuoteRecord {
  return {
    id: "q-1",
    rh_user_id: "u-1",
    quote_name: "测试报价",
    ref_type: "",
    ref_id: "",
    ref_name: "",
    tax_note: "",
    version: "v1",
    created: "",
    updated: "",
    opportunity_id: "",
    opportunity_name: "",
    groups,
  }
}

describe("DEFAULT_GROUP_NAMES / makeDefaultGroups 已废弃", () => {
  it("常量清空 + makeDefaultGroups 返回空数组（新报价由产品库/清单驱动）", () => {
    expect(DEFAULT_GROUP_NAMES).toEqual([])
    expect(makeDefaultGroups()).toEqual([])
  })
})

describe("sanitizeQuote 向前兼容", () => {
  it("老记录（无 category / product_id / source）：正常读取 + 新字段留 undefined", () => {
    const legacyGroups: QuoteRecord["groups"] = [
      {
        id: "g1",
        name: "软件许可",
        items: [
          {
            id: "i1",
            item_name: "旧条目",
            spec: "规格",
            unit: "套",
            qty: 2,
            price: 1000,
            discount: 90,
          } as unknown as QuoteItem,
        ],
      },
    ]
    const out = sanitizeQuote(fakeQuote(legacyGroups))
    const it0 = out.groups[0].items[0]
    expect(it0.item_name).toBe("旧条目")
    expect(it0.price).toBe(1000)
    expect(it0.discount).toBe(90)
    // 新字段：老记录里没有 → 保留 undefined（不硬填 category=""，让 isCatalogLine 判为 false）
    expect(it0.product_id).toBeUndefined()
    expect(it0.category).toBeUndefined()
    expect(isCatalogLine(it0)).toBe(false)
  })

  it("price 允许为 0（价格后录）：不被 clamp 回默认，discount 缺省视为 100", () => {
    const groups: QuoteRecord["groups"] = [
      {
        id: "g1",
        name: "医疗信息化",
        items: [
          {
            id: "i1",
            item_name: "新产品",
            spec: "",
            unit: "套",
            qty: 1,
            price: 0,
            // discount 缺省
            category: "医疗信息化",
            product_name: "新产品",
            product_id: "p-1",
            source: "company",
          } as unknown as QuoteItem,
        ],
      },
    ]
    const out = sanitizeQuote(fakeQuote(groups))
    const it0 = out.groups[0].items[0]
    expect(it0.price).toBe(0)
    expect(it0.discount).toBe(100)
    expect(it0.category).toBe("医疗信息化")
    expect(it0.source).toBe("company")
    expect(isCatalogLine(it0)).toBe(true)
  })

  it("rating_hits 非数组 / 含空串 → 归为 undefined 或过滤后保留", () => {
    const groups: QuoteRecord["groups"] = [
      {
        id: "g1",
        name: "g",
        items: [
          {
            id: "i1",
            item_name: "x",
            spec: "",
            unit: "套",
            qty: 1,
            price: 0,
            discount: 100,
            rating_hits: "电子病历-5 级" as unknown as string[],
          } as unknown as QuoteItem,
          {
            id: "i2",
            item_name: "y",
            spec: "",
            unit: "套",
            qty: 1,
            price: 0,
            discount: 100,
            rating_hits: ["等级保护-三级", "", "  "] as unknown as string[],
          } as unknown as QuoteItem,
        ],
      },
    ]
    const out = sanitizeQuote(fakeQuote(groups))
    expect(out.groups[0].items[0].rating_hits).toBeUndefined()
    // String(v).filter(Boolean) 会剔除空串，保留 trim 后为空的字符串（现有实现按 filter(Boolean) 判定，只去空串）
    expect(out.groups[0].items[1].rating_hits).toEqual(["等级保护-三级", "  "])
  })

  it("groups 是 JSON 字符串：能解析并保留新字段", () => {
    const rec = fakeQuote([])
    rec.groups =
      '[{"id":"g1","name":"医信","items":[{"id":"i1","item_name":"x","spec":"","unit":"套","qty":1,"price":0,"discount":100,"category":"医信","product_id":"p-9"}]}]' as unknown as QuoteRecord["groups"]
    const out = sanitizeQuote(rec)
    expect(out.groups[0].items[0].product_id).toBe("p-9")
    expect(out.groups[0].items[0].category).toBe("医信")
  })
})

describe("lineKey / isCatalogLine", () => {
  it("lineKey 用 category + product_name(或 item_name) + module_name 三元组", () => {
    expect(lineKey({ category: "医信", product_name: "互联网医院", module_name: "在线复诊", item_name: "互联网医院" })).toBe(
      "医信::互联网医院::在线复诊",
    )
    // product_name 缺失时回退到 item_name
    expect(lineKey({ category: "", item_name: "手写行", module_name: "" })).toBe("::手写行::")
  })

  it("isCatalogLine：product_id 或 category 非空即视为目录行", () => {
    expect(isCatalogLine({ product_id: "p-1" } as QuoteItem)).toBe(true)
    expect(isCatalogLine({ category: " 医信 " } as QuoteItem)).toBe(true)
    expect(isCatalogLine({ category: "   " } as QuoteItem)).toBe(false)
    expect(isCatalogLine({ item_name: "手写" } as QuoteItem)).toBe(false)
  })
})

describe("quoteItemFromProduct / quoteItemFromChecklistLine", () => {
  it("产品→报价行：zeroPrice 控制价格是否带入；category 缺失回退「未分类」", () => {
    const p = fakeProduct({ category: "" })
    const zero = quoteItemFromProduct(p, { zeroPrice: true, qty: 3 })
    expect(zero.price).toBe(0)
    expect(zero.qty).toBe(3)
    expect(zero.category).toBe("未分类")
    expect(zero.product_id).toBe("p-1")
    expect(zero.source).toBe("company")
    const keep = quoteItemFromProduct({ ...p, category: "医信" }, { zeroPrice: false })
    expect(keep.price).toBe(120000)
    expect(keep.category).toBe("医信")
  })

  it("清单行→报价行：默认保留 unit_price；zeroPrice 时置零；未勾选行由调用方过滤（此处不重复处理）", () => {
    const l = fakeLine()
    expect(quoteItemFromChecklistLine(l).price).toBe(120000)
    expect(quoteItemFromChecklistLine(l, { zeroPrice: true }).price).toBe(0)
    expect(quoteItemFromChecklistLine(l).rating_hits).toEqual(["电子病历-5 级"])
  })
})

describe("importChecklistLines / mergeItemsIntoGroups", () => {
  it("按 category 聚合分组：2 个类别 → 2 个组；未勾选行被过滤", () => {
    const lines = [
      fakeLine({ line_id: "l1", category: "医疗信息化", product_name: "EMR" }),
      fakeLine({ line_id: "l2", category: "医疗信息化", product_name: "LIS" }),
      fakeLine({ line_id: "l3", category: "基础设施", product_name: "服务器" }),
      fakeLine({ line_id: "l4", category: "基础设施", product_name: "已删除项", checked: false }),
    ]
    const groups = importChecklistLines(lines, { zeroPrice: true })
    expect(groups).toHaveLength(2)
    const cats = groups.map((g) => g.name).sort()
    expect(cats).toEqual(["医疗信息化", "基础设施"])
    for (const g of groups) for (const it of g.items) expect(it.price).toBe(0)
  })

  it("mergeItemsIntoGroups 按 lineKey 去重：已存在的 category+product+module 组合被 skip", () => {
    const initial = importChecklistLines([fakeLine()], { zeroPrice: true })
    const { groups, added, skipped } = mergeItemsIntoGroups(initial, [
      quoteItemFromChecklistLine(fakeLine()), // 完全相同 → skip
      quoteItemFromChecklistLine(fakeLine({ line_id: "l2", product_name: "新系统" })), // 新增
      quoteItemFromChecklistLine(fakeLine({ line_id: "l3", category: "基础设施", product_name: "网络" })), // 新增分组
    ])
    expect(added).toBe(2)
    expect(skipped).toBe(1)
    expect(groups.map((g) => g.name).sort()).toEqual(["医疗信息化", "基础设施"])
  })
})

describe("normalizeDraftItemsFromCatalog", () => {
  const catalog = [
    fakeProduct({ id: "p-1", product_name: "EMR" }),
    fakeProduct({ id: "p-2", product_name: "LIS" }),
  ]

  it("严格过滤非目录 product_id：filtered 计数正确", () => {
    const { items, filtered } = normalizeDraftItemsFromCatalog(
      { items: [{ product_id: "p-1", qty: 2 }, { product_id: "not-in-catalog" }, { product_id: "p-2" }] },
      catalog,
    )
    expect(items.map((i) => i.product_id)).toEqual(["p-1", "p-2"])
    expect(items[0].qty).toBe(2)
    expect(items[0].price).toBe(0)
    expect(filtered).toBe(1)
  })

  it("兼容旧结构 {groups:[{items:[...]}]}", () => {
    const { items } = normalizeDraftItemsFromCatalog(
      { groups: [{ name: "x", items: [{ product_id: "p-1" }] }, { name: "y", items: [{ product_id: "p-2", qty: 3 }] }] },
      catalog,
    )
    expect(items).toHaveLength(2)
    expect(items[1].qty).toBe(3)
  })

  it("重复 product_id 只保留一次；qty 非正数兜底为 1", () => {
    const { items } = normalizeDraftItemsFromCatalog(
      { items: [{ product_id: "p-1" }, { product_id: "p-1", qty: 5 }, { product_id: "p-2", qty: 0 }] },
      catalog,
    )
    expect(items).toHaveLength(2)
    expect(items[0].qty).toBe(1) // 首次出现，qty 缺省 → 1（不会用后来的 5）
    expect(items[1].qty).toBe(1) // qty:0 归一为 1
  })

  it("空目录 / 非数组 raw → items:[]", () => {
    expect(normalizeDraftItemsFromCatalog(null, [])).toEqual({ items: [], filtered: 0 })
    expect(normalizeDraftItemsFromCatalog({ items: "bad" }, catalog).items).toEqual([])
    expect(normalizeDraftItemsFromCatalog({ items: [{ product_id: "p-1" }] }, []).filtered).toBe(1)
  })
})

// quote-history-01（最小切片）：同客户历史报价检索
describe("historyQuotesFor（同商机历史报价）", () => {
  const rec = (over: Partial<QuoteRecord>): QuoteRecord =>
    ({
      id: "q1",
      quote_name: "n",
      opportunity_id: "",
      opportunity_name: "",
      updated: "2026-01-01",
      groups: [],
      ...over,
    }) as unknown as QuoteRecord

  it("同 opportunity_id 命中；排除自身；无关商机不命中", () => {
    const cur = rec({ id: "me", opportunity_id: "opp1" })
    const all = [cur, rec({ id: "a", opportunity_id: "opp1" }), rec({ id: "b", opportunity_id: "opp2" })]
    expect(historyQuotesFor(cur, all).map((q) => q.id)).toEqual(["a"])
  })

  it("老单无 id 但同 opportunity_name → 兼容命中", () => {
    const cur = rec({ id: "me", opportunity_name: "××医院智慧园区" })
    const all = [cur, rec({ id: "old", opportunity_name: "××医院智慧园区" }), rec({ id: "x", opportunity_name: "其他" })]
    expect(historyQuotesFor(cur, all).map((q) => q.id)).toEqual(["old"])
  })

  it("当前单未关联商机（id/名字都空）→ 静默空", () => {
    expect(historyQuotesFor(rec({ id: "me" }), [rec({ id: "a", opportunity_id: "opp1" })])).toHaveLength(0)
    expect(historyQuotesFor(null, [])).toHaveLength(0)
  })

  it("按 updated 降序，最多 limit 份", () => {
    const cur = rec({ id: "me", opportunity_id: "opp1" })
    const all = [
      cur,
      rec({ id: "old", opportunity_id: "opp1", updated: "2025-01-01" }),
      rec({ id: "mid", opportunity_id: "opp1", updated: "2026-05-01" }),
      rec({ id: "new", opportunity_id: "opp1", updated: "2026-09-01" }),
    ]
    expect(historyQuotesFor(cur, all).map((q) => q.id)).toEqual(["new", "mid", "old"])
    expect(historyQuotesFor(cur, all, 2).map((q) => q.id)).toEqual(["new", "mid"])
  })
})
