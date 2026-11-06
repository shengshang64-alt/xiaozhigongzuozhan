/**
 * 知识库**目录树构建**（纯函数，零 React / 零网络）。
 *
 * R4（整仓重构 · 巨型 hook 再拆一轮）从 `useKnowledge.ts` 搬出：
 * 这棵树的构建在 hook 里是一个 45 行的 `useMemo`，混在 1776 行里既没法单独测，
 * 也没法在别处复用（上传对话框要算目标目录、回收站要算祖先链，只能各写一遍）。
 *
 * 行为守恒纪律：**逻辑逐字搬运**，只把「闭包捕获的外部变量」改成显式入参
 * （原实现捕获 `treeDocs` 与 `extraFolders`，搬出后成为函数参数）。
 * 两个既有易踩点原样保留：
 *   ① `count` 要**自底向上汇总**（父节点计入子孙文档数），否则「全部文档 3」而子目录加起来是 7；
 *   ② 空目录（`extraFolders`，即用户刚建还没传文档的目录）也必须出现在树里，
 *      否则「刚建的目录消失了」——建完目录却看不到，是实打实的可用性 bug。
 */

/** 目录树节点。`path` 是 POSIX 相对路径（""=根），`count` 为**含子孙**的文档数。 */
export interface FolderNode {
  path: string
  label: string
  children: FolderNode[]
  count: number
}

/** 拆路径为段（忽略空段与首尾斜杠） */
export function splitFolderPath(path: string): string[] {
  return (path ?? "").split("/").map((s) => s.trim()).filter(Boolean)
}

/** 取路径末段作为显示名（"/a/b" → "b"） */
export function baseNameOf(path: string): string {
  const segs = splitFolderPath(path)
  return segs.length ? segs[segs.length - 1] : ""
}

/**
 * 用「文档所属目录 + 显式补充的空目录」构建整棵目录树。
 *
 * @param docs          参与建树的文档（调用方已按团队/个人库过滤）
 * @param extraFolders  只有目录没有文档的路径（用户新建的空目录）
 */
export function buildFolderTree(
  docs: { folder_path?: string | null }[],
  extraFolders: string[] = [],
): FolderNode {
  const root: FolderNode = { path: "", label: "全部文档", children: [], count: 0 }
  const ensure = (segments: string[]): FolderNode => {
    let node = root
    let acc = ""
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg
      let child = node.children.find((c) => c.label === seg)
      if (!child) {
        child = { path: acc, label: seg, children: [], count: 0 }
        node.children.push(child)
      }
      node = child
    }
    return node
  }
  for (const d of docs) {
    const segs = splitFolderPath(d.folder_path ?? "")
    const node = segs.length ? ensure(segs) : root
    node.count += 1
  }
  // 空目录也要进树：用户刚建好目录、还没来得及传文档时，树里必须看得到
  for (const p of extraFolders) {
    const segs = splitFolderPath(p)
    if (segs.length) ensure(segs)
  }
  // count 汇总：父节点计入子孙文档数
  const rollup = (node: FolderNode): number => {
    let total = node.count
    for (const c of node.children) total += rollup(c)
    node.count = total
    return total
  }
  for (const c of root.children) rollup(c)
  root.count = docs.length
  const sortChildren = (node: FolderNode) => {
    node.children.sort((a, b) => a.label.localeCompare(b.label, "zh-CN"))
    node.children.forEach(sortChildren)
  }
  sortChildren(root)
  return root
}

/** 树里所有非根节点路径（已按中文排序），供「移动到目录」等下拉使用。 */
export function collectFolderPaths(root: FolderNode): string[] {
  const paths = new Set<string>()
  const walk = (node: FolderNode) => {
    if (node.path) paths.add(node.path)
    node.children.forEach(walk)
  }
  walk(root)
  return [...paths].sort((a, b) => a.localeCompare(b, "zh-CN"))
}
