// 2026-10-23（P0-3 正文可读性）：段落长度门禁，标尺取真实交付标书
import { describe, expect, it } from "vitest"
import { evaluateProseQuality, PROSE_BENCH } from "./proseQualityGate"
import type { Chapter } from "../SolutionStudio/solutionTypes"

const ch = (content: string, part: "tech" | "biz" = "tech"): Chapter =>
  ({ node_id: "n", title: "章", sections: [], content, gen_status: "done", part }) as unknown as Chapter

// 真实交付风格：一句一个事实，40~120 字一段
const shortParas = Array.from({ length: 12 }, (_, i) => `第${i + 1}段：系统支持门诊挂号、收费、住院医嘱等业务闭环，平均响应时间不超过 3 秒，覆盖 12 个科室。`).join("\n")
// AI 风格：一坨 300+ 字
const longText =
  "系统整体采用先进的技术架构，通过统一的数据治理与权限管理体系，实现了对全院业务数据的全面汇聚与深度利用，并在多个业务场景中形成了闭环，同时兼顾了未来的扩展性与兼容性，能够满足医院长期发展的需要，并且在不同院区之间实现了统一的配置与分级授权，确保数据的一致性与安全性。" +
  "在此基础上，平台通过标准化的数据服务接口向绩效、驾驶舱、监管等应用供数，链路设有质量监控与自动告警，并由专门的运营岗位负责持续迭代，确保数据资产目录与实际业务保持一致，避免出现同名不同义、同义不同源的口径冲突。" +
  "同时，围绕一院多区的业务特点，系统在统一主数据与统一权限的基础上支持院区级差异化配置，既保证集团层面的口径一致，又兼顾各院区在流程与服务上的个性化需求，并为此建立了配套的变更审核与回滚机制。"
const longParas = Array.from({ length: 4 }, () => longText).join("\n")

describe("正文可读性门禁（P0-3）", () => {
  it("① 空正文：不臆断，level=ok", () => {
    const r = evaluateProseQuality([])
    expect(r.paragraphs).toBe(0)
    expect(r.level).toBe("ok")
  })

  it("② 真实交付风格（短段）→ ok", () => {
    const r = evaluateProseQuality([ch(shortParas)])
    expect(r.paragraphs).toBe(12)
    expect(r.median).toBeLessThanOrEqual(PROSE_BENCH.median * 1.5)
    expect(r.level).toBe("ok")
  })

  it("③ AI 风格（长段）→ 非 ok，且给出可拆分段落数", () => {
    const r = evaluateProseQuality([ch(longParas)])
    expect(r.level).not.toBe("ok")
    expect(r.over300Pct).toBeGreaterThan(0.3)
    expect(r.splittable).toBeGreaterThan(0)
    expect(r.detail).toContain("超 300 字占")
  })

  it("④ 商务章不参与（正文只算技术章）", () => {
    const r = evaluateProseQuality([ch(shortParas), ch(longParas, "biz")])
    expect(r.paragraphs).toBe(12)
    expect(r.level).toBe("ok")
  })
})
