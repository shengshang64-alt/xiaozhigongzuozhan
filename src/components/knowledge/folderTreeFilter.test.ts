/** @vitest-environment jsdom */
// P2-2：目录树整备的纯函数与存储助手——过滤（保留命中祖先链）+ 展开记忆（读写/脏值防御）。
import { afterEach, describe, expect, it } from "vitest"
import { filterFolderTree, readExpandedPrefs, writeExpandedPref } from "./folderTreeFilter"
import type { FolderNode } from "@/pages/Knowledge/useKnowledge"

function node(path: string, label: string, children: FolderNode[] = [], count = 0): FolderNode {
  return { path, label, children, count }
}

describe("filterFolderTree（P2-2）", () => {
  const tree = node("", "全部文档", [
    node("本地材料导入", "本地材料导入", [
      node("本地材料导入/客户情况库", "客户情况库", [node("本地材料导入/客户情况库/2022年区域材料", "2022年区域材料")]),
      node("本地材料导入/PPT素材", "PPT素材"),
    ]),
    node("标书范本", "标书范本", [node("标书范本/HIS系统", "HIS系统")]),
  ])

  it("空查询原样返回同一引用", () => {
    expect(filterFolderTree(tree, "")).toBe(tree)
    expect(filterFolderTree(tree, "   ")).toBe(tree)
  })
  it("命中叶子 → 保留其祖先链，剪除无关兄弟", () => {
    const out = filterFolderTree(tree, "HIS")
    expect(out.children).toHaveLength(1)
    expect(out.children[0].label).toBe("标书范本")
    expect(out.children[0].children[0].label).toBe("HIS系统")
  })
  it("命中中间节点 → 整个子树保留", () => {
    const out = filterFolderTree(tree, "客户情况库")
    expect(out.children).toHaveLength(1)
    const local = out.children[0]
    expect(local.label).toBe("本地材料导入")
    expect(local.children).toHaveLength(1)
    expect(local.children[0].children[0].label).toBe("2022年区域材料")
  })
  it("无命中 → 根的 children 为空数组（UI 显示无匹配提示）", () => {
    const out = filterFolderTree(tree, "zzz不存在的目录qqq")
    expect(out.children).toHaveLength(0)
  })
  it("大小写不敏感", () => {
    const out = filterFolderTree(tree, "his")
    expect(out.children[0].children[0].label).toBe("HIS系统")
  })
})

describe("展开状态记忆（P2-2）", () => {
  const SCOPE = "test-user:team"
  afterEach(() => {
    try {
      window.localStorage.removeItem("kb_folder_tree_expanded:" + SCOPE)
    } catch {
      /* ignore */
    }
  })

  it("无记录返回 null（走默认规则）；写入后可读回", () => {
    expect(readExpandedPrefs(SCOPE)).toBeNull()
    writeExpandedPref(SCOPE, "a/b", true)
    writeExpandedPref(SCOPE, "c", false)
    const prefs = readExpandedPrefs(SCOPE)
    expect(prefs).not.toBeNull()
    expect(prefs!["a/b"]).toBe(true)
    expect(prefs!["c"]).toBe(false)
    expect(Object.keys(prefs!)).toHaveLength(2)
  })
  it("只记忆碰过的路径：折叠一个目录不影响其它未记录目录走默认规则（in 判定）", () => {
    writeExpandedPref(SCOPE, "本地材料导入", false)
    const prefs = readExpandedPrefs(SCOPE)!
    expect("本地材料导入" in prefs).toBe(true)
    expect("标书范本" in prefs).toBe(false)
    // 组件侧 initExpanded 语义：未记录 → depth === 0（顶层默认展开），不被牵连折叠
    expect(prefs["标书范本"]).toBeUndefined()
  })
  it("同路径覆写为最新状态", () => {
    writeExpandedPref(SCOPE, "a/b", true)
    writeExpandedPref(SCOPE, "a/b", false)
    expect(readExpandedPrefs(SCOPE)!["a/b"]).toBe(false)
  })
  it("脏值防御（非对象 / 混杂类型只收布尔值 / 全脏视作无记录）", () => {
    window.localStorage.setItem("kb_folder_tree_expanded:" + SCOPE, '["a","b"]')
    expect(readExpandedPrefs(SCOPE)).toBeNull()
    window.localStorage.setItem("kb_folder_tree_expanded:" + SCOPE, JSON.stringify({ ok1: true, bad: "x", ok2: false }))
    const prefs = readExpandedPrefs(SCOPE)
    expect(prefs).not.toBeNull()
    expect(prefs!.ok1).toBe(true)
    expect(prefs!.ok2).toBe(false)
    expect("bad" in prefs!).toBe(false)
    window.localStorage.setItem("kb_folder_tree_expanded:" + SCOPE, JSON.stringify({ bad: 1 }))
    expect(readExpandedPrefs(SCOPE)).toBeNull()
  })
  it("不同 scope 互不串扰", () => {
    writeExpandedPref(SCOPE, "a", true)
    expect(readExpandedPrefs("other-user:team")).toBeNull()
  })
})
