// ---------------------------------------------------------------------------
// PPT 渲染质检（sidecar 模块，2026-10-30 补齐 5）
//
// 需求原文（§七 质量门禁）：
//   「导出后将 PPTX 渲染为页面图片，检查实际效果；只检查 JSON 字数不算完成验收。」
//
// 为什么放后端：前端**无法**把 pptx 渲染成图 —— 需要 LibreOffice 这类完整布局引擎。
// 浏览器只有 pptxgenjs（只能生成不能渲染），所以这一层必须后端做。
//
// 管线：
//   pptx 字节 → LibreOffice 转 PDF → PDF 每页转 PNG → 像素/几何检查 → 报告
//
// 依赖（都已在本机，零新增安装）：
//   · LibreOffice：C:\Program Files\LibreOffice\program\soffice.exe
//   · PDF 渲染：优先用 Python + PyMuPDF（已验证可用），无 Python 时降级
//
// 降级策略（重要）：
//   找不到 soffice / 渲染失败时**返回明确原因**，不假装通过。
//   前端据此提示「无法做渲染质检」，而不是静默放过。
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process"
import { mkdtemp, rm, readdir, readFile, writeFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { existsSync } from "node:fs"

/** LibreOffice 常见安装路径（Windows / macOS / Linux） */
const SOFFICE_CANDIDATES = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
]

function findSoffice() {
  if (process.env.ZX_SOFFICE_PATH && existsSync(process.env.ZX_SOFFICE_PATH)) return process.env.ZX_SOFFICE_PATH
  for (const p of SOFFICE_CANDIDATES) if (existsSync(p)) return p
  return null
}

/** 跑子进程并收集输出（带超时，防 LibreOffice 卡死） */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts })
    } catch (e) {
      resolve({ code: -1, stdout: "", stderr: String(e?.message ?? e) })
      return
    }
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs ?? 120_000)
    child.stdout?.on("data", (d) => {
      stdout += String(d)
    })
    child.stderr?.on("data", (d) => {
      stderr += String(d)
    })
    child.on("error", (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(e?.message ?? e) })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

// ---------------------------------------------------------------------------
// 一、pptx → pdf
// ---------------------------------------------------------------------------
async function pptxToPdf(pptxPath, outDir) {
  const soffice = findSoffice()
  if (!soffice) {
    return { ok: false, reason: "未找到 LibreOffice（soffice），无法把 PPTX 渲染成图片。请安装 LibreOffice 后重试。" }
  }
  // -env:UserInstallation 必须给独立 profile，否则多实例会抢锁
  const profile = join(outDir, "lo-profile")
  const res = await run(soffice, [
    "--headless",
    "--norestore",
    "--nolockcheck",
    `-env:UserInstallation=file:///${profile.replace(/\\/g, "/")}`,
    "--convert-to",
    "pdf",
    "--outdir",
    outDir,
    pptxPath,
  ])
  if (res.code !== 0) {
    return { ok: false, reason: `LibreOffice 转换失败（退出码 ${res.code}）：${(res.stderr || res.stdout).slice(0, 300)}` }
  }
  const files = await readdir(outDir)
  const pdf = files.find((f) => f.toLowerCase().endsWith(".pdf"))
  if (!pdf) return { ok: false, reason: `LibreOffice 未产出 PDF（stderr: ${res.stderr.slice(0, 200)}）` }
  return { ok: true, pdfPath: join(outDir, pdf) }
}

// ---------------------------------------------------------------------------
// 二、pdf → png（+ 每页像素统计）
//
// 用 Python + PyMuPDF：本机已验证可用，且能直接拿到渲染位图做像素分析。
// 没有 Python 时返回明确原因（不静默通过）。
// ---------------------------------------------------------------------------
const PY_EXTRACT = String.raw`
import sys, json, base64
try:
    import fitz
except Exception as e:
    print(json.dumps({"ok": False, "reason": "PyMuPDF 不可用: %s" % e}))
    sys.exit(0)

pdf_path = sys.argv[1]
dpi = int(sys.argv[2]) if len(sys.argv) > 2 else 96
max_pages = int(sys.argv[3]) if len(sys.argv) > 3 else 60

try:
    doc = fitz.open(pdf_path)
except Exception as e:
    print(json.dumps({"ok": False, "reason": "PDF 打不开: %s" % e}))
    sys.exit(0)

pages = []
for i in range(min(doc.page_count, max_pages)):
    page = doc[i]
    pix = page.get_pixmap(dpi=dpi)
    # 每页统计：有墨率 + 4x4 网格留白
    w, h = pix.width, pix.height
    samples = pix.samples  # bytes, RGB or RGBA
    n = pix.n  # channels
    total = w * h
    ink = 0
    grid_rows, grid_cols = 4, 4
    cell_ink = [0] * (grid_rows * grid_cols)
    cell_total = [0] * (grid_rows * grid_cols)
    cw, ch = max(1, w // grid_cols), max(1, h // grid_rows)
    for y in range(h):
        row_base = y * w * n
        gr = min(grid_rows - 1, y // ch)
        for x in range(w):
            p = row_base + x * n
            r, g, b = samples[p], samples[p+1], samples[p+2]
            lum = 0.299*r + 0.587*g + 0.114*b
            is_ink = lum < 245
            if is_ink:
                ink += 1
            gc = min(grid_cols - 1, x // cw)
            idx = gr * grid_cols + gc
            cell_total[idx] += 1
            if is_ink:
                cell_ink[idx] += 1
    blank_cells = 0
    for k in range(len(cell_ink)):
        t = cell_total[k]
        if t and (cell_ink[k] / t) < 0.005:
            blank_cells += 1
    # 只回传统计与小缩略图（避免响应过大）
    thumb = page.get_pixmap(dpi=48)
    png_b64 = base64.b64encode(thumb.tobytes("png")).decode("ascii")
    pages.append({
        "page": i + 1,
        "width": w,
        "height": h,
        "inkRatio": ink / total if total else 0,
        "blankCells": blank_cells,
        "gridCells": grid_rows * grid_cols,
        "thumb": png_b64,
    })
doc.close()
print(json.dumps({"ok": True, "pageCount": len(pages), "pages": pages}))
`

async function pdfToPageStats(pdfPath, dpi = 96, maxPages = 60) {
  const res = await run("python", ["-c", PY_EXTRACT, pdfPath, String(dpi), String(maxPages)], { timeoutMs: 180_000 })
  if (res.code !== 0) {
    return { ok: false, reason: `PDF 渲染失败（python 退出码 ${res.code}）：${res.stderr.slice(0, 300)}` }
  }
  try {
    // 取最后一行 JSON（python 可能有多余输出）
    const line = res.stdout.trim().split("\n").filter(Boolean).pop()
    return JSON.parse(line)
  } catch {
    return { ok: false, reason: `PDF 渲染输出无法解析：${res.stdout.slice(0, 200)}` }
  }
}

// ---------------------------------------------------------------------------
// 三、检查规则（与前端 deckRenderCheck.ts 同口径）
// ---------------------------------------------------------------------------
const DEFAULTS = {
  minInkRatio: 0.008, // 低于 0.8% 有墨 → 空页
  blankCellsWarn: 8, // 16 格里 ≥8 格全空 → 版面偏空
}

function checkPages(pages, opts = {}) {
  const minInk = opts.minInkRatio ?? DEFAULTS.minInkRatio
  const blankWarn = opts.blankCellsWarn ?? DEFAULTS.blankCellsWarn
  const issues = []
  for (const p of pages) {
    if (p.inkRatio < minInk) {
      issues.push({
        page: p.page,
        code: "blank_page_render",
        severity: "error",
        message: `第 ${p.page} 页渲染后几乎空白（有墨率 ${(p.inkRatio * 100).toFixed(2)}%），导出前请补充内容`,
      })
      continue
    }
    if (p.blankCells >= blankWarn) {
      issues.push({
        page: p.page,
        code: "large_blank_area",
        severity: "warn",
        message: `第 ${p.page} 页有 ${p.blankCells}/${p.gridCells} 个区域完全空白，版面偏空`,
      })
    }
  }
  const errorCount = issues.filter((i) => i.severity === "error").length
  const warnCount = issues.filter((i) => i.severity === "warn").length
  return { issues, errorCount, warnCount }
}

// ---------------------------------------------------------------------------
// 四、路由注册
// ---------------------------------------------------------------------------
export function register({ route, readJson, readBody, send }) {
  /**
   * GET /health/render — 渲染能力自检（前端据此决定是否提供"渲染质检"按钮）
   */
  route("GET", "/health/render", async (_req, res) => {
    const soffice = findSoffice()
    const py = await run("python", ["-c", "import fitz; print(fitz.__doc__)"], { timeoutMs: 15_000 })
    send(res, 200, {
      ok: Boolean(soffice) && py.code === 0,
      soffice: soffice ?? null,
      python: py.code === 0,
      pymupdf: py.code === 0,
      hint:
        !soffice
          ? "未找到 LibreOffice，无法做渲染质检"
          : py.code !== 0
            ? "未找到 Python/PyMuPDF，无法把 PDF 转成图片"
            : "可以渲染",
    })
  })

  /**
   * POST /ppt/render-check
   *
   * 请求体：{ pptxBase64: string, dpi?: number, maxPages?: number }
   * 响应：{ ok, pageCount, issues[], errorCount, warnCount, pass, pages[] }
   *
   * 说明：接收 base64 而不是文件路径——前端没有文件系统访问，
   * 且这样不依赖两边的临时目录约定。
   */
  route("POST", "/ppt/render-check", async (req, res) => {
    let dir = null
    try {
      const body = await readJson(req, 120 * 1024 * 1024)
      const b64 = String(body.pptxBase64 || "")
      if (!b64) {
        send(res, 400, { ok: false, error: "pptx_required", message: "缺少 pptxBase64" })
        return
      }
      const bytes = Buffer.from(b64, "base64")
      if (bytes.length < 1000) {
        send(res, 400, { ok: false, error: "pptx_too_small", message: "PPTX 内容过小，可能不是有效文件" })
        return
      }

      dir = await mkdtemp(join(tmpdir(), "zx-render-"))
      const pptxPath = join(dir, "deck.pptx")
      await writeFile(pptxPath, bytes)

      // Step 1: pptx → pdf
      const conv = await pptxToPdf(pptxPath, dir)
      if (!conv.ok) {
        send(res, 200, { ok: false, error: "convert_failed", message: conv.reason, pass: null })
        return
      }

      // Step 2: pdf → 每页统计
      const dpi = Math.max(48, Math.min(200, Number(body.dpi) || 96))
      const maxPages = Math.max(1, Math.min(120, Number(body.maxPages) || 60))
      const stats = await pdfToPageStats(conv.pdfPath, dpi, maxPages)
      if (!stats.ok) {
        send(res, 200, { ok: false, error: "render_failed", message: stats.reason, pass: null })
        return
      }

      // Step 3: 检查
      const { issues, errorCount, warnCount } = checkPages(stats.pages)
      send(res, 200, {
        ok: true,
        pageCount: stats.pageCount,
        issues,
        errorCount,
        warnCount,
        pass: errorCount === 0,
        // 每页缩略图与统计数据（前端可展示"渲染预览"）
        pages: stats.pages.map((p) => ({
          page: p.page,
          width: p.width,
          height: p.height,
          inkRatio: p.inkRatio,
          blankCells: p.blankCells,
          thumb: p.thumb,
        })),
      })
    } catch (e) {
      send(res, 500, { ok: false, error: "internal", message: String(e?.message ?? e) })
    } finally {
      if (dir) {
        try {
          await rm(dir, { recursive: true, force: true })
        } catch {
          /* 临时目录清理失败不影响结果 */
        }
      }
    }
  })

  /**
   * POST /ppt/render-preview — 只渲染缩略图（不检查），供"导出前预览实际效果"
   */
  route("POST", "/ppt/render-preview", async (req, res) => {
    let dir = null
    try {
      const body = await readJson(req, 80 * 1024 * 1024)
      const b64 = String(body.pptxBase64 || "")
      if (!b64) {
        send(res, 400, { ok: false, error: "pptx_required" })
        return
      }
      dir = await mkdtemp(join(tmpdir(), "zx-preview-"))
      const pptxPath = join(dir, "deck.pptx")
      await writeFile(pptxPath, Buffer.from(b64, "base64"))
      const conv = await pptxToPdf(pptxPath, dir)
      if (!conv.ok) {
        send(res, 200, { ok: false, message: conv.reason })
        return
      }
      const stats = await pdfToPageStats(conv.pdfPath, 96, 40)
      if (!stats.ok) {
        send(res, 200, { ok: false, message: stats.reason })
        return
      }
      send(res, 200, {
        ok: true,
        pageCount: stats.pageCount,
        pages: stats.pages.map((p) => ({ page: p.page, thumb: p.thumb, inkRatio: p.inkRatio })),
      })
    } catch (e) {
      send(res, 500, { ok: false, error: "internal", message: String(e?.message ?? e) })
    } finally {
      if (dir) {
        try {
          await rm(dir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }
  })
}
