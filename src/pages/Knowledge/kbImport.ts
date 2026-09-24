// 知识库「选择本地文件夹导入」：浏览器 File System Access API 递归遍历目录，
// 跳过代码/缓存/回收等噪声目录与不支持格式，保留相对路径供目录结构入库。全部本地读取，不上传原文件。

export interface PickedFile {
  file: File
  /** 相对所选根目录的子路径（不含根名），根目录下的文件为空串 */
  relFolder: string
}

const SUPPORTED_EXT_RE = /\.(md|markdown|txt|docx|pdf|pptx|xls|xlsx)$/i
// 常见代码 / 依赖 / 构建 / 缓存 / 浏览器 profile 等噪声目录，直接整段跳过
const SKIP_DIR_RE =
  /^(node_modules|\.git|\.svn|\.venv|venv|env|__pycache__|dist|build|target|out|\.next|\.nuxt|\.cache|\.vite|vendor|_edgeprofile|_pkg_verify|_wb_tmp|pb_data|pb_hooks|pb_migrations|logs|thumbnails|\.pnpm-store|site-packages)$/i
const MAX_FILE_BYTES = 40 * 1024 * 1024

export function supportsFolderImport(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function"
}

function isSkippedFile(name: string): boolean {
  return (
    name.startsWith(".") ||
    name.includes("$RECYCLE") ||
    name.includes("Thumbs.db") ||
    name.includes("desktop.ini")
  )
}

async function walk(dir: any, rel: string, out: PickedFile[]): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "directory") {
      if (name.startsWith(".") || SKIP_DIR_RE.test(name)) continue
      await walk(handle, rel ? `${rel}/${name}` : name, out)
    } else {
      if (!SUPPORTED_EXT_RE.test(name) || isSkippedFile(name)) continue
      try {
        const file: File = await handle.getFile()
        if (file.size === 0 || file.size > MAX_FILE_BYTES) continue
        out.push({ file, relFolder: rel })
      } catch {
        /* 个别文件读取失败直接跳过 */
      }
    }
  }
}

/** 打开目录选择器并遍历；用户取消返回 null */
export async function pickAndWalkFolder(): Promise<{ rootName: string; files: PickedFile[] } | null> {
  const w = window as unknown as { showDirectoryPicker?: (o?: unknown) => Promise<any> }
  if (typeof w.showDirectoryPicker !== "function") return null
  let root: any
  try {
    root = await w.showDirectoryPicker({ id: "kb-folder-import", mode: "read" })
  } catch {
    return null // 取消或权限拒绝
  }
  const files: PickedFile[] = []
  await walk(root, "", files)
  return { rootName: String(root?.name ?? "文件夹"), files }
}

/** 目标目录 = 根前缀 + 相对子路径，任一为空时优雅拼接 */
export function joinImportFolder(rootPrefix: string, relFolder: string): string {
  return [rootPrefix.trim().replace(/^\/+|\/+$/g, ""), (relFolder || "").replace(/^\/+|\/+$/g, "")]
    .filter(Boolean)
    .join("/")
}
