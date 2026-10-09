import { describe, expect, it } from "vitest"
import { redactPii, findPii, containsPii } from "./piiRedact"

// ---------------------------------------------------------------------------
// 确定性 PII 逐字段脱敏（R186）：服务 AGENTS.md #7，敏感档摘要进 AI 前二次掩码。
// 锁死点：①各类别掩码口径；②普通数字 / 年份 / 金额 / ISO 编号零误伤；
// ③身份证内含手机号子串不被误切；④掩码幂等（已脱敏文本再跑不变）。
// ---------------------------------------------------------------------------

describe("redactPii 手机号", () => {
  it("11 位大陆手机号掩码", () => {
    expect(redactPii("联系电话13812345678")).toBe("联系电话138****5678")
  })
  it("12 位普通数字串不脱", () => {
    expect(redactPii("编号 202412345678 完")).toBe("编号 202412345678 完")
  })
})

describe("redactPii 身份证", () => {
  it("18 位纯数字保留前6后4", () => {
    expect(redactPii("身份证号110101199003071234。")).toBe("身份证号110101********1234。")
  })
  it("17 位 + X 校验位保留前6后4", () => {
    expect(redactPii("证号 11010119900307123X 完")).toContain("110101********123X")
  })
  it("15 位老证保留前6后3", () => {
    expect(redactPii("15位证110101900307123完")).toContain("110101******123")
  })
  it("身份证内部的手机号子串不被误切", () => {
    // 前 11 位恰似手机号，仍整体判为身份证（极大数字串优先），保留前6后4
    expect(redactPii("138123456789012345")).toBe("138123********2345")
  })
})

describe("redactPii 银行卡", () => {
  it("19 位保留前4后4", () => {
    expect(redactPii("6222020000000000111")).toBe("6222***********0111")
  })
})

describe("redactPii 邮箱", () => {
  it("局部首字母 + 完整域名", () => {
    expect(redactPii("邮箱 zhangsan@corp.com")).toBe("邮箱 z***@corp.com")
  })
})

describe("redactPii 统一社会信用代码", () => {
  it("91 开头含字母主体保留前2后4", () => {
    expect(redactPii("代码91310000MA1FL1234X")).toBe("代码91************234X")
  })
})

describe("redactPii 固定电话", () => {
  it("区号保留，号码留尾 2", () => {
    expect(redactPii("座机 010-12345678")).toBe("座机 010-******78")
  })
})

describe("redactPii 零误伤", () => {
  it("金额 / 年份 / 章节号原样", () => {
    const s = "预算金额：3500 万元，2024 年采购，第 1 章"
    expect(redactPii(s)).toBe(s)
  })
  it("ISO9001 编号原样", () => {
    expect(redactPii("ISO9001 证书")).toBe("ISO9001 证书")
  })
})

describe("redactPii 幂等", () => {
  it("已脱敏文本再跑不变", () => {
    const once = redactPii("联系13812345678 证110101199003071234")
    expect(redactPii(once)).toBe(once)
  })
})

describe("findPii", () => {
  it("混合文本识别多类", () => {
    const hits = findPii("李四 13800138000 身份证110101199003071234 邮箱 lisi@a.com")
    const kinds = hits.map((h) => h.kind).sort()
    expect(kinds).toEqual(["email", "idcard", "phone"])
  })
  it("无 PII 返回空数组", () => {
    expect(findPii("正常的一句话，无任何敏感字段")).toEqual([])
  })
})

describe("containsPii", () => {
  it("含手机为真", () => {
    expect(containsPii("电话13812345678")).toBe(true)
  })
  it("普通数字为假", () => {
    expect(containsPii("金额 3500 万元")).toBe(false)
  })
})
