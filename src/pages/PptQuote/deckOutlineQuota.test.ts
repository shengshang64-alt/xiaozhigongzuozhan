// ---------------------------------------------------------------------------
// 大纲页型配额单测（2026-11-04，B 项）
//
// 钉住三件事：
//   ① 10 页级册子的硬配额（≥1 架构 / ≥1 流程 / ≥1 KPI-对照 / bullets ≤30%）；
//   ② 校正**只改 kind**，不碰标题与内容（防止为了凑页型改标题、更不许编数字）；
//   ③ 没有结构语义可改时如实报 unmet，不假装达标。
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import type { SlidePlan } from "./pptQuoteTypes"
import {
  bulletsBudgetOf,
  enforceOutlineKindQuota,
  kindQuotaFor,
  kindQuotaRuleText,
} from "./deckOutlineQuota"

function plan(title: string, kind: SlidePlan["kind"], intent = ""): SlidePlan {
  return { id: title, title, intent, kind }
}

/** 一册「10 页全 bullets」的典型 AI 大纲（无结构语义，最坏情况） */
function flatPlan(): SlidePlan[] {
  return [
    plan("某市中医院智慧医院建设规划", "cover"),
    plan("目录", "agenda"),
    plan("现状：系统分散数据不通", "bullets", "讲现状与痛点"),
    plan("政策要求与评级压力", "bullets", "讲政策"),
    plan("我们要建什么", "bullets", "讲总体思路"),
    plan("投资估算与预算安排", "bullets", "讲预算"),
    plan("价值与成效", "bullets", "讲价值"),
    plan("保障措施", "bullets", "讲保障"),
    plan("下一步工作建议", "bullets", "讲计划"),
    plan("谢谢聆听", "summary"),
  ]
}

/** 语义齐全的混合大纲（用来验证"不瞎改"） */
function healthyPlan(): SlidePlan[] {
  return [
    plan("某市中医院智慧医院建设规划", "cover"),
    plan("目录", "agenda"),
    plan("系统分散与数据孤岛拖慢全院协作", "bullets", "痛点论述"),
    plan("一体化平台总体架构：五层两体系", "architecture", "渠道/接入/业务/能力/数据分层"),
    plan("一期夯基、二期提质、三期创优的分期路径", "flow", "一期/二期/三期节奏"),
    plan("三个关键指标的三年目标", "kpi", "评级达标率、门诊等候、运维占比"),
    plan("支撑体系", "bullets", "讲保障"),
    plan("谢谢聆听", "summary"),
  ]
}

describe("kindQuotaFor / bulletsBudgetOf · 配额口径", () => {
  it("10 页册：≥1 架构、≥1 流程、≥1 KPI-对照，纯文字≤30%", () => {
    const q = kindQuotaFor(10)
    expect(q.architectureMin).toBe(1)
    expect(q.flowMin).toBe(1)
    expect(q.dataMin).toBe(1)
    expect(q.bulletsMax).toBe(2) // contentPages=8 → floor(8*0.3)=2
  })

  it("小册子按比例折算：3 页不强制架构/流程（不逼模型编内容）", () => {
    const q = kindQuotaFor(3)
    expect(q.architectureMin).toBe(0)
    expect(q.flowMin).toBe(0)
    expect(q.dataMin).toBe(0)
  })

  it("纯文字预算随内容页线性增长，且不为负", () => {
    expect(bulletsBudgetOf(8)).toBe(2)
    expect(bulletsBudgetOf(20)).toBe(6)
    expect(bulletsBudgetOf(0)).toBe(0)
    expect(bulletsBudgetOf(-5)).toBe(0)
  })
})

describe("kindQuotaRuleText · 提示词文案与配额同源", () => {
  it("文案里出现本次页数、三类结构化页型与 30% 上限", () => {
    const text = kindQuotaRuleText(10)
    expect(text).toContain("10 页")
    expect(text).toContain('kind="architecture"')
    expect(text).toContain('kind="flow"')
    expect(text).toContain('kind="kpi"')
    expect(text).toContain('kind="table"')
    expect(text).toContain("30%")
  })

  it("小册子不写死配额，避免逼模型硬凑", () => {
    const text = kindQuotaRuleText(3)
    expect(text).not.toContain('kind="architecture"')
    expect(text).toContain("纯文字页")
  })
})

describe("enforceOutlineKindQuota · 确定性校正", () => {
  it("全 bullets 的 10 页册被补到 ≥1 架构/≥1 流程/≥1 数据页，且纯文字不超预算", () => {
    const r = enforceOutlineKindQuota(flatPlan(), 10)
    expect(r.counts.architecture).toBeGreaterThanOrEqual(1)
    expect(r.counts.flow).toBeGreaterThanOrEqual(1)
    expect(r.counts.data).toBeGreaterThanOrEqual(1)
    expect(r.counts.bullets).toBeLessThanOrEqual(bulletsBudgetOf(r.counts.contentPages))
    expect(r.converted).toBeGreaterThan(0)
  })

  it("已经达标的大纲不被乱改（title/intent 原样保留）", () => {
    const src = healthyPlan()
    const r = enforceOutlineKindQuota(src, 10)
    expect(r.counts.architecture).toBeGreaterThanOrEqual(1)
    expect(r.counts.flow).toBeGreaterThanOrEqual(1)
    expect(r.plan.map((p) => p.title)).toEqual(src.map((p) => p.title))
  })

  it("只改 kind，绝不改标题/意图/角色/id（防止为凑页型重写内容）", () => {
    const src = flatPlan()
    const r = enforceOutlineKindQuota(src, 10)
    r.plan.forEach((p, i) => {
      expect(p.id).toBe(src[i].id)
      expect(p.title).toBe(src[i].title)
      expect(p.intent).toBe(src[i].intent)
      expect(p.role).toBe(src[i].role)
    })
  })

  it("cover/agenda/summary 永远不参与改判（不把致谢页变架构图）", () => {
    const r = enforceOutlineKindQuota(flatPlan(), 10)
    expect(r.plan[0].kind).toBe("cover")
    expect(r.plan[1].kind).toBe("agenda")
    expect(r.plan[r.plan.length - 1].kind).toBe("summary")
  })

  it("有架构语义的标题优先被选为架构页（不是随便挑一页）", () => {
    const src = [
      plan("封面", "cover"),
      plan("现状痛点", "bullets", "讲现状"),
      plan("一体化平台总体蓝图", "bullets", "讲平台分层"),
      plan("保障", "bullets", "讲保障"),
      plan("致谢", "summary"),
    ]
    const r = enforceOutlineKindQuota(src, 5)
    expect(r.plan[2].kind).toBe("architecture")
  })

  it("有分期语义的标题优先被选为流程页", () => {
    const src = [
      plan("封面", "cover"),
      plan("现状痛点", "bullets", "讲现状"),
      plan("一体化平台总体蓝图", "bullets", "讲平台分层"),
      plan("一期夯基、二期提质、三期创优", "bullets", "分期实施"),
      plan("致谢", "summary"),
    ]
    const r = enforceOutlineKindQuota(src, 5)
    expect(r.plan[2].kind).toBe("architecture")
    expect(r.plan[3].kind).toBe("flow")
  })

  it("完全没有结构语义时，超额纯文字降级成对照表并如实记录（unmet 为空但注明换版面）", () => {
    const src = [
      plan("封面", "cover"),
      plan("现状 A", "bullets", "讲现状"),
      plan("现状 B", "bullets", "讲现状"),
      plan("现状 C", "bullets", "讲现状"),
      plan("现状 D", "bullets", "讲现状"),
      plan("致谢", "summary"),
    ]
    const r = enforceOutlineKindQuota(src, 6)
    // contentPages=4 → bulletsMax=1，必须把超出的纯文字页处理掉
    expect(r.counts.bullets).toBeLessThanOrEqual(1)
    expect(r.plan.some((p) => p.kind === "table")).toBe(true)
    // 数据类页型的 table 只是版面替换，notes 要说清楚
    expect(r.notes.join("\n")).toContain("维度对照表")
  })

  it("无法满足的配额写进 unmet（不假装达标）", () => {
    const src = [plan("封面", "cover"), plan("致谢", "summary")]
    const r = enforceOutlineKindQuota(src, 10)
    expect(r.counts.contentPages).toBe(0)
    expect(r.converted).toBe(0)
    // 没有内容页可改 → 配额缺口如实上报
    expect(r.unmet.length).toBeGreaterThan(0)
  })

  it("不修改入参数组（React 状态不可变）", () => {
    const src = flatPlan()
    const before = src.map((p) => p.kind)
    enforceOutlineKindQuota(src, 10)
    expect(src.map((p) => p.kind)).toEqual(before)
  })
})
