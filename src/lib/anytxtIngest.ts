// ---------------------------------------------------------------------------
// 本机文件 → 纳入知识库（2026-10-30）
//
// 场景价值：
//   用户搜到「D:\...\邳州市人民医院电子病历五级实证材料.pdf」这类文件后，
//   以前只能「打开看看」，看完就散了。纳入知识库后，这篇文档会：
//     ① 进入团队/个人知识库，被列表检索到
//     ② 自动进 FTS5 正文索引，被「正文全文检索」搜到
//     ③ 可被「问知识库」引用作答
//   等于把散落在硬盘里的历史资产，一次性转成系统资产。
//
// 数据来源：AnyTXT 的 GetRawTextByFID（已实测可取整篇正文）。
// ---------------------------------------------------------------------------

import { getPocketBaseUrl } from "@/lib/pb"
import { rawTextAnytxt, type AnytxtFile } from "@/lib/anytxtClient"
import { vibexAuthHeaders } from "@/lib/rhLogin"

export type IngestResult = { ok: true; docId: string; chars: number } | { ok: false; message: string }

/** 从文件名推断文档格式（用于 kb 的 doc_format 字段） */
function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name)
  return m ? m[1].toLowerCase() : ""
}

/** 从文件全文里抽一段有信息量的摘要（取前若干非空行，压掉表格噪声） */
function summarize(text: string, max = 220): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 4 && !/^[#\-=*_]{2,}$/.test(l))
  // 优先找像正文的行（排除大量逗号/竖线的表格行）
  const prose = lines.filter((l) => {
    const commaRatio = (l.match(/[,，|]/g) || []).length / Math.max(l.length, 1)
    return commaRatio < 0.25
  })
  const picked = (prose.length ? prose : lines).slice(0, 4).join(" ")
  return picked.slice(0, max)
}

/**
 * 把一个本机文件纳入知识库。
 *
 * @param file      搜索结果里的文件（含 id/name/path）
 * @param opts.folderPath  目标目录（默认按源文件所在目录归类）
 * @param opts.visibility  team=团队库，personal=我的笔记
 * @param opts.rawText     若调用方已有正文可直接传，省一次 RPC
 */
export async function ingestToKb(
  file: AnytxtFile,
  opts?: { folderPath?: string; visibility?: "team" | "personal"; rawText?: string },
): Promise<IngestResult> {
  // 1) 取正文
  let text = opts?.rawText ?? ""
  if (!text) {
    const r = await rawTextAnytxt(file.id)
    if (!r.ok) return { ok: false, message: r.message ?? "取文件正文失败（AnyTXT 可能未索引该文件）" }
    text = r.text ?? ""
  }
  if (!text.trim()) return { ok: false, message: "该文件没有可提取的文字（可能是纯图片扫描件，可尝试 OCR）" }

  // 2) 推断目录：默认「本机资料导入/源目录末两级」，便于用户归类
  const parts = file.path.split(/[\\/]/).filter(Boolean)
  const tail = parts.slice(Math.max(0, parts.length - 3), parts.length - 1).join("/")
  const folderPath = opts?.folderPath ?? `本机资料导入/${tail || "未分类"}`

  // 3) 写入知识库
  const title = file.name.replace(/\.[A-Za-z0-9]{1,8}$/, "") || "未命名文档"
  const payload = {
    title,
    folder_path: folderPath,
    content: text.slice(0, 500000), // 与 kb_docs.content 的 max 一致
    doc_format: extOf(file.name) || "txt",
    visibility: opts?.visibility ?? "team",
    summary: summarize(text),
    source_file_name: file.name,
    doc_category: "本机导入",
    kb_track: "本机资料",
  }
  try {
    const res = await fetch(`${getPocketBaseUrl()}/api/kb_docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
      body: JSON.stringify(payload),
    })
    const j = await res.json()
    if (!res.ok || !j?.id) {
      return { ok: false, message: j?.message ?? `写入知识库失败（HTTP ${res.status}）` }
    }
    return { ok: true, docId: String(j.id), chars: payload.content.length }
  } catch (e) {
    return { ok: false, message: `写入知识库失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 批量纳入（串行，避免 AnyTXT 与 PB 同时被打满；返回逐条结果） */
export async function ingestManyToKb(
  files: AnytxtFile[],
  opts?: { folderPath?: string; visibility?: "team" | "personal" },
): Promise<{ ok: number; failed: { name: string; message: string }[] }> {
  let ok = 0
  const failed: { name: string; message: string }[] = []
  for (const f of files) {
    const r = await ingestToKb(f, opts)
    if (r.ok) ok += 1
    else failed.push({ name: f.name, message: r.message })
  }
  return { ok, failed }
}
