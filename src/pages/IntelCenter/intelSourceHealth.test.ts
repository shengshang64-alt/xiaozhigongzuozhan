import { describe, expect, it } from "vitest"
import { classifyIntelSourceError, intelSourceErrorText } from "./intelSourceHealth"

describe("信息源失败分类", () => {
  it("404 / DNS / 拒连 = 死链，可累计到自动停用", () => {
    expect(classifyIntelSourceError("对方返回 HTTP 404")).toBe("dead")
    expect(classifyIntelSourceError("dial tcp: lookup www.example.cn: no such host")).toBe("dead")
    expect(classifyIntelSourceError("connection refused")).toBe("dead")
  })

  it("403 / 412 = 反爬，不当作死链", () => {
    expect(classifyIntelSourceError("对方返回 HTTP 403")).toBe("blocked")
    expect(classifyIntelSourceError("对方返回 HTTP 412")).toBe("blocked")
  })

  it("5xx / 超时 / 证书 = 瞬时故障，不自动停用", () => {
    expect(classifyIntelSourceError("对方返回 HTTP 503")).toBe("transient")
    expect(classifyIntelSourceError("抓取超时（15s）")).toBe("transient")
    expect(classifyIntelSourceError("x509 certificate error")).toBe("transient")
  })

  it("给用户的中文解释按类别区分", () => {
    expect(intelSourceErrorText("对方返回 HTTP 404")).toContain("地址失效")
    expect(intelSourceErrorText("对方返回 HTTP 412")).toContain("反爬")
    expect(intelSourceErrorText("抓取超时（15s）")).toContain("不会自动停用")
  })
})
