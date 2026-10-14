import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  SOL_CHECK_LABEL,
  SOL_CHECK_RULES,
  SOL_DELIVERY_ITEMS,
  auditSolutionDelivery,
  buildDeliveryFixText,
  type SolCheckHit,
} from "./solDeliveryCheck"
import type { Chapter } from "./solutionTypes"

// ---------------------------------------------------------------------------
// R252 方案交付前本地体检：规则口径与标书侧同源（复用 bidTypes 纯函数），
// 本测试守住三件事——① 该报的报得出（占位/元话语/指标/水印/超链接/空行/重复/章态）
// ② 不该报的不误报（合法占位不被装饰规则重复报、短文不报半角标点密度、未生成章不算空章）
// ③ 接线与口径哨兵（暗标专属项不纳入、查重段落预算护栏、占位约定与标书侧一致、卡片无障碍）。
// ---------------------------------------------------------------------------

function ch(over: Partial<Chapter> = {}): Chapter {
  return { node_id: "n1", title: "章节", sections: [], content: "", gen_status: "done", ...over } as Chapter
}

function rules(hits: SolCheckHit[]): string[] {
  return Array.from(new Set(hits.map((h) => h.rule)))
}

/** 通过全部本地核验的干净正文（不含拉丁/数字，避免中英混排提示项干扰断言） */
const CLEAN_A = "系统设计遵循集成、先进、可靠的原则，满足三级甲等医院业务连续性要求。"
const CLEAN_B = "项目分三期推进，每期完成既定范围并组织验收，确保交付质量可控。"

describe("auditSolutionDelivery 干净稿", () => {
  it("全部通过的方案正文不应产出任何命中", () => {
    const r = auditSolutionDelivery([
      ch({ node_id: "a", title: "总体设计", content: CLEAN_A }),
      ch({ node_id: "b", title: "实施计划", content: CLEAN_B }),
    ])
    expect(r.hits.map((h) => `${h.rule}:${h.quote}`)).toEqual([])
    expect(r.total).toBe(0)
    expect(r.bodyChapters).toBe(2)
    expect(r.scannedChapters).toBe(2)
    expect(r.truncated).toBe(false)
    expect(r.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it("正文尚未生成时不报空章（未生成属正常进度，不是交付硬伤）", () => {
    const r = auditSolutionDelivery([
      ch({ node_id: "a", title: "总体设计", content: "", gen_status: "pending" }),
      ch({ node_id: "b", title: "实施计划", content: "", gen_status: "generating" }),
    ])
    expect(r.total).toBe(0)
    expect(r.bodyChapters).toBe(0)
  })

  it("空清单容错，不抛异常", () => {
    expect(auditSolutionDelivery([]).total).toBe(0)
    expect(auditSolutionDelivery(undefined as unknown as Chapter[]).total).toBe(0)
  })
})

describe("章完成态硬伤", () => {
  it("标记完成却无正文 → empty_chapter，并带可跳转 node_id", () => {
    const r = auditSolutionDelivery([ch({ node_id: "x9", title: "运维保障", content: "   ", gen_status: "done" })])
    const hit = r.hits.find((h) => h.rule === "empty_chapter")
    expect(hit?.chapter).toBe("运维保障")
    expect(hit?.nodeId).toBe("x9")
    expect(hit?.level).toBe("warn")
  })

  it("生成失败章 → failed_chapter", () => {
    const r = auditSolutionDelivery([ch({ node_id: "f", title: "安全设计", content: "旧稿", gen_status: "failed" })])
    expect(rules(r.hits)).toContain("failed_chapter")
  })

  it("R282：失败摘录带上落库的真实原因，旧记录兜底「旧记录未留存原因」", () => {
    const withReason = auditSolutionDelivery([
      ch({ node_id: "f", title: "安全设计", gen_status: "failed", genError: "fetch timeout after 120000ms" }),
    ])
    expect(withReason.hits.find((h) => h.rule === "failed_chapter")?.quote).toContain("fetch timeout")
    const legacy = auditSolutionDelivery([ch({ node_id: "f", title: "安全设计", gen_status: "failed" })])
    expect(legacy.hits.find((h) => h.rule === "failed_chapter")?.quote).toContain("旧记录未留存原因")
  })

  it("偏短章只算提示级，不抬成硬伤", () => {
    const r = auditSolutionDelivery([ch({ node_id: "u", title: "培训方案", content: CLEAN_A, underlength: true })])
    const hit = r.hits.find((h) => h.rule === "underlength_chapter")
    expect(hit?.level).toBe("info")
    expect(r.warnCount).toBe(0)
    expect(r.infoCount).toBe(1)
  })
})

describe("合法占位与元话语", () => {
  it("【待填写】/【请补充素材】算交付硬伤，每章最多 2 条", () => {
    const content = `接口清单见附表：【待填写】。\n责任人安排：【请补充素材】。\n预算金额：【待填写】。`
    const r = auditSolutionDelivery([ch({ node_id: "p", title: "数据接口", content })])
    const ph = r.hits.filter((h) => h.rule === "placeholder_leftover")
    expect(ph).toHaveLength(2)
    expect(ph[0].chapter).toBe("数据接口")
    expect(ph[0].nodeId).toBe("p")
    expect(ph[0].quote).toContain("待填写")
  })

  it("合法占位剥离后不被装饰规则重复报（避免一处问题两种口径）", () => {
    const r = auditSolutionDelivery([ch({ node_id: "p", title: "数据接口", content: "接口清单：【待填写】。" })])
    expect(rules(r.hits)).toContain("placeholder_leftover")
    expect(rules(r.hits)).not.toContain("decoration_leftover")
  })

  it("占位镜像约定与标书侧一致（LEGAL_PLACEHOLDER_RE 变更须同步）", () => {
    const src = readFileSync(new URL("../BidWorkspace/bidTypes.ts", import.meta.url), "utf-8")
    expect(src).toContain("const LEGAL_PLACEHOLDER_RE = /【待填写】|【请补充素材】/g")
  })

  it("元话语残留与绝对化承诺按标书侧同一规则报出", () => {
    const content = "该模块的上线时间待确认。\n我们保证通过等保三级测评。"
    const r = auditSolutionDelivery([ch({ node_id: "m", title: "安全合规", content })])
    const meta = r.hits.filter((h) => h.rule === "meta_leftover")
    expect(meta.length).toBeGreaterThanOrEqual(2)
    expect(meta.every((h) => h.nodeId === "m")).toBe(true)
  })

  it("无标题章节按序号兜底命名，与标书侧同口径", () => {
    const r = auditSolutionDelivery([ch({ node_id: "n", title: "", content: "接口清单：【待填写】。" })])
    expect(r.hits[0].chapter).toBe("第1章")
  })
})

describe("跨章指标口径与本地禁则", () => {
  it("跨章同指标多值 → metric_conflict，全文级命中不给假跳转", () => {
    const r = auditSolutionDelivery([
      ch({ node_id: "a", title: "总体设计", content: "平台可用率 99.9%，支持全天候运行。" }),
      ch({ node_id: "b", title: "运维保障", content: "平台可用率 99.5%，按年度体检维护。" }),
    ])
    const hit = r.hits.find((h) => h.rule === "metric_conflict")
    expect(hit?.chapter).toBe("（全文）")
    expect(hit?.nodeId).toBe("")
    expect(hit?.quote).toContain("99.9")
    expect(hit?.quote).toContain("99.5")
    expect(hit?.label).toBe(SOL_CHECK_LABEL.metric_conflict)
  })

  it("超链接与水印词命中", () => {
    const r = auditSolutionDelivery([
      ch({ node_id: "a", title: "产品说明", content: "详见 https://his.example.com/doc 官方文档。\n本稿为草稿，仅供内部评审。" }),
    ])
    expect(rules(r.hits)).toEqual(expect.arrayContaining(["no_hyperlink", "no_watermark"]))
  })

  it("连续空行命中", () => {
    const r = auditSolutionDelivery([ch({ node_id: "a", title: "建设目标", content: "第一段。\n\n\n\n第二段。" })])
    expect(rules(r.hits)).toContain("no_empty_line_consecutive")
  })

  it("短正文不报半角标点密度（误报防护）", () => {
    const r = auditSolutionDelivery([ch({ node_id: "a", title: "建设目标", content: "目标明确,范围清晰,节奏可控。" })])
    expect(rules(r.hits)).not.toContain("no_half_width_punct")
  })

  it("暗标专属禁则不纳入方案体检（彩色/加粗/下划线/空白页/身份泄露）", () => {
    for (const k of ["no_color_content", "no_bold", "no_underline", "no_blank_page", "identity_leak"]) {
      expect(SOL_DELIVERY_ITEMS).not.toContain(k)
    }
    expect(SOL_DELIVERY_ITEMS.length).toBe(6)
  })

  it("装饰符号残留走标书侧同一规则，不自建第二套", () => {
    const r = auditSolutionDelivery([ch({ node_id: "a", title: "亮点", content: "■ 一体化设计，全流程闭环。" })])
    const hit = r.hits.find((h) => h.rule === "decoration_leftover")
    expect(hit?.quote).toContain("一体化设计")
  })

  // 2026-10-14 交付物治理：★/▲ 是招标实质性条款标记（废标判据），标书侧已从装饰符黑名单移出；
  // 方案侧复用同一规则 → 同样不得报残留（本条测试的本意就是两侧口径一致，正反两个方向都要锁）。
  it("★/▲ 实质性条款标记方案侧同样不报装饰残留", () => {
    const r = auditSolutionDelivery([ch({ node_id: "b", title: "亮点", content: "★ 一体化设计，▲ 全流程闭环。" })])
    expect(rules(r.hits)).not.toContain("decoration_leftover")
  })
})

describe("跨章重复段落（成本护栏内）", () => {
  const DUP_PARA =
    "平台建设须完成数据集成、业务协同、运维保障三项核心任务，并建立配套的管理制度与考核办法，确保各系统之间数据贯通、流程闭环、责任到人。"

  /** 线性同余生成的无重复中文段落：与任何其它段落几乎不共享三元组，避免查重干扰断言 */
  function noise(seed: number, len: number): string {
    let s = seed
    const out: string[] = []
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) % 2147483648
      out.push(String.fromCharCode(0x4e00 + (s % 2000)))
    }
    return out.join("")
  }

  /** salt 保证两章的同序号噪声段落互不相同，唯一的重合点只有 DUP_PARA */
  function body(dupAt: number, salt: number): string {
    const parts: string[] = []
    for (let i = 1; i <= 20; i++) parts.push(i === dupAt ? DUP_PARA : noise(i * 7919 + salt, 60))
    return parts.join("\n")
  }

  it("前段预算内出现相同段落 → intra_dup 报出，章名标注两个章", () => {
    const r = auditSolutionDelivery([
      ch({ node_id: "a", title: "建设内容", content: body(2, 1) }),
      ch({ node_id: "b", title: "实施方案", content: body(2, 99991) }),
    ])
    const hits = r.hits.filter((h) => h.rule === "intra_dup")
    expect(hits).toHaveLength(1)
    expect(hits[0].chapter).toBe("建设内容 ↔ 实施方案")
    expect(hits[0].nodeId).toBe("a")
    expect(hits[0].quote).toContain("相似度")
  })

  it("重复段落落在每章前 12 段之外时不比对（主线程成本护栏，宁漏不卡）", () => {
    const r = auditSolutionDelivery([
      ch({ node_id: "a", title: "建设内容", content: body(15, 1) }),
      ch({ node_id: "b", title: "实施方案", content: body(15, 99991) }),
    ])
    expect(rules(r.hits)).not.toContain("intra_dup")
  })
})

describe("分组、截断与整改清单", () => {
  it("命中按规则聚合，warn 组排在 info 组之前", () => {
    const r = auditSolutionDelivery([
      ch({ node_id: "a", title: "培训方案", content: "接口清单：【待填写】。", underlength: true }),
    ])
    const firstInfo = r.groups.findIndex((g) => g.level === "info")
    const lastWarn = r.groups.map((g) => g.level).lastIndexOf("warn")
    expect(r.groups.every((g) => g.count > 0)).toBe(true)
    expect(firstInfo).toBeGreaterThan(lastWarn)
  })

  it("命中过多时截断并置 truncated，卡片不至于刷屏", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      ch({ node_id: `c${i}`, title: `第${i}篇`, content: `责任人：【待填写】。\n预算：【待填写】。` }),
    )
    const r = auditSolutionDelivery(many)
    expect(r.total).toBe(60)
    expect(r.hits).toHaveLength(60)
    expect(r.truncated).toBe(true)
  })

  it("整改清单按规则分组输出，复制即可当整改要求用", () => {
    const r = auditSolutionDelivery([ch({ node_id: "a", title: "数据接口", content: "接口清单：【待填写】。" })])
    const text = buildDeliveryFixText(r)
    expect(text).toContain(SOL_CHECK_LABEL.placeholder_leftover)
    expect(text).toContain("数据接口")
    expect(buildDeliveryFixText(auditSolutionDelivery([ch({ node_id: "a", content: CLEAN_A })]))).toContain("未发现")
  })

  it("规则清单长度即卡片文案里的核验项数，防口径漂移", () => {
    expect(SOL_CHECK_RULES).toHaveLength(13)
    expect(SOL_CHECK_RULES.every((r) => !!SOL_CHECK_LABEL[r])).toBe(true)
  })
})

describe("接线与无障碍哨兵", () => {
  const ws = readFileSync(new URL("../../components/solution-studio/EditorWorkspace.tsx", import.meta.url), "utf-8")
  const card = readFileSync(
    new URL("../../components/solution-studio/SolutionDeliveryCheckCard.tsx", import.meta.url),
    "utf-8",
  )

  it("编辑器工作区已挂上体检卡，且复用既有 chapters / selectChapter（零 hook 改动）", () => {
    expect(ws).toContain("<SolutionDeliveryCheckCard")
    expect(ws).toContain("chapters={sol.chapters}")
    expect(ws).toContain("onSelectChapter={p.selectChapter}")
  })

  it("R282：卡片已挂失败归因聚合视图（同因归一组 + 复制失败归因），仍只报不拦", () => {
    expect(card).toContain("生成失败归因")
    expect(card).toContain("summarizeGenFailures")
    expect(card).toContain("复制失败归因")
    expect(card).toContain("buildGenFailureText")
  })

  it("卡片保持只报不拦口径，并具备展开无障碍属性", () => {
    expect(card).toContain("只报不拦")
    expect(card).toContain("aria-expanded={expanded}")
    expect(card).toContain("type=\"button\"")
    expect(card).not.toContain("disabled")
  })

  it("零正文但已有命中时不承诺「成稿后生效」（实机走查发现的文案自相矛盾）", () => {
    expect(card).toContain("正文尚未生成（0 章），体检项在成稿后自动生效")
    expect(card).toContain("处要先处理（生成失败 / 标完成却空章 / 占位未填）")
    expect(card).toContain("补齐正文后其余核验项自动生效")
  })
})
