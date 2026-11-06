/**
 * R4（整仓重构 · 巨型 hook 再拆一轮）**目录树回归网**。
 *
 * 这棵树原来在 `useKnowledge` 里是一个 45 行 `useMemo`，混在 1776 行 hook 中既没法单测，
 * 也没法在别处复用。搬出来之后这里钉住三条**真实踩过的**语义：
 *
 *   ① `count` 必须**自底向上汇总**——父节点要计入子孙文档数。
 *      否则会出现「根节点写 3，子目录加起来 7」：这个数字直接显示在侧栏目录旁，
 *      用户按它判断哪个目录还有多少资料，算错了就会漏翻。
 *   ② 空目录必须出现在树里——用户刚建好目录、还没传文档时，树里看不到就是「建完就没了」。
 *   ③ 同级按中文名排序（`zh-CN`）——跨机器/跨 locale 时若退化成默认排序，
 *      中文目录会跑到英文后面，已有的肌肉记忆全失效。
 */
import { describe, expect, it } from "vitest"
import { baseNameOf, buildFolderTree, collectFolderPaths, splitFolderPath } from "./kbFolderTree"

const doc = (folder_path: string) => ({ folder_path })

describe("buildFolderTree：文档目录 → 树", () => {
  it("单层目录：每个目录一个节点，根部 count = 文档总数", () => {
    const tree = buildFolderTree([doc("A"), doc("A"), doc("B")])
    expect(tree.label).toBe("全部文档")
    expect(tree.count).toBe(3)
    expect(tree.children.map((c) => c.label)).toEqual(["A", "B"])
    expect(tree.children.map((c) => c.count)).toEqual([2, 1])
  })

  it("**父节点 count 汇总子孙**（否则侧栏数字与实际份数对不上）", () => {
    const tree = buildFolderTree([doc("A/x"), doc("A/y"), doc("A/y/z"), doc("B")])
    const a = tree.children.find((c) => c.label === "A")!
    // A 自己 0 篇，子孙 3 篇
    expect(a.count).toBe(3)
    expect(a.children.find((c) => c.label === "y")!.count).toBe(2)
    expect(tree.count).toBe(4)
  })

  it("**空目录也进树**（建完目录还没传文档时必须看得到）", () => {
    const tree = buildFolderTree([doc("有文档")], ["刚建的空目录", "有文档/子空目录"])
    const empty = tree.children.find((c) => c.label === "刚建的空目录")
    expect(empty, "空目录必须出现在树里").toBeTruthy()
    expect(empty!.count).toBe(0)
    const parent = tree.children.find((c) => c.label === "有文档")!
    expect(parent.children.map((c) => c.label)).toContain("子空目录")
  })

  it("根文档（folder_path 为空）只计入根部，不产生空节点", () => {
    const tree = buildFolderTree([doc(""), doc("A")])
    expect(tree.count).toBe(2)
    expect(tree.children.map((c) => c.label)).toEqual(["A"])
  })

  it("同级按中文名排序（zh-CN 拼音序，不是码点序）", () => {
    const tree = buildFolderTree([doc("丙"), doc("甲"), doc("乙")])
    // 拼音序：丙(bing) < 甲(jia) < 乙(yi)；若退化成码点序会是「丙、乙、甲」
    expect(tree.children.map((c) => c.label)).toEqual(["丙", "甲", "乙"])
  })

  it("空输入得到一棵只有根的空树（不是 null / 不抛错）", () => {
    const tree = buildFolderTree([])
    expect(tree.count).toBe(0)
    expect(tree.children).toEqual([])
  })

  it("路径首尾多余的斜杠与空格被归一（同一目录不会裂成两个节点）", () => {
    const tree = buildFolderTree([doc("/A/B/"), doc("A/B"), doc(" A / B ")])
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].label).toBe("A")
    expect(tree.children[0].children).toHaveLength(1)
    expect(tree.children[0].count).toBe(3)
  })
})

describe("collectFolderPaths：下拉用的全部目录路径", () => {
  it("含各级目录、不含根、已排序", () => {
    const tree = buildFolderTree([doc("A/x"), doc("B")])
    expect(collectFolderPaths(tree)).toEqual(["A", "A/x", "B"])
  })

  it("空树返回空数组", () => {
    expect(collectFolderPaths(buildFolderTree([]))).toEqual([])
  })
})

describe("路径工具", () => {
  it("splitFolderPath 忽略空段", () => {
    expect(splitFolderPath("/a//b/")).toEqual(["a", "b"])
    expect(splitFolderPath("")).toEqual([])
    expect(splitFolderPath(null as unknown as string)).toEqual([])
  })

  it("baseNameOf 取末段", () => {
    expect(baseNameOf("a/b/c")).toBe("c")
    expect(baseNameOf("a")).toBe("a")
    expect(baseNameOf("")).toBe("")
  })
})
