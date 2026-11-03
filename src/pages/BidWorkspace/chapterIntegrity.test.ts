// 2026-10-25（A1/A2）：章表↔大纲对账 + 落库一致性巡检的判定口径
import { describe, expect, it } from "vitest"
import {
  checkChapterIntegrity,
  normalizeChapterTitle,
  reconcileChaptersWithOutline,
  titleSimilarity,
  DUPLICATE_SIMILARITY,
  MATCH_SIMILARITY,
} from "./chapterIntegrity"

const ch = (title: string, content = "", extra: Record<string, unknown> = {}) => ({
  title,
  content,
  gen_status: "done",
  ...extra,
})

describe("normalizeChapterTitle：标题归一", () => {
  it("剥「第N章」、标点与空白，全角数字转半角", () => {
    expect(normalizeChapterTitle("第13章 培训方案")).toBe("培训方案")
    expect(normalizeChapterTitle("历史数据治理、迁移与集成方案")).toBe("历史数据治理迁移与集成方案")
    expect(normalizeChapterTitle("技术参数实质性响应（★1-★10）")).toBe("技术参数实质性响应★1★10")
    expect(normalizeChapterTitle("　5.2 应急 方案 ")).toBe("52应急方案")
  })
})

describe("titleSimilarity：精确 / 包含 / Jaccard 三档", () => {
  it("精确同名 → 1", () => {
    expect(titleSimilarity("培训方案", "第13章 培训方案")).toBe(1)
  })

  it("短标题被长标题整段包含 → 0.9（真实例：售后运维）", () => {
    const sim = titleSimilarity("售后服务、运维保障", "售后服务运维保障与质保期外运维及新增接口服务方案")
    expect(sim).toBeGreaterThanOrEqual(MATCH_SIMILARITY)
  })

  it("只差连接词的中文标题 → Jaccard 达匹配线", () => {
    const sim = titleSimilarity("项目实施、管理与协同保障方案", "项目实施组织与协同保障方案")
    expect(sim).toBeGreaterThanOrEqual(MATCH_SIMILARITY)
  })

  it("不同主题 → 低分（应急方案 vs 质量保障…应急预案）", () => {
    const sim = titleSimilarity("应急方案", "质量保障测试验收与业务连续性应急预案")
    expect(sim).toBeLessThan(MATCH_SIMILARITY)
  })
})

describe("reconcileChaptersWithOutline（A1）", () => {
  it("① 章与大纲一一对应 → 无孤儿、不阻断", () => {
    const r = reconcileChaptersWithOutline(
      [{ title: "总体技术解决方案" }, { title: "培训方案" }],
      [ch("总体技术解决方案", "正文"), ch("培训方案", "正文")],
    )
    expect(r.orphans).toHaveLength(0)
    expect(r.duplicated).toHaveLength(0)
    expect(r.blocking).toBe(false)
    expect(r.summary).toContain("一一对应")
  })

  it("② 精确同名优先占位：相似度更高的同族章不会被先到先得抢走节点", () => {
    // 「总体技术解决方案与统分结合架构设计」与节点的 Jaccard 也过线，
    // 若按数组顺序分配，会把同名章判成孤儿——贪心按分数降序可避免。
    const r = reconcileChaptersWithOutline(
      [{ title: "总体建设方案与统分结合架构设计" }],
      [ch("总体技术解决方案与统分结合架构设计", "旧稿"), ch("总体建设方案与统分结合架构设计", "新稿")],
    )
    expect(r.duplicated.map((x) => x.title)).toEqual(["总体技术解决方案与统分结合架构设计"])
    expect(r.blocking).toBe(true)
  })

  it("③ 旧大纲遗留的同主题章 → 判为重复并阻断导出（真实项目 d3c35 形态）", () => {
    const r = reconcileChaptersWithOutline(
      [{ title: "质保期外运维及新增接口服务方案" }, { title: "应急方案与业务连续性保障" }],
      [
        ch("质保期外运维及新增接口服务方案", "新", { section_stats: [{ chars: 26446 }] }),
        ch("应急方案与业务连续性保障", "新"),
        ch("应急方案", "旧稿 11560 字"),
        ch("应急预案与业务连续性保障方案", "旧稿 395 字"),
      ],
    )
    expect(r.blocking).toBe(true)
    expect(r.duplicated.map((x) => x.title).sort()).toEqual(["应急预案与业务连续性保障方案", "应急方案"].sort())
  })

  it("④ 大纲之外另起的增补章 → 只提示、不阻断", () => {
    const r = reconcileChaptersWithOutline(
      [{ title: "总体技术解决方案" }, { title: "培训方案" }],
      [ch("总体技术解决方案", "正文"), ch("培训方案", "正文"), ch("项目理解与需求分析", "正文 11124 字")],
    )
    expect(r.extra.map((x) => x.title)).toEqual(["项目理解与需求分析"])
    expect(r.blocking).toBe(false)
    expect(r.summary).toContain("增补章")
  })

  it("⑤ 无大纲或无章表 → 不误报", () => {
    expect(reconcileChaptersWithOutline([], [ch("培训方案")]).blocking).toBe(false)
    expect(reconcileChaptersWithOutline([{ title: "培训方案" }], []).blocking).toBe(false)
    expect(reconcileChaptersWithOutline(null, null).blocking).toBe(false)
  })
})

describe("checkChapterIntegrity（A2）", () => {
  it("① 假成功：done + 正文 364 字 + 统计 33776 → 阻断（真实项目形态）", () => {
    const r = checkChapterIntegrity([
      { title: "一体化核心业务系统详细技术方案", content: "x".repeat(364), gen_status: "done", section_stats: [{ chars: 6758 }, { chars: 6599 }, { chars: 7317 }, { chars: 7460 }, { chars: 5642 }] },
    ])
    expect(r.fakeDone).toHaveLength(1)
    expect(r.fakeDone[0].statsChars).toBe(33776)
    expect(r.blocking).toBe(true)
    expect(r.summary).toContain("分节产物没拼回正文")
  })

  it("② 统计漂移：正文比统计少 30% → 提示但不阻断", () => {
    const r = checkChapterIntegrity([
      { title: "项目理解与需求分析", content: "x".repeat(26365), gen_status: "done", section_stats: [{ chars: 44850 }] },
    ])
    expect(r.statsDrift).toHaveLength(1)
    expect(r.statsDrift[0].gap).toBe(18485)
    expect(r.blocking).toBe(false)
  })

  it("③ 正文比统计**长**属预期（R179 整章补足只更新正文）→ 不报", () => {
    const r = checkChapterIntegrity([
      { title: "某章", content: "x".repeat(75022), gen_status: "done", section_stats: [{ chars: 58952 }] },
    ])
    expect(r.statsDrift).toHaveLength(0)
    expect(r.blocking).toBe(false)
  })

  it("④ 无 section_stats（单次生成章）→ 跳过，不误伤", () => {
    const r = checkChapterIntegrity([
      { title: "交付地点", content: "x".repeat(722), gen_status: "done" },
      { title: "开标一览表", content: "x".repeat(250), gen_status: "done" },
    ])
    expect(r.fakeDone).toHaveLength(0)
    expect(r.statsDrift).toHaveLength(0)
    expect(r.summary).toContain("一致")
  })

  it("⑤ 未完章的短正文不算假成功（交给既有「技术章正文」项）", () => {
    const r = checkChapterIntegrity([
      { title: "某章", content: "x".repeat(300), gen_status: "pending", section_stats: [{ chars: 25000 }] },
    ])
    expect(r.fakeDone).toHaveLength(0)
  })

  it("⑥ 相似度常量与重复判定线一致（防止后续调参把两处口径改岔）", () => {
    expect(DUPLICATE_SIMILARITY).toBeLessThan(MATCH_SIMILARITY)
  })
})
