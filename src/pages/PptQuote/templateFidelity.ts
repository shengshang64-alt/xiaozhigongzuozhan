import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"

// ---------------------------------------------------------------------------
// R182（r169 三切片计划·切片一）：公司模板母版/版式级保真引擎。
// 蓝本＝R181 评估 PoC-2（.loop/reports/2026-10-06-r181-ppt-template-fidelity-eval.md）：
// 克隆模板『版式样张页』→ 改写占位文本 → 重打包，母版/版式/主题/媒体原样携带
// （byte-identical），使导出 PPT 真正复用模板的 slideMaster/slideLayout/占位位置。
// 纯函数零 UI 依赖，只用项目既有 fflate，node 下单测；不新增任何第三方引擎。
// v1 边界（诚实降级，返回 { ok:false } 由调用方回退 pptxgenjs 现通道）：
//  - 样张页含 notes/图表/嵌入 OLE 等跨页共享部件关系时跳过该样张；
//  - 正文行需要 body 占位（type=body|subTitle|obj）或第二个文字形状承载；
//  - 原模板样张页不进产物（产物只含生成页），notesSlides 对旧页的引用被清理。
// R189（切片二·引擎扩展）：spec.notes 讲稿备注写入 notesSlide（对模板既有 notesSlide 顺延编号、
// 挂回对应生成页）；备注非空但模板无 notesMaster 时返回 ok:false，由调用方回退现通道，保证讲稿不静默丢失。
// ---------------------------------------------------------------------------

export type FidelitySlideSpec = {
  /** 标题文本（必填） */
  title: string
  /** 正文行；为空/省略时该页使用标题样张页 */
  lines?: string[]
  /** R189：演讲者备注；逐行成段写入 notesSlide，备注非空要求模板含 notesMaster */
  notes?: string
  /**
   * 2026-10-07 用户需求「图文并茂×模板」：本页配图（base64，去 data: 前缀）。
   * 注入为右侧半栏图片（正文加右内边距避让），模板母版/版式原样保留。
   */
  image?: { base64: string; ext: string }
  /**
   * 2026-11-05：本页应使用的**版式文件名**（如 `slideLayout3.xml`）。
   * 缺省时按「有无正文行」退回标题/正文样张页（旧行为，逐字不变）。
   *
   * 为什么必须显式指定：保真引擎原本**只克隆一张样张页**，于是整册所有页共用同一个版式。
   * 实测公司官方模板 6 页导出后，6 页 layout 全是「封面」——封面/目录/章节/内页/封底
   * 的差异被完全抹平，用户看到的仍是"一个版式复制 6 遍"。
   * 现在按 kind→版式映射挑「该版式下的样张页」来克隆，母版版式才真正生效。
   */
  layoutFile?: string
}

export type FidelityTemplateSlide = {
  /** slide 部件序号（slideN.xml 的 N） */
  idx: number
  titlePh: boolean
  bodyPh: boolean
  /** 可承载正文的文字形状数（排除页脚/页码/日期占位与非文本形状） */
  textShapes: number
  /** 关系引用了不可复制的部件（notes/charts/embeddings 等）时不可用 */
  usable: boolean
  reject?: string
}

export type FidelityOutcome =
  | { ok: true; bytes: Uint8Array; titleSample: number; bodySample: number; slideCount: number; notesCount: number }
  | { ok: false; reason: string }

const SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/
const NOTES_MASTER_RE = /^ppt\/notesMasters\/notesMaster\d+\.xml$/
const NOTES_CT = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"
// 样张页关系黑名单：这些部件与某一页一一绑定或存在级联关系，克隆共享会坏
const FORBID_REL_RE = /Target="[^"]*(notesSlides|charts|diagrams|embeddings|oleObject)[^"]*"/

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function slideIdx(name: string): number {
  return Number(SLIDE_RE.exec(name)?.[1] ?? NaN)
}

function spBlocks(xml: string): string[] {
  return xml.match(/<p:sp>[\s\S]*?<\/p:p>/g) || xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []
}

const TITLE_PH_RE = /<p:ph\b[^>]*type="(ctrTitle|title)"/
const BODY_PH_RE = /<p:ph\b[^>]*type="(body|subTitle|obj)"/
const SKIP_PH_RE = /<p:ph\b[^>]*type="(sldNum|ftr|dt)"/
// ECMA-376：`<p:ph>` 的 type 属性缺省即 body。从版式克隆正文占位符时常常只写
// `<p:ph idx="1"/>`（python-pptx 与 PowerPoint 继承版式占位符都是这一形态），
// 只认显式 type 会把最常见的内容页误判成「没有正文框」，故补认裸 ph。
const BARE_PH_RE = /<p:ph\b(?![^>]*\btype=)[^>]*\/?>/

/** 是否带正文占位符：显式 body/subTitle/obj，或 type 缺省（规范默认 body） */
function hasBodyPlaceholder(xml: string): boolean {
  return BODY_PH_RE.test(xml) || BARE_PH_RE.test(xml)
}

function classifySlide(name: string, xml: string, rels: string | null): FidelityTemplateSlide {
  const blocks = spBlocks(xml)
  const textish = blocks.filter((b) => /<p:txBody>/.test(b) && !SKIP_PH_RE.test(b))
  let reject: string | undefined
  if (!rels) reject = "missing rels"
  else if (!/slideLayouts\/slideLayout\d+\.xml/.test(rels)) reject = "no layout relation"
  else if (FORBID_REL_RE.test(rels)) reject = "forbidden relation part"
  return {
    idx: slideIdx(name),
    titlePh: TITLE_PH_RE.test(xml),
    bodyPh: hasBodyPlaceholder(xml),
    textShapes: textish.length,
    usable: reject === undefined,
    reject,
  }
}

type Ctx = {
  entries: Record<string, Uint8Array>
  slides: FidelityTemplateSlide[]
  /** idx -> slide xml 文本 */
  xmls: Map<number, string>
  /** idx -> slide rels 文本（缺省空串） */
  relss: Map<number, string>
  /** 2026-11-05：idx -> 该样张页绑定的版式文件名（如 slideLayout3.xml），供按版式选样张 */
  layouts: Map<number, string>
  pres: string
  presRels: string
  ct: string
}

function readCtx(entries: Record<string, Uint8Array>): { ctx?: Ctx; reason?: string } {
  const presU = entries["ppt/presentation.xml"]
  const presRelU = entries["ppt/_rels/presentation.xml.rels"]
  const ctU = entries["[Content_Types].xml"]
  if (!presU || !presRelU || !ctU) return { reason: "template is not a valid pptx package" }
  const names = Object.keys(entries).filter((n) => SLIDE_RE.test(n)).sort((a, b) => slideIdx(a) - slideIdx(b))
  const slides: FidelityTemplateSlide[] = []
  const xmls = new Map<number, string>()
  const relss = new Map<number, string>()
  // 2026-11-05：记录每个样张页绑定的版式，供「按 kind 分配版式」时挑对样张页
  const layouts = new Map<number, string>()
  for (const n of names) {
    const xml = strFromU8(entries[n])
    const relName = `ppt/slides/_rels/slide${slideIdx(n)}.xml.rels`
    const rels = entries[relName] ? strFromU8(entries[relName]) : null
    const info = classifySlide(n, xml, rels)
    slides.push(info)
    xmls.set(info.idx, xml)
    if (rels !== null) {
      relss.set(info.idx, rels)
      const lay = /Target="[^"]*?(slideLayout\d+\.xml)"/.exec(rels)?.[1]
      if (lay) layouts.set(info.idx, lay)
    }
  }
  if (!slides.length) return { reason: "no slides in template" }
  return {
    ctx: {
      entries,
      slides,
      xmls,
      relss,
      layouts,
      pres: strFromU8(presU),
      presRels: strFromU8(presRelU),
      ct: strFromU8(ctU),
    },
  }
}

/**
 * 按角色挑样张页的真源口径（R190 抽出）：先认占位符类型，再退到「有可填文字的形状」。
 * 渲染与事前探测共用本函数，保证『体检说能保真』与『导出真走保真』选同一张样张页。
 */
export function pickFidelitySamples(slides: FidelityTemplateSlide[]): { title: number | null; body: number | null } {
  const usable = slides.filter((s) => s.usable)
  const title = usable.find((s) => s.titlePh)?.idx ?? usable.find((s) => s.textShapes >= 1)?.idx ?? null
  const body = usable.find((s) => s.bodyPh)?.idx ?? usable.find((s) => s.textShapes >= 2)?.idx ?? null
  return { title, body }
}

function pickSample(ctx: Ctx, role: "title" | "body"): FidelityTemplateSlide | null {
  const picked = pickFidelitySamples(ctx.slides)[role]
  if (picked === null) return null
  return ctx.slides.find((s) => s.idx === picked) ?? null
}

/**
 * 按指定版式挑一张可用样张页（2026-11-05）。
 *
 * 用途：让封面/目录/章节/内页/封底各自复用**自己那个版式**的样张页，
 * 而不是整册都克隆同一张。找不到该版式的样张页时返回 null，调用方回退到默认样张。
 */
function pickSampleByLayout(ctx: Ctx, layoutFile: string): FidelityTemplateSlide | null {
  const target = layoutFile.replace(/^.*?((?:slide)?layout\d+\.xml)$/, "$1")
  const cands = ctx.slides.filter((s) => s.usable && ctx.layouts.get(s.idx) === target)
  if (!cands.length) return null
  // 优先有标题占位符的（才能写入本页标题）
  return cands.find((s) => s.titlePh) ?? cands[0]
}

// ---------------------------- 文本注入 -------------------------------------

/**
 * 取出从第一个 `<tag ...>` 开始的**完整元素**文本（正确处理自闭合与同名嵌套）。
 *
 * 2026-11-05 修（真实模板暴露）：原来这里用
 *   `firstMatch(/<a:rPr\b[\s\S]*?(?:\/>|<\/a:rPr>)/, run)`
 * 这类**非贪婪 + `/>` 或收尾**的写法。当 rPr 内部嵌套自闭合子元素时（公司官方模板
 * zoe-light-internal 的 rPr 含 `<a:ln w="12700"><a:noFill/></a:ln>`），
 * 惰性匹配会先撞上 `<a:noFill/>` 的 `/>`，于是截到
 *   `<a:rPr ...><a:ln w="12700"><a:noFill/>`
 * ——`ln` 与 `rPr` 都没闭合。把它拼回新段落 → 产出的 slide1.xml 全部**标签不匹配**，
 * 用 python-pptx / PowerPoint 打开直接报 "Opening and ending tag mismatch: ln ... and r"。
 * 症状是「导出成功但文件打不开」，属于最坏的一类失败（静默产出坏文件）。
 *
 * 现改为扫描配对：同级自闭合立即返回、同名嵌套按深度计数，保证取出的是完整元素。
 */
function balancedElement(s: string, tag: string, from = 0): { text: string; end: number } | null {
  // 只匹配「开标签」与「闭标签」，属性值里含 > 的情况在 OOXML 中不会出现（会被转义）
  const re = new RegExp(`<${tag}\\b[^>]*?(?:/)?>|</${tag}>`, "g")
  re.lastIndex = from
  let depth = 0
  let start = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const tok = m[0]
    const isClose = tok.startsWith("</")
    const isSelfClose = !isClose && tok.endsWith("/>")
    if (isClose) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        return { text: s.slice(start, m.index + tok.length), end: m.index + tok.length }
      }
      if (depth < 0) return null
      continue
    }
    if (isSelfClose) {
      // 顶层自闭合即为完整元素；作为子元素时不改变深度
      if (depth === 0) return { text: tok, end: m.index + tok.length }
      continue
    }
    if (depth === 0) start = m.index
    depth += 1
  }
  return null
}

/** 从 txBody 里挖出可复用的样式骨架（bodyPr/lstStyle/首段 pPr/首 run rPr） */
function styleSkeleton(block: string): { txIndex: number; txLen: number; bodyPr: string; lstStyle: string; pPr: string; rPr: string } | null {
  const tx = /<p:txBody>[\s\S]*?<\/p:txBody>/.exec(block)
  if (!tx) return null
  const inner = tx[0].slice("<p:txBody>".length, -"</p:txBody>".length)
  // 这四者都可能是「带自闭合子元素的容器」（bodyPr 含 normAutofit、lstStyle 含 lvl1pPr、
  // pPr 含 spcBef/buFont、rPr 含 ln/fill），必须用配对扫描，不能用惰性正则（见 balancedElement 注释）。
  const bodyPr = balancedElement(inner, "a:bodyPr")?.text || '<a:bodyPr/>'
  const lstStyle = balancedElement(inner, "a:lstStyle")?.text ?? ""
  const firstPara = /<a:p\b[^>]*>[\s\S]*?<\/a:p>/.exec(inner)
  const pPr = firstPara ? (balancedElement(firstPara[0], "a:pPr")?.text ?? "") : ""
  const firstRun = firstPara ? /<a:r\b[^>]*>[\s\S]*?<\/a:r>/.exec(firstPara[0]) : null
  const rPr = firstRun ? (balancedElement(firstRun[0], "a:rPr")?.text ?? "") : ""
  return { txIndex: tx.index, txLen: tx[0].length, bodyPr, lstStyle, pPr, rPr }
}

/** 用给定文本行重建一个形状块的 txBody，保留 bodyPr/lstStyle 与首段 pPr/首 run rPr 样式模板 */
function rewriteShapeTxBody(block: string, texts: string[]): string | null {
  const sk = styleSkeleton(block)
  if (!sk) return null
  let paras = ""
  for (const t of texts) {
    paras += `<a:p>${sk.pPr}<a:r>${sk.rPr}<a:t>${xmlEscape(t)}</a:t></a:r></a:p>`
  }
  const newTx = `<p:txBody>${sk.bodyPr}${sk.lstStyle}${paras}</p:txBody>`
  return block.slice(0, sk.txIndex) + newTx + block.slice(sk.txIndex + sk.txLen)
}

/**
 * 清空一个形状块里的示例文字，但保留形状、样式与段落属性（2026-11-05）。
 *
 * 用于模板样例页：装饰卡片的形状要留着（版面结构靠它们），但卡片里的
 * 模板作者示例文案（「直播观看次数 7000W+」之类）必须抹掉，不能冒充本页内容。
 * 保留 bodyPr/lstStyle/pPr（含项目符号与间距），只是不再有 <a:r> 文字节点。
 */
function clearShapeText(block: string): string | null {
  const sk = styleSkeleton(block)
  if (!sk) return null
  const newTx = `<p:txBody>${sk.bodyPr}${sk.lstStyle}<a:p>${sk.pPr}</a:p></p:txBody>`
  return block.slice(0, sk.txIndex) + newTx + block.slice(sk.txIndex + sk.txLen)
}

/**
 * 在整页 XML 上按形状顺序做标题/正文注入。
 *
 * 2026-11-05 修（渲染实测暴露的严重缺陷）：
 * 原来只在「找得到 body 占位符或第二个文字形状」时替换正文，**其余文字形状原样保留**。
 * 而公司模板的「内页1」样张页没有 body 占位符（是一堆装饰卡片，16 个文字形状装的是
 * 模板作者的示例文案）——结果导出后正文区全是模板自带的「直播带货：新生代妈妈消费新风尚」
 * 「直播观看次数 7000W+」这类与医院毫无关系的内容，且多页完全相同，只有标题被换掉。
 * 这是"看起来套上了模板、实际交付了错误内容"，比不套模板更糟。
 *
 * 现在的口径：
 *   · 标题形状 = 标题占位符，其次第一个有文字的形状（不变）；
 *   · 正文形状 = body 占位符，其次除标题外第一个有文字的形状（不变）；
 *   · **其余所有「承载业务文案」的文字形状一律清空文字**（形状本身保留，装饰卡片/图标不受影响），
 *     避免模板示例文案冒充本页内容；
 *   · 页码/页脚/日期占位符（SKIP_PH_RE）不动。
 *
 * 返回 null 表示该样张无法承载指定文本（调用方回退）。
 */
function injectSlideText(xml: string, title: string, lines: string[]): string | null {
  const re = /<p:sp>[\s\S]*?<\/p:sp>/g
  const blocks: { start: number; end: number; text: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  }
  if (!blocks.length) return null
  const hasText = (b: string) => /<p:txBody>/.test(b) && !SKIP_PH_RE.test(b)
  let tIdx = blocks.findIndex((b) => TITLE_PH_RE.test(b.text))
  if (tIdx < 0) tIdx = blocks.findIndex((b) => hasText(b.text))

  // ---------------------------------------------------------------------
  // 2026-11-05 修（第二层，渲染实测暴露）：
  // 正文原来按「第一个有文字的非标题形状」挑，实测挑中了「矩形 5」——
  // 它是一块 **带 accent5 填充 + 整页宽** 的色块，而它上方还有一层全页渐变「矩形 44」，
  // 于是文字注入成功、却**被上层色块完全盖住**：渲染出来是"标题 + 空白大色板"。
  //
  // 现在按「可见性」挑正文承载形状，顺序：
  //   ① 真·正文占位符（type=body/subTitle/obj 或无 type 的裸 ph）
  //   ② 纯文本框（不带填充）：模板里的「文本框 N」就是这种，文字天然可见
  //   ③ 兜底：任意有文字的非标题形状
  // 「纯文本框」判定 = 形状有 txBody 且 spPr 里没有 solidFill/gradFill/pattFill/blipFill。
  // 带填充的大色块会被排除，避免"文字写进被盖住的色块"。
  // ---------------------------------------------------------------------
  const isFilledShape = (b: string) => /<p:spPr\b[\s\S]*?<\/p:spPr>/.test(b) && /<a:(solidFill|gradFill|pattFill|blipFill)\b/.test(/<p:spPr\b[\s\S]*?<\/p:spPr>/.exec(b)?.[0] ?? "")
  const isFramelessText = (b: string) => hasText(b) && !isFilledShape(b) && !/<p:ph\b[^>]*type="(sldNum|ftr|dt)"/.test(b)

  let bIdx = -1
  if (lines.length) {
    bIdx = blocks.findIndex((b, i) => i !== tIdx && hasBodyPlaceholder(b.text))
    if (bIdx < 0) bIdx = blocks.findIndex((b, i) => i !== tIdx && isFramelessText(b.text))
    if (bIdx < 0) bIdx = blocks.findIndex((b, i) => i !== tIdx && hasText(b.text))
    if (bIdx < 0) return null
  }
  if (tIdx < 0) return null
  const tRewrite = rewriteShapeTxBody(blocks[tIdx].text, [title])
  if (tRewrite === null) return null
  let bRewrite = ""
  if (bIdx >= 0) {
    const r = rewriteShapeTxBody(blocks[bIdx].text, lines)
    if (r === null) return null
    bRewrite = r
  }
  // 其余文字形状：清空文字（只留形状与样式），防模板示例文案冒充本页内容
  const cleared = new Map<number, string>()
  blocks.forEach((b, i) => {
    if (i === tIdx || i === bIdx) return
    if (!hasText(b.text)) return
    const empty = clearShapeText(b.text)
    if (empty !== null) cleared.set(i, empty)
  })
  let out = ""
  let last = 0
  for (let i = 0; i < blocks.length; i++) {
    out += xml.slice(last, blocks[i].start)
    out += i === tIdx ? tRewrite : i === bIdx ? bRewrite : (cleared.get(i) ?? blocks[i].text)
    last = blocks[i].end
  }
  out += xml.slice(last)
  return out
}

/** 标准 notesSlide 部件：body 占位 + 备注逐行成段，每行 XML 转义 */
function notesDoc(text: string): string {
  const paras = text
    .split(/\r?\n/)
    .map((line) => `<a:p><a:r><a:t>${xmlEscape(line)}</a:t></a:r></a:p>`)
    .join("")
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    "<p:cSld><p:spTree>" +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
    '<p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr/>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>` +
    "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"
  )
}

/** 备注页 rels：rId1 指向对应生成页、rId2 指向模板 notesMaster */
function notesRelsXml(slideNo: number, notesMasterPart: string): string {
  const masterName = notesMasterPart.split("/").pop() ?? "notesMaster1.xml"
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${REL_NS}/slide" Target="../slides/slide${slideNo}.xml"/>` +
    `<Relationship Id="rId2" Type="${REL_NS}/notesMaster" Target="../notesMasters/${masterName}"/>` +
    "</Relationships>"
  )
}

// ---------------------------- 重打包 ---------------------------------------

function repackage(
  ctx: Ctx,
  generated: { xml: string; rels: string; notes?: string }[],
  titleSample: number,
  bodySample: number,
  notesMasterPart: string | null,
  extras?: {
    media: Record<string, Uint8Array>
    ctDefaults: string
    /** 生成页序号 → 需注入 spTree 的 <p:pic> XML */
    slidePics: Record<number, string>
  },
): FidelityOutcome {
  const k = generated.length
  // 1) presentation rels：摘除旧 slide 关系，新增 K 条（rId 从现有最大值续排）；保留 <Relationships> 包裹标签
  const relTags = ctx.presRels.match(/<Relationship\b[^>]*\/>/g) || []
  let maxRid = 0
  for (const tag of relTags) {
    const idm = /\bId="rId(\d+)"/.exec(tag)
    if (idm) maxRid = Math.max(maxRid, Number(idm[1]))
  }
  const rids: number[] = []
  for (let i = 0; i < k; i++) rids.push(maxRid + 1 + i)
  let addRels = ""
  for (let i = 0; i < k; i++) {
    addRels += `<Relationship Id="rId${rids[i]}" Type="${REL_NS}/slide" Target="slides/slide${i + 1}.xml"/>`
  }
  // 只摘 slide 类型关系（/slide" 精确匹配，不误删 slideMaster/slideLayout），保留包裹标签
  let presRels = ctx.presRels.replace(/<Relationship\b[^>]*Type="[^"]*\/slide"[^>]*\/>/g, "")
  if (!presRels.includes("</Relationships>")) {
    return { ok: false, reason: "template presentation rels malformed" }
  }
  presRels = presRels.replace("</Relationships>", addRels + "</Relationships>")

  // 2) presentation.xml：整体重建 sldIdLst（兼容自闭空标签）
  const idList = rids.map((r, i) => `<p:sldId id="${256 + i}" r:id="rId${r}"/>`).join("")
  let pres = ctx.pres
  if (/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(pres)) {
    pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${idList}</p:sldIdLst>`)
  } else if (pres.includes("<p:sldIdLst/>")) {
    pres = pres.replace("<p:sldIdLst/>", `<p:sldIdLst>${idList}</p:sldIdLst>`)
  } else {
    return { ok: false, reason: "template presentation.xml missing sldIdLst" }
  }

  // 3) [Content_Types].xml：摘除旧 slide Override，加入 K 条
  let ct = ctx.ct.replace(/<Override PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "")
  let addCt = ""
  for (let i = 0; i < k; i++) {
    addCt += `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${SLIDE_CT}"/>`
  }
  if (!ct.includes("</Types>")) return { ok: false, reason: "template [Content_Types].xml malformed" }
  ct = ct.replace("</Types>", addCt + "</Types>")

  // 3.5) R189 讲稿备注：对模板既有 notesSlide 顺延编号避免覆盖孤部件，新增部件逐个补 Override
  let notesSeq = 0
  for (const name of Object.keys(ctx.entries)) {
    const nm = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(name)
    if (nm) notesSeq = Math.max(notesSeq, Number(nm[1]))
  }
  const notesParts: Record<string, string> = {}
  const notesRelParts: Record<string, string> = {}
  let addNotesCt = ""
  let notesCount = 0
  generated.forEach((g, i) => {
    const text = (g.notes ?? "").trim()
    if (!text) return
    notesSeq += 1
    notesCount += 1
    const part = `notesSlide${notesSeq}`
    notesParts[`ppt/notesSlides/${part}.xml`] = notesDoc(text)
    notesRelParts[`ppt/notesSlides/_rels/${part}.xml.rels`] = notesRelsXml(i + 1, notesMasterPart ?? "")
    addNotesCt += `<Override PartName="/ppt/notesSlides/${part}.xml" ContentType="${NOTES_CT}"/>`
  })
  if (addNotesCt) ct = ct.replace("</Types>", addNotesCt + "</Types>")
  // 2026-10-07 图文并茂：补媒体扩展名 Default（缺失时）
  if (extras?.ctDefaults) ct = ct.replace("</Types>", extras.ctDefaults + "</Types>")

  // 4) 复制其余部件；清理 notesSlides rels 中指向已删除旧页的关系
  const out: Record<string, Uint8Array> = {}
  out["[Content_Types].xml"] = strToU8(ct)
  for (const name of Object.keys(ctx.entries)) {
    if (name === "[Content_Types].xml" || name === "ppt/presentation.xml" || name === "ppt/_rels/presentation.xml.rels") continue
    if (SLIDE_RE.test(name) || name.startsWith("ppt/slides/_rels/")) continue
    if (name.startsWith("ppt/notesSlides/_rels/")) {
      const cleaned = strFromU8(ctx.entries[name]).replace(
        /<Relationship\b[^>]*Target="[^"]*slides\/slide\d+\.xml"[^>]*\/>/g,
        "",
      )
      out[name] = strToU8(cleaned)
      continue
    }
    out[name] = ctx.entries[name]
  }
  out["ppt/presentation.xml"] = strToU8(pres)
  out["ppt/_rels/presentation.xml.rels"] = strToU8(presRels)
  for (let i = 0; i < k; i++) {
    out[`ppt/slides/slide${i + 1}.xml`] = strToU8(generated[i].xml)
    out[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(generated[i].rels)
  }
  for (const name of Object.keys(notesParts)) out[name] = strToU8(notesParts[name])
  for (const name of Object.keys(notesRelParts)) out[name] = strToU8(notesRelParts[name])
  // 2026-10-07 图文并茂：新增配图媒体部件与逐页 <p:pic> 注入
  for (const [name, bytes] of Object.entries(extras?.media ?? {})) out[name] = bytes
  const slidePics = extras?.slidePics ?? {}
  for (const [i, pic] of Object.entries(slidePics)) {
    const slideName = `ppt/slides/slide${Number(i) + 1}.xml`
    const xml = strFromU8(out[slideName])
    const close = xml.lastIndexOf("</p:spTree>")
    if (close >= 0) out[slideName] = strToU8(xml.slice(0, close) + pic + xml.slice(close))
  }

  try {
    return { ok: true, bytes: zipSync(out, { level: 6 }), titleSample, bodySample, slideCount: k, notesCount }
  } catch (e) {
    return { ok: false, reason: `zip pack failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}

// ---------------------------- 对外 API -------------------------------------

/** 模板体检（详细版，R190 切片三）：附 notesMaster 有无与不可读归因，供事前探测展示 */
export function inspectFidelityTemplateDetailed(
  template: Uint8Array,
): { slides: FidelityTemplateSlide[]; hasNotesMaster: boolean; failure: string | null } {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(template)
  } catch {
    return { slides: [], hasNotesMaster: false, failure: "template is not a valid zip package" }
  }
  const { ctx, reason } = readCtx(entries)
  if (!ctx) return { slides: [], hasNotesMaster: false, failure: reason ?? "template unreadable" }
  return {
    slides: ctx.slides,
    hasNotesMaster: Object.keys(ctx.entries).some((n) => NOTES_MASTER_RE.test(n)),
    failure: null,
  }
}

/** 模板体检：逐样张页可保真性目录（供切片三样张选择交互与失败归因展示） */
export function inspectFidelityTemplate(template: Uint8Array): { slides: FidelityTemplateSlide[] } | null {
  const r = inspectFidelityTemplateDetailed(template)
  return r.failure === null ? { slides: r.slides } : null
}

/**
 * 以公司模板为底，按 specs 生成保真 .pptx 字节。
 * 母版/版式/主题/媒体原样保留；产物只含生成页（原样张页不进产物）。
 * 任何不满足前提的情形返回 { ok:false, reason }，调用方按契约回退现通道。
 */
export function buildFidelityDeck(template: Uint8Array, specs: FidelitySlideSpec[]): FidelityOutcome {
  if (!specs.length) return { ok: false, reason: "no slides to generate" }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(template)
  } catch {
    return { ok: false, reason: "template is not a valid zip package" }
  }
  const r = readCtx(entries)
  if (!r.ctx) return { ok: false, reason: r.reason ?? "template unreadable" }
  const ctx = r.ctx
  // R189：讲稿备注不得静默丢失——任一页有备注时模板必须含 notesMaster，否则 ok:false 回退现通道
  const needNotes = specs.some((s) => (s.notes ?? "").trim() !== "")
  const notesMasterPart = needNotes
    ? Object.keys(ctx.entries).filter((n) => NOTES_MASTER_RE.test(n)).sort()[0] ?? null
    : null
  if (needNotes && !notesMasterPart) return { ok: false, reason: "template has no notesMaster for speaker notes" }
  const titleSample = pickSample(ctx, "title")
  if (!titleSample) return { ok: false, reason: "no usable title sample slide in template" }
  const anyLines = specs.some((s) => (s.lines ?? []).some((t) => t.trim() !== ""))
  const bodySampleOpt = anyLines ? pickSample(ctx, "body") : null
  if (anyLines && !bodySampleOpt) return { ok: false, reason: "no usable body sample slide in template" }
  const bodySample = bodySampleOpt ?? titleSample

  const generated: { xml: string; rels: string; notes?: string }[] = []
  // 2026-10-07 图文并茂：带图页的媒体部件/关系/图片元素在此收集，repackage 统一落包
  const mediaParts: Record<string, Uint8Array> = {}
  const ctDefaults: string[] = []
  const slidePics: Record<number, string> = {}
  let mediaSeq = 0
  for (const name of Object.keys(entries)) {
    const nm = /^ppt\/media\/image(\d+)\./.exec(name)
    if (nm) mediaSeq = Math.max(mediaSeq, Number(nm[1]))
  }
  const CT_EXT: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif" }

  for (const spec of specs) {
    const lines = (spec.lines ?? []).filter((t) => t.trim() !== "")
    let useImage = !!spec.image && !!spec.image.base64
    let ext = "png"
    if (useImage) {
      const bytes = bytesFromBase64(spec.image!.base64)
      if (!bytes.length) useImage = false
      else ext = spec.image!.ext === "jpeg" ? "jpeg" : spec.image!.ext === "gif" ? "gif" : "png"
    }
    // 2026-11-05：优先用它专属版式的样张页，让封面/目录/章节/内页/封底各自套自己的版式；
    // 该版式没有可用样张页时退回「有无正文行」的默认样张（旧行为）。
    const byLayout = spec.layoutFile ? pickSampleByLayout(ctx, spec.layoutFile) : null
    const sample = byLayout ?? (lines.length || (useImage && bodySample) ? bodySample : titleSample)
    const src = ctx.xmls.get(sample.idx) ?? ""
    // 带图页：正文限 3 行避让右侧图（正文加右内边距，不与图重叠）
    const effLines = useImage ? lines.slice(0, 3) : lines
    const inj = injectSlideText(src, spec.title, effLines)
    if (inj === null) return { ok: false, reason: `sample slide ${sample.idx} cannot host title/body text` }
    let xml = inj
    let rels = ctx.relss.get(sample.idx) ?? ""
    if (useImage) {
      mediaSeq += 1
      const mediaName = `image${mediaSeq}.${ext}`
      mediaParts[`ppt/media/${mediaName}`] = bytesFromBase64(spec.image!.base64)
      if (!ctDefaults.some((x) => x.includes(`Extension="${ext}"`))) {
        ctDefaults.push(`<Default Extension="${ext}" ContentType="${CT_EXT[ext] ?? "image/" + ext}"/>`)
      }
      let maxR = 0
      for (const t of rels.match(/Id="rId(\d+)"/g) || []) {
        const nm = /rId(\d+)/.exec(t)
        if (nm) maxR = Math.max(maxR, Number(nm[1]))
      }
      const rid = `rId${maxR + 1}`
      rels = rels.replace(
        "</Relationships>",
        `<Relationship Id="${rid}" Type="${REL_NS}/image" Target="../media/${mediaName}"/></Relationships>`,
      )
      // 版面：右半栏放图；从 presentation.xml 读版心尺寸（缺省 16:9）
      const szm = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(ctx.pres)
      const CW = Number(szm?.[1]) || 12192000
      const CH = Number(szm?.[2]) || 6858000
      const px = Math.round(CW * 0.54)
      const pw = Math.round(CW * 0.4)
      const py = Math.round(CH * 0.24)
      const ph = Math.round(CH * 0.64)
      const picId = 990
      slidePics[specs.indexOf(spec)] =
        `<p:pic><p:nvPicPr><p:cNvPr id="${picId}" name="配图"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr><a:xfrm><a:off x="${px}" y="${py}"/><a:ext cx="${pw}" cy="${ph}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
      // 正文形状加右内边距避让图片（EMU）
      xml = withBodyRightInset(xml, Math.round(pw * 0.92))
    }
    generated.push({ xml, rels, notes: spec.notes })
  }
  const extras = {
    media: mediaParts,
    ctDefaults: ctDefaults.join(""),
    slidePics,
  }
  return repackage(ctx, generated, titleSample.idx, bodySample.idx, notesMasterPart, extras)
}

/** base64（可带 data: 前缀）→ 字节；非法输入返回空 */
function bytesFromBase64(b64: string): Uint8Array {
  const clean = String(b64 ?? "").replace(/^data:[^;]*;base64,/, "").trim()
  if (!clean) return new Uint8Array()
  try {
    const bin = atob(clean)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return new Uint8Array()
  }
}

/** 给正文形状的 bodyPr 补右内边距（EMU），把要点文字从右侧图片区推开 */
function withBodyRightInset(xml: string, insetEmu: number): string {
  const spRe = /<p:sp>[\s\S]*?<\/p:sp>/g
  const blocks: { start: number; end: number; text: string }[] = []
  let m: RegExpExecArray | null
  while ((m = spRe.exec(xml)) !== null) blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  // 第一个形状为标题占位，其后的第一个带 txBody 形状为正文
  let bodyIdx = -1
  for (let i = 1; i < blocks.length; i++) {
    if (/<p:txBody>/.test(blocks[i].text)) { bodyIdx = i; break }
  }
  if (bodyIdx < 0) return xml
  const block = blocks[bodyIdx].text
  let patched = block
  if (/<a:bodyPr[^>]*\/>/.test(block)) {
    patched = block.replace(/<a:bodyPr([^>]*?)\/>/, `<a:bodyPr$1 rIns="${insetEmu}"/>`)
  } else if (/<a:bodyPr[^>]*>/.test(block)) {
    patched = block.replace(/<a:bodyPr([^>]*?)>/, `<a:bodyPr$1 rIns="${insetEmu}">`)
  }
  if (patched === block) return xml
  return xml.slice(0, blocks[bodyIdx].start) + patched + xml.slice(blocks[bodyIdx].end)
}
