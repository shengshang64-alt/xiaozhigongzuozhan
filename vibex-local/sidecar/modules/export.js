// ---------------------------------------------------------------------------
// 导出后端化（第一批）
//
// 解决什么：现在 docx 是在**浏览器里**用 docx 库现生成再下载。两个问题：
//   ① 45 万字正文 + 图片全部驻留浏览器内存，大标书容易卡死/崩溃
//   ② 生成过程用户关页面就全丢，且无法重试
//
// 后端化后：前端只发「章表 + 导出配置」，后端生成 docx 字节流返回。
//   优点：不占浏览器内存、可重试、可后台跑、大文件不崩。
//
// 边界（重要）：
//   本模块**不重写** bidFiles.ts 那套排版逻辑（表格/图/题注/页眉页脚，2000+ 行，
//   重写风险极高）。它只做「同一份数据 → 同一份 docx」的服务端承载。
//   前端可先继续用旧路径，本端点作为「大文件专用通道」逐步切换。
// ---------------------------------------------------------------------------

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx"

/**
 * 极简版 docx 生成：把「章标题 + 正文段落」排成 Word。
 *
 * 刻意只做最小闭环，后续按需扩展（表格/图/题注）。
 * 目的先验证「后端生成 docx → 前端下载」这条链路通，再逐项搬排版细节。
 */
function buildSimpleDocx({ projectName = "", chapters = [], title = "投标文件" }) {
  const children = []

  // 封面标题
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400, after: 400 },
      children: [new TextRun({ text: title, bold: true, size: 44 })],
    }),
  )
  if (projectName) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 2400 },
        children: [new TextRun({ text: projectName, size: 32 })],
      }),
    )
  }

  // 逐章
  for (const ch of chapters) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 180 },
        children: [new TextRun({ text: String(ch.title ?? ""), bold: true, size: 32 })],
      }),
    )
    for (const line of String(ch.content ?? "").split(/\r?\n/)) {
      const t = line.trim()
      if (!t) continue
      children.push(
        new Paragraph({
          spacing: { after: 100, line: 360, lineRule: "auto" },
          indent: { firstLine: 480 },
          children: [new TextRun({ text: t, size: 24 })],
        }),
      )
    }
  }

  return new Document({ sections: [{ children }] })
}

export function register({ route, readJson, send }) {
  /**
   * POST /export/docx
   * body: { projectName, title, chapters: [{title, content}], fileName? }
   * 返回: docx 二进制（Content-Disposition 带文件名）
   */
  route("POST", "/export/docx", async (req, res) => {
    const body = await readJson(req)
    const chapters = Array.isArray(body.chapters) ? body.chapters : []
    if (!chapters.length) {
      send(res, 400, { error: "no_chapters", message: "chapters 为空，没有可导出的正文" })
      return
    }

    const totalChars = chapters.reduce((s, c) => s + String(c.content ?? "").length, 0)
    const t0 = Date.now()
    const doc = buildSimpleDocx({
      projectName: String(body.projectName ?? ""),
      title: String(body.title ?? "投标文件"),
      chapters,
    })
    const buf = await Packer.toBuffer(doc)
    const ms = Date.now() - t0

    const fname = String(body.fileName ?? "").trim() || "投标文件.docx"
    const encoded = encodeURIComponent(fname)
    console.log(`[export] ${chapters.length} 章 / ${totalChars} 字 → ${buf.length} 字节 / ${ms}ms`)

    send(res, 200, new Uint8Array(buf), {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "X-Export-Chapters": String(chapters.length),
      "X-Export-Chars": String(totalChars),
      "X-Export-Bytes": String(buf.length),
      "X-Export-Ms": String(ms),
    })
  })

  /**
   * POST /export/probe
   * 不生成 docx，只算「这份正文导出后大概多大、多少段」——前端用来预估进度。
   */
  route("POST", "/export/probe", async (req, res) => {
    const body = await readJson(req)
    const chapters = Array.isArray(body.chapters) ? body.chapters : []
    const totalChars = chapters.reduce((s, c) => s + String(c.content ?? "").length, 0)
    let paras = 0
    for (const c of chapters) {
      for (const line of String(c.content ?? "").split(/\r?\n/)) if (line.trim()) paras++
    }
    send(res, 200, {
      chapters: chapters.length,
      paragraphs: paras,
      chars: totalChars,
      // 粗估：正文 UTF-8 + docx 结构开销，约 1.15 倍
      estimatedBytes: Math.round(totalChars * 3 * 1.15),
    })
  })
}
