/**
 * 电子签章存在性检测（Q28 切片B · 天好 Skill 能力移植）
 *
 * 设计口径：
 *  - 语义参考 telehot-bid-compliance-check v2.0.5 seal_check 判据（Apache-2.0）；
 *    本模块为纯浏览器端独立实现，不依赖 Python 侧，使用 pdfjs-dist 公开 operator list API。
 *  - 三判据同时成立才判「疑似无签章」：贴图面积覆盖率=0 ∧ 矢量曲线 Ops=0 ∧ 无彩色填充文本绘制。
 *  - 不做 OCR / 不做图像识别，纯 opList 统计，零额外依赖。
 */
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"

// pdfjs OPS 编码（对齐 pdfjs-dist v6）
const OP_TRANSFORM = 12
const OP_CURVE_TO = 15
const OP_CURVE_TO_2 = 16
const OP_CURVE_TO_3 = 17
const OP_CONSTRUCT_PATH = 91
const OP_PAINT_IMAGE_XOBJECT = 85
const OP_PAINT_INLINE_IMAGE_XOBJECT = 86
const OP_PAINT_IMAGE_XOBJECT_REPEAT = 88
const OP_SET_FILL_RGB = 59
const OP_SET_FILL_GRAY = 57
const OP_SET_FILL_COLOR = 54
const OP_SHOW_TEXT = 44
const OP_SHOW_SPACED_TEXT = 45

const IMAGE_OPS = new Set([OP_PAINT_IMAGE_XOBJECT, OP_PAINT_INLINE_IMAGE_XOBJECT, OP_PAINT_IMAGE_XOBJECT_REPEAT])
const CURVE_OPS = new Set([OP_CURVE_TO, OP_CURVE_TO_2, OP_CURVE_TO_3])

export type PageSealStats = {
  /** 贴图 Ops 次数（paintImageXObject 系） */
  imageCount: number
  /** 估算贴图面积占页面面积百分比（0-100） */
  imageAreaPct: number
  /** 矢量曲线 Ops 总数（curveTo 系 + constructPath 中含曲线的） */
  curveCount: number
  /** 是否存在非黑色填充色的文本绘制 */
  hasNonBlackFillText: boolean
}

/**
 * 分析单页 operator list，统计签章三判据。
 * @param fnArray - pdfjs operatorList.fnArray
 * @param argsArray - pdfjs operatorList.argsArray
 * @param pageArea - 页面面积（pt²），由 page.view 计算
 */
export function analyzePageOps(
  fnArray: ArrayLike<number>,
  argsArray: (unknown[] | undefined)[],
  pageArea: number,
): PageSealStats {
  let imageCount = 0
  let imageTotalArea = 0
  let curveCount = 0
  let hasNonBlackFillText = false
  let lastFillColor: [number, number, number] | null = null // RGB normalized 0-1

  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i]
    const args = argsArray[i]

    // --- Image ops: estimate area from preceding transform ---
    if (IMAGE_OPS.has(op)) {
      imageCount++
      // 回看最近 transform 获取缩放（image 在 unit rect 上 transform 给实际尺寸）
      // args for paintImageXObject may carry { width, height } for inline images
      if (op === OP_PAINT_INLINE_IMAGE_XOBJECT && args && typeof args[0] === "object") {
        const img = args[0] as { width?: number; height?: number }
        imageTotalArea += (img.width ?? 0) * (img.height ?? 0)
      } else {
        // XObject image: look back for last transform to estimate area
        const scale = findLastTransformScale(fnArray, argsArray, i)
        imageTotalArea += scale.w * scale.h
      }
    }

    // --- Curve ops ---
    if (CURVE_OPS.has(op)) {
      curveCount++
    }
    // constructPath: args[0] is array of types for path segments; count curves in it
    if (op === OP_CONSTRUCT_PATH && args && Array.isArray(args[0])) {
      const types = args[0] as number[]
      for (const t of types) {
        if (CURVE_OPS.has(t)) curveCount++
      }
    }

    // --- Color tracking ---
    if (op === OP_SET_FILL_RGB && args && args.length >= 3) {
      lastFillColor = [Number(args[0]), Number(args[1]), Number(args[2])]
    } else if (op === OP_SET_FILL_GRAY && args && args.length >= 1) {
      const g = Number(args[0])
      lastFillColor = [g, g, g]
    } else if (op === OP_SET_FILL_COLOR && args) {
      lastFillColor = null // color space unknown, reset to conservative
    }

    // --- Non-black fill text detection ---
    if ((op === OP_SHOW_TEXT || op === OP_SHOW_SPACED_TEXT) && lastFillColor) {
      const [r, g, b] = lastFillColor
      if (r > 0.05 || g > 0.05 || b > 0.05) {
        hasNonBlackFillText = true
      }
    }
  }

  const imageAreaPct = pageArea > 0 ? Math.min(100, (imageTotalArea / pageArea) * 100) : 0

  return { imageCount, imageAreaPct, curveCount, hasNonBlackFillText }
}

/**
 * 回看 index 之前最近的 transform op，提取缩放宽高（pdf image 画在 [0,1]×[0,1]，由 CTM scale）。
 * 回看最多 6 步，找到则返回 w*h（pt²），否则返回默认 (100×100 = 保守估算)。
 */
function findLastTransformScale(
  fnArray: ArrayLike<number>,
  argsArray: (unknown[] | undefined)[],
  idx: number,
): { w: number; h: number } {
  for (let j = idx - 1; j >= Math.max(0, idx - 6); j--) {
    if (fnArray[j] === OP_TRANSFORM && argsArray[j] && argsArray[j]!.length >= 6) {
      const m = argsArray[j] as number[]
      // [a, b, c, d, e, f] → scale_x = sqrt(a²+b²), scale_y = sqrt(c²+d²)
      const w = Math.sqrt(m[0] * m[0] + m[1] * m[1])
      const h = Math.sqrt(m[2] * m[2] + m[3] * m[3])
      return { w, h }
    }
  }
  return { w: 100, h: 100 } // fallback: assume small stamp
}

/** 三判据全满足 → 疑似无签章 */
export function isSealAbsent(stats: PageSealStats): boolean {
  return stats.imageAreaPct === 0 && stats.curveCount === 0 && !stats.hasNonBlackFillText
}

/** 单页扫描结果 */
export type PageScanResult = {
  pageNo: number
  stats: PageSealStats
  sealAbsent: boolean
}

/** 整文件扫描摘要 */
export type SealScanSummary = {
  totalPages: number
  scannedPages: number
  results: PageScanResult[]
  /** 全文件签章可疑率（absent 页 / scanned 页） */
  absentRatio: number
  /** 扫描/图像页占比（有 image ops 的页 → 视为"含图"线索，参考 Skill needs_ocr） */
  imagePageRatio: number
}

/**
 * 逐页扫描 PDF，输出签章体检结果。
 * @param file - PDF 文件（File 对象）
 * @param targetPages - 指定页码数组（1-based），缺省全文件扫描
 */
export async function scanPdfForSeal(file: File, targetPages?: number[]): Promise<SealScanSummary> {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const buf = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise

  const pagesToScan = targetPages?.length
    ? targetPages.filter((p) => p >= 1 && p <= doc.numPages)
    : Array.from({ length: doc.numPages }, (_, i) => i + 1)

  const results: PageScanResult[] = []
  let absentCount = 0
  let imagePageCount = 0

  for (const pageNo of pagesToScan) {
    try {
      const page = await doc.getPage(pageNo)
      const opList = await page.getOperatorList()
      const view = page.view // [x0, y0, x1, y1]
      const pageArea = Math.abs((view[2] - view[0]) * (view[3] - view[1]))
      const stats = analyzePageOps(opList.fnArray, opList.argsArray as (unknown[] | undefined)[], pageArea)
      const sealAbsent = isSealAbsent(stats)
      results.push({ pageNo, stats, sealAbsent })
      if (sealAbsent) absentCount++
      if (stats.imageCount > 0) imagePageCount++
    } catch {
      // 异常页降级：标记为全零（不抛）
      results.push({
        pageNo,
        stats: { imageCount: 0, imageAreaPct: 0, curveCount: 0, hasNonBlackFillText: false },
        sealAbsent: true,
      })
      absentCount++
    }
  }

  const scanned = results.length
  // pdfjs 5.x 的 PDFDocumentProxy 类型未声明 destroy（运行时存在），走可选调用兼容
  const docWithDestroy = doc as unknown as { destroy?: () => Promise<unknown> }
  await docWithDestroy.destroy?.().catch(() => {})

  return {
    totalPages: doc.numPages,
    scannedPages: scanned,
    results,
    absentRatio: scanned > 0 ? absentCount / scanned : 0,
    imagePageRatio: scanned > 0 ? imagePageCount / scanned : 0,
  }
}
