// R292 一键补入的致命盲区：四处「补入」只写 bid_outline，而正文生成与导出的真源是章节清单 bid_chapters，
// 覆盖核验却按大纲全深度叶子统计 —— 补入瞬间转绿、交付物里却一个字都没有（假绿）。
// 本文件锁死三件事：①条款落点归一到「章 → 节」的节层（生成唯一可见层）；②大纲与章节清单对齐只增不删；
// ③不存在「只写 bid_outline 不写 bid_chapters」的补入出口（源码扫描守卫）。纯 node fs，无需 jsdom/RTL。
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  alignChaptersWithOutline,
  buildScoringCoverageMatrix,
  clauseMatchesTitle,
  clauseToNodeTitle,
  describeOutlineSync,
  diagnoseOutlineChapterDrift,
  findTopLevelAncestorId,
  insertClauseIntoOutline,
  findNodeTitle,
  isClauseFragmentTitle,
  pickClauseFragmentNodes,
  pickChaptersToBuild,
} from "./bidTypes"
import { hasPendingSections } from "./chapterCompletion"
import type { Chapter, OutlineNode } from "@/pages/SolutionStudio/solutionTypes"

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8")

// --------------------------- 落点归一：只落在生成可见的节层 ---------------------------

describe("insertClauseIntoOutline 落点归一（R292 假绿根因之一：挂进孙层则生成/导出永不可见）", () => {
  const tree: OutlineNode[] = [
    { id: "c1", title: "售后服务方案", children: [{ id: "s1", title: "运维保障", children: [{ id: "t1", title: "驻点人员小时级响应", children: [] }] }] },
    { id: "biz1", title: "资质与证照证明", children: [], part: "biz" },
  ]
  const clause = { id: "R9", text: "中标人须保证驻点人员小时级响应并留存签到记录", source: "第五章 技术要求" }

  it("命中孙层节点时，新小节归一到所属顶层章的直接子层，孙层结构不被改写", () => {
    const next = insertClauseIntoOutline(tree, clause)
    const c1 = next.find((n) => n.id === "c1")
    expect(c1?.children.map((k) => k.id)).toContain("s1")
    // 新增节点挂在章的直接子层（第 2 个子节点），不是 s1 的孩子
    expect(c1?.children.length).toBe(2)
    expect(c1?.children[0].children.length).toBe(1)
    const added = c1?.children[1]
    expect(added?.title).toBe(clauseToNodeTitle(clause.text))
    expect(added?.children).toEqual([])
    expect(next.length).toBe(2)
  })

  it("重复补入同一条款不累加同名小节（旧实现可无限叠加）", () => {
    const once = insertClauseIntoOutline(tree, clause)
    const twice = insertClauseIntoOutline(once, clause)
    expect(twice.find((n) => n.id === "c1")?.children.length).toBe(2)
  })

  it("无任何相似命中时新建顶层技术章，插在最后一个技术章之后、不打乱商务章顺序", () => {
    const simple: OutlineNode[] = [
      { id: "c1", title: "售后服务方案", children: [] },
      { id: "biz1", title: "资质与证照证明", children: [], part: "biz" },
    ]
    const next = insertClauseIntoOutline(simple, { id: "R1", text: "区块链存证与电子签章验签要求", source: "第五章" })
    expect(next.map((n) => n.title)).toEqual(["售后服务方案", clauseToNodeTitle("区块链存证与电子签章验签要求"), "资质与证照证明"])
    expect(next[1].part).toBe("tech")
  })

  it("findTopLevelAncestorId 顶层节点返回自身、深层节点返回所属顶层章", () => {
    expect(findTopLevelAncestorId(tree, "t1")).toBe("c1")
    expect(findTopLevelAncestorId(tree, "c1")).toBe("c1")
    expect(findTopLevelAncestorId(tree, "nope")).toBe("")
  })
})

// --------------------------- 大纲 ↔ 章节清单对齐：只增不删 ---------------------------

describe("alignChaptersWithOutline（R292 补入即进正文的单一真源）", () => {
  const nodes: OutlineNode[] = [
    { id: "a", title: "章A", children: [{ id: "a1", title: "节1", children: [] }, { id: "a2", title: "节2", children: [] }] },
    { id: "b", title: "章B", children: [] },
  ]
  const chapters: Chapter[] = [
    { node_id: "a", title: "章A", sections: ["节1"], content: "已有正文", gen_status: "done", section_stats: [{ title: "节1", chars: 200 }] },
  ]

  it("缺章补为 pending、缺节追加到尾部、正文与生成状态一律不动", () => {
    const r = alignChaptersWithOutline(nodes, chapters)
    expect(r.chapters.length).toBe(2)
    expect(r.addedTitles).toEqual(["章B"])
    expect(r.refreshedCount).toBe(1)
    const a = r.chapters[0]
    expect(a.sections).toEqual(["节1", "节2"]) // 只追加不重排：section_stats 按下标对齐，重排会把成品判成待补
    expect(a.content).toBe("已有正文")
    expect(a.gen_status).toBe("done")
    expect(a.section_stats).toHaveLength(1)
    expect(r.chapters[1].gen_status).toBe("pending")
    expect(r.chapters[1].sections).toEqual([])
  })

  it("新增小节后 hasPendingSections 认出「仍有待补小节」，接上既有断点续跑通道", () => {
    const r = alignChaptersWithOutline(nodes, chapters)
    expect(hasPendingSections(r.chapters[0])).toBe(true)
    expect(hasPendingSections(chapters[0])).toBe(false)
  })

  it("id 漂移但标题已有唯一章时认作同一章，绝不新建重复章（防止重复付费与正文重复）", () => {
    const drifted: OutlineNode[] = [{ id: "new-a", title: "章A", children: [{ id: "a1", title: "节1", children: [] }] }]
    const oldChapters: Chapter[] = [{ node_id: "old-a", title: "章A", sections: ["节1"], content: "正文", gen_status: "done" }]
    const r = alignChaptersWithOutline(drifted, oldChapters)
    expect(r.chapters).toHaveLength(1)
    expect(r.addedTitles).toEqual([])
    expect(r.refreshedCount).toBe(0)
  })

  it("清单里大纲已无对应的章原样保留：宁可多一章也不删任何已有正文", () => {
    const orphan: Chapter[] = [{ node_id: "gone", title: "已删章", sections: [], content: "长正文", gen_status: "done" }]
    const r = alignChaptersWithOutline(nodes, [...chapters, ...orphan])
    expect(r.chapters.some((c) => c.node_id === "gone" && c.content === "长正文")).toBe(true)
  })

  it("幂等：对齐两次结果一致（同步按钮可重复点）", () => {
    const once = alignChaptersWithOutline(nodes, chapters)
    const twice = alignChaptersWithOutline(nodes, once.chapters)
    expect(twice.addedTitles).toEqual([])
    expect(twice.refreshedCount).toBe(0)
    expect(twice.chapters.map((c) => c.sections)).toEqual(once.chapters.map((c) => c.sections))
  })

  it("端到端口径：补入条款后落点必然进章节清单（旧实现只写大纲，清单永远没有它＝假绿）", () => {
    const base: OutlineNode[] = [{ id: "c1", title: "售后服务方案", children: [{ id: "s1", title: "运维保障", children: [] }] }]
    const oldChapters: Chapter[] = [
      { node_id: "c1", title: "售后服务方案", sections: ["运维保障"], content: "正文", gen_status: "done", section_stats: [{ title: "运维保障", chars: 3000 }] },
    ]
    // ① 无任何相似命中 → 新建顶层章必须作为 pending 章进清单（生成候选与导出都按清单取章）
    const loose = { id: "R7", text: "驻点人员小时级响应与签到留痕", source: "第五章" }
    const r1 = alignChaptersWithOutline(insertClauseIntoOutline(base, loose), oldChapters)
    expect(r1.addedTitles).toEqual([clauseToNodeTitle(loose.text)])
    expect(r1.chapters[1].gen_status).toBe("pending")
    // ② 命中既有章/节 → 归一到节层并追加进该章 sections（sections 是小节生成的唯一入口）
    const tight = { id: "R8", text: "落实运维保障驻点人员小时级响应", source: "第五章" }
    const r2 = alignChaptersWithOutline(insertClauseIntoOutline(base, tight), oldChapters)
    expect(r2.chapters.flatMap((c) => c.sections)).toContain(clauseToNodeTitle(tight.text))
    expect(r2.refreshedCount).toBe(1)
    expect(hasPendingSections(r2.chapters[0])).toBe(true)
  })
})

describe("diagnoseOutlineChapterDrift 两态（真缺章 vs id 漂移）", () => {
  const chapters: Chapter[] = [{ node_id: "old", title: "总体架构", sections: [], content: "x", gen_status: "done" }]

  it("同 id 命中不算漂移；仅标题命中记 relink（不新建重复章）；两者都无记 missing（正文必缺）", () => {
    const nodes: OutlineNode[] = [
      { id: "n1", title: "总体架构", children: [] },
      { id: "n2", title: "数据安全", children: [] },
    ]
    const d = diagnoseOutlineChapterDrift(nodes, chapters)
    expect(d.relinkTitles).toEqual(["总体架构"])
    expect(d.missingTitles).toEqual(["数据安全"])
  })

  it("商务骨架章与空标题不参与漂移诊断", () => {
    const nodes: OutlineNode[] = [
      { id: "z1", title: "投标函", children: [], part: "biz" },
      { id: "z2", title: "   ", children: [] },
    ]
    // R295 起诊断返回三态（新增 fragmentTitles），故断言落到前两态上而非整对象深比较
    const d = diagnoseOutlineChapterDrift(nodes, [])
    expect(d.missingTitles).toEqual([])
    expect(d.relinkTitles).toEqual([])
    expect(d.fragmentTitles).toEqual([])
  })
})

describe("describeOutlineSync 诚实回执（不把进不了正文写成已完成）", () => {
  it("新建章与新增小节分别报数，并给出「继续生成」只写新小节的口径", () => {
    const msg = describeOutlineSync("已把 3 条条款补入大纲", { addedTitles: ["章A", "章B", "章C", "章D"], refreshedCount: 2 })
    expect(msg).toContain("新建 4 个章节")
    expect(msg).toContain("等")
    expect(msg).toContain("待生成清单")
    expect(msg).toContain("2 个已有章节补入新小节")
    expect(msg).toContain("不重复付费")
  })
  it("无改动时如实说明无需重新生成", () => {
    expect(describeOutlineSync("章节清单已与大纲同步", { addedTitles: [], refreshedCount: 0 })).toContain("无需重新生成")
  })
})

// --------------------------- 接线守卫：四处补入出口必须同写章节清单 ---------------------------

/** 按大括号配对截取所有 updateProject({ ... }) 的对象字面量（不依赖字段顺序与换行） */
function updateProjectObjects(src: string): string[] {
  const needle = "updateProject({"
  const out: string[] = []
  let i = src.indexOf(needle)
  while (i >= 0) {
    let depth = 0
    let j = i + needle.length - 1
    for (; j < src.length; j++) {
      if (src[j] === "{") depth += 1
      else if (src[j] === "}") {
        depth -= 1
        if (depth === 0) break
      }
    }
    out.push(src.slice(i + needle.length - 1, j + 1))
    i = src.indexOf(needle, i + needle.length)
  }
  return out
}

describe("R292 接线守卫：写 bid_outline 的出口必须同时写 bid_chapters", () => {
  const hook = read("pages/BidWorkspace/useBidWorkspace.ts")

  it("所有 updateProject 对象字面量：出现 bid_outline 即出现 bid_chapters", () => {
    const objs = updateProjectObjects(hook)
    expect(objs.length).toBeGreaterThan(0)
    const bad = objs.filter((o) => o.includes("bid_outline") && !o.includes("bid_chapters"))
    expect(bad).toEqual([])
  })

  it("四处一键补入统一走 applyOutlineWithChapters（条款/评分项/招标目录/技术参数）", () => {
    expect(hook).toContain("const aligned = applyOutlineWithChapters(next)")
    expect(hook.match(/applyOutlineWithChapters\(next\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(hook).toContain("const aligned = applyOutlineWithChapters(base)")
  })

  it("批量生成进行中拒写整章清单（避开 bid_chapters 整数组与单章 PATCH 的已知竞态）", () => {
    expect(hook).toContain("if (bulkGeneratingRef.current) {")
    expect(hook).toContain("再补入/同步章节清单")
  })

  it("漂移诊断与同步动作已导出到页面，且 UI 有「同步章节清单」入口", () => {
    expect(hook).toContain("outlineChapterDrift,")
    expect(hook).toContain("syncOutlineChapters,")
    const cov = read("components/bid-workspace/OutlineCoverage.tsx")
    expect(cov).toContain("outlineChapterDrift")
    expect(cov).toContain("syncOutlineChapters")
    expect(cov).toContain("同步章节清单")
    const cs = read("components/bid-workspace/ComposeStep.tsx")
    expect(cs.match(/outlineChapterDrift=\{p\.outlineChapterDrift\}/g)?.length).toBe(2)
    expect(cs.match(/syncOutlineChapters=\{p\.syncOutlineChapters\}/g)?.length).toBe(2)
    const page = read("pages/BidWorkspace/BidWorkspacePage.tsx")
    expect(page).toContain("outlineChapterDrift={p.outlineChapterDrift}")
    expect(page).toContain("syncOutlineChapters={p.syncOutlineChapters}")
  })
})

// ---------- R292+ 补入判据自洽：标题必须能被覆盖判据自己识别；评分标注必须能被收集正则承认 ----------

describe("clauseToNodeTitle 提炼标题自覆盖（短首段向后拼接，公共子串 ≥4）", () => {
  it("「质保期：应用软件自验收通过之日起2年」提炼标题与原文公共子串 ≥4（旧实现仅 3 字假红）", () => {
    const text = "质保期：应用软件自验收通过之日起2年"
    const title = clauseToNodeTitle(text)
    expect(clauseMatchesTitle(text, title)).toBe(true)
    expect(title.startsWith("质保期")).toBe(true)
  })

  it("短首段拼接不破坏正常长条款（首段已 ≥4 字时行为不变）", () => {
    const text = "支持用户自定义配置的工作流程管理，兼容多院区"
    expect(clauseToNodeTitle(text)).toBe("支持用户自定义配置的工作流程管理")
  })

  it("全条款无一段 ≥4 字时返回非空标题且不抛错", () => {
    const title = clauseToNodeTitle("系统：应可靠")
    expect(title.length).toBeGreaterThan(0)
    expect(clauseMatchesTitle("系统：应可靠", title)).toBe(true)
  })
})

describe("评分项补入章节的 description 标注格式（collectResponseAnnotations 只认方括号 [响应:Rx]）", () => {
  it("[响应:R7] 标注的章节在评分矩阵中 covered=true", () => {
    const outline: OutlineNode[] = [
      {
        id: "n1",
        title: "护理系统功能证明",
        children: [],
        part: "tech",
        description: "[响应:R7] 评分项补入（2 分）",
      },
    ]
    const items = [
      { id: "R7", item: "护理系统功能证明", score: 2, category: "tech" as const, isSubjective: false, criteria: "" },
      { id: "R8", item: "其他项", score: 3, category: "tech" as const, isSubjective: false, criteria: "" },
    ]
    const matrix = buildScoringCoverageMatrix(outline, items)
    expect(matrix.find((e) => e.item.id === "R7")?.coveredBy).toEqual(["护理系统功能证明"])
    expect(matrix.find((e) => e.item.id === "R8")?.coveredBy).toEqual([])
  })

  it("源码守卫：addUncoveredScoringToOutline 的 description 必须用 [响应:id] 方括号格式", () => {
    const hook = read("pages/BidWorkspace/useBidWorkspace.ts")
    expect(hook).not.toContain("响应评分项 ${m.id}")
    expect(hook).toContain("[响应:${m.id}]")
  })
})

// ---------- R294 确认大纲的破坏性覆盖必须有二次确认（误点一次=清空全部正文） ----------

describe("R294「确认大纲」清空既有正文的二次确认", () => {
  const compose = read("components/bid-workspace/ComposeStep.tsx")

  it("按钮不得直接调confirmOutline（必须先过二次确认闸）", () => {
    expect(compose).not.toMatch(/onClick=\{p\.confirmOutline\}/)
  })

  it("闸门口径：按 content 非空统计已成稿章节（无正文的新项目仍一键确认，零打扰）", () => {
    expect(compose).toContain("confirmOutlineGuard")
    expect(compose).toMatch(/\(c\.content \?\? ""\)\.trim\(\)\.length > 0/)
    expect(compose).toContain("setConfirmOutlineGuard({")
  })

  it("弹窗必须如实报出将清空的章数与字数，并给出替代路径（补入/同步不删正文）", () => {
    expect(compose).toContain("确认大纲会清空已生成正文")
    expect(compose).toContain("confirmOutlineGuard?.chapters")
    expect(compose).toContain("confirmOutlineGuard?.words")
    expect(compose).toContain("一键补入 / 同步章节清单")
  })

  it("确认路径：弹窗二次按钮才真正调 confirmOutline（取消路径不调）", () => {
    // 两处显式调用：一处是无正文直通、一处是弹窗内「清空并重建」
    const calls = compose.match(/p\.confirmOutline\(\)/g) ?? []
    expect(calls.length).toBe(2)
    expect(compose).toContain("清空并重建")
    expect(compose).toContain("取消（改用补入）")
  })

  it("源码事实守卫：confirmOutline 仍是全量重建（本次只加确认闸，未偷改重建语义）", () => {
    const hook = read("pages/BidWorkspace/useBidWorkspace.ts")
    // content: "" + gen_status: "pending" 的重建写法必须仍在（若被改成保留正文，本测试提醒复核口径变更）
    expect(hook).toMatch(/content: ""/)
    expect(hook).toMatch(/gen_status: "pending" as const/)
  })
})

// ---------- R295 条款碎片顶层节点：同步章节清单时必须跳过，否则生成 74 章「交付地点」式垃圾 ----------

describe("R295 条款碎片识别（isClauseFragmentTitle）", () => {
  it("商务约束标签判为碎片：招标条款的小标题，不是章节名", () => {
    for (const t of ["交付地点", "验收要求", "质保期", "实施周期", "是否邀请投标人验收", "招标要求响应", "试运行"]) {
      expect(isClauseFragmentTitle(t), t).toBe(true)
    }
  })

  it("黑名单按「整名或标签+分隔符」命中，不以开头就算——真章节名常以标签词开头", () => {
    // 2026-10-15 用户实测事故：真章节「质保期外运维及新增接口服务方案」（评分项 R8、挂 6 个小节）
    // 以「质保期」开头，被按前缀判成条款碎片 → 「确认大纲」建章时整章被跳过，用户以为小节点丢了。
    for (const t of ["质保期外运维及新增接口服务方案", "质保期外运维服务范围界定", "验收要求与测试方案", "交付地点确认与验收流程"]) {
      expect(isClauseFragmentTitle(t), t).toBe(false)
    }
    // 标签本身与「标签+分隔符」仍按碎片拦
    for (const t of ["质保期", "质保期：三年", "交付地点：", "验收要求（含试运行）"]) {
      expect(isClauseFragmentTitle(t), t).toBe(true)
    }
  })

  it("句读残缺判为碎片：从长句中途截断的痕迹（真章节名不会这样结尾）", () => {
    for (const t of ["供应商应按照招标文件、合同在规定时间内", "确需更换的", "维护期满后", "驻点人员离职或调离的"]) {
      expect(isClauseFragmentTitle(t), t).toBe(true)
    }
  })

  it("长句数字后无单位判为碎片", () => {
    expect(isClauseFragmentTitle("供应商收到招标人支付第一阶段款之日起60")).toBe(true)
  })

  it("真章节名不得被误伤（回归优先：宁可漏拦也不误伤）", () => {
    const real = [
      "项目理解与总体建设方案",
      "医院信息管理系统（HIS）建设方案",
      "电子病历系统（EMR）建设方案",
      "临床协同与辅助系统建设方案",
      "项目实施组织与进度计划",
      "质量保障与测试验收方案",
      "培训方案与知识转移",
      "售后服务与运维保障方案",
      "应急响应与安全保障方案",
      "技术需求要点",
    ]
    for (const t of real) expect(isClauseFragmentTitle(t), t).toBe(false)
  })

  it("pickClauseFragmentNodes 只摘顶层技术章里的碎片（商务章与真章节都不误伤）", () => {
    const picked = pickClauseFragmentNodes([
      { id: "k", title: "项目理解与总体建设方案", children: [] },
      { id: "f", title: "交付地点", children: [] },
      { id: "b", title: "投标函", children: [], part: "biz" },
      { id: "e", title: "  ", children: [] },
    ])
    expect(picked.map((n) => n.title)).toEqual(["交付地点"])
  })

  it("空标题判为碎片（不可建章）", () => {
    expect(isClauseFragmentTitle("")).toBe(true)
    expect(isClauseFragmentTitle("   ")).toBe(true)
  })
})

describe("R295 同步章节清单时跳过碎片（防止把脏数据固化成章）", () => {
  const outline: OutlineNode[] = [
    { id: "k1", title: "项目理解与总体建设方案", children: [{ id: "s1", title: "建设背景", children: [] }], part: "tech" },
    { id: "k2", title: "售后运维", children: [] },
    { id: "f1", title: "交付地点", children: [] },
    { id: "f2", title: "验收要求", children: [] },
    { id: "f3", title: "供应商应按照招标文件、合同在规定时间内", children: [{ id: "x", title: "子", children: [] }] },
    { id: "biz", title: "投标函", children: [], part: "biz" },
  ]

  it("默认跳过碎片：只为真章节建章，碎片刻意不建（商务骨架章照常成章——R292 设计如此）", () => {
    const r = alignChaptersWithOutline(outline, [])
    expect(r.chapters.map((c) => c.title)).toEqual(["项目理解与总体建设方案", "售后运维", "投标函"])
    expect(r.addedTitles).toEqual(["项目理解与总体建设方案", "售后运维", "投标函"])
    expect(r.skippedFragments).toEqual(["交付地点", "验收要求", "供应商应按照招标文件、合同在规定时间内"])
  })

  it("碎片节点即便有子节点也不建章（子节点不会跟着进正文）", () => {
    const r = alignChaptersWithOutline(outline, [])
    expect(r.chapters.some((c) => c.title.includes("供应商应按照"))).toBe(false)
    expect(r.chapters.some((c) => c.title === "子")).toBe(false)
  })

  it("opt-out 通道存在（宁可漏拦也不误伤：显式关掉即恢复旧行为，便于人工判定的场景）", () => {
    const r = alignChaptersWithOutline(outline, [], { skipFragments: false })
    expect(r.chapters.map((c) => c.title)).toContain("交付地点")
    expect(r.skippedFragments).toEqual([])
  })

  it("跳过碎片不破坏「只增不删」：清单里的既有章原样保留", () => {
    const existing: Chapter[] = [
      { node_id: "keep", title: "历史章（大纲已无对应）", sections: [], content: "已有正文不得丢", gen_status: "done" },
    ]
    const r = alignChaptersWithOutline(outline, existing)
    expect(r.chapters.some((c) => c.content === "已有正文不得丢")).toBe(true)
  })

  it("幂等：连跑两次结果一致（碎片不会被第一次跑「顺手成章」后第二次又判缺）", () => {
    const a = alignChaptersWithOutline(outline, [])
    const b = alignChaptersWithOutline(outline, a.chapters)
    expect(b.addedTitles).toEqual([])
    expect(b.chapters).toEqual(a.chapters)
    expect(b.skippedFragments).toEqual(a.skippedFragments)
  })
})

describe("R295 诊断三态分离：碎片不是「清单缺章」（混进去会诱导用户点同步把垃圾固化）", () => {
  it("碎片进 fragmentTitles，且不出现在 missingTitles", () => {
    const d = diagnoseOutlineChapterDrift(
      [
        { id: "k1", title: "项目理解与总体建设方案", children: [] },
        { id: "f1", title: "交付地点", children: [] },
        { id: "f2", title: "质保期", children: [] },
        { id: "r1", title: "已有章", children: [] },
      ],
      [{ node_id: "r1", title: "已有章", sections: [], content: "", gen_status: "pending" }],
    )
    expect(d.missingTitles).toEqual(["项目理解与总体建设方案"])
    expect(d.fragmentTitles).toEqual(["交付地点", "质保期"])
    expect(d.relinkTitles).toEqual([])
  })
})

describe("R295 回执必须如实报出「跳过了碎片」（否则用户以为同步失败会反复重试）", () => {
  it("skippedFragments 非空时文案点明数量与「跳过不建章」", () => {
    const msg = describeOutlineSync("已同步", {
      addedTitles: ["售后运维"],
      refreshedCount: 0,
      skippedFragments: ["交付地点", "验收要求"],
    })
    expect(msg).toContain("新建 1 个章节")
    expect(msg).toContain("2 个大纲节点是招标条款原文")
    expect(msg).toContain("已跳过不建章")
  })

  it("无碎片时不提碎片（不制造噪音）", () => {
    const msg = describeOutlineSync("已同步", { addedTitles: ["售后运维"], refreshedCount: 0, skippedFragments: [] })
    expect(msg).not.toContain("条款原文")
  })
})

describe("R295 UI 接线守卫（碎片提示条必须可达，且只提示不代删）", () => {
  const ui = read("components/bid-workspace/OutlineCoverage.tsx")

  it("props 与渲染条件都纳入 fragmentTitles（否则碎片永不可见）", () => {
    expect(ui).toContain("fragmentTitles: string[]")
    expect(ui).toContain("outlineChapterDrift.fragmentTitles ?? []")
    expect(ui).toContain("!driftFragments.length")
  })

  it("碎片提示条明示「同步会自动跳过」且指引人工删除（不提供自动删除按钮）", () => {
    expect(ui).toContain("同步章节清单会")
    expect(ui).toContain("自动跳过")
    // R297：字面文案两代并存——R295「手动删除」/R299「逐条人工删除入口」，口径等价（均为人工处理指引，无自动批量删除）
    expect(ui).toMatch(/手动删除|人工删除|人工清理/)
  })
})

// ---------- R297「确认大纲」出口同样不得把碎片建章（R295 只堵了同步出口，确认出口还开着：全量重建 1:1 把碎片固化成 pending 章） ----------

describe("R297 pickChaptersToBuild（确认大纲出口的建章前置过滤）", () => {
  const nodes: OutlineNode[] = [
    { id: "k1", title: "项目理解与总体建设方案", children: [], part: "tech" },
    { id: "f1", title: "交付地点", children: [] },
    { id: "f2", title: "供应商应按照招标文件、合同在规定时间内", children: [] },
    { id: "e", title: "   ", children: [] },
    { id: "biz", title: "投标函", children: [], part: "biz" },
  ]

  it("只返回应建章节点：真章节与商务章保留、碎片与空标题摘除", () => {
    const r = pickChaptersToBuild(nodes)
    expect(r.build.map((n) => n.id)).toEqual(["k1", "biz"])
    expect(r.fragmentTitles).toEqual(["交付地点", "供应商应按照招标文件、合同在规定时间内"])
  })

  it("碎片判据与 pickClauseFragmentNodes 同源（不允许出现第二套口径，两边行为必须一致）", () => {
    expect(pickChaptersToBuild(nodes).fragmentTitles).toEqual(pickClauseFragmentNodes(nodes).map((n) => n.title))
  })

  it("全碎片的脏数据项目返回空 build → 调用方必须拦下而不是写空章节清单把整本书打空", () => {
    const r = pickChaptersToBuild([{ id: "f", title: "验收要求", children: [] }])
    expect(r.build).toEqual([])
    expect(r.fragmentTitles).toEqual(["验收要求"])
  })
})

describe("R297 confirmOutline 接线守卫（堵上确认出口的两个洞：碎片建章 + 批量生成竞态）", () => {
  const hook = read("pages/BidWorkspace/useBidWorkspace.ts")
  const start = hook.indexOf("const confirmOutline = useCallback")
  const seg = hook.slice(start, hook.indexOf("}, [outlineDraft, updateProject, writeStageSnapshot]", start))

  it("建章必须走 pickChaptersToBuild，不得再 filled.map 1:1 全建（旧实现把碎片固化成章）", () => {
    expect(seg).toContain("pickChaptersToBuild(filled)")
    expect(seg).not.toContain("const chapters: Chapter[] = filled.map")
  })

  it("过滤后无可建章必须拒写（不写入空章节清单）", () => {
    expect(seg).toContain("if (!build.length)")
  })

  it("批量生成中拒写：confirmOutline 是 bid_chapters 整数组覆盖，会踩掉在途单章 PATCH（与 applyOutlineWithChapters 同源裁定）", () => {
    expect(seg).toContain("bulkGeneratingRef.current")
  })

  it("回执如实报未建章的碎片（否则用户以为确认漏章而反复确认）", () => {
    expect(seg).toContain("fragmentTitles.length")
    expect(seg).toContain("不是章节，未为其建章")
  })

  it("确认的全量重建语义不变：content 清空 + gen_status 回 pending（R294 裁定口径未被顺手改）", () => {
    expect(seg).toContain('content: "",')
    expect(seg).toContain('gen_status: "pending" as const')
  })

  it("bid_outline 仍写整棵树：碎片节点不删（破坏性清理交人工，既有裁定）", () => {
    expect(seg).toContain("updateProject({ bid_outline: filled, bid_chapters: chapters")
  })
})

// ---------- R299 大纲删除必须落库（74 个碎片一直删不掉的根因） ----------

describe("R299 findNodeTitle（删除前回显节点名）", () => {
  const tree: OutlineNode[] = [
    { id: "k1", title: "项目理解与总体建设方案", children: [{ id: "s1", title: "建设背景", children: [] }] },
    { id: "f1", title: "交付地点", children: [] },
  ]
  it("顶层节点命中返回其标题", () => {
    expect(findNodeTitle(tree, "f1")).toBe("交付地点")
  })
  it("深层子节点也能命中（R299 用于删除任意层级节点）", () => {
    expect(findNodeTitle(tree, "s1")).toBe("建设背景")
  })
  it("未命中返回空串（不抛错，由调用方给通用文案）", () => {
    expect(findNodeTitle(tree, "nope")).toBe("")
    expect(findNodeTitle([], "k1")).toBe("")
  })
})

describe("R299 诊断带出 fragmentNodes（删除必须按 id，不能按标题）", () => {
  it("fragmentNodes 带 id + title + childCount，且与 fragmentTitles 同序同长", () => {
    const d = diagnoseOutlineChapterDrift(
      [
        { id: "k1", title: "项目理解与总体建设方案", children: [] },
        { id: "f1", title: "交付地点", children: [] },
        { id: "f2", title: "质保期", children: [{ id: "x", title: "子", children: [] }] },
      ],
      [{ node_id: "k1", title: "项目理解与总体建设方案", sections: [], content: "", gen_status: "pending" }],
    )
    expect(d.fragmentNodes).toEqual([
      { id: "f1", title: "交付地点", childCount: 0 },
      { id: "f2", title: "质保期", childCount: 1 },
    ])
    expect(d.fragmentTitles).toEqual(d.fragmentNodes.map((n) => n.title))
    expect(d.missingTitles).toEqual([])
  })

  it("同名碎片各自独立成条（实测存在 14 个同名「招标要求响应」）——按 id 删才不会一次干掉多条", () => {
    const dup = Array.from({ length: 14 }, (_, i) => ({ id: `d${i}`, title: "招标要求响应", children: [] }))
    const d = diagnoseOutlineChapterDrift(dup, [])
    expect(d.fragmentNodes.length).toBe(14)
    expect(new Set(d.fragmentNodes.map((n) => n.id)).size).toBe(14)
  })
})

describe("R299 源码事实守卫：删除落库 + UI 逐条清理入口", () => {
  const hook = read("pages/BidWorkspace/useBidWorkspace.ts")
  const ui = read("components/bid-workspace/OutlineCoverage.tsx")
  const compose = read("components/bid-workspace/ComposeStep.tsx")

  it("outlineRemove 必须落库（旧实现只 setOutlineDraft，关页面即丢）", () => {
    expect(hook).toMatch(/const outlineRemove = useCallback\(/)
    expect(hook).toMatch(/if \(!applyOutlineWithChapters\(next\)\) return/)
    expect(hook).toContain("已从大纲删除")
  })

  it("删除走 applyOutlineWithChapters（同一次 PATCH 同写两字段，正文真源不脱节）", () => {
    expect(hook).toMatch(/alignChaptersWithOutline\(nextOutline, cur\?\.bid_chapters \?\? \[\]\)/)
  })

  it("UI 提供逐条删除按钮，且删除区默认收起（74 个节点铺开会撑爆覆盖条）", () => {
    expect(ui).toContain("逐条清理")
    expect(ui).toContain("useState(false)") // fragOpen 默认收起
    expect(ui).toMatch(/removeOutlineNode\?\.\(f\.id\)/)
  })

  it("批量清空按钮不得出现（破坏性操作必须逐条复核）", () => {
    expect(ui).not.toMatch(/全部删除|批量删除|一键清除/)
  })

  it("两处 OutlineCoverage 调用都接上了回调（否则另一处是死入口）", () => {
    const n = (compose.match(/removeOutlineNode=\{p\.outlineRemove\}/g) ?? []).length
    expect(n).toBe(2)
  })

  it("碎片清理文案必须说清「已生成正文不受影响」（用户最大的顾虑）", () => {
    expect(ui).toContain("已生成的正文不受影响")
    expect(ui).toContain("同名")
  })
})
