// 正文编写右栏三卡（UX-v2：prototype/bid/draft.html 1:1 复刻）守卫。
//
// 钉住两条最容易回退的口径：
//   ① 三卡必须接真实计算函数（void_check / detectNumberConflicts / lintProse），
//      不许为了「看起来像原型」而写死条目或假数字；
//   ② 现网没有检测器的能力（厂商名混用 / 章节引用失效 / 术语一致率）必须如实
//      标注「未接入」，不许渲染成「已通过」。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const readSrc = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8")

const RAIL = readSrc("./ComposeRightRail.tsx")
const COMPOSE = readSrc("./ComposeStep.tsx")

describe("① 三卡接真数据源（防造假）", () => {
  it("废标风险读 void_check 的逐条判定，不写死条目", () => {
    expect(RAIL).toContain("effectiveVoidStatus")
    expect(RAIL).toContain("VOID_STATUS_LABEL")
    expect(COMPOSE).toContain("voidItems={proj.void_check?.items ?? []}")
  })

  it("一致性检查真跑跨章数字比对", () => {
    expect(RAIL).toContain("detectNumberConflicts")
    expect(RAIL).toContain("NumberConflict")
  })

  it("写作体检真跑本章文风扫描，计数取未截断 rawCounts", () => {
    expect(RAIL).toContain("lintProse")
    expect(RAIL).toContain("stats.rawCounts")
    expect(RAIL).toContain("paragraphCount")
  })
})

describe("② 无检测器的能力如实标注未接入（不冒充通过）", () => {
  it("厂商名混用 / 章节引用失效标为未接入", () => {
    expect(RAIL).toContain("厂商名混用与章节引用失效现网未接入检测器")
  })

  it("三卡都不含演示数值", () => {
    for (const fake of ["3,000", "98.7%", "5 处模板腔", "2 处数字不一致"]) {
      expect(RAIL.includes(fake), `右栏出现演示值：${fake}`).toBe(false)
    }
  })
})

describe("③ 接线：宽屏常驻右栏 + 窄屏降级到编辑器下方", () => {
  it("宽屏右栏按 废标风险 → 一致性检查 → 写作体检 顺序渲染", () => {
    const iVoid = COMPOSE.indexOf("<VoidRiskRail")
    const iCons = COMPOSE.indexOf("<ConsistencyRail")
    const iProse = COMPOSE.indexOf("<ProseCheckRail")
    expect(iVoid).toBeGreaterThan(-1)
    expect(iCons).toBeGreaterThan(iVoid)
    expect(iProse).toBeGreaterThan(iCons)
  })

  it("原「评分映射/素材弹药」双 Tab 收进折叠块，能力不丢", () => {
    expect(COMPOSE).toContain("评分映射 / 素材弹药")
    expect(COMPOSE).toContain("ScoreMappingPanel")
    expect(COMPOSE).toContain("BidMaterialAmmoPanel")
  })

  it("窄屏三卡同样可见（不因断点丢功能）", () => {
    const narrow = COMPOSE.slice(COMPOSE.indexOf("xl:hidden"))
    expect(narrow).toContain("<VoidRiskRail")
    expect(narrow).toContain("<ConsistencyRail")
    expect(narrow).toContain("<ProseCheckRail")
  })
})
