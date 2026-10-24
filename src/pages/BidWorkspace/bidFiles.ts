import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import { buildFigureSvg, tokenPalette } from "@/components/bid-workspace/BidFigure"
import { renderMermaidToSvg } from "./mermaidFigure"
import type { Chapter, FigureSpec } from "@/pages/SolutionStudio/solutionTypes"
import { DOCX_SIZE_HALFPT } from "./bidFormatConstants"
import { triggerBlobDownload } from "@/lib/download"
import { DEFAULT_RUN_FONT } from "@/lib/exportFont"
import { unzipSync, strFromU8 } from "fflate" // REQ-057：大文件只读 document.xml 用（项目既有依赖，mammoth 未导出 zip 能力）
import { formatDateTimeDisplay } from "@/lib/dateDisplay"
import {
  CLAUSE_GRANULARITY_LABEL,
  RESPONSE_LEVEL_LABEL,
  deviationExportSummary,
  REVIEW_STATUS_LABEL,
  SEVERITY_LABEL,
  VOID_STATUS_LABEL,
  effectiveVoidStatus,
  isBizPart,
  normalizeBidScope,
  normalizeBasisPlaceholders,
  normalizeDeviationTable,
  parseFixedLineSpacing,
  isRealSectionHeading,
  sanitizeChapterText,
  splitContentFont,
  type BidProjectRecord,
  type DeviationRow,
  type BidScope,
  type FormatAlign,
  type FormatSettings,
  type HeadingFormat,
} from "./bidTypes"

/** R206 切片 1（R-002）：按内容范围三模式决定导出分册收录哪些章——
 *  biz 仅商务章 / tech 仅技术章 / both 全部（商务骨架章保留占位供线下填写） */
export function pickExportChapters(chapters: Chapter[], scope: BidScope): Chapter[] {
  return (chapters ?? []).filter((c) => {
    // 2026-10-14 交付物治理：**已有正文的章一律导出**，内容范围只用于筛掉空骨架章。
    // 旧口径按 part 一刀切：scope=tech（含 include_biz=false）时把 part=biz 的
    // 「实质性条款响应承诺函」整章丢弃——而该章是零 AI 自动生成（commitmentLetter.ts）、
    // 设计上「随全套文档导出」、且是 ★ 条款逐字响应与盖章的法定载体，写了却拿不到。
    if ((c.content ?? "").trim()) return true
    return scope === "biz" ? isBizPart(c) : scope === "tech" ? !isBizPart(c) : true
  })
}

/** 导出/预览共用的章清单（纯函数 pickExportChapters 的取数包装） */
function bidExportChapters(project: BidProjectRecord): Chapter[] {
  return pickExportChapters(project.bid_chapters, normalizeBidScope(project.gen_options))
}

/** R206 切片 1：分册标题随内容范围切换 */
function bidVolumeTitle(project: BidProjectRecord): string {
  const scope = normalizeBidScope(project.gen_options)
  return scope === "biz" ? "投标文件（商务标）" : scope === "tech" ? "投标文件（技术标）" : "投标文件"
}

// ---------------------------------------------------------------------------
// 本地文件解析（.docx / .pdf → 纯文本，全部在浏览器内完成，不上传原文件）
// ---------------------------------------------------------------------------

// Q28 切片A（天好 Skill 移植）：页码锚点——仅外部投标文件通道注入 〔P<页码>〕 前缀，
// 招标解析等既有通道默认不带（行为零变化）。纯函数独立可测。
export type PageTagOptions = { pageTag?: boolean }
export const PAGE_TAG_RE = /^〔P(\d+|\?)〕\s?/

/** 给一行加页码前缀；已带前缀的行原样返回（幂等） */
export function tagPageLine(line: string, pageNo: number): string {
  if (PAGE_TAG_RE.test(line)) return line
  return "〔P" + pageNo + "〕 " + line
}

/** 剥离行首页码前缀 */
export function stripPageTag(line: string): string {
  return line.replace(PAGE_TAG_RE, "")
}

/** 取行首页码；无页码（docx/文本通道）或非锚点行返回 null */
export function pageOfLine(line: string): number | null {
  const m = line.match(PAGE_TAG_RE)
  if (!m || m[1] === "?") return null
  return parseInt(m[1], 10)
}

/** 显示/导出渲染：〔P12〕 → 「第 12 页」；〔P?〕 → 「见章节」 */
export function renderPageRefs(s: string): string {
  return s
    .replace(/〔P(\d+)〕/g, "第 $1 页")
    .replace(/〔P\?〕/g, "见章节")
}

/** REQ-057（2026-10-18）大文件分流阈值：**word/document.xml 解压后大小**超过此值改走
 * 「只读 document.xml」路径。
 *
 * 【为什么不能用 file.size 当判据（验收官 55 份全量扫描推翻的第一版设计）】
 * 内存消耗取决于 **document.xml 解压后的大小**，不是 docx 文件大小——因为图片压缩率差异极大：
 *   file 24.4MB → xml 24.6MB（压缩比 101%，几乎没压缩）→ OOM
 *   file 33.3MB → xml 25.1MB（压缩比 75%）           → OOM
 *   file 33.2MB → xml 22.9MB（压缩比 69%，同源同目录）→ 通过
 *   file 274.7MB → xml 20.5MB（压缩比 7%）           → 通过
 *   file 143.4MB → xml 18.8MB（压缩比 13%）          → 通过
 *   file 167.2MB → xml 14.3MB（压缩比 9%）           → 通过
 * **274MB 的文件能过、24MB 的反而 OOM** —— 按文件大小分流会把这两个都判反。
 *
 * 【怎么在不解压的前提下拿到 xml 大小】
 * zip 中央目录里就存着 uncompressedSize。fflate 的 `unzipSync` 即使 filter 全返回 false，
 * 也会把每个 entry 的元信息（含 `originalSize`）交给 filter 回调——用这个读大小，零解压成本：
 *   实测 274.7MB 文件 55ms、143.4MB 文件 50ms、20.8MB 文件 4ms。
 *
 * 【阈值为什么取 20MB】
 * 验收官实测：能通过的最大 XML 是 22.9MB（heap 954MB），OOM 掉的最小 XML 是 24.6MB。
 * 边界在 22.9~24.6MB 之间；取 20MB 留 3MB 安全余量。
 *
 * 为什么保留旧路径：extractDocxText 是公共入口（招标解析 / 范本导入 / 知识库上传），
 * 小文件的旧路径本来工作正常，能不改的行为就不改。 */
export const DOCX_XML_SIZE_THRESHOLD = 20 * 1024 * 1024

/** 旧路径（mammoth）的 media 体积上限：超过则改走新路径。
 *
 * 【为什么必须同时卡 media（55 份全量扫描推翻的第二版设计）】
 * 只卡 xml 大小会漏掉最有代表性的一类文件——**正文不大、图片极多**：
 *   池州【主】143.4MB：xml 仅 18.8MB（未超 20MB 阈值）→ 走旧路径 → media 209.6MB
 *     → mammoth 把 1278 张图全解成 base64 塞进 HTML（实测 HTML 达 293MB）→ **OOM**
 *   合稿第5版 274.5MB：xml 15.2MB → 旧路径 → media 334MB → OOM
 *   蚌医 167.2MB：     xml 14.3MB → 旧路径 → media 165.8MB → OOM
 *   1、智业框架 86MB：  xml 15.7MB → 旧路径 → media 87.8MB  → OOM
 * 全量扫描实测：19 份失败**全部**是这类「xml 未超阈值但 media 巨大」的文件。
 *
 * 【旧路径的内存公式（实测拟合）】
 *   峰值 heap ≈ media 解压总量 × 1.4 + xml 解压量 × 2 + jsdom DOM 开销
 *   media 是主项：1278 张图 209.6MB → HTML 293MB → 峰值 >8GB。
 *
 * 【阈值为什么取 40MB】
 * 55 份全量实测（3.36GB，每份独立进程）：
 *   media ≥ 65.7MB 的 10 份——全部走新路径，全部成功
 *   media 53.9MB 的「信息集成平台项目」——旧路径 OOM（唯一失败件）
 *   media 58.6MB 的 2 份——旧路径却成功（图片压缩率不同，无法用 media 单独区分）
 * 即 media 与 OOM 不是单调对应，53.9MB 会挂而 58.6MB 能过。所以**不取边界值**，
 * 取 40MB 让「media 偏大」的一律走新路径（新路径已验证峰值远低于旧路径，
 * 实测 334MB media 的文件在新路径下也通过）。宁可用更省内存的那条，不赌压缩率。 */
export const DOCX_MEDIA_SIZE_THRESHOLD = 40 * 1024 * 1024

/** 读 docx 里 word/document.xml 与 word/media/* 的解压后大小。
 *
 * 只读 zip 中央目录，不解压任何 entry —— 这是判据能低成本落地的关键。
 * 实测：274.7MB 文件 55ms、143.4MB 50ms、20.8MB 4ms。
 *
 * 返回值：
 *   xmlSize    — document.xml 解压后大小（决定新路径自身的 DOM 开销）
 *   mediaSize  — word/media/* 解压总量（决定旧路径的 base64 膨胀，是 OOM 主因）
 *   readable   — zip 能否读出中央目录（false 时调用方按旧路径处理，保持原错误行为） */
export function peekDocxSizes(arrayBuffer: ArrayBuffer): { xmlSize: number; mediaSize: number; readable: boolean } {
  let xmlSize = 0
  let mediaSize = 0
  try {
    unzipSync(new Uint8Array(arrayBuffer), {
      filter: (file) => {
        if (file.name === "word/document.xml") xmlSize = file.originalSize ?? 0
        else if (file.name.startsWith("word/media/")) mediaSize += file.originalSize ?? 0
        return false // 全部拒绝解压，只借回调读元信息
      },
    })
  } catch {
    return { xmlSize: 0, mediaSize: 0, readable: false } // 损坏/非 zip：交给旧路径去报错
  }
  return { xmlSize, mediaSize, readable: true }
}

/** 兼容旧签名：只取 document.xml 大小（单测与探针在用）。 */
export function peekDocumentXmlSize(arrayBuffer: ArrayBuffer): number {
  return peekDocxSizes(arrayBuffer).xmlSize
}

/** T-DOCX（2026-09-28 解析审计）：docx 文本提取升级——表格感知。
 * extractRawText 会把表格拆成碎单元格流：竖排表头「投标价格分」逐字拆 5 行、
 * 序号/分值/评分标准的对应关系断裂，AI 解析评分表时极易错位配对（实测东华656 安庆二院
 * 招标文件评分表）。改用 convertToHtml 保留 <table> 结构后转「A | B | C」行文本：
 *  - 表格行：单元格以「 | 」分隔（LLM 读表格的标准形态）
 *  - 竖排单元格：单元格内按换行分隔的片段全部 ≤2 字时判定为竖排字，合并（「投 标 价 格 分」→「投标价格分」）
 *  - 普通段落：textContent 独立成行
 * 消费方：招标文件解析 / 范本资料导入 / 知识库 docx 上传，全部受益。
 *
 * REQ-057（2026-10-18）：word/document.xml 解压后超过 DOCX_XML_SIZE_THRESHOLD 的文件改走
 * extractDocxTextFromXml（只读 document.xml，不解压图片）；小文件维持本函数原行为，一字未改。
 * 判据是 **xml 大小而非文件大小**——图片压缩率差异极大，按文件大小会把 274MB(过) 和
 * 24MB(OOM) 判反（详见 DOCX_XML_SIZE_THRESHOLD 注释里的 55 份全量实测）。 */
export async function extractDocxText(file: File, opts?: PageTagOptions): Promise<string> {
  // REQ-057：按「document.xml 大小」**或**「media 总量」分流，任一超限即走新路径。
  // 只读 zip 中央目录，不解压（274MB 文件 55ms）。
  // 两个条件缺一不可：只卡 xml 会漏掉「正文不大、图片极多」的一类（池州 xml 18.8MB 但
  // media 209.6MB，旧路径照样 OOM）；只卡 media 会漏掉「正文巨大」的一类。
  const buf = await file.arrayBuffer()
  const { xmlSize, mediaSize } = peekDocxSizes(buf)
  if (xmlSize > DOCX_XML_SIZE_THRESHOLD || mediaSize > DOCX_MEDIA_SIZE_THRESHOLD) {
    return extractDocxTextFromXml(buf, opts)
  }
  const mammoth = await import("mammoth")
  // mammoth 的 browser 构建认 arrayBuffer、Node 构建只认 buffer（openZip 只枚举
  // path/buffer/file）；vite 解析 browser 字段走前者，vitest 走后者。两个键都传
  // （Uint8Array 视图零拷贝，运行时 JSZip.loadAsync 两者都收）。
  const result = await mammoth.convertToHtml({
    arrayBuffer: buf,
    buffer: new Uint8Array(buf) as unknown as Buffer,
  })
  const html = result.value ?? ""
  const parsed = new DOMParser().parseFromString(html, "text/html")

  const decode = (s: string) =>
    s.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")

  /** 单元格文本：竖排字合并；普通文本空白折叠。td.textContent 保留换行信息供竖排判定 */
  const cellText = (td: Element): string => {
    const raw = decode(td.textContent ?? "")
    const rows = raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (rows.length > 1 && rows.every((r) => [...r].length <= 2)) return rows.join("") // 竖排：逐字换行
    return raw.replace(/\s+/g, " ").trim()
  }

  const walk = (el: Element) => {
    for (const node of Array.from(el.children)) {
      const tag = node.tagName.toLowerCase()
      if (tag === "table") {
        lines.push(...tableRowsToLines(node, cellText))
        lines.push("") // 表格后空行，保持分块边界
      } else if (tag === "br") {
        lines.push("")
      } else if (node.children.length > 0 && node.querySelector("table, p")) {
        walk(node) // 容器递归
      } else {
        const text = decode(node.textContent ?? "").replace(/[ \t]+/g, " ").trim()
        if (text) lines.push(text)
      }
    }
  }

  const lines: string[] = []
  walk(parsed.body)
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  // docx 无物理页：锚点占位 〔P?〕，下游按章节定位（不硬造页码）
  return opts?.pageTag && out ? "〔P?〕 " + out : out
}

/**
 * REQ-057（2026-10-18）：大文件 docx 文本提取——**只解压 word/document.xml，完全不碰 word/media**。
 *
 * 【为什么必须另开一条路】
 * 旧路径 `mammoth.convertToHtml` 会把 media 下全部图片转成 base64 data URI 塞进 HTML，
 * 再用 jsdom 建 DOM 树，实测放大系数 50~100 倍：
 *   15.4MB → 峰值 heapUsed 1183MB；42.2MB → 2029MB；143.4MB【池州】→ 8192MB 仍 OOM。
 * 而 143MB 文件里 document.xml 只有 17.9MB、图片 1278 张占 209.6MB——**99% 的内存花在取文本用不到的东西上**。
 *
 * 【与旧路径的行为对应关系】（逐条，验收要求核对）
 *   ① 表格：复用同一个 `tableRowsToLines` + 同一个 cellText 口径（rowspan/colspan 还原、竖排字合并）
 *   ② 竖排字：cellText 里「片段全部 ≤2 字则合并」的逻辑原样沿用（「投 标 价 格 分」→「投标价格分」）
 *   ③ 普通段落：`w:p` 独立成行，段内取全部 `w:t` 文本
 *   ④ 空行压缩：`\n{3,}` → `\n\n`（与旧路径同一句）
 *   ⑤ 页码锚点：opts.pageTag 时前缀 `〔P?〕`
 *   ⑥ 表格后空行：保持分块边界
 *
 * 【XML → HTML 的等价映射】（这是新旧两条路唯一的语义差）
 *   w:tbl   → table（内部 w:tr → tr，w:tc → td，vMerge/gridSpan 换算成 rowspan/colspan）
 *   w:p     → p（内部 w:t 拼接；w:br / w:cr → 换行）
 *   w:tab   → 制表符
 * mammoth 把 vMerge 的续格渲染成 `rowspan`，这里同样换算，故 tableRowsToLines 的向上填充逻辑照旧生效。
 */
export async function extractDocxTextFromXml(arrayBuffer: ArrayBuffer, opts?: PageTagOptions): Promise<string> {
  const files = unzipSync(new Uint8Array(arrayBuffer), {
    // 只解压 word/document.xml。图片（media）与页眉页脚一律不取：
    //  - media 是内存爆点（143MB 文件里图片占 209MB），且取文本用不到；
    //  - 页眉页脚取进来反而制造差异（见下方注释）。
    filter: (f) => f.name === "word/document.xml",
  })
  const entry = files["word/document.xml"]
  if (!entry) throw new Error("不是有效的 docx：缺少 word/document.xml")
  const xml = strFromU8(entry)

  const parsed = new DOMParser().parseFromString(xml, "application/xml")
  const decode = (s: string) =>
    s.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")

  /** 单元格文本：与旧路径 cellText 完全同口径（含竖排字合并） */
  const cellText = (td: Element): string => {
    const raw = decode(td.textContent ?? "")
    const rows = raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (rows.length > 1 && rows.every((r) => [...r].length <= 2)) return rows.join("")
    return raw.replace(/\s+/g, " ").trim()
  }

  /** w:p → 纯文本。逐个**直接子节点**走，不能对 w:p 整体取 getElementsByTagName("w:t")：
   *  - w:tab 要还原成空格，否则目录行「第一章 公司相关资质 3」粘成「第一章公司相关资质3」；
   *  - w:br / w:cr 要还原成换行，否则段内断行被拼平（旧路径 mammoth 会出 <br>）；
   *  - **文本框（w:txbxContent）必须取**：实测漳州那份首行「正本」就在文本框里，
   *    旧路径 mammoth 会渲染它；跳过就丢——「正本/副本」是投标文件判定信息。
   *    文本框里的 w:p 由 visit 递归进去取 w:t，不单独成行（它属于当前段落）。 */
  const paraText = (p: Element): string => {
    let out = ""
    const visit = (el: Element) => {
      for (const c of Array.from(el.children)) {
        const tag = c.tagName
        if (tag === "w:pPr" || tag === "w:rPr" || tag === "w:sectPr") continue
        // mc:AlternateContent 同时含 mc:Choice 与 mc:Fallback 两份等价内容（文本框新/旧表示），
        // 两份都取会得到「正本正本」。只取 mc:Choice（新表示），Fallback 跳过——
        // 与 mammoth 一致（它读 Choice 分支）。
        if (tag === "mc:AlternateContent") {
          const choice = Array.from(c.children).find((x) => x.tagName === "mc:Choice")
          if (choice) visit(choice)
          continue
        }
        if (tag === "w:t") out += c.textContent ?? ""
        else if (tag === "w:tab") out += " " // 制表符 → 空格（目录行、表格制表分隔）
        else if (tag === "w:br" || tag === "w:cr") out += "\n" // 段内换行
        else visit(c) // 含 w:txbxContent / w:r / w:hyperlink
      }
    }
    visit(p)
    return out
  }

  /** w:tc → 补 colspan/rowspan 属性后的 Element（供 tableRowsToLines 复用） */
  const toHtmlTable = (tbl: Element): Element => {
    const doc = tbl.ownerDocument!
    const rows = Array.from(tbl.getElementsByTagName("w:tr"))
    const table = doc.createElement("table")
    for (const tr of rows) {
      const htmlTr = doc.createElement("tr")
      for (const tc of Array.from(tr.getElementsByTagName("w:tc"))) {
        const td = doc.createElement("td")
        const tcPr = Array.from(tc.children).find((c) => c.tagName === "w:tcPr")
        // 纵向合并：w:vMerge (w:val="restart" 起始 / 无 val 表示续行) → rowspan
        let rowspan = 1
        if (tcPr) {
          const vMerge = Array.from(tcPr.children).find((c) => c.tagName === "w:vMerge")
          if (vMerge) {
            const restart = vMerge.getAttribute("w:val") === "restart"
            if (!restart) continue // 续行格不输出（与 mammoth 一致：续行在 HTML 里没有 td）
            // 起始格：数一下后续连续有多少个 vMerge 续行，换算成 rowspan
            const rowIdx = rows.indexOf(tr)
            for (let k = rowIdx + 1; k < rows.length; k++) {
              const cells = Array.from(rows[k].getElementsByTagName("w:tc"))
              const ci = Array.from(tr.getElementsByTagName("w:tc")).indexOf(tc)
              const next = cells[ci]
              if (!next) break
              const nextPr = Array.from(next.children).find((c) => c.tagName === "w:tcPr")
              const nextVm = nextPr ? Array.from(nextPr.children).find((c) => c.tagName === "w:vMerge") : null
              if (!nextVm || nextVm.getAttribute("w:val") === "restart") break
              rowspan += 1
            }
          }
          // 横向合并：w:gridSpan w:val → colspan
          const gridSpan = Array.from(tcPr.children).find((c) => c.tagName === "w:gridSpan")
          const span = Number(gridSpan?.getAttribute("w:val") ?? 1)
          if (span > 1) td.setAttribute("colspan", String(span))
          if (rowspan > 1) td.setAttribute("rowspan", String(rowspan))
        }
        // 单元格内容：多个 w:p 之间用 \n 连接——**必须保留换行**，
        // 因为 cellText 的竖排判定依赖它：实测真标书里有「信/用/承/诺」这种逐字成段的单元格，
        // 若压成空格，rows.every(≤2字) 判据失效，竖排字就合并不了（实测会输出「信 用 承 诺」）。
        //
        // ⚠️ 不能用 `:scope > w:p` 选择器：jsdom 的 XML 文档（application/xml）不支持 `:scope`，
        // 实测 querySelectorAll(":scope > w:p") 恒返回 0 条 → 永远落到兜底分支。
        // 改用 children 直接筛（XML DOM 的 children 只含元素节点）。
        const inner = Array.from(tc.children)
          .filter((c) => c.tagName === "w:p")
          .map((p) => paraText(p))
          .filter((s) => s !== "")
          .join("\n")
        // 兜底：直接子 w:p 找不到时（结构异常），退回全量子段落扫描
        td.textContent = inner || Array.from(tc.getElementsByTagName("w:p")).map((p) => paraText(p)).join("\n")
        htmlTr.appendChild(td)
      }
      table.appendChild(htmlTr)
    }
    return table
  }

  /** w:p → 纯文本。逐个**直接子节点**走，不能对 w:p 整体取 getElementsByTagName("w:t")：
   *  - 文本框（w:txbxContent）里嵌套的 w:t 会被重复计一次，实测「正本」→「正本正本」；
   *  - w:tab 要还原成空格，否则目录行「第一章 公司相关资质 3」粘成「第一章公司相关资质3」；
   *  - w:br / w:cr 要还原成换行，否则段内断行被拼平（旧路径 mammoth 会出 <br>）。
   * 只走直接子节点的递归，遇到 w:pPr / w:rPr 这类属性容器要跳过。 */
  const lines: string[] = []
  const body = parsed.getElementsByTagName("w:body")[0]
  const walk = (container: Element) => {
    for (const node of Array.from(container.children)) {
      const tag = node.tagName
      if (tag === "w:tbl") {
        lines.push(...tableRowsToLines(toHtmlTable(node), cellText))
        lines.push("") // 表格后空行，保持分块边界
      } else if (tag === "w:p") {
        // 段内 w:br 是**软换行**，不是段落边界。旧路径里 mammoth 把段内 <br> 转成 textContent
        // 的一个换行符，随后 `replace(/\s+/g, " ")` 折叠成空格，整段仍是一行——
        // 所以这里也必须把段内换行折叠为空格，不能拆成多行（拆了行差会到 6~7%）。
        const text = decode(paraText(node)).replace(/\s+/g, " ").trim()
        if (text) lines.push(text)
      } else {
        // 容器继续下钻（w:sdt、w:txbxContent、w:sectPr 等）
        if (node.children.length) walk(node)
      }
    }
  }
  if (body) walk(body)

  // 【为什么不取页眉页脚】实测漳州那份 document.xml 里「正本」出现 9 次、footer1.xml 里 0 次，
  // 说明正文本身就有；而宁德那份若把 footer 前置，会多出「报价部分 / 1 / 19」三行旧路径没有的内容
  // （旧路径 mammoth 不渲染该 footer）。取页脚 = 引入新差异，故只读 document.xml。
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return opts?.pageTag && out ? "〔P?〕 " + out : out
}

/**
 * REQ-019（2026-10-17）：表格 → 竖线行，按 rowspan/colspan 还原成**规整网格**。
 *
 * 缺陷（验收官在 REQ-015 验收中发现的既有 bug）：docx 用**纵向合并单元格**（vMerge）时，
 * mammoth 把合并渲染成 `<td rowspan="8">`，**后续行在 HTML 里就只剩 2 个 td**（不是 3 个 td 其中 1 个空）。
 * 于是评分表 T3 跨 8 行时，后 7 行从 `名称 | 分值 | 说明` 塌缩成 `分值 | 说明`，
 * 名称列凭空消失且无法从文本层恢复——用户看到「3 分 | 投标人提供的医院信息系统…」，
 * 不知道这是哪一项。实测福安 10/20 = 50% 评分项丢名称；84/96 份文件含 rowspan。
 *
 * 修法：**按 rowspan 向上填充**（不是保留空列、也不是章节层猜名）。
 * 用一张 `carry` 网格记住每个列位当前仍被哪个合并单元格占着；渲染某行时，
 * 该行没有对应 td 的列位就用 carry 里那份格子的文本填充。这样：
 *  - 纵向合并的续行拿到与首行**同一个**名称（T3 八行都叫「T3、信息系统功能方案」）；
 *  - 行数不变（不删行、不合并行）→ 评分行总数不减少；
 *  - 只对**声明了 rowspan 的表格**生效，其余表格逐字走原路径（零行为变化）。
 *
 * 为什么不选另外两种（验收标准要求说明）：
 *  - 「保留空列占位」：HTML 里根本没有那个 td，无从保留；若强行按表头列数补哨兵，
 *    会给**所有**短行（含真·空列）插哨兵，把 14126 个短行全改写成带哨兵的行，噪声大且改变下游提示词口径。
 *  - 「章节层补名兜底」：会把两个相邻但分属不同合并区的行张冠李戴，验收官也明确只建议作过渡。
 *
 * 竖排字合并（cellText 内 rows.every(≤2 字) 那段）**一字未改**，仍按原逻辑处理单元格内容。
 */
export function tableRowsToLines(table: Element, cellText: (td: Element) => string): string[] {
  // REQ-057：不用 querySelectorAll("tr")。本函数同时被新旧两条路径调用，新路径传进来的是
  // **XML 文档**（application/xml）里 createElement 出来的元素——jsdom 对 XML 文档的 CSS
  // 选择器支持不完整，验收官全量扫描时曾报 `Unknown pseudo-class :p`（同一文件单进程失败、
  // 独立进程成功，属间歇性失败）。getElementsByTagName 在 HTML/XML 两种文档下行为一致，
  // 且不需要选择器解析，从根上消除这类不稳定。
  const trs = Array.from(table.getElementsByTagName("tr"))
  if (!trs.length) return []
  // 网格列数：取「含 colspan 展开」后的最大行宽，作为规整网格宽度
  const gridWidthOf = (tr: Element) =>
    Array.from(tr.children).reduce((n, td) => n + Math.max(1, Number(td.getAttribute("colspan") ?? 1)), 0)
  const hasSpanInfo = trs.some((tr) => Array.from(tr.children).some((td) => Number(td.getAttribute("rowspan") ?? 1) > 1))
  // 无 rowspan：逐字走旧路径（filter(Boolean) + 相邻重复空列去重），保证既有行为零变化
  if (!hasSpanInfo) {
    const out: string[] = []
    for (const tr of trs) {
      const cells = Array.from(tr.children).map((td) => cellText(td)).filter(Boolean)
      const cleaned = cells.filter((c, i) => c !== "" || (cells[i - 1] ?? "") !== "")
      if (cleaned.some((c) => c)) out.push(cleaned.join(" | "))
    }
    return out
  }

  const width = trs.reduce((w, tr) => Math.max(w, gridWidthOf(tr)), 0)
  if (width < 2) return []
  /**
   * 每个列位当前被哪一份「上方合并单元格」占着：{ text, remain, real }。
   * remain = 还要向下覆盖几行；real = 该列是否「该单元格自己的第一列」。
   * real 用来区分**横向**合并产生的占位列与**纵向**合并要补的列：
   *  - 横向（colspan）第 2..n 列只是占位，旧实现里那个 td 只输出一格 → 不计入输出；
   *  - 纵向（rowspan）的续行没有 td，必须补上同一个名称 → 计入输出。
   * 混为一谈会把同一文本重复灌进多列（实测伪造出「评分因素 | 评分因素」，
   * 让 #9/#17/#26/#28/#37 五份本来正常的行反而对不上，假报丢内容）。
   */
  const carry: Array<{ text: string; remain: number; real: boolean } | null> = new Array(width).fill(null)
  const out: string[] = []
  for (const tr of trs) {
    const rowText: string[] = new Array(width).fill("")
    const rowReal: boolean[] = new Array(width).fill(false)
    /** 取用上方合并格：把它的文本落到本列，并递减剩余行数 */
    const takeCarry = (c: number) => {
      const cr = carry[c]!
      rowText[c] = cr.text
      rowReal[c] = cr.real
      cr.remain -= 1
      if (cr.remain <= 0) carry[c] = null
    }
    let col = 0
    for (const td of Array.from(tr.children)) {
      // 跳过被上方 rowspan 占据的列位，并把那份文本填进来（这就是「向上填充」）
      while (col < width && carry[col]) {
        takeCarry(col)
        col++
      }
      if (col >= width) break
      const colspan = Math.max(1, Number(td.getAttribute("colspan") ?? 1))
      const rowspan = Math.max(1, Number(td.getAttribute("rowspan") ?? 1))
      const text = cellText(td)
      for (let k = 0; k < colspan && col + k < width; k++) {
        // 文本只落第一列；其余列位仅占位，输出时丢弃（保持与旧实现「一个 td 一格」一致）
        rowText[col + k] = k === 0 ? text : ""
        rowReal[col + k] = k === 0
        carry[col + k] = rowspan > 1 ? { text, remain: rowspan - 1, real: k === 0 } : null
      }
      col += colspan
    }
    // 行尾仍被上方合并覆盖的列位（本行 td 用完了）
    while (col < width) {
      if (carry[col]) takeCarry(col)
      col++
    }
    // 与旧实现同口径：只输出「真实存在且非空」的格（旧路径先 filter(Boolean) 再 join）
    const cells: string[] = []
    for (let c = 0; c < width; c++) if (rowReal[c] && rowText[c] !== "") cells.push(rowText[c])
    if (cells.length) out.push(cells.join(" | "))
  }
  return out
}

/** T-PDF（2026-09-28 解析审计）：把 pdfjs 文本项按几何坐标重建行。
 * 旧实现 join("") 把整页文本粘成一行（实测 466 页招标文件均值 895 字符/行，最长 1588），导致：
 *  ① 页码粘进正文与章节名（「15第三章…」）② 表格行列关系全丢 ③ 评分办法定位器
 * extractScoringSectionExcerpt 的「标题行≤60字/行首第X章」规则全部失效 → 评分章节定位
 * 返回空 → 回退全文分段 → 评分表跨段断裂 → AI 误报「评分办法缺失」。
 * 重建规则：同一 y（±2.5pt）的文本项按 x 排序拼一行；y 变化即换行；空串项丢弃。
 * 表格行识别：同一行内相邻文本项列间距 > 15pt（不同表格列）时以「 | 」拼接——与 docx
 * 表格感知提取（convertToHtml）的竖线行格式统一，使解析提示词的「竖线=表格行」规则两通道一致。 */
export function rebuildPdfLines(items: Array<Record<string, unknown>>): string {
  const frags: Array<{ y: number; x: number; w: number; str: string }> = []
  for (const it of items) {
    const str = it && typeof it === "object" && "str" in it ? String((it as { str?: unknown }).str ?? "") : ""
    if (!str.trim()) continue
    const tr = (it as { transform?: number[] }).transform
    const x = Array.isArray(tr) ? Number(tr[4]) || 0 : 0
    const yRaw = Array.isArray(tr) ? Number(tr[5]) || 0 : 0
    const w = Number((it as { width?: number }).width ?? 0) || 0
    frags.push({ y: Math.round(yRaw * 10) / 10, x, w, str })
  }
  if (!frags.length) return ""
  const ys: number[] = []
  for (const f of frags) if (!ys.includes(f.y)) ys.push(f.y)
  ys.sort((a, b) => b - a) // PDF y 轴向上，从大到小 = 从上到下
  const TOL = 2.5
  const GAP = 15 // 列间距阈值：超过视为不同表格列，用竖线分隔
  const lines: string[] = []
  let lastY: number | null = null
  for (const y of ys) {
    if (lastY !== null && Math.abs(y - lastY) <= TOL) continue // 已被同容差行吸收
    const rowFrags = frags
      .filter((f) => Math.abs(f.y - y) <= TOL)
      .sort((a, b) => a.x - b.x)
    let row = ""
    let prevEnd = -Infinity
    let prevStr = ""
    for (const f of rowFrags) {
      // 重叠去重：部分 PDF 生成器对文字做描边+填充双层渲染，同位置同文本出现两次——跳过重复项
      if (row !== "" && f.x < prevEnd - 1 && (f.str === prevStr || prevStr.includes(f.str) || f.str.includes(prevStr))) {
        continue
      }
      const gap = f.x - prevEnd
      const sep = row === "" ? "" : gap > GAP ? " | " : " "
      row = row + sep + f.str
      prevEnd = f.x + f.w
      prevStr = f.str
    }
    row = row.replace(/\s+/g, " ").trim()
    if (row) lines.push(row)
    lastY = y
  }
  return lines.join("\n")
}

export type PdfTextExtraction = {
  text: string
  /** 无文字层的页码（1 起）—— 扫描版页面 */
  imageOnlyPages: number[]
  totalPages: number
}

/** 单页「有文字层」的下限：低于此值视为该页只有页码/页眉/水印等零星字符，不算有效文字层 */
const PAGE_TEXT_MIN_CHARS = 20

/**
 * R298：PDF 文本抽取，顺带**如实报告哪些页没有文字层**。
 *
 * 背景（55 份真实招标文件实测）：9 份是 100% 扫描件、0 份混合、46 份有文字层。
 * 原实现对扫描件走的是**成功路径**——`rebuildPdfLines` 返回空串，`lines.join("\n").trim()` 得到 `""`，
 * 不抛错。因此「文件解析失败（…）扫描版 PDF 无法提取文字」那条提示挂在 catch 里**永远不会被扫描件触发**，
 * 用户看到的是「上传成功 → 解析 0 项」，完全不知道是扫描件。
 * 而 R298 审计还发现：真正需要 OCR 的只有 1 份是招标正文，其余 8 份是承诺函/报价表/合同等附属材料
 * （这些本来就常是盖章扫描件）。→ **先做到「如实告知」比上 OCR 收益大得多、风险小得多。**
 */
export async function extractPdfTextWithLayers(file: File, opts?: PageTagOptions): Promise<PdfTextExtraction> {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const buf = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) })
  const doc = await loadingTask.promise
  const lines: string[] = []
  const imageOnlyPages: number[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // T-PDF：几何重建行（保留段落/表格行/页码边界），不再整页粘成一坨
    const pageText = rebuildPdfLines(content.items as unknown as Array<Record<string, unknown>>)
    // 无文字层判定按「有效字符数」而非行数：只有页码/页眉的水印页仍会产出一两行
    if (pageText.replace(/\s+/g, "").length < PAGE_TEXT_MIN_CHARS) imageOnlyPages.push(i)
    if (opts?.pageTag) {
      // Q28 切片A：外部标书审查通道逐行加页码锚点，AI 可回写「〔P12〕」定位
      lines.push(
        pageText
          .split("\n")
          .map((l) => tagPageLine(l, i))
          .join("\n"),
      )
    } else {
      lines.push(pageText)
    }
  }
  await loadingTask.destroy()
  return { text: lines.join("\n").trim(), imageOnlyPages, totalPages: doc.numPages }
}

/**
 * 抽不出任何文字时的报错文案（R298）。三个真实场景各有处置方式，不能只丢一句「解析失败」：
 * - 全扫描件 → 需 OCR 或改用「粘贴文本」
 * - 部分扫描页 → 可继续（拿得到的页照样解析），但必须告知丢了哪些页
 */
export function buildNoTextLayerMessage(imageOnlyPages: number[], totalPages: number, fileName = "该 PDF"): string {
  if (totalPages > 0 && imageOnlyPages.length === totalPages) {
    return `${fileName} 是扫描件（${totalPages} 页均无文字层），无法提取文字。请改用「粘贴文本」方式导入，或先用 OCR 工具转成可复制文字的 PDF。`
  }
  const shown = imageOnlyPages.slice(0, 20)
  const suffix = imageOnlyPages.length > 20 ? ` 等 ${imageOnlyPages.length} 页` : ""
  return `${fileName} 有 ${imageOnlyPages.length} 页是扫描件（无文字层，第 ${shown.join("、")}${suffix} 页），这部分内容无法读取。其余 ${totalPages - imageOnlyPages.length} 页照常解析；如需完整内容，请把这几页单独 OCR 后补入。`
}

export async function extractPdfText(file: File, opts?: PageTagOptions): Promise<string> {
  const { text, imageOnlyPages, totalPages } = await extractPdfTextWithLayers(file, opts)
  // 全扫描件：显式抛错而不是静默返回空串——否则上传后表现为「解析 0 项」，用户毫无线索
  if (totalPages > 0 && !text) throw new Error(buildNoTextLayerMessage(imageOnlyPages, totalPages, file.name))
  return text
}

/** 按扩展名分发解析招标文件；失败抛中文错误并引导改用粘贴文本 */
export async function extractTenderFileText(file: File, opts?: PageTagOptions): Promise<string> {
  const lower = file.name.toLowerCase()
  try {
    if (lower.endsWith(".docx")) return await extractDocxText(file, opts)
    if (lower.endsWith(".pdf")) return await extractPdfText(file, opts)
    if (lower.endsWith(".txt") || lower.endsWith(".md")) return (await file.text()).trim()
    throw new Error("暂不支持该格式")
  } catch (e) {
    const detail = e instanceof Error ? e.message : "未知原因"
    // R298：扫描件提示已上移到 extractPdfText（走成功路径才会命中），此处只保留格式层面的引导，
    // 避免把「文件坏了」和「这是扫描件」两种不同原因混成一句话。
    throw new Error(`文件解析失败（${detail}）。支持 .docx / .pdf / .txt`, { cause: e })
  }
}

// ---------------------------------------------------------------------------
// Word 导出（投标文件 + 解析 / 检查 / 评标报告，全部前端本地生成）
// ---------------------------------------------------------------------------

/** 第十七轮 17C：页面级导出选项（纸张/页边距 twips、页眉文字、页码页脚、目录域更新提示） */
export type DocxExportOptions = {
  page?: {
    size: { width: number; height: number }
    margin: { top: number; bottom: number; left: number; right: number }
  }
  headerText?: string
  footerPageNumber?: boolean
  /** Q28 切片B：true 时页脚只出裸页码数字（暗标「任何一页不得设页眉页脚，只准出现页码」口径） */
  footerPageNumberBare?: boolean
  /**
   * Q28 切片B：true 时把 docx 内置 Title/Heading1-6/Hyperlink 默认样式颜色压成纯黑。
   * docx 9.x 的 Heading1/2/3 默认 run 色为 2E74B5（蓝），而标题段落只覆盖字号/加粗不覆盖颜色，
   * 暗标「所有文字（含图表）均为黑色」的口径会因此判为不符（评标模块可整块 0 分）。
   */
  allTextBlack?: boolean
  updateFields?: boolean
}

export async function downloadDocx(
  fileName: string,
  children: (Paragraph | Table | TableOfContents)[],
  opts?: DocxExportOptions,
): Promise<void> {
  const songRun = (text: string) =>
    new TextRun({ text, size: 18, font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" } })
  const headers = opts?.headerText
    ? { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [songRun(opts.headerText)] })] }) }
    : undefined
  const footers = opts?.footerPageNumber
    ? {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              // Q28 切片B：暗标页脚只准出现页码本身（裸连续阿拉伯数字、底端居中）；非暗标保留「第 X 页」字样
              children: opts.footerPageNumberBare
                ? [new TextRun({ children: [PageNumber.CURRENT], size: 18, font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" } })]
                : [new TextRun({ children: ["第 ", PageNumber.CURRENT, " 页"], size: 18, font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" } })],
            }),
          ],
        }),
      }
    : undefined
  // Q28 切片B：暗标全黑口径——内置标题/超链接样式默认色改黑；非暗标 styles 不下发，零行为变化
  const blackRun = { color: "000000" }
  const blackStyles = opts?.allTextBlack
    ? {
        default: {
          title: { run: blackRun },
          heading1: { run: blackRun },
          heading2: { run: blackRun },
          heading3: { run: blackRun },
          heading4: { run: blackRun },
          heading5: { run: blackRun },
          heading6: { run: blackRun },
          hyperlink: { run: blackRun },
        },
      }
    : undefined
  const doc = new Document({
    ...(blackStyles ? { styles: blackStyles } : {}),
    ...(opts?.updateFields ? { features: { updateFields: true } } : {}),
    sections: [
      {
        ...(opts?.page ? { properties: { page: { size: opts.page.size, margin: opts.page.margin } } } : {}),
        ...(headers ? { headers } : {}),
        ...(footers ? { footers } : {}),
        children,
      },
    ],
  })
  const blob = await Packer.toBlob(doc)
  triggerBlobDownload(blob, fileName)
}

// 默认字体已收口到 src/lib/exportFont.ts（单一真源，R62），此处只 import 使用；
// 历史根因见该文件头注释（R46：不写 font 则 docx 无 <w:rFonts>，落到主题默认字体）。

function titlePara(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: true, size: 40, font: DEFAULT_RUN_FONT.heading })],
  })
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 200 },
    children: [new TextRun({ text, bold: true, size: 30, font: DEFAULT_RUN_FONT.heading })],
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, size: 26, font: DEFAULT_RUN_FONT.heading })],
  })
}

/** 第十轮修复 4：三级小标题（（一）（二）… 式），加粗正文字号、无缩进 */
function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 120, after: 80 },
    children: [new TextRun({ text, bold: true, size: 24, font: DEFAULT_RUN_FONT.heading })],
  })
}

/** 四级小标题（（1）（2）… 式）——格式设置面板能设 6 级，导出必须接得住，否则设置等于没生效 */
function h4(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_4,
    spacing: { before: 100, after: 60 },
    children: [new TextRun({ text, bold: true, size: 24, font: DEFAULT_RUN_FONT.heading })],
  })
}

/** 五级小标题（① ②… 式） */
function h5(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_5,
    spacing: { before: 80, after: 60 },
    children: [new TextRun({ text, bold: true, size: 24, font: DEFAULT_RUN_FONT.heading })],
  })
}

/**
 * 正文行 → 标题级别（0 = 正文段落）。
 * 判据与既有「（一）」口径同源：短行（≤30 字）+ 不以句末标点结尾 + 枚举式编号。
 * 为什么要把层级延到 4/5 级：格式设置面板暴露 6 级标题样式，导出此前最多只到 3 级
 * （（一）→H3，其余一律当正文），四级以上样式永远没有落点，用户改了设置看不出任何变化。
 * 刻意只认括号/圈号枚举，**不认「1.」「1.1」**——那两种在正文里绝大多数是列表项而不是标题，
 * 误升标题会把交付物的结构搞乱，比"设置不生效"更糟。
 */
export function contentHeadingLevel(line: string): 0 | 2 | 3 | 4 {
  const t = (line ?? "").trim()
  if (!t || t.length > 30 || /[。！？；，、]$/.test(t)) return 0
  if (/^（[一二三四五六七八九十]+）/.test(t)) return 2
  if (/^[（(]\s*[0-9]{1,2}\s*[)）]/.test(t)) return 3
  if (/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(t)) return 4
  return 0
}

/** 第十轮修复 4：正文段落规范排版——首行缩进 2 字符（480 twip）、1.5 倍行距、两端对齐 */
function body(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { after: 120, line: 360, lineRule: "auto" },
    children: [new TextRun({ text, size: 24, font: DEFAULT_RUN_FONT.body })],
  })
}

/** 位图 URL → PNG（fetch + Blob 解码，供 docx ImageRun）；失败返回 null 走【图】标题文字降级 */
export async function imageUrlToPng(url: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const res = await fetch(url, { credentials: "include" })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith("image/")) return null
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (!pngBlob) return null
    return { data: new Uint8Array(await pngBlob.arrayBuffer()), width: bitmap.width, height: bitmap.height }
  } catch {
    return null
  }
}

/** 画布像素原地转灰度（Rec.601 亮度加权，保留 alpha）；异常静默返回原图，不阻断导出 */
function toGrayscale(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  try {
    const frame = ctx.getImageData(0, 0, width, height)
    const d = frame.data
    for (let i = 0; i < d.length; i += 4) {
      const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
      d[i] = y
      d[i + 1] = y
      d[i + 2] = y
    }
    ctx.putImageData(frame, 0, 0)
  } catch {
    /* 画布被跨源污染等异常：保留彩色原图，交由人工核对 */
  }
}

/**
 * Q28 切片B：位图黑白化。暗标招标文件普遍要求「图片（含 PPT 幻灯片）、图表均为黑白色」，
 * 彩色位图直接进 Word 属编制要求不符（暗标评审模块可能整块 0 分）。on=false 原样返回，零行为变化。
 */
async function grayscalePng(
  png: { data: Uint8Array; width: number; height: number },
  on: boolean,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  if (!on) return png
  try {
    const bitmap = await createImageBitmap(new Blob([png.data as BlobPart], { type: "image/png" }))
    const canvas = document.createElement("canvas")
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return png
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    toGrayscale(ctx, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
    if (!blob) return png
    return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
  } catch {
    return png
  }
}

/** 章节配图 SVG → PNG（浏览器内 canvas 转换）；任何一步失败返回 null，由调用方降级为文字段落（方案编制导出同样复用） */
export async function figureToPng(
  spec: FigureSpec,
  opts?: { grayscale?: boolean },
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const grayscale = opts?.grayscale === true
  try {
    // T17：image 型是现成位图，fetch→canvas→PNG（尺寸超宽时等比压到 960 防止 docx 版面溢出）
    if (spec.type === "image") {
      const png = await imageUrlToPng(spec.url)
      if (!png) return null
      const maxW = 960
      if (png.width <= maxW) return grayscalePng(png, grayscale)
      const ratio = maxW / png.width
      const canvas = document.createElement("canvas")
      canvas.width = maxW
      canvas.height = Math.max(1, Math.round(png.height * ratio))
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      const bitmap = await createImageBitmap(new Blob([png.data as BlobPart], { type: "image/png" }))
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
      if (!resized) return null
      const scaled = { data: new Uint8Array(await resized.arrayBuffer()), width: canvas.width, height: canvas.height }
      return grayscalePng(scaled, grayscale)
    }
    // T16：mermaid 型走异步渲染（mermaid.render → SVG）再进同一条 SVG→canvas 链路；渲染失败返回 null 走文字降级
    const svg =
      spec.type === "mermaid"
        ? await renderMermaidToSvg(spec.code)
        : buildFigureSvg(spec, tokenPalette())
    if (!svg) return null
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
    const root = parsed.documentElement
    if (!root || root.nodeName === "parsererror") return null
    const width = Number(root.getAttribute("width")) || 640
    const height = Number(root.getAttribute("height")) || 320
    const markup = new XMLSerializer().serializeToString(root)
    const blobUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }))
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error("配图渲染失败"))
        img.src = blobUrl
      })
      const canvas = document.createElement("canvas")
      canvas.width = width * 2
      canvas.height = height * 2
      const ctx = canvas.getContext("2d")
      if (!ctx) return null
      const palette = tokenPalette()
      ctx.fillStyle = palette.card
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      // 全黑检测：四角 + 中心抽样 5 点，全部近黑说明 token 色值解析失败，判转换失败走文字降级，杜绝黑块入 Word
      const samplePoints: [number, number][] = [
        [2, 2],
        [canvas.width - 3, 2],
        [2, canvas.height - 3],
        [canvas.width - 3, canvas.height - 3],
        [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)],
      ]
      const allBlack = samplePoints.every(([x, y]) => {
        const d = ctx.getImageData(x, y, 1, 1).data
        return d[0] < 10 && d[1] < 10 && d[2] < 10
      })
      if (allBlack) return null
      // Q28 切片B：暗标导出图表黑白（SVG 分支渲染后的位图同样过灰度）
      if (grayscale) toGrayscale(ctx, canvas.width, canvas.height)
      const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
      if (!pngBlob) return null
      const buf = await pngBlob.arrayBuffer()
      return { data: new Uint8Array(buf), width, height }
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 第十七轮 17C：格式配置驱动导出（format_settings null = 现状默认导出，一字不改）
// ---------------------------------------------------------------------------

/** 中文字体名 → docx 西文字体名（eastAsia 保留中文名，Word 中文字体直接匹配） */
const DOCX_FONT: Record<string, string> = { 宋体: "SimSun", 黑体: "SimHei", 仿宋: "FangSong", 楷体: "KaiTi" }

// DOCX_SIZE_HALFPT 抽至 ./bidFormatConstants（R269）：构建层与检查层共用同一份字号半点表

const DOCX_ALIGN: Record<FormatAlign, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

/** 纸张尺寸（twips：A4=21×29.7cm，A3=29.7×42cm，16 开=18.5×26cm） */
export const PAPER_TWIPS: Record<string, { width: number; height: number }> = {
  A4: { width: 11906, height: 16838 },
  A3: { width: 16838, height: 23811 },
  "16K": { width: 10489, height: 14740 },
}

const CM_TO_TWIPS = 566.93

/** 导出级别 → docx 标题样式：必须覆盖 1-6 级（见 headingPara 的注释，四级以上曾被塌回 H3） */
const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
]

function cmToTwips(cm: number): number {
  return Math.round(cm * CM_TO_TWIPS)
}

/** 行距值 → docx spacing（固定值N磅 = N×20 twips exact；倍数 = 240×倍数 auto） */
function lineSpacingOf(lineSpacing: string): { line: number; lineRule: "auto" | "exact" } {
  const fixed = parseFixedLineSpacing(lineSpacing)
  if (fixed) return { line: Math.round(fixed * 20), lineRule: "exact" }
  if (lineSpacing === "单倍") return { line: 240, lineRule: "auto" }
  if (lineSpacing === "2倍") return { line: 480, lineRule: "auto" }
  return { line: 360, lineRule: "auto" }
}

/**
 * 格式配置驱动的 docx 构建器（第十七轮 17C 抽出）：字体 run / 各级标题段 / 正文段 /
 * 全角空格分列的纯文本表格行识别与 docx Table 构建；投标文件导出与方案编制导出共用同一套映射。
 */
export type FormatDocxKit = {
  fontRun: (text: string, o: { font: string; size: string; bold?: boolean; italics?: boolean }) => TextRun
  headingAt: (i: number) => HeadingFormat
  headingPara: (
    level: number,
    text: string,
    opts?: { before?: number; after?: number; pageBreakBefore?: boolean },
  ) => Paragraph
  bodyPara: (text: string) => Paragraph
  splitTableRow: (line: string) => string[] | null
  buildFmtTable: (rows: string[][]) => Table
}

export function createFormatDocxKit(fmt: FormatSettings): FormatDocxKit {  const fontRun: FormatDocxKit["fontRun"] = (text, o) =>
    new TextRun({
      text,
      bold: o.bold ?? false,
      italics: o.italics ?? false,
      size: DOCX_SIZE_HALFPT[o.size] ?? 28,
      font: { ascii: DOCX_FONT[o.font] ?? "SimSun", hAnsi: DOCX_FONT[o.font] ?? "SimSun", eastAsia: o.font },
    })
  const headingAt: FormatDocxKit["headingAt"] = (i) => fmt.heading[Math.min(Math.max(i, 0), 5)]
  const headingPara: FormatDocxKit["headingPara"] = (level, text, opts) => {
    const h = headingAt(level)
    // 级别映射必须覆盖 1-6 级：此前只映射 H1-H3，四级以上一律塌回 H3，
    // 于是格式设置面板里四/五/六级标题的字体字号设了也不会有任何变化。
    const headingLevel = HEADING_LEVELS[Math.min(Math.max(level, 0), HEADING_LEVELS.length - 1)]
    return new Paragraph({
      heading: headingLevel,
      alignment: DOCX_ALIGN[h.align],
      ...(opts?.pageBreakBefore ? { pageBreakBefore: true } : {}),
      spacing: { before: opts?.before ?? 240, after: opts?.after ?? 120 },
      children: [fontRun(text, { font: h.font, size: h.size, bold: true })],
    })
  }
  const bodySpacing = lineSpacingOf(fmt.body.lineSpacing)
  // 首行缩进：字符数 × 字号半点值 × 10（1 半点 = 10 twips，2 字符四号 ≈ 560 twips）
  const bodyIndent = Math.round(fmt.body.firstIndent * (DOCX_SIZE_HALFPT[fmt.body.size] ?? 28) * 10)
  const bodyPara: FormatDocxKit["bodyPara"] = (text) =>
    new Paragraph({
      alignment: DOCX_ALIGN[fmt.body.align],
      ...(bodyIndent > 0 ? { indent: { firstLine: bodyIndent } } : {}),
      spacing: { after: 120, ...bodySpacing },
      children: [fontRun(text, { font: fmt.body.font, size: fmt.body.size })],
    })

  // 循环 6 A4：正文里的纯文本表格行（生成约定：每行一条记录、列间用全角空格 U+3000 分隔、首行为表头）
  // 渲染成真正的 docx 表格，边框粗细与单元格字体随格式设置变化
  const tblFont = splitContentFont(fmt.table.contentFont)
  const tblBorderPt = parseFloat(fmt.table.border) || 0.5
  // docx 边框 size 单位 = 1/8 磅："0.5pt" → 4
  const tblBorderSide = {
    style: BorderStyle.SINGLE,
    size: Math.max(1, Math.round(tblBorderPt * 8)),
    color: "000000",
  }
  const splitTableRow: FormatDocxKit["splitTableRow"] = (line) => {
    if (!line.includes("　")) return null
    // 生成约定为「两个全角空格 U+3000」分列；用 \u3000+ 正则折叠连续分隔符，兼容模型偶发单个全角空格
    const cols = line.split(/\u3000+/).map((c) => c.trim())
    while (cols.length && !cols[cols.length - 1]) cols.pop()
    while (cols.length && !cols[0]) cols.shift()
    return cols.length >= 2 ? cols : null
  }
  const buildFmtTable: FormatDocxKit["buildFmtTable"] = (rows) => {
    const colCount = Math.max(...rows.map((r) => r.length))
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: tblBorderSide,
        bottom: tblBorderSide,
        left: tblBorderSide,
        right: tblBorderSide,
        insideHorizontal: tblBorderSide,
        insideVertical: tblBorderSide,
      },
      rows: rows.map((cells, ri) =>
        new TableRow({
          ...(ri === 0 ? { tableHeader: true } : {}),
          children: Array.from({ length: colCount }, (_, ci) =>
            new TableCell({
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  spacing: { after: 0, line: 276, lineRule: "auto" },
                  children: [fontRun(cells[ci] ?? "", { font: tblFont.font, size: tblFont.size, bold: ri === 0 })],
                }),
              ],
            }),
          ),
        }),
      ),
    })
  }
  return { fontRun, headingAt, headingPara, bodyPara, splitTableRow, buildFmtTable }
}

/** 导出投标文件 Word：format_settings 存在时按格式配置驱动；null=现状默认导出一字不改 */
export async function exportBidDocx(project: BidProjectRecord): Promise<void> {
  const fmt = project.format_settings ?? null
  if (!fmt) {
    await exportBidDocxDefaults(project)
    return
  }
  await exportBidDocxFormatted(project, fmt)
}

/** 现状默认导出（存量项目 format_settings=null 走此路径） */
async function exportBidDocxDefaults(project: BidProjectRecord): Promise<void> {
  const children: Paragraph[] = []
  children.push(titlePara(`${project.project_name} ${bidVolumeTitle(project)}`))
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        new TextRun({
          text: [project.hospital, project.tender_no].filter((x) => x).join(" · "),
          size: 24,
          font: DEFAULT_RUN_FONT.body,
        }),
      ],
    }),
  )
  for (const [idx, ch] of bidExportChapters(project).entries()) {
    const chapter: Chapter = ch
    children.push(h1(`第${idx + 1}章 ${chapter.title}`))
    // 标书第十三轮改造 4：商务骨架章导出「章标题 + 小节标题 + 每节占位行」，供线下填写后合并
    if (isBizPart(chapter) && !(chapter.content ?? "").trim()) {
      const bizSections = chapter.sections ?? []
      if (!bizSections.length) {
        children.push(body("（商务文书，请线下填写）"))
      }
      bizSections.forEach((s, j) => {
        children.push(h2(`${idx + 1}.${j + 1} ${s}`))
        children.push(body(`（商务文书，请线下填写：${s}）`))
      })
      continue
    }
    const paras: Paragraph[] = []
    let firstBodyAt = -1
    // 2026-10-07 图位锚点：正文行「【图：标题】」= 该图的插入位置（按标题精确匹配，每图一次）；
    // 未匹配到图的锚点行直接丢弃（不把标记文字带进 Word）；剩余未锚定图回落到旧聚合位置
    const figsAll = chapter.figures ?? []
    const usedFigTitles = new Set<string>()
    // 第十轮修复 1/4：导出前整体净化正文（存量脏数据——围栏/JSON 块/markdown 残留——导出也干净）
    // 交付物治理：依据表「编号」列的无编号占位（【待填写】）规整为「／」，不动库内原文
    const cleanContent = normalizeBasisPlaceholders(sanitizeChapterText(chapter.content || ""))
    for (const rawLine of cleanContent.split("\n")) {
      const line = rawLine.trim()
      if (!line) continue
      const anchorMatch = /^【图[:：](.+?)】$/.exec(line)
      if (anchorMatch) {
        const spec = figsAll.find((f) => f.title === anchorMatch[1].trim() && !usedFigTitles.has(f.title))
        if (spec) {
          usedFigTitles.add(spec.title)
          const rendered = await figureToPng(spec)
          const figCaption = (spec.caption ?? "").trim()
          if (rendered) {
            const drawW = 460
            const drawH = Math.max(40, Math.round((drawW * rendered.height) / rendered.width))
            paras.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 160, after: 60 },
                children: [new ImageRun({ type: "png", data: rendered.data, transformation: { width: drawW, height: drawH } })],
              }),
            )
          } else {
            paras.push(body(`【图】${spec.title}`))
          }
          paras.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: figCaption ? 40 : 160 },
              children: [new TextRun({ text: spec.title, italics: true, size: 20, font: DEFAULT_RUN_FONT.body })],
            }),
          )
          if (figCaption) {
            paras.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 160 },
                children: [new TextRun({ text: figCaption, size: 18, font: DEFAULT_RUN_FONT.body })],
              }),
            )
          }
        }
        continue
      }
      // 问题3：正文句以小节名/数字开头不再误升标题——改走整行精确匹配真小节标题
      const isSubHeading = isRealSectionHeading(line, chapter.sections, idx + 1)
      const hLevel = contentHeadingLevel(line)
      if (!isSubHeading && hLevel === 0 && firstBodyAt === -1) firstBodyAt = paras.length
      paras.push(
        // REQ-053（2026-10-18）：真小节标题按编号段数分 H2/H3，与预览端 bidWordPreviewLogic.classify
        // 同口径（`/^\d+\.\d+\.\d+/` → h3）。修前一律 h2，三段编号「2.5.1 阶段验收…」预览显示三级、
        // 导出后掉成二级——所见非所得，且把三级标题挤进二级导致目录层级断档。
        isSubHeading
          ? /^\d+\.\d+\.\d+/.test(line.trim())
            ? h3(line)
            : h2(line)
          : hLevel === 2
            ? h3(line)
            : hLevel === 3
              ? h4(line)
              : hLevel === 4
                ? h5(line)
                : body(line),
      )
    }
    const figs = figsAll.filter((f) => !usedFigTitles.has(f.title))
    if (figs.length) {
      const figParas: Paragraph[] = []
      for (const spec of figs) {
        const png = await figureToPng(spec)
        // 循环 2 批 2-1：编排图注（caption）非空时图后追加图注行（纯文本不斜体、小字号）
        const figCaption = (spec.caption ?? "").trim()
        if (png) {
          const drawW = 460
          const drawH = Math.max(40, Math.round((drawW * png.height) / png.width))
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 60 },
              children: [new ImageRun({ type: "png", data: png.data, transformation: { width: drawW, height: drawH } })],
            }),
          )
        } else {
          figParas.push(body(`【图】${spec.title}`))
        }
        figParas.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: figCaption ? 40 : 160 },
            children: [new TextRun({ text: spec.title, italics: true, size: 20, font: DEFAULT_RUN_FONT.body })],
          }),
        )
        if (figCaption) {
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [new TextRun({ text: figCaption, size: 18, font: DEFAULT_RUN_FONT.body })],
            }),
          )
        }
      }
      const insertAt = firstBodyAt === -1 ? paras.length : firstBodyAt + 1
      paras.splice(insertAt, 0, ...figParas)
    }
    children.push(...paras)
  }
  await downloadDocx(`${project.project_name}-投标文件.docx`, children)
}

/**
 * 第十七轮 17C：格式配置驱动导出——字体/字号映射、行距、页边距、首行缩进、标题编号样式、
 * 目录/页码/页眉页脚开关。
 * Q28 切片B：sealed=true 按暗标编制口径出件——页码为页面底端居中裸连续阿拉伯数字（不再关闭页码）、
 * 强制不输出页眉、配图与图片黑白化；「暗标声明」占位页改由 sealedDeclarationPage 单独控制（默认不出）。
 * 章节配图逻辑与默认导出一致（SVG→PNG 插入正文首段后，失败降级「【图】标题」）。
 */
async function exportBidDocxFormatted(project: BidProjectRecord, fmt: FormatSettings): Promise<void> {
  // 字体/标题/正文/表格构建统一走 createFormatDocxKit（与方案编制导出共用同一套映射）
  const { fontRun, headingAt, headingPara, bodyPara, splitTableRow, buildFmtTable } = createFormatDocxKit(fmt)

  const children: (Paragraph | Table | TableOfContents)[] = []
  // Q28 切片B：声明占位页仅在显式勾选时置顶（多数暗标招标文件不要求，多余页反成不符项）
  if (fmt.sealed && fmt.sealedDeclarationPage) {
    const sealHead = headingAt(0)
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400, after: 320 },
        children: [fontRun("暗 标 声 明", { font: sealHead.font, size: sealHead.size, bold: true })],
      }),
    )
    children.push(bodyPara("（暗标声明页占位：请按招标文件要求在此粘贴暗标声明与密封标注。）"))
    children.push(bodyPara("暗标部分不得出现投标人名称、印章或任何身份标识；页码按招标文件要求编制于页面底端居中。"))
    children.push(new Paragraph({ pageBreakBefore: true }))
  }
  const h0 = headingAt(0)
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [fontRun(`${project.project_name} ${bidVolumeTitle(project)}`, { font: h0.font, size: h0.size, bold: true })],
    }),
  )
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [
        fontRun([project.hospital, project.tender_no].filter((x) => x).join(" · "), {
          font: fmt.body.font,
          size: fmt.body.size,
        }),
      ],
    }),
  )
  // 目录开关：TOC 域（Word 打开时提示更新域），目录后正文另起一页
  let breakBeforeNext = false
  if (fmt.toc) {
    const tocHead = headingAt(1)
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 160 },
        children: [fontRun("目  录", { font: tocHead.font, size: tocHead.size, bold: true })],
      }),
    )
    // Q28 切片B：暗标目录不做超链接——Word 更新域后会给超链接目录项套 Hyperlink 字符样式（蓝色下划线）
    // 目录级别跟随实际会产出的标题层级（现在正文可到 5 级），否则四/五级标题不进目录
    children.push(new TableOfContents("目录", { hyperlink: !fmt.sealed, headingStyleRange: "1-5" }))
    breakBeforeNext = true
  }
  // 标题编号样式：数字层级 "1 / 1.1"；章—节式 "第1章 / 1.1"（现状默认）；无编号
  const chapterPrefix = (idx: number) =>
    fmt.titleNumbering === "none" ? "" : fmt.titleNumbering === "chapter" ? `第${idx + 1}章 ` : `${idx + 1} `
  const sectionPrefix = (idx: number, j: number) =>
    fmt.titleNumbering === "none" ? "" : `${idx + 1}.${j + 1} `
  for (const [idx, ch] of bidExportChapters(project).entries()) {
    const chapter: Chapter = ch
    children.push(headingPara(0, `${chapterPrefix(idx)}${chapter.title}`, { before: 320, after: 200, pageBreakBefore: breakBeforeNext }))
    breakBeforeNext = false
    if (isBizPart(chapter) && !(chapter.content ?? "").trim()) {
      const bizSections = chapter.sections ?? []
      if (!bizSections.length) children.push(bodyPara("（商务文书，请线下填写）"))
      bizSections.forEach((s, j) => {
        children.push(headingPara(1, `${sectionPrefix(idx, j)}${s}`))
        children.push(bodyPara(`（商务文书，请线下填写：${s}）`))
      })
      continue
    }
    const paras: (Paragraph | Table)[] = []
    let firstBodyAt = -1
    // 2026-10-07 图位锚点（与默认导出同语义）：「【图：标题】」行 = 该图插入位置，每图一次；
    // 未匹配的锚点行丢弃；剩余未锚定图回落到旧聚合位置（首段后）
    const figsAll = chapter.figures ?? []
    const usedFigTitles = new Set<string>()
    const renderAnchoredFig = async (spec: FigureSpec): Promise<(Paragraph | Table)[]> => {
      const out: (Paragraph | Table)[] = []
      const rendered = await figureToPng(spec, { grayscale: fmt.sealed })
      const figCaption = (spec.caption ?? "").trim()
      if (rendered) {
        const drawW = 460
        const drawH = Math.max(40, Math.round((drawW * rendered.height) / rendered.width))
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 160, after: 60 },
            children: [new ImageRun({ type: "png", data: rendered.data, transformation: { width: drawW, height: drawH } })],
          }),
        )
      } else {
        out.push(bodyPara(`【图】${spec.title}`))
      }
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: figCaption ? 40 : 160 },
          children: [fontRun(spec.title, { font: fmt.body.font, size: "小五", italics: true })],
        }),
      )
      if (figCaption) {
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [fontRun(figCaption, { font: fmt.body.font, size: "小五" })],
          }),
        )
      }
      return out
    }
    // 交付物治理：依据表「编号」列的无编号占位（【待填写】）规整为「／」，不动库内原文
    const cleanContent = normalizeBasisPlaceholders(sanitizeChapterText(chapter.content || ""))
    const contentLines = cleanContent
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
    let li = 0
    while (li < contentLines.length) {
      const line = contentLines[li]
      const anchorMatch = /^【图[:：](.+?)】$/.exec(line)
      if (anchorMatch) {
        const spec = figsAll.find((f) => f.title === anchorMatch[1].trim() && !usedFigTitles.has(f.title))
        if (spec) {
          usedFigTitles.add(spec.title)
          if (firstBodyAt === -1) firstBodyAt = paras.length
          paras.push(...(await renderAnchoredFig(spec)))
        }
        li++
        continue
      }
      // 循环 6 A4：连续 ≥2 行可拆分（全角空格分列）视为表格块，转 docx Table；孤立单行仍按正文段落
      const headCols = splitTableRow(line)
      if (headCols) {
        const block: string[][] = [headCols]
        let lj = li + 1
        while (lj < contentLines.length) {
          const nextCols = splitTableRow(contentLines[lj])
          if (!nextCols) break
          block.push(nextCols)
          lj++
        }
        if (block.length >= 2) {
          if (firstBodyAt === -1) firstBodyAt = paras.length
          paras.push(buildFmtTable(block))
          li = lj
          continue
        }
      }
      const isSubHeading = isRealSectionHeading(line, chapter.sections, idx + 1)
      const hLevel = contentHeadingLevel(line)
      if (!isSubHeading && hLevel === 0 && firstBodyAt === -1) firstBodyAt = paras.length
      paras.push(isSubHeading ? headingPara(1, line) : hLevel ? headingPara(hLevel, line) : bodyPara(line))
      li++
    }
    const figs = figsAll.filter((f) => !usedFigTitles.has(f.title))
    if (figs.length) {
      const figParas: Paragraph[] = []
      for (const spec of figs) {
        const png = await figureToPng(spec, { grayscale: fmt.sealed })
        // 循环 2 批 2-1：编排图注（caption）非空时图后追加图注行（正文字体、不斜体、小五号）
        const figCaption = (spec.caption ?? "").trim()
        if (png) {
          const drawW = 460
          const drawH = Math.max(40, Math.round((drawW * png.height) / png.width))
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 160, after: 60 },
              children: [new ImageRun({ type: "png", data: png.data, transformation: { width: drawW, height: drawH } })],
            }),
          )
        } else {
          figParas.push(bodyPara(`【图】${spec.title}`))
        }
        figParas.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: figCaption ? 40 : 160 },
            children: [fontRun(spec.title, { font: fmt.body.font, size: "小五", italics: true })],
          }),
        )
        if (figCaption) {
          figParas.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 160 },
              children: [fontRun(figCaption, { font: fmt.body.font, size: "小五" })],
            }),
          )
        }
      }
      const insertAt = firstBodyAt === -1 ? paras.length : firstBodyAt + 1
      paras.splice(insertAt, 0, ...figParas)
    }
    children.push(...paras)
  }
  await downloadDocx(`${project.project_name}-投标文件.docx`, children, {
    page: {
      size: PAPER_TWIPS[fmt.paper] ?? PAPER_TWIPS.A4,
      margin: {
        top: cmToTwips(fmt.margins.top),
        bottom: cmToTwips(fmt.margins.bottom),
        left: cmToTwips(fmt.margins.left),
        right: cmToTwips(fmt.margins.right),
      },
    },
    // Q28 切片B：暗标任何一页不得设页眉，强制不输出页眉文字
    headerText: fmt.headerFooter && !fmt.sealed ? `${project.project_name} 投标文件` : "",
    // Q28 切片B：暗标同样必须编页码（底端居中·连续阿拉伯数字），只把样式换成裸数字
    footerPageNumber: fmt.pageNumber,
    footerPageNumberBare: fmt.sealed,
    // Q28 切片B：暗标全黑（内置标题/超链接样式默认色改黑）
    allTextBlack: fmt.sealed,
    updateFields: fmt.toc,
  })
}

export type ReportKind = "parse" | "dup_void" | "eval"

/**
 * 循环 6 A4：报告 / 偏离表导出的页面级选项——纸张、页边距、页码从 format_settings 读取；
 * format_settings=null（存量默认）返回 undefined，导出行为与改前完全一致。
 * 正文标题/段落仍用各报告既有固定样式（最小改动，只补页面设置）。
 */
function pageOptsOf(project: BidProjectRecord, pageNumber: boolean): DocxExportOptions | undefined {
  return pageOptsFromFormatSettings(project.format_settings ?? null, { pageNumber })
}

/**
 * 循环 9 C2：纯函数——由 FormatSettings 生成页面级导出选项（方案工作台 localStorage 方案复用）；
 * fmt 空 → undefined（导出走现状默认）。sealedAware：密封口径由调用方在 pageNumber 入参体现，此函数不感知。
 */
export function pageOptsFromFormatSettings(
  fmt: FormatSettings | null | undefined,
  opts?: { pageNumber?: boolean },
): DocxExportOptions | undefined {
  if (!fmt) return undefined
  return {
    page: {
      size: PAPER_TWIPS[fmt.paper] ?? PAPER_TWIPS.A4,
      margin: {
        top: cmToTwips(fmt.margins.top),
        bottom: cmToTwips(fmt.margins.bottom),
        left: cmToTwips(fmt.margins.left),
        right: cmToTwips(fmt.margins.right),
      },
    },
    ...(opts?.pageNumber ? { footerPageNumber: true } : {}),
  }
}

/** 导出解析报告 / 检查报告 / 评标报告 Word */
/** Q28 切片A：页码锚点渲染开关——external（外部标书审查）模式下 〔P12〕 显示为「第 12 页」 */
function shouldRenderPages(project: { bid_source_mode?: unknown }): boolean {
  return String((project as { bid_source_mode?: string }).bid_source_mode ?? "") === "external"
}

export async function exportReportDocx(kind: ReportKind, project: BidProjectRecord): Promise<void> {
  const fmt = project.format_settings ?? null
  const pageOpts = pageOptsOf(project, !!fmt?.pageNumber)
  const children: Paragraph[] = []
  if (kind === "parse") {
    const rep = project.parse_report
    children.push(titlePara(`${project.project_name} 招标文件解析报告`))
    if (!rep || !rep.sections.length) {
      children.push(body("尚未生成解析报告。"))
    } else {
      rep.sections.forEach((s, i) => {
        children.push(h1(`${i + 1}. ${s.title}${s.human_edited ? "（已人工修订）" : ""}`))
        const lines = s.content
          .split(/\n+/)
          .map((l) => l.trim())
          .filter(Boolean)
        if (!lines.length) children.push(body("（本分区暂无内容）"))
        else lines.forEach((line) => children.push(body(line)))
      })
    }
    await downloadDocx(`${project.project_name}-解析报告.docx`, children, pageOpts)
    return
  }
  if (kind === "dup_void") {
    children.push(titlePara(`${project.project_name} 查重与废标检查报告`))
    children.push(h1("一、标书查重"))
    const dup = project.dup_report
    if (!dup) children.push(body("尚未执行查重。"))
    else {
      children.push(body(`对比范围：本人历史投标项目 ${dup.scanned_projects} 个；可疑段落 ${dup.suspect_count} 处。`))
      dup.pairs.forEach((pair, i) => {
        children.push(h2(`${i + 1}. ${pair.target_chapter} ↔「${pair.source_project}」${pair.source_chapter}（相似度 ${Math.round(pair.similarity * 100)}%${pair.ai_verdict ? `，AI 复判：${pair.ai_verdict}` : ""}）`))
        children.push(body(`本标书段落：${pair.target_text}`))
        children.push(body(`历史段落：${pair.source_text}`))
        if (pair.ai_note) children.push(body(`复判意见：${pair.ai_note}`))
      })
    }
    children.push(h1("二、废标项自查"))
    const vc = project.void_check
    if (!vc) children.push(body("尚未执行废标项检查。"))
    else {
      vc.items.forEach((item, i) => {
        const status = effectiveVoidStatus(item)
        children.push(h2(`${i + 1}. ${item.clause}`))
        children.push(
          body(
            `判定：${VOID_STATUS_LABEL[status]}（严重度：${SEVERITY_LABEL[item.severity]}；核销：${REVIEW_STATUS_LABEL[item.review_status]}${item.review_status === "skipped" && item.skip_reason ? `，原因：${item.skip_reason}` : ""}）${item.manual_checked ? "（已人工复核）" : ""}`,
          ),
        )
        if (item.source_location) children.push(body(`招标位置：${item.source_location}`))
        if (item.response) children.push(body(`投标文件响应：${item.response}`))
        if (item.response_location)
          children.push(
            body(
              `响应位置：${shouldRenderPages(project) ? renderPageRefs(item.response_location) : item.response_location}`,
            ),
          )
        if (item.evidence) children.push(body(`证据摘录：${item.evidence}`))
        if (item.suggestion) children.push(body(`整改建议：${item.suggestion}`))
        if (item.reason) children.push(body(`说明：${item.reason}`))
      })
    }
    await downloadDocx(`${project.project_name}-检查报告.docx`, children, pageOpts)
    return
  }
  children.push(titlePara(`${project.project_name} 模拟评标报告`))
  const ai = project.ai_review
  const manual = project.manual_review
  children.push(h1("一、AI 模拟评标"))
  if (!ai) children.push(body("尚未执行模拟评标。"))
  else {
    children.push(body(`AI 预估总分：${ai.total_score} 分`))
    ai.items.forEach((item, i) => {
      children.push(h2(`${i + 1}. ${item.scoring_item}（${item.ai_score} / ${item.max_score} 分）`))
      if (item.reason) children.push(body(`扣分理由：${item.reason}`))
      if (item.suggestion) children.push(body(`改进建议：${item.suggestion}`))
    })
    if (ai.summary) {
      children.push(h2("总体评价"))
      children.push(body(ai.summary))
    }
  }
  children.push(h1("二、人工打分"))
  if (!manual || !manual.items.length) children.push(body("尚未进行人工打分。"))
  else {
    children.push(body(`人工总分：${manual.total_score} 分`))
    manual.items.forEach((item, i) => {
      children.push(body(`${i + 1}. ${item.scoring_item}：${item.manual_score} / ${item.max_score} 分${item.comment ? `（${item.comment}）` : ""}`))
    })
  }
  await downloadDocx(`${project.project_name}-评标报告.docx`, children, pageOpts)
}

/** T18+：文本审计报告导出（错别字 + 逻辑谬误清单成档，交卷前留痕用） */
export async function exportTextAuditDocx(project: BidProjectRecord): Promise<void> {
  const fmt = project.format_settings ?? null
  const pageOpts = pageOptsOf(project, !!fmt?.pageNumber)
  const report = project.text_audit ?? null
  const children: Paragraph[] = []
  children.push(titlePara(`${project.project_name} 文本审计报告`))
  if (!report || (!report.typos.length && !report.logic.length)) {
    children.push(body("尚未执行文本审计，或本次审计未发现问题。"))
  } else {
    children.push(
      body(
        `检查对象：${report.source === "external" ? "外部投标文件全文" : "已成稿章节正文"}；检查时间：${report.checked_at ? formatDateTimeDisplay(report.checked_at) : "—"}；发现错别字 ${report.typos.length} 处、逻辑问题 ${report.logic.length} 处。错别字均经原文位置校验（逐字命中才收录）。`,
      ),
    )
    children.push(h1("一、错别字清单"))
    if (!report.typos.length) children.push(body("未发现高确信错别字。"))
    else
      report.typos.forEach((t, i) => {
        children.push(h2(`${i + 1}. 「${t.wrongText}」→「${t.correctText}」（${t.docTitle} · 第 ${t.line} 行附近）`))
        children.push(body(`原文摘录：…${t.excerpt}…`))
        children.push(body(`判定理由：${t.reason}`))
      })
    children.push(h1("二、逻辑谬误 / 前后不一致清单"))
    if (!report.logic.length) children.push(body("未发现逻辑谬误或前后不一致。"))
    else
      report.logic.forEach((l, i) => {
        children.push(h2(`${i + 1}. ${l.title}（${l.docTitle} · ${l.locationHint}）`))
        children.push(body(`原文摘录：${l.originalText}`))
        children.push(body(`问题说明：${l.fallacyReason}`))
        children.push(body(`修改建议：${l.suggestion}`))
      })
  }
  await downloadDocx(`${project.project_name}-文本审计报告.docx`, children, pageOpts)
}

function deviationCell(text: string, opts?: { bold?: boolean; width?: number }): TableCell {
  return new TableCell({
    width: opts?.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: text || "—", size: 20, bold: opts?.bold ?? false })],
      }),
    ],
  })
}

/**
 * 改造 4：独立导出技术偏离表 Word（按来源章节分组的表格：条款序号|招标要求原文|响应程度|响应内容（投标文件原文）|响应位置）
 * R52：① 响应内容列输出**投标文件原文摘录**（deviationResponseText，存量数据自动回退旧摘要）；
 *      ② 响应位置列在章-节编号之外补原文出处（evidence_ref），专家可回正文逐字核对；
 *      ③ 表头摘要行写明「一一对应」核对结论（招标条款数 ↔ 响应行数），不让人自己数。
 */
export async function exportDeviationDocx(project: BidProjectRecord): Promise<void> {
  // 循环 6 A4：偏离表属投标文件组成部分——暗标时与正文同口径不输出页码
  const devFmt = project.format_settings ?? null
  const pageOpts = pageOptsOf(project, !!devFmt && devFmt.pageNumber && !devFmt.sealed)
  const table = normalizeDeviationTable(project.response_map)
  const children: (Paragraph | Table)[] = []
  children.push(titlePara(`${project.project_name} 技术偏离表`))
  if (!table || !table.rows.length) {
    children.push(body("尚未生成技术偏离表，请先在「投标文件编制」环节生成。"))
    await downloadDocx(`${project.project_name}-技术偏离表.docx`, children, pageOpts)
    return
  }
  const full = table.rows.filter((r) => r.response_level === "full").length
  const partial = table.rows.filter((r) => r.response_level === "partial").length
  const deviation = table.rows.filter((r) => r.response_level === "deviation").length
  children.push(
    body(
      `拆分维度：${CLAUSE_GRANULARITY_LABEL[table.split_dim]}；总条款 ${table.rows.length} 条，完全响应 ${full} 条、部分响应 ${partial} 条、偏离 ${deviation} 条。`,
    ),
  )
  if (table.alignment) {
    const { clause_count, row_count, missing, duplicated } = table.alignment
    children.push(
      body(
        missing.length || duplicated.length
          ? `条款对应核对：招标要求 ${clause_count} 条、响应 ${row_count} 行；未完全对应——缺 ${missing.length} 行、重复 ${duplicated.length} 行，请回系统复核。`
          : `条款对应核对：招标要求 ${clause_count} 条 ↔ 响应 ${row_count} 行，一一对应。响应内容均为投标文件正文原文摘录。`,
      ),
    )
  }
  // 按来源章节分组导出
  const groups: { source: string; rows: DeviationRow[] }[] = []
  for (const r of table.rows) {
    const g = groups.find((x) => x.source === r.source)
    if (g) g.rows.push(r)
    else groups.push({ source: r.source || "招标技术要求", rows: [r] })
  }
  groups.forEach((g, gi) => {
    children.push(h2(`${gi + 1}. ${g.source}（${g.rows.length} 条）`))
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: [
              deviationCell("条款序号", { bold: true, width: 9 }),
              deviationCell("招标要求（原文）", { bold: true, width: 34 }),
              deviationCell("响应程度", { bold: true, width: 10 }),
              deviationCell("响应内容（投标文件原文）", { bold: true, width: 31 }),
              deviationCell("响应位置", { bold: true, width: 16 }),
            ],
          }),
          ...g.rows.map((r, ri) =>
            new TableRow({
              children: [
                // 有招标文件原编号（5.3.2 / （一））时优先展示——专家按它对回招标文件，本表内部 id 退居括号
                deviationCell(r.clause_no ? `${r.clause_no}（${r.clause_id || ri + 1}）` : r.clause_id || String(ri + 1), { width: 9 }),
                deviationCell(r.clause_text, { width: 34 }),
                deviationCell(r.response_level ? RESPONSE_LEVEL_LABEL[r.response_level] : "待人工判定", { width: 10 }),
                deviationCell(deviationExportSummary(r), { width: 31 }),
                deviationCell(
                  [r.bid_ref, r.response_node, r.evidence_ref ? `原文出处：${r.evidence_ref}` : ""].filter(Boolean).join(" "),
                  { width: 16 },
                ),
              ],
            }),
          ),
        ],
      }),
    )
  })
  await downloadDocx(`${project.project_name}-技术偏离表.docx`, children, pageOpts)
}

