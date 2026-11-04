import { describe, expect, it } from "vitest"
import {
  historyQuotesFor,
  importChecklistLines,
  isCatalogLine,
  itemSubtotal,
  lineKey,
  makeDefaultGroups,
  mergeItemsIntoGroups,
  normalizeDraftItemsFromCatalog,
  normalizeDiscount,
  normalizeSlides,
  quoteItemFromChecklistLine,
  quoteItemFromProduct,
  sanitizeQuote,
  trimSlidesToTarget,
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

// ---------------------------------------------------------------------------
// R149：标书项目素材注入招标原文节选（防 PPT 凭空编造事实）
// ---------------------------------------------------------------------------

import { buildMaterialText, tenderFactExcerpt } from "./pptQuoteTypes"

const R149_TENDER = [
  "项目名称：三明市中西医结合医院信息化整体提升项目",
  "采购人：三明市中西医结合医院",
  "编制时间：2026年7月",
  "目 录",
  "第一章 投标邀请 3",
  "1.1 项目概况 3",
  "第二章 采购需求（项目背景、目标、范围与前置条件） 6",
  "2.2 项目目标 6",
  "第二章 采购需求（项目背景、目标、范围与前置条件）",
  "2.1 项目背景",
  "医院决定实施为期三年（2026—2028年）的信息化整体提升项目。",
  "2.2 项目目标",
  "总体目标：围绕电子病历系统应用水平分级评价五级、医院信息互联互通标准化成熟度测评五级乙等、医院智慧服务分级评估三级。",
  "2.3 建设范围",
  "本项目建设范围共九大类，合计约206个系统/子系统模块。",
].join("\n")

describe("tenderFactExcerpt（R149 素材链路修复）", () => {
  it("保留头部项目事实与第二章正文窗口，剔除目录页码行", () => {
    const got = tenderFactExcerpt(R149_TENDER)
    expect(got).toContain("项目名称：三明市中西医结合医院信息化整体提升项目")
    expect(got).toContain("2026—2028年")
    expect(got).toContain("互联互通标准化成熟度测评五级乙等")
    expect(got).toContain("206个系统/子系统模块")
    // 目录行（带页码）不得混入
    expect(got).not.toContain("第一章 投标邀请 3")
    expect(got).not.toContain("2.2 项目目标 6")
  })

  it("尊重 maxChars 上限；空文本返回空串", () => {
    expect(tenderFactExcerpt(R149_TENDER, 120).length).toBeLessThanOrEqual(120)
    expect(tenderFactExcerpt("", 3600)).toBe("")
    expect(tenderFactExcerpt("   \n  ", 3600)).toBe("")
  })

  it("无目录的短招标文本也能取到事实（降级为头部窗口）", () => {
    const short = "项目名称：某县医院HIS采购项目\n预算金额：人民币800万元\n建设内容：HIS 系统升级"
    const got = tenderFactExcerpt(short)
    expect(got).toContain("某县医院HIS采购项目")
  })
})

describe("buildMaterialText 注入招标节选（R149）", () => {
  it("带 tenderText 时含【招标文件节选】块且置于大纲/摘要之前", () => {
    const got = buildMaterialText("【演练】R01", [], [], 4200, R149_TENDER)
    expect(got).toContain("【招标文件节选")
    expect(got).toContain("五级乙等")
    const tenderIdx = got.indexOf("【招标文件节选")
    const srcIdx = got.indexOf("【素材来源】")
    expect(tenderIdx).toBeGreaterThan(srcIdx)
  })

  it("不带 tenderText 时保持原行为（无招标块，大纲/摘要照旧）", () => {
    const got = buildMaterialText("某方案", [{ id: "1", title: "总体设计", children: [] }], [
      { id: "c1", title: "总体设计", content: "全文交换平台，数据同源共享。" },
    ] as never[])
    expect(got).not.toContain("【招标文件节选")
    expect(got).toContain("【大纲】")
    expect(got).toContain("总体设计：全文交换平台")
  })
})

// ---------------------------------------------------------------------------
// R157 单发 PPT 生成页数收敛：trimSlidesToTarget + normalizeSlides(maxPages)
// 闭环 r149-deck-pagecount-unenforced：单发路径此前不限页数（目标 3 页返回 6 页照单全收）
// ---------------------------------------------------------------------------

function slideFixture(titles: string[]) {
  return { slides: titles.map((title) => ({ title, bullets: ["x"], notes: "" })) }
}

describe("trimSlidesToTarget（单发超页按目标收敛，保留开场/致谢）", () => {
  it("不超目标 → 原样返回（同一引用）", () => {
    const s = [{ title: "开场" }, { title: "正文" }, { title: "致谢" }]
    expect(trimSlidesToTarget(s, 3)).toBe(s)
    expect(trimSlidesToTarget(s, 5)).toBe(s)
  })
  it("超目标 → 裁到 target，保留首页与末页、只删中间正文", () => {
    const s = [
      { title: "开场" },
      { title: "C1" },
      { title: "C2" },
      { title: "C3" },
      { title: "C4" },
      { title: "致谢" },
    ]
    const r = trimSlidesToTarget(s, 3)
    expect(r.map((x) => x.title)).toEqual(["开场", "C1", "致谢"])
  })
  it("target=1 → 只留首页", () => {
    const r = trimSlidesToTarget([{ title: "开场" }, { title: "致谢" }], 1)
    expect(r.map((x) => x.title)).toEqual(["开场"])
  })
  it("target 非正数 / 非法 → 原样返回（不裁剪）", () => {
    const s = [{ title: "A" }, { title: "B" }]
    expect(trimSlidesToTarget(s, 0)).toBe(s)
    expect(trimSlidesToTarget(s, -1)).toBe(s)
    expect(trimSlidesToTarget(s, NaN)).toBe(s)
  })
})

describe("normalizeSlides maxPages 上限", () => {
  it("传 maxPages 且模型超页 → 收敛到上限", () => {
    const raw = slideFixture(["开场", "C1", "C2", "C3", "C4", "致谢"])
    const out = normalizeSlides(raw, null, 3)
    expect(out.map((x) => x.title)).toEqual(["开场", "C1", "致谢"])
  })
  it("不传 maxPages → 不限页数（批量/精修路径向后兼容）", () => {
    const raw = slideFixture(["开场", "C1", "C2", "C3", "C4", "致谢"])
    expect(normalizeSlides(raw, null)).toHaveLength(6)
  })
  it("空返回仍抛错", () => {
    expect(() => normalizeSlides({ slides: [] }, null, 3)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 2026-11-04 C 项补链回归：normalizeSlides 曾**完全丢弃 kind**，
// 导致单发路径（≤10 页，最常见）生成的页型全丢 → reshape 的「按声明页型整形」
// 永远触发不了，架构/流程页继续退化成文字卡片。这里钉住 kind 必须保住。
// ---------------------------------------------------------------------------
describe("normalizeSlides 保留页型 kind", () => {
  it("模型给了合法 kind → 原样保留（单发路径 reshape 依赖它）", () => {
    const out = normalizeSlides(
      { slides: [{ title: "总体架构", kind: "architecture", bullets: ["a", "b", "c"] }] },
      null,
    )
    expect(out[0].kind).toBe("architecture")
  })

  it("非法 kind → 不抛错、不硬塞，退化为无 kind", () => {
    const out = normalizeSlides({ slides: [{ title: "页", kind: "网页", bullets: ["a"] }] }, null)
    expect(out[0].kind).toBeUndefined()
  })

  it("模型没给 kind → 继承大纲同名页的 kind", () => {
    const plan = [{ id: "s1", title: "总体架构", intent: "", kind: "architecture" as const }]
    const out = normalizeSlides({ slides: [{ title: "总体架构", bullets: ["a", "b", "c"] }] }, plan)
    expect(out[0].kind).toBe("architecture")
  })
})


// ---------------------------------------------------------------------------
// R285（r281-quote-discount-no-entry）：折扣百分比单一口径
// ---------------------------------------------------------------------------
describe("normalizeDiscount（R285 折扣单一口径）", () => {
  it("缺省 / 非法 / ≤0 一律归一为原价 100，杜绝「0 当 0 折」把小计悄悄归零", () => {
    expect(normalizeDiscount(undefined)).toBe(100)
    expect(normalizeDiscount(null)).toBe(100)
    expect(normalizeDiscount(NaN)).toBe(100)
    expect(normalizeDiscount(0)).toBe(100)
    expect(normalizeDiscount(-10)).toBe(100)
  })

  it("90 = 按 90% 计价（打 9 折），与表尾脚注、Excel 公式同口径；>100 按 100 封顶", () => {
    expect(normalizeDiscount(90)).toBe(90)
    expect(normalizeDiscount(85.5)).toBe(85.5)
    expect(normalizeDiscount(100)).toBe(100)
    expect(normalizeDiscount(120)).toBe(100)
  })

  it("itemSubtotal：脏值 discount=0 不再把金额清零，按原价计", () => {
    const it = { id: "i1", item_name: "x", spec: "", unit: "套", qty: 2, price: 1000, discount: 0 }
    expect(itemSubtotal(it as unknown as QuoteItem)).toBe(2000)
    expect(itemSubtotal({ ...it, discount: 90 } as unknown as QuoteItem)).toBe(1800)
  })

  it("sanitizeQuote：落盘脏值 discount=0 重载后归一为 100（不再 ||0 存成 0）", () => {
    const groups: QuoteRecord["groups"] = [
      {
        id: "g1",
        name: "软件",
        items: [
          {
            id: "i1",
            item_name: "x",
            spec: "",
            unit: "套",
            qty: 1,
            price: 1200,
            discount: 0,
          } as unknown as QuoteItem,
        ],
      },
    ]
    const out = sanitizeQuote(fakeQuote(groups))
    expect(out.groups[0].items[0].discount).toBe(100)
    expect(itemSubtotal(out.groups[0].items[0])).toBe(1200)
  })
})
