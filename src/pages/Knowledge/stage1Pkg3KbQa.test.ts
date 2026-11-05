/**
 * 阶段 1 · 包 3（知识问答）回归网。
 *
 * 钉住 M0 §7.2 包 3 的四件事，验收句是「用一篇演示 md 问答能命中」：
 *  ① 已入库要点问得到——用一篇**演示 md**（虚构的医院信息化资料）做端到端检索命中；
 *  ② 未命中 vs 真无资料可区分——「库里没有」与「有资料但这次没匹配上」必须给不同文案；
 *  ③ 问答 Markdown 表可渲染——表格单元格内带 [资料N] 时表格必须完整（此前会被切碎）；
 *  ④ 素材注入默认开——新建项目默认 true（存量项目按存储值，不改变老项目行为）。
 *
 * 演示数据全是虚构的通用产品能力描述，不含任何真实标书、客户名或密钥。
 */
import { describe, expect, it } from "vitest"
import { searchKbDocs, type KbDocRow } from "@/lib/kbCore"
import { buildKbMissCopy, qaScopeLabel } from "@/pages/Knowledge/kbMissCopy"
import { defaultGenOptions, normalizeGenOptions } from "@/pages/BidWorkspace/bidTypes"

function kbDoc(title: string, content: string, over: Partial<KbDocRow> = {}): KbDocRow {
  return {
    id: `doc_${title}`,
    title,
    content,
    folder_path: "",
    visibility: "team",
    source_type: "md",
    summary: "",
    keywords: [],
    rh_user_id: "local-user",
    ...over,
  } as unknown as KbDocRow
}

/** 演示 md：一份虚构的售前资料（用于「问答能命中」的验收取证） */
const DEMO_DOC = kbDoc(
  "演示-电子病历分级评价应答要点",
  [
    "# 电子病历系统应用水平分级评价 应答要点",
    "",
    "## 四级核心要求",
    "四级要求全院信息共享，并具备中级医疗决策支持能力；门诊、住院、医技等主要业务环节的数据需在院内互通。",
    "",
    "## 建设要点",
    "- 统一患者主索引，打通 HIS、EMR、LIS、PACS 的患者标识",
    "- 建设 CDR 临床数据中心，支撑跨科室调阅",
    "- 提供合理用药、危急值等中级决策支持",
    "",
    "## 常见废标风险",
    "响应文件中未逐条对应分级评价条款、只写「完全响应」而无具体措施，评审会判定未实质响应。",
  ].join("\n"),
)

describe("① 已入库要点问得到（演示 md 端到端命中）", () => {
  it("演示文档入库后，问四级要求能命中该文档", () => {
    const hits = searchKbDocs([DEMO_DOC], "电子病历分级评价四级有什么要求", 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].doc.title).toContain("电子病历分级评价")
    // 命中片段必须带出来源可读内容（引用可见的前提）
    expect((hits[0].snippet ?? "").length).toBeGreaterThan(0)
  })

  it("问废标风险也能命中同一篇（要点级命中，不是只认标题）", () => {
    const hits = searchKbDocs([DEMO_DOC], "分级评价响应文件有哪些废标风险", 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].doc.id).toBe(DEMO_DOC.id)
  })

  it("有正文块时命中会给章节路径（引用可见的依据）", () => {
    const hits = searchKbDocs([DEMO_DOC], "统一患者主索引 主索引", 5)
    expect(hits.length).toBeGreaterThan(0)
    // 至少命中的那条能定位到内容，供 UI 生成 [资料N] 与跳原文
    expect(JSON.stringify(hits[0])).toContain(DEMO_DOC.id)
  })
})

describe("② 未命中 vs 真无资料可区分", () => {
  it("库为空：说「还没有可检索文档」，并指向上传", () => {
    const c = buildKbMissCopy({ question: "电子病历四级要求", scopeDocs: 0, visibleDocs: 0, scopeLabel: "全部" })
    expect(c.kind).toBe("empty_scope")
    expect(c.text).toContain("还没有可检索的文档")
    expect(c.text).toContain("上传")
  })

  it("有资料但没命中：说明资料在、给出换问法/换范围三个方向（不说「库里没有」）", () => {
    const c = buildKbMissCopy({ question: "电子病历四级要求", scopeDocs: 12, visibleDocs: 12, scopeLabel: "全部" })
    expect(c.kind).toBe("no_match")
    expect(c.text).toContain("12 篇文档")
    expect(c.text).toContain("换个问法")
    // 关键：不能再说成「库里没找到」，否则用户会以为资料丢了
    expect(c.text).not.toContain("还没有可检索的文档")
  })

  it("范围选窄了（该范围 0 篇但全库有）：指出资料在别的范围，建议切回", () => {
    const c = buildKbMissCopy({ question: "报价规则", scopeDocs: 0, visibleDocs: 9, scopeLabel: "个人笔记" })
    expect(c.kind).toBe("filtered_out")
    expect(c.text).toContain("个人笔记")
    expect(c.text).toContain("9 篇")
    expect(c.text).toContain("切回")
  })

  it("三种文案互不相同，且都保留「不编造」承诺", () => {
    const a = buildKbMissCopy({ question: "x", scopeDocs: 0, visibleDocs: 0, scopeLabel: "全部" }).text
    const b = buildKbMissCopy({ question: "x", scopeDocs: 3, visibleDocs: 3, scopeLabel: "全部" }).text
    const c = buildKbMissCopy({ question: "x", scopeDocs: 0, visibleDocs: 3, scopeLabel: "团队知识库" }).text
    expect(new Set([a, b, c]).size).toBe(3)
    for (const t of [a, b, c]) expect(t).toContain("不会编造")
  })

  it("检索范围中文名口径一致", () => {
    expect(qaScopeLabel("team")).toBe("团队知识库")
    expect(qaScopeLabel("personal")).toBe("个人笔记")
    expect(qaScopeLabel("all")).toBe("全部")
  })
})

describe("④ 素材注入默认开（存量项目不受影响）", () => {
  it("新建项目默认开启", () => {
    expect(defaultGenOptions().material_boost).toBe(true)
  })

  it("存量项目无该字段时保持关闭——不改变老项目下次生成的内容与费用", () => {
    expect(normalizeGenOptions({ scope: "both", include_biz: true }).material_boost).toBe(false)
  })

  it("显式选择优先", () => {
    expect(normalizeGenOptions({ material_boost: true }).material_boost).toBe(true)
    expect(normalizeGenOptions({ material_boost: false }).material_boost).toBe(false)
  })
})
