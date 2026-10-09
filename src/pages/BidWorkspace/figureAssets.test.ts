import { describe, expect, it, beforeEach, vi } from "vitest"
import { addFigureTemplate, figureKindFromName, listFigureTemplates, removeFigureTemplate } from "./figureAssets"

// 2026-10 配图需求轮：图模板登记表（localStorage）纯函数侧单测
// vitest 环境为 node：用内存 localStorage stub 挂到 globalThis.window

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage
}

describe("figureAssets 图模板登记表", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: memoryStorage() })
  })

  it("空存储返回空数组", () => {
    expect(listFigureTemplates()).toEqual([])
  })

  it("新增模板落库并可读回，类别缺省 screenshot", () => {
    const next = addFigureTemplate({ name: "总体架构图", url: "http://x/a.png" })
    expect(next).toHaveLength(1)
    expect(next[0].name).toBe("总体架构图")
    expect(next[0].kind).toBe("screenshot")
    expect(listFigureTemplates()).toHaveLength(1)
    const next2 = addFigureTemplate({ name: "实施甘特图", url: "http://x/b.png", kind: "flow" })
    expect(next2[0].kind).toBe("flow")
    expect(next2).toHaveLength(2)
  })

  it("同名同 URL 去重（提到最前），不同 URL 同名共存", () => {
    addFigureTemplate({ name: "A", url: "http://x/1.png" })
    addFigureTemplate({ name: "B", url: "http://x/2.png" })
    const next = addFigureTemplate({ name: "A", url: "http://x/1.png" })
    expect(next).toHaveLength(2)
    expect(next[0].name).toBe("A")
    addFigureTemplate({ name: "A", url: "http://x/3.png" })
    expect(listFigureTemplates()).toHaveLength(3)
  })

  it("删除模板：命中移除，未命中静默", () => {
    addFigureTemplate({ name: "A", url: "http://x/1.png" })
    const [t] = listFigureTemplates()
    expect(removeFigureTemplate(t.id)).toHaveLength(0)
    expect(removeFigureTemplate("no-such-id")).toHaveLength(0)
  })

  it("按文件名猜类别", () => {
    expect(figureKindFromName("医院总体架构图.png")).toBe("architecture")
    expect(figureKindFromName("实施进度甘特.png")).toBe("flow")
    expect(figureKindFromName("门诊系统截图.png")).toBe("screenshot")
    expect(figureKindFromName("photo.jpg")).toBe("screenshot")
  })

  it("URL 为空不新增", () => {
    expect(addFigureTemplate({ name: "X", url: "  " })).toHaveLength(0)
  })
})
