import { describe, expect, it } from "vitest"
import { rewriteRequirementToResponse, scanRequirementMarkers, verifyRewrite } from "./paramRewrite"

/**
 * R53（2026-10-15 用户裁定）：技术参数响应的字眼转换不是词表映射，而是
 * 「义务标记 +（主体词）+ 谓语动词」的句法模式识别 + 五道语义守卫。
 * 本文件锁的是**方法本身**：能改的必须只动字眼、不能改的一个字都不许动。
 */

const rw = (s: string) => rewriteRequirementToResponse(s)

describe("义务类：剥离标记（+主体词），谓语原样保留", () => {
  it("要求提供 X → 提供 X（不是「支持 X」——词表映射在这里必然错配）", () => {
    const r = rw("要求提供三年免费质保服务")
    expect(r.response).toBe("提供三年免费质保服务")
    expect(r.rewritten).toBe(true)
    expect(r.needs_review).toBe(false)
  })

  it("应支持 X → 支持 X", () => {
    expect(rw("应支持国产化数据库").response).toBe("支持国产化数据库")
  })

  it("必须满足 / 须达到 / 需具备 等标记一律只剥标记", () => {
    expect(rw("必须满足三级等保要求").response).toBe("满足三级等保要求")
    expect(rw("须达到 99.9% 可用性").response).toBe("达到 99.9% 可用性")
    expect(rw("需具备电子病历分级评价四级能力").response).toBe("具备电子病历分级评价四级能力")
  })

  it("投标人一侧主体词一并剥掉（响应主体默认我方）", () => {
    const r = rw("要求投标人提供原厂授权书")
    expect(r.response).toBe("提供原厂授权书")
    expect(r.changes.map((c) => c.rule)).toEqual(["obligation_strip", "subject_strip"])
  })

  it("非投标人主体（系统/平台）保留——「系统应支持」改的是标记不是主语", () => {
    expect(rw("系统应支持多院区部署").response).toBe("系统支持多院区部署")
  })

  it("同一行多个标记各自处理，其余文字一字不动", () => {
    const r = rw("系统应支持国产化数据库，不得转包或分包")
    expect(r.response).toBe("系统支持国产化数据库，不转包或分包")
    expect(r.needs_review).toBe(true) // 禁止类要人确认口径
  })
})

describe("语义守卫①：假词黑名单——不是义务标记的一个都不许动", () => {
  it("「需求 / 应对 / 可配置」这类以标记字开头的词不被误切", () => {
    for (const s of ["需求清单详见附件", "应对突发情况提供保障", "系统可配置多租户隔离", "适应不同科室的业务流程"]) {
      const r = rw(s)
      expect(r.response, s).toBe(s)
      expect(r.rewritten, s).toBe(false)
    }
  })

  it("标记出现在句中（非分句首）时不认——中文没有词边界，位置是第一道闸", () => {
    const r = rw("本项目采购需求应提供明细清单")
    // 句中「应提供」不落分句首，不改写（宁可漏改，不可错改）
    expect(r.rewritten).toBe(false)
  })

  it("回归：以标记字结尾的常见词（响应/应急响应/急需/认可/许可/将要）不被当成标记", () => {
    // 这些句子没有任何该改的地方：响应=响应、应急=应急，一个都不许动、也不许报警
    for (const s of [
      "提供 7×24 小时运维响应",
      "应急响应时间不超过 15 分钟",
      "提供原厂认可的实施资质",
      "项目将要上线时提供驻场支持",
    ]) {
      const r = rw(s)
      expect(r.response, s).toBe(s)
      expect(r.reason, s).toBe("")
    }
    // 句中「须」带状语：不改写但必须提示人工确认；「急需」不许被误切
    const r = rw("项目急需的模块须优先上线")
    expect(r.rewritten).toBe(false)
    expect(r.response).toContain("急需")
    expect(r.needs_review).toBe(true)
    // 「许可」「方可」都不是许可类标记，不许触发提示
    const p = rw("取得制造商许可后方可部署")
    expect(p.response).toBe("取得制造商许可后方可部署")
    expect(p.reason).toBe("")
  })
})

describe("语义守卫②：右邻谓语白名单——带状语的一律不自动改", () => {
  it("「须在合同签订后 30 日内完成交付」不自动改写，只给人工提示", () => {
    const r = rw("须在合同签订后 30 日内完成交付")
    expect(r.response).toBe("须在合同签订后 30 日内完成交付")
    expect(r.rewritten).toBe(false)
    expect(r.needs_review).toBe(true)
    expect(r.reason).toContain("未紧跟可识别的谓语动词")
  })
})

describe("语义守卫③：角色判定——采购人一侧的义务不是我的响应义务", () => {
  it("「要求采购人提供机房环境」不改写并标人工确认", () => {
    const r = rw("要求采购人提供机房环境")
    expect(r.response).toBe("要求采购人提供机房环境")
    expect(r.rewritten).toBe(false)
    expect(r.needs_review).toBe(true)
    expect(r.reason).toContain("采购人")
  })
})

describe("禁止类：量化边界原样保留，禁止行为换「不」", () => {
  it("不得少于 / 不得低于 是下限承诺口径，一个字不改也不报警", () => {
    for (const s of ["质保期不得少于 3 年", "系统可用性不得低于 99.9%"]) {
      const r = rw(s)
      expect(r.response, s).toBe(s)
      expect(r.rewritten, s).toBe(false)
      expect(r.needs_review, s).toBe(false)
      expect(r.changes.some((c) => c.rule === "boundary_keep"), s).toBe(true)
    }
  })

  it("禁止行为改为承诺不做，并要求人工确认口径", () => {
    expect(rw("不得转包或分包").response).toBe("不转包或分包")
    expect(rw("严禁将本项目转包").response).toBe("不将本项目转包")
    expect(rw("不得转包").needs_review).toBe(true)
  })
})

describe("许可/建议类：只提示不改写（改成承诺＝凭空增加验收义务）", () => {
  it("可提供 / 宜采用 保持原样，并提示属招标侧选做项", () => {
    const r = rw("可提供可选的数据分析模块")
    expect(r.response).toBe("可提供可选的数据分析模块")
    expect(r.rewritten).toBe(false)
    expect(r.needs_review).toBe(true)
    expect(r.reason).toContain("选做项")
  })
})

describe("语义守卫④：回读自证——只调整字眼、原文一个字没动", () => {
  const samples = [
    "要求提供三年免费质保服务",
    "应支持国产化数据库",
    "要求投标人提供原厂授权书",
    "系统应支持多院区部署，需具备双活能力",
    "不得转包或分包",
    "质保期不得少于 3 年",
    "须在合同签订后 30 日内完成交付",
  ]

  it("每条改写都能把 changes 作用回原文得到响应文本（机器自证成立）", () => {
    for (const s of samples) {
      const r = rw(s)
      expect(verifyRewrite(r.original, r.response, r.changes), s).toBe(true)
    }
  })

  it("自证函数本身能识破「动了不该动的地方」", () => {
    expect(verifyRewrite("abc", "abd", [{ rule: "obligation_strip", at: 2, removed: "c", inserted: "d", note: "" }])).toBe(true)
    expect(verifyRewrite("abc", "abx", [{ rule: "obligation_strip", at: 2, removed: "c", inserted: "d", note: "" }])).toBe(false)
  })

  it("改写幂等：对已改写的响应再跑一次不再变化（可安全重复执行）", () => {
    const once = rw("要求提供三年免费质保服务").response
    const twice = rw(once)
    expect(twice.response).toBe(once)
    expect(twice.rewritten).toBe(false)
  })

  it("扫描器能报出标记位置与档位（面板解释「为什么改/为什么不改」用）", () => {
    const marks = scanRequirementMarkers("系统应支持国产化数据库，不得转包")
    expect(marks.map((m) => `${m.family}:${m.marker}`)).toEqual(["obligation:应", "prohibition:不得"])
    expect(scanRequirementMarkers("需求清单详见附件")).toEqual([])
  })
})
