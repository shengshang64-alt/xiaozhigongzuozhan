/** @vitest-environment jsdom */
// P1-5（2026-10-24）：zip 整包导入支持办公格式。
// 旧口径 zip 内只提取 md/markdown/txt，实测投标材料几乎全是 docx/pdf 压缩包——
// 弹窗承诺「整包解压保留目录结构入库」，实际拖进去只得到「zip 内没有 .md 文档」。
// 修复后办公条目递归走 parseUploadFile 顶层同一解析链（含 OOM 分流与单条容错）。
// 夹具口径沿用 docxXmlExtract.test.ts 的合成 docx（仅 word/document.xml，几 KB）。
import { describe, expect, it } from "vitest"
import { zipSync, strToU8 } from "fflate"
import { parseUploadFile, isSupportedUpload } from "./kbUpload"

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

/** 把一段 word/document.xml 正文包成合法 docx（zip）字节 */
function docxBytes(bodyXml: string): Uint8Array {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`
  return zipSync({ "word/document.xml": strToU8(xml) }, { level: 0 })
}
const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

function asFile(bytes: Uint8Array, name: string): File {
  // 同 kbUpload.ts：Uint8Array<ArrayBufferLike> 与 BlobPart 的类型收紧，运行时安全
  return new File([bytes as unknown as BlobPart], name)
}

describe("parseUploadFile · zip 整包（P1-5：办公格式支持）", () => {
  it("文本条目保留目录结构：folder_path 带子目录，标题取内部文件名，来源记 zip 包名", async () => {
    const zip = zipSync({
      "docs/方案/总纲.txt": strToU8("总纲内容"),
      "readme.md": strToU8("# 说明"),
    })
    const items = await parseUploadFile(asFile(zip, "材料包.zip"), "评审测试")
    expect(items).toHaveLength(2)
    const zong = items.find((i) => i.title === "总纲")
    expect(zong?.folder_path).toBe("评审测试/docs/方案")
    expect(zong?.doc_format).toBe("txt")
    expect(zong?.source_file_name).toBe("材料包.zip")
    const readme = items.find((i) => i.title === "readme")
    expect(readme?.folder_path).toBe("评审测试")
    expect(readme?.doc_format).toBe("md")
  })

  it("zip 内 .docx 走与顶层上传相同的解析链，提取出正文", { timeout: 15000 }, async () => {
    const zip = zipSync({
      "标书/技术方案.docx": docxBytes(p("本方案采用一体化架构。")),
    })
    const items = await parseUploadFile(asFile(zip, "投标材料.zip"), "")
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("技术方案")
    expect(items[0].doc_format).toBe("docx")
    expect(items[0].content).toContain("本方案采用一体化架构。")
    expect(items[0].source_file_name).toBe("投标材料.zip")
  })

  it("垃圾条目与嵌套 zip 跳过；单条损坏不炸整包", async () => {
    const zip = zipSync({
      "__MACOSX/meta": strToU8("junk"),
      ".DS_Store": strToU8("junk"),
      "nested/inner.zip": zipSync({ "x.txt": strToU8("x") }),
      "broken/坏文件.docx": strToU8("这不是合法的docx字节"),
      "ok/正文.txt": strToU8("正文内容"),
    })
    const items = await parseUploadFile(asFile(zip, "混合包.zip"), "")
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe("正文")
    expect(items[0].folder_path).toBe("ok")
  })

  it("全不可入库条目报新文案错误（不再只提 .md）", async () => {
    const zip = zipSync({ "a.png": strToU8("img") })
    await expect(parseUploadFile(asFile(zip, "图包.zip"), "")).rejects.toThrow(
      "zip 内没有可入库的文档",
    )
  })

  it("isSupportedUpload 口径不变（zip 与全部办公格式均受支持，legacy .doc 不支持）", () => {
    for (const n of ["a.md", "a.markdown", "a.txt", "a.docx", "a.pdf", "a.pptx", "a.xls", "a.xlsx", "a.zip"]) {
      expect(isSupportedUpload(n)).toBe(true)
    }
    expect(isSupportedUpload("a.doc")).toBe(false)
  })
})
