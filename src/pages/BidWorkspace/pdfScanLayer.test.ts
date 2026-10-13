// R298 扫描件 PDF 输入侧：文本层缺失必须如实报告，不能静默返回空串
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { buildNoTextLayerMessage } from "./bidFiles"

const ROOT = "D:/重要文件/A重要客户情况/友商公司产品/招标材料及方案/"

// 全扫描件的真实样本（R298 审计确认：9 份 100% 无文字层）
const KNOWN_SCAN_SAMPLES = ["510附件.pdf", "A包合同.pdf", "投标业绩承诺函.pdf"]

describe("R298 扫描件文案（buildNoTextLayerMessage）", () => {
  it("全扫描件：明示页数与两条可执行出路（粘贴文本 / 先 OCR）", () => {
    const msg = buildNoTextLayerMessage([1, 2, 3, 4, 5, 6], 6, "510附件.pdf")
    expect(msg).toContain("510附件.pdf")
    expect(msg).toContain("扫描件")
    expect(msg).toContain("6 页")
    expect(msg).toContain("粘贴文本")
    expect(msg).toContain("OCR")
  })

  it("部分扫描页：给出具体页号，并说清其余页照常解析（不阻断）", () => {
    const msg = buildNoTextLayerMessage([3, 7], 40, "混合.pdf")
    expect(msg).toContain("2 页是扫描件")
    expect(msg).toContain("第 3、7 页")
    expect(msg).toContain("其余 38 页照常解析")
    expect(msg).not.toMatch(/无法提取文字，请改用/) // 不能把部分缺页说成整份不可读
  })

  it("扫描页超 20 个时折叠并报总数（避免消息被页号撑爆）", () => {
    const many = Array.from({ length: 35 }, (_, i) => i + 1)
    const msg = buildNoTextLayerMessage(many, 100, "大扫描件.pdf")
    expect(msg).toContain("35 页是扫描件")
    expect(msg).toContain("等 35 页")
    expect(msg).toContain("其余 65 页照常解析")
    // 只列前 20 个页号
    expect(msg).not.toContain("第 21 页")
  })

  it("totalPages=0（防御：解析异常时 pageCount 为 0）不得抛错", () => {
    expect(() => buildNoTextLayerMessage([], 0, "x.pdf")).not.toThrow()
    expect(buildNoTextLayerMessage([], 0, "x.pdf")).toContain("x.pdf")
  })

  it("默认文件名兜底（非 File 调用场景）", () => {
    expect(buildNoTextLayerMessage([1], 1)).toContain("该 PDF")
  })
})

describe("R298 源码事实守卫（防静默回退复发）", () => {
  const src = readFileSync(path.join(process.cwd(), "src/pages/BidWorkspace/bidFiles.ts"), "utf-8")

  it("extractPdfText 必须走 WithLayers 版并对空结果抛错", () => {
    expect(src).toContain("extractPdfTextWithLayers")
    expect(src).toMatch(/if \(totalPages > 0 && !text\) throw new Error\(buildNoTextLayerMessage/)
  })

  it("旧实现那行裸 join 不复存在（它就是静默返回空串的根因）", () => {
    // 旧代码：`return lines.join("\n").trim()` 出现在 extractPdfText 里
    expect(src).not.toMatch(/async function extractPdfText\([^)]*\)[^{]*\{\s*[\s\S]{0,900}?return lines\.join\("\\n"\)\.trim\(\)/)
  })

  it("无文字层判据按「有效字符数」而非行数（只有页码的水印页会产出一两行）", () => {
    expect(src).toContain("PAGE_TEXT_MIN_CHARS")
    expect(src).toMatch(/pageText\.replace\(\/\\s\+\/g, ""\)\.length < PAGE_TEXT_MIN_CHARS/)
  })

  it("扫描件提示只在 extractPdfText 层抛出，catch 不再混装两种原因", () => {
    // catch 里保留旧文案会让「文件坏了」与「这是扫描件」混成同一句
    expect(src).not.toContain("支持 .docx / .pdf / .txt；扫描版 PDF 无法提取文字")
    expect(src).toMatch(/支持 \.docx \/ \.pdf \/ \.txt`/)
  })
})

describe("R298 真实样本取证（55 份文件审计结论固化）", () => {
  // 递归收集：扫描件样本分布在多层子目录里（每个项目一个子目录）
  function collectPdfs(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) collectPdfs(p, out)
      else if (/\.pdf$/i.test(e.name) && !e.name.startsWith("~$")) out.push(p)
    }
    return out
  }
  const ALL = collectPdfs(ROOT)

  it("样本目录里确实存在被审计判为全扫描件的文件", () => {
    // R298 审计：55 份 PDF 中 9 份 100% 无文字层
    expect(ALL.length).toBeGreaterThanOrEqual(50)
    for (const s of KNOWN_SCAN_SAMPLES) {
      const hit = ALL.find((p) => path.basename(p) === s)
      expect(hit, s).toBeTruthy()
      expect(statSync(hit!).size).toBeGreaterThan(0)
    }
  })

  it("真实扫描件样本的字节头是 %PDF（证明确实是 PDF 而不是改名文件）", () => {
    const f = ALL.find((p) => path.basename(p) === "510附件.pdf")!
    expect(readFileSync(f).subarray(0, 5).toString("latin1").startsWith("%PDF")).toBe(true)
  })
})