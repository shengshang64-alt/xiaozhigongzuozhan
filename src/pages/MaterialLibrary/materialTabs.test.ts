/**
 * 素材库 · UX-v2 四屏拆分的口径与「不许抄原型演示数」哨兵。
 *
 * 背景：docs/ux-v2-2026-11/prototype/material/ 四个 HTML 里的数字全是**设计稿演示数据**
 * （486 个素材 / 2.0 GB / 1,284 次引用 / 未被引用 61 个 / Top5 38 次 / 导入 18.4 MB /
 *  抓取 42 / 200 / 6 主 + 6 子 …）。验收口径：「出现与原型一模一样的演示数字 → 打回」。
 *
 * 本文件钉四件事：
 *   ① 四个 SubTab 的名称与顺序 = 原型 manifest；
 *   ② 四屏源码里不许出现原型演示值（注释里引用说明允许，写进 JSX 才是缺陷）；
 *   ③ 原型 .note「拆前 / 拆后」设计说明条不许进生产；
 *   ④ 空库保留骨架——数据条 / 左分类树 / 排行卡必须在空态分支之外；
 *      且「筛选后 0 条」与「真空库」是两种空态，不能合并。
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MATERIAL_TABS, materialTabHref, parseMaterialTab } from "./materialTabs"

// 本文件位于 src/pages/MaterialLibrary/ → 仓库根上溯三级
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8")

/** 代码行（注释不算）：注释里引用原型数字做说明是允许的，写进 JSX 才是缺陷 */
function codeLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))
    })
}

const SCREEN_FILES = [
  "src/pages/MaterialLibrary/MaterialOverview.tsx",
  "src/pages/MaterialLibrary/MaterialImportScreen.tsx",
  "src/pages/MaterialLibrary/MaterialWebScreen.tsx",
  "src/pages/MaterialLibrary/MaterialSettingsScreen.tsx",
  "src/pages/MaterialLibrary/MaterialLibraryPage.tsx",
]

describe("① 四个 SubTab 的名称与顺序 = 原型 manifest", () => {
  it("标签文案逐字一致", () => {
    expect(MATERIAL_TABS.map((t) => t.label)).toEqual(["素材总览", "导入", "联网抓取", "库设置"])
  })

  it("?tab= 解析：非法值与缺省都落「素材总览」，旧链接行为不变", () => {
    expect(parseMaterialTab(null)).toBe("overview")
    expect(parseMaterialTab("garbage")).toBe("overview")
    expect(parseMaterialTab("import")).toBe("import")
    expect(parseMaterialTab("web")).toBe("web")
    expect(parseMaterialTab("settings")).toBe("settings")
    expect(materialTabHref("overview")).toBe("/materials")
    expect(materialTabHref("web")).toBe("/materials?tab=web")
  })
})

describe("② 四屏不许抄原型演示数（打回判据）", () => {
  it("list/import/web/settings 的演示值都不许出现在代码行里", () => {
    const demo = [
      /\b486\b/, // 页头徽标与数据条「486 个素材」
      /\b1,?284\b/, // 被 PPT 引用 1,284 次
      /2\.0\s?GB/, // 存储占用
      /\b18\.4\s?MB/, // 导入页 18.4 MB
      /\b42\s*\/\s*200\b/, // 抓取配额 42 / 200
      /未被引用\s*61/, // 数据条建议「未被引用 61 个」
      /\b38\s*次\b/, // Top5 榜首引用次数
      /\b2048×1365\b/, // 网格卡尺寸
      /\b3024×4032\b/, // 导入文件尺寸
      /\b2480×3508\b/, // 导入文件尺寸
      /\b30\s*天后自动清除/, // 设置页回收站保留文案
      /6\s*主\s*\+\s*6\s*子/, // 12 个分类 = 6 主 + 6 子
    ]
    for (const rel of SCREEN_FILES) {
      const lines = codeLines(read(rel))
      for (const re of demo) {
        const hits = lines.filter((l) => re.test(l))
        expect(hits, `${rel} 出现原型演示数 ${re}：\n${hits.join("\n")}`).toEqual([])
      }
    }
  })

  it("统计值全部来自 stats（真聚合），不写死常量", () => {
    const src = read("src/pages/MaterialLibrary/MaterialOverview.tsx")
    for (const field of ["stats?.total", "stats?.newThisMonth", "stats?.usageTotal", "stats?.unused", "stats?.topUsed"]) {
      expect(src, `总览页没读 ${field}`).toContain(field)
    }
  })

  it("后端 stats 走真实记录聚合：本月新增 / 引用总数 / 未被引用 / Top N", () => {
    const hook = read("pocketbase/pb_hooks/material_library.pb.js")
    expect(hook).toContain("newThisMonth")
    expect(hook).toContain("usageTotal")
    expect(hook).toContain("unused")
    expect(hook).toContain("topUsed")
    // 「本月」按真实年月前缀算，不写死月份
    expect(hook).toContain("var monthPrefix = now.getFullYear()")
    expect(hook).toContain("created.substring(0, 7) === monthPrefix")
  })

  it("排序走白名单，不把用户传的 sort 拼进 SQL", () => {
    const hook = read("pocketbase/pb_hooks/material_library.pb.js")
    expect(hook).toContain("var SORTS = {")
    expect(hook).toContain("SORTS[sortKey] || SORTS.created")
  })
})

describe("③ 原型 .note「拆前 / 拆后」说明条不许进生产", () => {
  it("四屏与页面壳里都没有拆前/拆后文案", () => {
    for (const rel of SCREEN_FILES) {
      const src = read(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 空库保留骨架，且两种空态分开", () => {
  it("数据条 / 左分类树 / 排行卡在空态分支之前（空库也看得见）", () => {
    const src = read("src/pages/MaterialLibrary/MaterialOverview.tsx")
    const emptyBranch = src.indexOf("素材库还是空的")
    expect(emptyBranch, "找不到真空库空态").toBeGreaterThan(-1)
    const databar = src.indexOf("本月新增")
    const tree = src.indexOf('label="全部素材"')
    const ranking = src.indexOf("使用排行 Top")
    expect(databar).toBeGreaterThan(-1)
    expect(tree).toBeGreaterThan(-1)
    expect(ranking).toBeGreaterThan(-1)
    // 三件骨架都渲染在网格空态之前，而不是被空态顶掉
    expect(databar).toBeLessThan(emptyBranch)
    expect(tree).toBeLessThan(emptyBranch)
    expect(ranking).toBeLessThan(emptyBranch)
  })

  it("筛选后 0 条 ≠ 库是空的：各给各的下一步", () => {
    const src = read("src/pages/MaterialLibrary/MaterialOverview.tsx")
    expect(src).toContain("当前筛选条件下没有素材")
    expect(src).toContain("清空筛选")
    // 加载中不能被渲染成「空库」（failure/loading disguised as empty）
    expect(src).toContain("itemsLoaded")
    expect(src).toContain("素材加载中")
  })

  it("回收站为空单独一态，不与空库共用文案", () => {
    const src = read("src/pages/MaterialLibrary/MaterialOverview.tsx")
    expect(src).toContain("回收站为空")
  })
})

describe("⑤ 统计未到手不许画成 0（本轮实拍抓到的缺陷）", () => {
  // 实测：设置屏先于 stats 返回渲染，页头一度显示「回收站 0 条 / 存储占用 0 B」，
  // 而真实值是 4 条 / 3.95 MB。0 会被读成「统计过了，结果是零」，与仓库
  // dataStatesGuard 的「未加载不得伪装成空」同一条底线。
  it("四屏的统计都走 statText/statBytes，不写 `?? 0`", () => {
    for (const rel of SCREEN_FILES) {
      const lines = codeLines(read(rel))
      const bad = lines.filter((l) => /stats\?\.\w+\s*\?\?\s*0/.test(l))
      expect(bad, `${rel} 把未加载的统计画成了 0：\n${bad.join("\n")}`).toEqual([])
    }
  })

  it("statText/statBytes：undefined → 「—」，真 0 → 「0」", () => {
    // 源码级校验：两个助手必须保留 undefined 分支
    const core = read("src/pages/MaterialLibrary/materialCore.ts")
    expect(core).toContain("export function statText")
    expect(core).toContain("export function statBytes")
    expect(core).toContain("typeof v === \"number\" && Number.isFinite(v)")
  })

  it("总览与设置屏确实用了这两个助手", () => {
    expect(read("src/pages/MaterialLibrary/MaterialOverview.tsx")).toContain("statText(")
    expect(read("src/pages/MaterialLibrary/MaterialOverview.tsx")).toContain("statBytes(")
    expect(read("src/pages/MaterialLibrary/MaterialSettingsScreen.tsx")).toContain("statText(")
    expect(read("src/pages/MaterialLibrary/MaterialSettingsScreen.tsx")).toContain("statBytes(")
    expect(read("src/pages/MaterialLibrary/MaterialImportScreen.tsx")).toContain("statText(")
  })
})
