import { describe, expect, it } from "vitest"
import { buildQuoteDraftMessages } from "./pptQuoteTypes"
import type { CheckProduct } from "@/pages/SolutionStudio/checklistTypes"

// ---------------------------------------------------------------------------
// AI 报价草案 Prompt：硬约束「只能引用产品库中的 product_id」+ 移除旧 4 科目
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

describe("buildQuoteDraftMessages", () => {
  const catalog = [
    fakeProduct(),
    fakeProduct({ id: "p-2", product_name: "LIS", module_name: "样本接收", unit_price: 80000 }),
  ]
  const msgs = buildQuoteDraftMessages("XX 市人民医院智慧医院项目", "建设内容：在线复诊、样本接收", catalog)

  it("System prompt 必含「只能引用 USER 消息中列出的 product_id」硬约束", () => {
    const sys = msgs.find((m) => m.role === "system")?.content ?? ""
    expect(sys).toContain("只能引用")
    expect(sys).toContain("product_id")
    // 明确要求"不允许编造未在目录中的产品"
    expect(sys).toMatch(/不允许编造|不允许.*编造/)
  })

  it("System prompt 声明输出格式：{items:[{product_id,qty}]}；不允许输出价格 / 折扣 / 备注", () => {
    const sys = msgs.find((m) => m.role === "system")?.content ?? ""
    expect(sys).toContain('{"items":[{"product_id"')
    for (const banned of ["price", "discount", "remark"]) {
      expect(sys).toContain(banned)
    }
  })

  it("旧 4 大报价科目（软件许可/实施服务/硬件三方/年保维保）不再出现在 prompt 中（防回流）", () => {
    const all = msgs.map((m) => m.content).join("\n")
    expect(all).not.toContain("软件许可")
    expect(all).not.toContain("实施服务")
    expect(all).not.toContain("年保维保")
    // 「硬件三方」也禁止（可能被误用作 category 兜底）
    expect(all).not.toContain("硬件三方")
  })

  it("User prompt 包含产品目录块：每行 [product_id] 类别 | 产品名 - 模块名 | 功能 | 单位 | 参考价", () => {
    const user = msgs.find((m) => m.role === "user")?.content ?? ""
    expect(user).toContain("【产品目录】")
    expect(user).toContain("[p-1] 医疗信息化 | 互联网医院平台 - 在线复诊")
    expect(user).toContain("[p-2]")
    expect(user).toContain("LIS")
    // 参考价数字出现在行内
    expect(user).toContain("120000")
    expect(user).toContain("80000")
  })

  it("关联项目名 + 素材文本被带入 user 消息", () => {
    const user = msgs.find((m) => m.role === "user")?.content ?? ""
    expect(user).toContain("XX 市人民医院智慧医院项目")
    expect(user).toContain("建设内容：在线复诊、样本接收")
  })

  it("空素材时不出现【参考素材】段落；空目录时提示返回 {items:[]}", () => {
    const noMaterial = buildQuoteDraftMessages("项目 A", "   ", catalog)
    const u1 = noMaterial.find((m) => m.role === "user")?.content ?? ""
    expect(u1).not.toContain("【参考素材】")
    expect(u1).toContain("【产品目录】")

    const emptyCatalog = buildQuoteDraftMessages("项目 B", "素材", [])
    const u2 = emptyCatalog.find((m) => m.role === "user")?.content ?? ""
    expect(u2).toContain("产品库为空")
    expect(u2).toContain('"items":[]')
  })

  it("目录超过 200 条时截断到 200 条（防 token 爆）", () => {
    const bigCatalog = Array.from({ length: 250 }, (_, i) => fakeProduct({ id: `p-${i}`, product_name: `P${i}` }))
    const m = buildQuoteDraftMessages("项目", "素材", bigCatalog)
    const user = m.find((x) => x.role === "user")?.content ?? ""
    // 提示行显示 "共 200 条"
    expect(user).toContain("共 200 条")
    // p-199 存在，p-249 不存在
    expect(user).toContain("[p-199]")
    expect(user).not.toContain("[p-249]")
  })
})
