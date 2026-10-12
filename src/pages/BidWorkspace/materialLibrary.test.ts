import { describe, expect, it } from "vitest"
import { buildBidChapterMessages } from "./prompts/bidChapter"
import { buildBidSectionMessages } from "./prompts/bidSection"
import {
  BASELINE_PREFIX_MARK,
  COMPANY_DEFAULTS,
  MATERIAL_KINDS,
  autoClassifyLibrary,
  baselineLabelFromText,
  baselineMarkForKind,
  composeRefMaterials,
  extractBaselineSegment,
  extractFragmentSegment,
  isCompanyDefaultBody,
  libraryBaselineFor,
  libraryFilledKinds,
  libraryKindFor,
  parseMaterialLibrary,
  renderMaterialLibrary,
  splitRefMaterials,
  upsertLibraryKind,
} from "./materialLibrary"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"

const emptyLib = { design: "", background: "", implementation: "", training: "", testing: "", other: "" }

describe("parseMaterialLibrary / renderMaterialLibrary 双向可逆", () => {
  it("空文本 -> 全空结构", () => {
    const lib = parseMaterialLibrary("")
    expect(lib).toEqual(emptyLib)
  })

  it("标记段按类别解析，未标记首段归 other", () => {
    const text = ["自由资料段落B", "", "【素材库·设计方案】", "架构写法A"].join("\n")
    const lib = parseMaterialLibrary(text)
    expect(lib.design).toContain("架构写法A")
    expect(lib.other).toContain("自由资料段落B")
    expect(lib.training).toBe("")
  })

  it("未知类别标记段不误丢，归 other", () => {
    const lib = parseMaterialLibrary("【素材库·不存在的类】\n内容X")
    expect(lib.other).toContain("内容X")
    expect(libraryFilledKinds(lib)).toHaveLength(0)
  })

  it("render 后再 parse 得到同样的各类内容（round-trip）", () => {
    const lib = { ...emptyLib, design: "D内容", testing: "T内容", other: "自由O" }
    const back = parseMaterialLibrary(renderMaterialLibrary(lib))
    expect(back.design).toBe("D内容")
    expect(back.testing).toBe("T内容")
    expect(back.other).toBe("自由O")
  })

  it("无分类内容时 render 输出即 other 原文（兼容 17D 纯自由资料）", () => {
    const lib = { ...emptyLib, other: "纯团队资料没有任何标记" }
    expect(renderMaterialLibrary(lib)).toBe("纯团队资料没有任何标记")
    expect(renderMaterialLibrary(lib)).not.toContain("【素材库·")
  })

  it("upsertLibraryKind 替换单类且保留其他类与 other", () => {
    const start = renderMaterialLibrary({ ...emptyLib, design: "旧设计", other: "保留我" })
    const next = upsertLibraryKind(start, "design", "新设计")
    const lib = parseMaterialLibrary(next)
    expect(lib.design).toBe("新设计")
    expect(lib.other).toBe("保留我")
  })
})

describe("libraryKindFor 章节标题归类（零 AI 关键词命中）", () => {
  it("命中设计/实施/培训/测试各类", () => {
    expect(libraryKindFor("系统与技术架构设计")).toBe("design")
    expect(libraryKindFor("项目实施进度与风险管控")).toBe("implementation")
    expect(libraryKindFor("培训方案与课时安排")).toBe("training")
    expect(libraryKindFor("测试与验收方案")).toBe("testing")
  })
  it("命中项目背景分析类", () => {
    expect(libraryKindFor("医院现状与需求深度分析")).toBe("background")
  })
  it("未命中返回 null（调用方静默降级）", () => {
    expect(libraryKindFor("投标函")).toBeNull()
    expect(libraryKindFor("")).toBeNull()
  })
  it("多命中按 MATERIAL_KINDS 顺序取先（design 在 implementation 前）", () => {
    expect(libraryKindFor("总体设计与实施保障")).toBe("design")
  })
})

describe("libraryBaselineFor 基线取用（素材库未启用即空）", () => {
  it("无标记段 -> 未启用 -> 空串（行为同 17D）", () => {
    expect(libraryBaselineFor("普通自由资料没有标记", "design")).toBe("")
  })
  it("有该类内容才返回基线，且带标记头渲染可被 compose 识别", () => {
    const text = renderMaterialLibrary({ ...emptyLib, design: "架构基线正文" })
    const baseline = libraryBaselineFor(text, "design")
    expect(baseline).toContain("架构基线正文")
    const composed = composeRefMaterials(baselineMarkForKind("design"), baseline, "检索片段")
    expect(composed.startsWith(BASELINE_PREFIX_MARK)).toBe(true)
  })
  it("超长截断到上限并以…结尾", () => {
    const long = "字".repeat(2000)
    const text = renderMaterialLibrary({ ...emptyLib, training: long })
    const b = libraryBaselineFor(text, "training")
    expect(b.length).toBeLessThanOrEqual(1501)
    expect(b.endsWith("…")).toBe(true)
  })
})

describe("composeRefMaterials / splitRefMaterials 往返（基线与检索段可逆拆分）", () => {
  it("无基线时 compose 即 fragments，split 基线空、检索段=原文", () => {
    const only = composeRefMaterials("", "", "纯检索段")
    expect(only).toBe("纯检索段")
    expect(splitRefMaterials(only)).toEqual(["", "纯检索段"])
    expect(extractFragmentSegment(only)).toBe("纯检索段")
  })
  it("有基线有检索段：拆回两段，标记类别名可读回", () => {
    const composed = composeRefMaterials(baselineMarkForKind("testing"), "测试基线\n第二行", "检索片段一\n\n检索片段二")
    const [baseline, fragments] = splitRefMaterials(composed)
    expect(baseline).toBe("测试基线\n第二行")
    expect(fragments).toBe("检索片段一\n\n检索片段二")
    expect(baselineLabelFromText(composed)).toBe("测试方案")
  })
  it("有基线无检索段：fragments 为空", () => {
    const composed = composeRefMaterials(baselineMarkForKind("design"), "设计基线", "")
    expect(extractBaselineSegment(composed)).toBe("设计基线")
    expect(extractFragmentSegment(composed)).toBe("")
  })
})

describe("autoClassifyLibrary 自由资料一键归类", () => {
  it("按块首行命中词分到五类，未命中块留在 other", () => {
    const lib = {
      ...emptyLib,
      other: "培训方案与讲师安排\n课时表若干\n\n投标函与保证金\n无关段落",
    }
    const next = autoClassifyLibrary(lib)
    expect(next.training).toContain("课时表若干")
    expect(next.other).toContain("投标函与保证金")
    expect(next.design).toBe("")
  })
  it("幂等：再跑一次不新增命中", () => {
    const once = autoClassifyLibrary({ ...emptyLib, other: "系统架构设计说明\n微服务拆分" })
    const twice = autoClassifyLibrary(once)
    expect(twice.design).toBe(once.design)
    expect(twice.other).toBe(once.other)
  })
})

describe("isCompanyDefaultBody 定制判定", () => {
  it("与 COMPANY_DEFAULTS 去空白全等 -> true", () => {
    expect(isCompanyDefaultBody("design", COMPANY_DEFAULTS.design)).toBe(true)
    expect(isCompanyDefaultBody("design", "  " + COMPANY_DEFAULTS.design + " \n ")).toBe(true)
  })
  it("被编辑过 -> false；空 -> false", () => {
    expect(isCompanyDefaultBody("design", COMPANY_DEFAULTS.design + "本院补充")).toBe(false)
    expect(isCompanyDefaultBody("design", "")).toBe(false)
  })
  it("五类默认件均含占位提示，非空", () => {
    for (const m of MATERIAL_KINDS) {
      expect(COMPANY_DEFAULTS[m.kind]).toContain("〔按本项目填写")
    }
  })
})

// ---- builder 运行时：非回流哨兵 + 定向调整口径注入 ----
const chapters = [{ node_id: "n1", title: "系统架构设计", sections: ["总体架构"], content: "", gen_status: "pending" }] as Chapter[]
const baseOpts = { wordBudget: 800, figures: false }

function chapterText(refMaterials: string): string {
  const msgs = buildBidChapterMessages("项目", "医院", null, [], chapters, 0, () => "", {
    ...baseOpts,
    refMaterials,
  } as never)
  return msgs.map((m) => m.content).join("\n")
}

describe("buildBidChapterMessages 素材库基线注入（B类 R167 v3）", () => {
  it("PROMPT_VERSION 已升到 4（2026-10 易标对齐：素材融入不提及来源）", async () => {
    const mod = await import("./prompts/bidChapter")
    expect(mod.PROMPT_VERSION).toBe(4)
  })
  it("普通资料（无标记）-> 只出【团队写作资料】，不出现【公司优质素材库】（非回流）", () => {
    const t = chapterText("自有人员与案例资料一段")
    expect(t).toContain("【团队写作资料")
    expect(t).toContain("自有人员与案例资料一段")
    expect(t).not.toContain("【公司优质素材库")
  })
  it("带基线标记 -> 拆出【公司优质素材库·设计方案标准件】独立槽，且要求按招标定向调整、禁止照抄沿用占位", () => {
    const composed = composeRefMaterials(baselineMarkForKind("design"), "总体架构五层写法基线", "自有案例检索段")
    const t = chapterText(composed)
    expect(t).toContain("【公司优质素材库·设计方案标准件")
    expect(t).toContain("总体架构五层写法基线")
    expect(t).toContain("结构与写法要求为基线")
    expect(t).toContain("禁止整段照抄")
    expect(t).toContain("〔按本项目填写〕")
    // 基线之外的自由资料仍进【团队写作资料】且不重复基线正文
    expect(t).toContain("【团队写作资料")
    expect(t).toContain("自有案例检索段")
  })
})

describe("buildBidSectionMessages 小节级同口径注入", () => {
  it("小节 PROMPT_VERSION 升到 5，带标记时出现标准件槽", async () => {
    const mod = await import("./prompts/bidSection")
    expect(mod.PROMPT_VERSION).toBe(5)
    const composed = composeRefMaterials(baselineMarkForKind("testing"), "用例追溯矩阵基线", "")
    const msgs = buildBidSectionMessages("项目", "医院", null, [], chapters, 0, () => "", {
      ...baseOpts,
      sectionName: "测试用例设计",
      sectionNo: "1.1",
      sectionIndex: 0,
      sectionCount: 1,
      refMaterials: composed,
    } as never)
    const t = msgs.map((m) => m.content).join("\n")
    expect(t).toContain("【公司优质素材库·测试方案标准件")
    expect(t).toContain("用例追溯矩阵基线")
  })
  it("无标记时小节提示词不出现标准件槽（与现状逐字一致）", () => {
    const msgs = buildBidSectionMessages("项目", "医院", null, [], chapters, 0, () => "", {
      ...baseOpts,
      sectionName: "测试用例设计",
      sectionNo: "1.1",
      sectionIndex: 0,
      sectionCount: 1,
      refMaterials: "普通自由资料",
    } as never)
    const t = msgs.map((m) => m.content).join("\n")
    expect(t).not.toContain("【公司优质素材库")
    expect(t).toContain("普通自由资料")
  })
})
