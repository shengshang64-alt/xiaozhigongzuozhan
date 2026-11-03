// Author: loop-R190
// ---------------------------------------------------------------------------
// R190（r169 切片三·探测层）：用户上传公司模板后，「这份模板到底能不能复用母版/版式」
// 原本只有导出那一刻看 toast 才知道。本模块把它提前成事前可见：纯函数产出
// 样张目录（模板里哪些页能当标题/正文样式）、失败归因与结论/建议文案。
// 口径与导出通道严格同源：能力探测走 templateFidelity.pickFidelitySamples 与
// inspectFidelityTemplateDetailed，逐页合格性走 deckFidelityPlan.isFidelityEligibleSlide，
// 归因先后顺序与 deckExports 的分流一致（先整册判定，再模板守卫）。
// 诚实边界：引擎真正写文本时仍可能拒绝某一样张（占位符结构异常等运行期情形），
// 本探测不预测该情形，由导出侧回退现通道并提示回看体检结果。
// 纯模块：零 UI、零 AI、零 collection、零 pb_hooks，node 下单测。
// ---------------------------------------------------------------------------

import { decodeTemplateBytes, type StoredDeckTemplate } from "./deckTheme"
import { isFidelityEligibleSlide } from "./deckFidelityPlan"
import { inspectFidelityTemplateDetailed, pickFidelitySamples, type FidelityTemplateSlide } from "./templateFidelity"
import type { Slide } from "./pptQuoteTypes"

/** 体检结论：可保真 / 本次只套用主题 / 模板读不出来 */
export type FidelityVerdict = "fidelity" | "theme" | "unreadable"

/** 模板单页的展示行（页号取模板部件序号，与模板内的页序一致） */
export type FidelitySampleRow = {
  page: number
  usable: boolean
  /** 能力标签（中文），如「标题框」「正文框」 */
  caps: string[]
  /** 不可用时的中文归因；可用且未被选中时为空串 */
  note: string
  /** 本页被选作哪种样式页 */
  role: "title" | "body" | "both" | null
}

/** 只依赖模板本身的探测事实（与当前 PPT 内容无关，模板换了才重算） */
export type TemplateFacts = {
  /** 模板原件是否已存到本地（未存则谈不上复用版式） */
  stored: boolean
  readable: boolean
  /** 不可读/不可用归因（已译成中文；可读且可用时为空串） */
  failure: string
  rows: FidelitySampleRow[]
  titlePage: number | null
  bodyPage: number | null
  templatePages: number
  hasNotesMaster: boolean
}

/** 模板事实 + 当前册页面特征合成后的最终结论 */
export type FidelityProbe = {
  verdict: FidelityVerdict
  /** 一句话结论（用户可见） */
  headline: string
  /** 归因明细（用户可见，逐条） */
  reasons: string[]
  /** 下一步建议（用户可见；结论已满足时为 null） */
  advice: string | null
  rows: FidelitySampleRow[]
  titlePage: number | null
  bodyPage: number | null
  templatePages: number
  /** 当前册里能复用模板版式的页数 */
  plainPages: number
  /** 当前册里迫使整册走内置版式的页号（1 基） */
  blockedPages: number[]
}

/** 引擎内部归因 → 用户可读文案（不暴露部件名与英文错误串） */
const FAILURE_CN: Record<string, string> = {
  "template is not a valid zip package": "文件不是可解析的 PPT 模板包",
  "template is not a valid pptx package": "文件缺少 PPT 模板的核心结构",
  "no slides in template": "模板里没有任何页面",
  "template unreadable": "模板内部结构无法识别",
}

const REJECT_CN: Record<string, string> = {
  "missing rels": "页面缺少配套配置，无法复用",
  "no layout relation": "页面没有绑定版式，无法复用",
  "forbidden relation part": "页面含图表、备注等专属内容，无法复用",
}

export function rejectReasonCn(reject?: string): string {
  if (!reject) return ""
  return REJECT_CN[reject] ?? "页面结构无法复用"
}

function capsOf(s: FidelityTemplateSlide): string[] {
  const caps: string[] = []
  if (s.titlePh) caps.push("标题框")
  if (s.bodyPh) caps.push("正文框")
  if (!s.titlePh && !s.bodyPh && s.textShapes > 0) caps.push(`文本框 ${s.textShapes} 处`)
  return caps
}

/** 样张目录：标出选中的标题/正文样式页，其余页给出中文归因 */
export function describeFidelityRows(
  slides: FidelityTemplateSlide[],
  picked: { title: number | null; body: number | null },
): FidelitySampleRow[] {
  return slides.map((s) => {
    const isTitle = picked.title !== null && picked.title === s.idx
    const isBody = picked.body !== null && picked.body === s.idx
    const role: FidelitySampleRow["role"] = isTitle && isBody ? "both" : isTitle ? "title" : isBody ? "body" : null
    let note = ""
    if (!s.usable) note = rejectReasonCn(s.reject)
    else if (!role && !capsOf(s).length) note = "没有可填写文字的框"
    return { page: s.idx, usable: s.usable, caps: capsOf(s), note, role }
  })
}

/** 模板侧探测：解包一次，产出样张目录与模板侧守卫结论 */
export function probeTemplateFacts(t: StoredDeckTemplate | null | undefined): TemplateFacts {
  const blank: TemplateFacts = {
    stored: false,
    readable: false,
    failure: "",
    rows: [],
    titlePage: null,
    bodyPage: null,
    templatePages: 0,
    hasNotesMaster: false,
  }
  if (!t) return blank
  const bytes = decodeTemplateBytes(t)
  if (!bytes) return { ...blank, failure: "模板原件未保存到本地，只留下了配色与字体" }
  const insp = inspectFidelityTemplateDetailed(bytes)
  if (insp.failure) {
    return { ...blank, stored: true, failure: FAILURE_CN[insp.failure] ?? "模板内部结构无法识别" }
  }
  const picked = pickFidelitySamples(insp.slides)
  return {
    stored: true,
    readable: true,
    failure: "",
    rows: describeFidelityRows(insp.slides, picked),
    titlePage: picked.title,
    bodyPage: picked.body,
    templatePages: insp.slides.length,
    hasNotesMaster: insp.hasNotesMaster,
  }
}

const THEME_SUFFIX = "导出仍会套用模板的配色与字体"

/** 合成最终结论：先整册判定，再模板守卫（与导出分流先后一致） */
export function finalizeFidelityProbe(facts: TemplateFacts, slides: Slide[]): FidelityProbe {
  const blockedPages: number[] = []
  slides.forEach((s, i) => {
    if (!isFidelityEligibleSlide(s)) blockedPages.push(i + 1)
  })
  const plainPages = slides.length - blockedPages.length
  const base = {
    rows: facts.rows,
    titlePage: facts.titlePage,
    bodyPage: facts.bodyPage,
    templatePages: facts.templatePages,
    plainPages,
    blockedPages,
  }
  if (!facts.stored) {
    return {
      ...base,
      verdict: "theme",
      headline: "模板原件没有存到本地，本次只套用配色与字体",
      reasons: [facts.failure || "模板原件未保存到本地"],
      advice: "换一份更精简的模板（删掉无关页面与嵌入图片）后重新上传，即可启用母版/版式保真",
    }
  }
  if (!facts.readable) {
    return {
      ...base,
      verdict: "unreadable",
      headline: `这份模板读不出内部版式，${THEME_SUFFIX}`,
      reasons: [facts.failure],
      advice: "在 Office 或 WPS 里把模板另存为标准 .pptx 文件后重新上传",
    }
  }
  if (!slides.length) {
    return {
      ...base,
      verdict: "theme",
      headline: "这本 PPT 还没有页面，暂时判断不了能否套用模板版式",
      reasons: ["当前没有可导出的页面"],
      advice: "先生成或添加页面，再回来看这份模板的保真结果",
    }
  }
  if (blockedPages.length) {
    const list = blockedPages.join("、")
    return {
      ...base,
      verdict: "theme",
      headline: `第 ${list} 页含图表、指标卡或配图，整册按内置版式导出（${THEME_SUFFIX}）`,
      reasons: [`第 ${list} 页：模板版式只有文字占位，这类页面无法承载`],
      advice: `把这些页改成纯文字要点后导出，整册即可复用模板版式；否则维持内置版式`,
    }
  }
  const notesPages = slides.filter((s) => (s.notes ?? "").trim() !== "").length
  if (notesPages && !facts.hasNotesMaster) {
    return {
      ...base,
      verdict: "theme",
      headline: `模板里没有备注页版式，为防讲稿丢失整册按内置版式导出（${THEME_SUFFIX}）`,
      reasons: [`本册 ${notesPages} 页写了讲稿，而模板缺少备注页版式`],
      advice: "在模板里保留备注页版式后重新上传；或先清空讲稿，即可启用母版/版式保真",
    }
  }
  if (facts.titlePage === null) {
    return {
      ...base,
      verdict: "theme",
      headline: `模板里找不到能填标题的页面，整册按内置版式导出（${THEME_SUFFIX}）`,
      reasons: ["模板内没有任何页面带标题框或可填写文字的文本框"],
      advice: "在模板里保留至少一页带标题框的版式，另存为标准 .pptx 后重新上传",
    }
  }
  if (facts.bodyPage === null) {
    return {
      ...base,
      verdict: "theme",
      headline: `模板里找不到能填正文要点的页面，整册按内置版式导出（${THEME_SUFFIX}）`,
      reasons: ["导出需要封面与目录的文字位置，模板内没有可承载两行文字的页面"],
      advice: "在模板里保留至少一页同时带标题框与正文框的版式，另存为标准 .pptx 后重新上传",
    }
  }
  return {
    ...base,
    verdict: "fidelity",
    headline: `整册 ${slides.length} 页都能复用模板版式，导出按公司模板的母版与版式呈现`,
    reasons: [],
    advice: null,
  }
}
