// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { unzipSync, strFromU8 } from "fflate"
import { exportBidDocx } from "./bidFiles"
import { classify } from "@/components/bid-workspace/bidWordPreviewLogic"
import type { BidProjectRecord } from "./bidTypes"

/**
 * REQ-053（2026-10-18）：真小节标题在**预览端与导出端必须同层级**。
 *
 * 修前：三段编号「2.5.1 阶段验收…」预览给 h3（bidWordPreviewLogic.classify 的
 * `/^\d+\.\d+\.\d+/` 分支），导出端 `isSubHeading ? h2(line)` 一律给 Heading2。
 * 用户预览看到三级、导出成文件变二级——所见非所得，且三级标题全挤进二级导致层级断档。
 * 真产物里这类标题每份几十到上百条（三明 139 / 福安约 60 / 海沧 46）。
 *
 * 本用例走**真实 exportBidDocx → 解包 word/document.xml → 读 pStyle**，不手写分支复刻，
 * 验证的是生产导出的实际产物；变异验证过（把 h3 分支改回 h2 本用例必红）。
 */
function project(): BidProjectRecord {
  return {
    id: "req053",
    project_name: "REQ-053 三段编号层级实测",
    hospital: "某某医院",
    tender_no: "2026-T-053",
    gen_options: { include_biz: false, include_tech: true },
    bid_chapters: [
      // 第 1 章占位：导出按数组下标 +1 当章号，正文编号 2.x 必须落在第 2 章
      {
        id: "c1",
        title: "项目概述",
        part: "tech",
        sections: ["建设背景"],
        content: "1.1 建设背景",
      } as never,
      {
        id: "c2",
        title: "总体建设方案",
        part: "tech",
        sections: ["概述", "架构", "部署", "集成", "数据迁移"],
        content: [
          "2.5 数据迁移",
          "本节说明数据迁移的整体安排与实施路径。",
          "2.5.1 阶段验收的具体实施安排",
          "按阶段组织验收，逐项核对交付物。",
        ].join("\n"),
      } as never,
    ],
    format_settings: null,
  } as unknown as BidProjectRecord
}

/** 捕获 downloadDocx 产出的 blob（jsdom 无真实下载），解包取 document.xml */
async function exportDocXml(proj: BidProjectRecord): Promise<string> {
  let captured: Blob | null = null
  const origCreate = URL.createObjectURL
  const origRevoke = URL.revokeObjectURL
  URL.createObjectURL = ((b: Blob) => {
    captured = b
    return "blob:test"
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  try {
    await exportBidDocx(proj)
  } finally {
    URL.createObjectURL = origCreate
    URL.revokeObjectURL = origRevoke
    clickSpy.mockRestore()
  }
  expect(captured).not.toBeNull()
  const zip = unzipSync(new Uint8Array(await (captured as unknown as Blob).arrayBuffer()))
  return zip["word/document.xml"] ? strFromU8(zip["word/document.xml"]) : ""
}

/** 按 <w:p> 切段，取出包含指定文字的段落的 pStyle（无 pStyle = 正文段落） */
function styleOf(docXml: string, needle: string): string {
  const paras = docXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []
  const hit = paras.find((p) => {
    const text = (p.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")
    return text.includes(needle)
  })
  if (!hit) return "(未找到该段落)"
  return /<w:pStyle w:val="([^"]+)"/.exec(hit)?.[1] ?? "(无pStyle=正文)"
}

describe("REQ-053 导出端真小节标题层级", () => {
  it("三段编号（2.5.1）导出为 Heading3，两段编号（2.5）导出为 Heading2", async () => {
    const xml = await exportDocXml(project())
    expect(styleOf(xml, "阶段验收的具体实施安排"), "三段编号应是三级标题").toBe("Heading3")
    expect(styleOf(xml, "2.5 数据迁移"), "两段编号应是二级标题").toBe("Heading2")
  })

  it("导出层级与预览端 classify 逐条一致（不许再出现所见非所得）", async () => {
    const sections = ["概述", "架构", "部署", "集成", "数据迁移"]
    const cases = [
      { line: "2.5 数据迁移", expect: "Heading2" },
      { line: "2.5.1 阶段验收的具体实施安排", expect: "Heading3" },
    ]
    const xml = await exportDocXml(project())
    for (const c of cases) {
      const preview = classify(c.line, sections, 2)
      const exported = styleOf(xml, c.line)
      // 预览的 h2/h3 与导出的 Heading2/Heading3 一一对应
      expect(exported, `「${c.line}」预览=${preview} 导出=${exported}，两端必须同层级`).toBe(
        preview === "h3" ? "Heading3" : "Heading2",
      )
    }
  })
})
