import { describe, expect, it } from "vitest"
import {
  base64ToBytes,
  computeMissingFields,
  decodeBinSections,
  deriveFlatFromLeadership,
  parseProfileJson,
  toLeadership,
  type CustomerRow,
} from "./customerTypes"

// 医院信息多维度补全：领导团队 / 扁平派生 / 缺失计算 / GBK 回传解码 的行为锈死网
// 仅覆盖前端纯函数层（parseProfileJson / deriveFlatFromLeadership / computeMissingFields / toLeadership / decode）。

// 造一个字段齐全的行，用于「全齐 → 无缺失」基线
const fullRow = (patch: Partial<CustomerRow> = {}): CustomerRow =>
  ({
    level: "三级甲等",
    region: "江苏省苏州市",
    website: "https://www.example.com",
    address: "苏州市某某路 1 号",
    it_lead: "王五",
    outpatient_daily: 8000,
    outpatient_yearly: 2000000,
    beds_total: 2000,
    annual_revenue: 300000,
    key_departments: ["心血管内科", "骨科"],
    leadership: [{ name: "张三", title: "院长" }],
    president: "张三",
    ...patch,
  }) as CustomerRow

describe("toLeadership", () => {
  it("过滤非对象/无姓名项，字符串 slice(0,40) 清洗", () => {
    const long = "刻".repeat(100)
    const out = toLeadership([
      null,
      42,
      { name: "  ", title: "院长" }, // 空姓名 → 丢
      { name: "李四", title: long, role: long },
      { name: "王五" }, // 仅姓名，职务/分工补空串
    ])
    expect(out.map((m) => m.name)).toEqual(["李四", "王五"])
    expect(out[0].title).toHaveLength(40)
    expect(out[0].role).toHaveLength(40)
    expect(out[1]).toMatchObject({ title: "", role: "" })
  })

  it("cap 12：超过 12 位只保留前 12", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ name: `姓名${i}`, title: "副院长" }))
    expect(toLeadership(many)).toHaveLength(12)
  })

  it("非数组入参返回空数组", () => {
    expect(toLeadership(undefined)).toEqual([])
    expect(toLeadership("nope")).toEqual([])
    expect(toLeadership({ name: "张三" })).toEqual([])
  })
})

describe("deriveFlatFromLeadership", () => {
  it("院长（非副/名誉）→ president；含书记 → party_secretary", () => {
    const r = deriveFlatFromLeadership([
      { name: "张三", title: "院长、党委副书记" },
      { name: "李四", title: "党委书记" },
      { name: "王五", title: "副院长" },
    ])
    expect(r.president).toBe("张三")
    expect(r.party_secretary).toBe("李四")
  })

  it("只有副院长/名誉院长不算正职", () => {
    const r = deriveFlatFromLeadership([
      { name: "赵六", title: "副院长" },
      { name: "钱七", title: "名誉院长" },
    ])
    expect(r.president).toBeNull()
    expect(r.party_secretary).toBeNull()
  })

  it("空/缺省 → 两个都 null", () => {
    expect(deriveFlatFromLeadership([])).toEqual({ president: null, party_secretary: null })
    expect(deriveFlatFromLeadership(null)).toEqual({ president: null, party_secretary: null })
  })
})

describe("computeMissingFields", () => {
  it("空档案：核心字段全缺（11 项）", () => {
    expect(computeMissingFields({} as CustomerRow)).toHaveLength(11)
  })

  it("数值 0 视为缺失", () => {
    const missing = computeMissingFields(fullRow({ beds_total: 0, outpatient_daily: 0 }))
    expect(missing).toContain("beds_total")
    expect(missing).toContain("outpatient_daily")
  })

  it("全齐 → 返回 []", () => {
    expect(computeMissingFields(fullRow())).toEqual([])
  })

  it("leadership 与 president 二选一非空即不算缺", () => {
    // 只有 leadership、president 空
    const a = computeMissingFields(fullRow({ president: "", leadership: [{ name: "张三", title: "院长" }] }))
    expect(a).not.toContain("leadership")
    // 只有 president、leadership 空
    const b = computeMissingFields(fullRow({ president: "张三", leadership: [] }))
    expect(b).not.toContain("leadership")
    // 两者都空 → 缺
    const c = computeMissingFields(fullRow({ president: "", leadership: [] }))
    expect(c).toContain("leadership")
  })
})

describe("parseProfileJson leadership", () => {
  it("正常解析 leadership 数组", () => {
    const json = JSON.stringify({
      level: "三级甲等",
      leadership: [
        { name: "张三", title: "院长", role: "主持行政全面工作" },
        { name: "李四", title: "党委书记" },
      ],
    })
    const r = parseProfileJson(json)
    expect(r?.leadership).toEqual([
      { name: "张三", title: "院长", role: "主持行政全面工作" },
      { name: "李四", title: "党委书记", role: "" },
    ])
  })

  it("丢弃无 name 的项 / 非数组 → null / 空数组 → null", () => {
    expect(parseProfileJson(JSON.stringify({ leadership: [{ title: "院长" }, { name: "张三" }] }))?.leadership)
      .toEqual([{ name: "张三", title: "", role: "" }])
    expect(parseProfileJson(JSON.stringify({ leadership: "nope" }))?.leadership).toBeNull()
    expect(parseProfileJson(JSON.stringify({ leadership: [] }))?.leadership).toBeNull()
  })

  it("cap 12", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ name: `N${i}`, title: "副院长" }))
    expect(parseProfileJson(JSON.stringify({ leadership: many }))?.leadership).toHaveLength(12)
  })
})

describe("base64ToBytes / decodeBinSections", () => {
  // 检测运行环境（Node full-icu / 浏览器）是否原生支持 gbk 解码；不支持则该用例跳过并注释
  const gbkSupported = (() => {
    try {
      return new TextDecoder("gbk").decode(new Uint8Array([0xd2, 0xbd, 0xd4, 0xba])) === "医院"
    } catch {
      return false
    }
  })()

  it("base64ToBytes 正确还原字节", () => {
    // "医院" 的 GBK 码：D2 BD D4 BA
    const b64 = Buffer.from([0xd2, 0xbd, 0xd4, 0xba]).toString("base64")
    expect(Array.from(base64ToBytes(b64))).toEqual([0xd2, 0xbd, 0xd4, 0xba])
  })

  it.skipIf(!gbkSupported)("decodeBinSections 用 TextDecoder('gbk') 还原非 UTF-8 段", () => {
    const b64 = Buffer.from([0xd2, 0xbd, 0xd4, 0xba]).toString("base64") // "医院"
    const out = decodeBinSections("前文", [{ label: "概况", encoding: "gbk", bytesB64: b64 }])
    expect(out).toContain("前文")
    expect(out).toContain("【概况】")
    expect(out).toContain("医院")
  })

  it("无 binSections 时原样返回 utf8 正文（纯 UTF-8 站行为不变）", () => {
    expect(decodeBinSections("纯文本", null)).toBe("纯文本")
    expect(decodeBinSections("纯文本", [])).toBe("纯文本")
  })
})
