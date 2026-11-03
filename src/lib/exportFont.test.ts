// ---------------------------------------------------------------------------
// R62（B21 收尾）导出字体护栏 —— 源码级守卫（零模型、零 DOM）。
//
// 背景：R46 只修了投标文件导出（bidFiles.ts 逐 run 写 font），其余导出仍「裸奔」——
// 体检报告 / 讲标手册 / 报价 Word / 讲稿 Word / 售前周报 / 方案封面目录 里的 TextRun
// 不写 font 时 docx 里不会有 <w:rFonts>，Word 落到主题默认字体（中文等线 / 西文 Calibri）。
// R62 把它们统一到 src/lib/exportFont.ts：
//   - 单一字体真源 DEFAULT_RUN_FONT（标题黑体 / 正文仿宋）；
//   - 整篇默认正文 DOCX_DEFAULT_STYLES（挂 Document.styles → w:rPrDefault）。
// 本文件钉住三件事：① 字体只定义一处；② 每个 docDefaults 导出 Document 都挂了 styles；
// ③ 方案封面/目录逐 run 带 font。
//
// 反向验证（R62 报告记录）：删某文件的 styles: DOCX_DEFAULT_STYLES → 用例②红；
// 把方案封面 centered 的 font 去掉 → 用例③红。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import { countMatches, sourceText } from "@/testing/hookSources"

/** 采用「整篇 docDefaults」方案的文件：每个 new Document 都必须挂 styles: DOCX_DEFAULT_STYLES */
const DOC_DEFAULT_FILES = [
  "src/pages/BidCheck/report/toAnnotatedDocx.ts",
  "src/pages/BidWorkspace/defenseHandbook.ts",
  "src/pages/PptQuote/deckExports.ts",
  "src/pages/PptQuote/quoteExports.ts",
  "src/components/assistant/ChatStream.tsx",
]

/** 方案封面/目录没有整篇 Document 在此文件，逐 run 写 font */
const FRONT_MATTER_FILE = "src/pages/SolutionStudio/exportTemplate.ts"

/** 投标文件导出：逐 run 写 font（R46 已覆盖），但字体常量必须引用单一真源 */
const BID_FILE = "src/pages/BidWorkspace/bidFiles.ts"

describe("R62 导出字体护栏：单一真源", () => {
  it("DEFAULT_RUN_FONT 只定义在 exportFont.ts（其余导出文件不得再本地重定义）", () => {
    const def = sourceText("src/lib/exportFont.ts")
    expect(countMatches(def, /export const DEFAULT_RUN_FONT/g)).toBe(1)
    for (const f of [...DOC_DEFAULT_FILES, FRONT_MATTER_FILE, BID_FILE]) {
      expect(countMatches(sourceText(f), /const DEFAULT_RUN_FONT\s*=/g), f).toBe(0)
    }
  })

  it("docDefaults 文件：每个 new Document 都挂 styles: DOCX_DEFAULT_STYLES", () => {
    for (const f of DOC_DEFAULT_FILES) {
      const src = sourceText(f)
      const docs = countMatches(src, /new Document\(/g)
      const styled = countMatches(src, /styles:\s*DOCX_DEFAULT_STYLES/g)
      expect(docs, `${f} 应至少有一个 new Document`).toBeGreaterThanOrEqual(1)
      expect(
        styled,
        `${f} 的每个 Document 都要挂 styles: DOCX_DEFAULT_STYLES（防止以后新增导出裸奔）`,
      ).toBe(docs)
    }
  })

  it("方案封面/目录：每个 new TextRun 都带 font", () => {
    const src = sourceText(FRONT_MATTER_FILE)
    const runs = countMatches(src, /new TextRun\(/g)
    const fonts = countMatches(src, /font\s*:/g)
    expect(runs, "方案封面/目录应至少有两个 TextRun").toBeGreaterThanOrEqual(2)
    expect(fonts, "每个 TextRun 都必须显式带 font（封面/目录不得裸奔到主题默认字体）").toBe(runs)
  })

  it("投标文件导出引用单一真源（import 而非本地 const）", () => {
    const src = sourceText(BID_FILE)
    expect(src).toContain('from "@/lib/exportFont"')
    expect(countMatches(src, /const DEFAULT_RUN_FONT\s*=/g)).toBe(0)
  })
})
