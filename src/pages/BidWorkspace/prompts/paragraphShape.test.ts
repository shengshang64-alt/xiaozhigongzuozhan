// REQ-022（2026-10-17）：正文段落形态提示词的防回归哨兵
// ---------------------------------------------------------------------------
// 病根（真实数据实测，不是推断）：
//   此前 bidSection.ts 写「每段 3-6 句」、bidChapter.ts 写「每段 3-6 句」，
//   而 PROSE_LINT_RULES 第 4 条写「每段控制在 200 字以内」——**两条硬冲突**。
//   按"3-6 句"写、平均句长 66 字，就是每段 200-400 字，200 字上限永远做不到。
//   模型服从了具体的数字指令（3-6 句），忽略抽象字数上限。这不是模型不听话。
//
//   | 指标             | AI 稿   | 真实中标 | 倍数 |
//   |------------------|---------|----------|------|
//   | 每段句数（>25池）| 4.47    | 2.35     | 1.9× |
//   | 段长中位         | 281 字  | 82 字    | 3.4× |
//   | 平均句长         | 66.0 字 | 49.3 字  | 1.34×|
//
// 本文件钉死三件事，防后人"只改一条又制造矛盾"：
//   ① bidSection 提示词含「每段 2-3 句」且**不含**「每段 3-6 句」
//   ② bidChapter 同上
//   ③ 「每段 2-3 句」与「段落数下限」必须**同时在场**（只改一条就是新矛盾）
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest"
import {
  buildBidChapterMessages,
  buildBidContinueMessages,
  buildBidRefineMessages,
  buildBidSectionMessages,
  PARA_CHARS_PER_PARAGRAPH,
  PARA_SHAPE_RULE,
  PROSE_LINT_RULES,
} from "../bidTypes"
import { buildWordAdjustmentMessages } from "./wordAdjust"

/** PROSE_LINT_RULES 里「段落首句规则」那一条（第 4 条）
 *  按内容定位而非按下标——下标会随"插入新规则"漂移，内容锚更稳 */
function findRule4(): string {
  const r = PROSE_LINT_RULES.find((s) => s.startsWith("段落首句必须给结论或事实"))
  if (!r) throw new Error("PROSE_LINT_RULES 里找不到「段落首句必须给结论或事实」那条")
  return r
}
const PROSE_RULE_4 = findRule4()

const outline = [{ id: "n5", title: "第五章 安全设计", children: [], part: "tech" }] as never
/** 与 promptsSnapshot.test.ts 同样用 as never 绕过 Chapter 的可选字段差异——
 *  这里只关心提示词文本，不校验 Chapter 业务字段 */
const chapters = [
  { title: "第五章 安全设计", node_id: "n5", sections: ["5.1 总体架构"], gen_status: "done", content: "……" },
] as never

/** 取出一个构造器产出的全部提示词正文（system + user 拼一起，便于整体断言） */
function flatten(msgs: Array<{ role: string; content: string }>): string {
  return msgs.map((m) => m.content).join("\n")
}

function sectionPrompt(wordBudget = 1500): string {
  return flatten(
    buildBidSectionMessages(
      "医院一体化核心业务系统",
      "安徽中医药大学第一附属医院",
      null,
      outline,
      chapters,
      0,
      (nodes: { title: string }[]) => (nodes ?? []).map((n) => n.title).join("\n"),
      {
        globalFacts: "【全局事实】本项目工期：90 天",
        wordBudget,
        figures: false,
        sectionName: "5.1 总体架构",
        sectionNo: "5.1",
        sectionIndex: 0,
        sectionCount: 3,
      },
    ) as Array<{ role: string; content: string }>,
  )
}

function chapterPrompt(wordBudget = 2000): string {
  return flatten(
    buildBidChapterMessages(
      "医院一体化核心业务系统",
      "安徽中医药大学第一附属医院",
      null,
      outline,
      [{ title: "第五章 安全设计", node_id: "n5", sections: ["5.1 总体架构", "5.2 安全域划分"], gen_status: "done", content: "安全体系按等保三级设计……" }],
      0,
      (nodes) => (nodes ?? []).map((n) => n.title).join("\n"),
      { globalFacts: "【全局事实】本项目工期：90 天", wordBudget, figures: false },
    ) as Array<{ role: string; content: string }>,
  )
}

describe("REQ-022 ① 小节生成器：每段 2-3 句，不得再出现 3-6 句", () => {
  it("含「每段 2-3 句」且不含「每段 3-6 句」", () => {
    const p = sectionPrompt()
    expect(p).toContain("每段 2-3 句")
    expect(p).not.toContain("每段 3-6 句")
    // 旧的固定段数区间也必须一并消失（否则段落数被压住 → 模型重新撑大段落）
    expect(p).not.toContain("3-8 段")
  })

  it("含句长上限「每句 45-65 字」", () => {
    expect(sectionPrompt()).toContain("每句 45-65 字")
  })
})

describe("REQ-022 ② 章节生成器：同上", () => {
  it("含「每段 2-3 句」且不含「每段 3-6 句」", () => {
    const p = chapterPrompt()
    expect(p).toContain("每段 2-3 句")
    expect(p).not.toContain("每段 3-6 句")
    expect(p).not.toContain("2-5 段")
  })

  it("含句长上限「每句 45-65 字」", () => {
    expect(chapterPrompt()).toContain("每句 45-65 字")
  })
})

describe("REQ-022 ③ 段落数下限公式：不得与句数规则脱钩", () => {
  it("「每段 2-3 句」与「段落数下限」两条必须同时在场（防只改一条制造新矛盾）", () => {
    for (const [label, p] of [
      ["小节", sectionPrompt()],
      ["章节", chapterPrompt()],
    ] as const) {
      expect(p, `${label} 缺句数规则`).toContain("每段 2-3 句")
      expect(p, `${label} 缺段落数规则`).toContain("段落数不少于")
      expect(p, `${label} 缺预算除数`).toContain("÷ 130")
    }
  })

  it("段落数按字数预算算得出来（1500 ÷ 130 = 不少于 12 段）", () => {
    expect(Math.ceil(1500 / PARA_CHARS_PER_PARAGRAPH)).toBe(12) // 1500/130 = 11.5 → 向上取整 12 段
    // 文案里给的是"如预算 1500 字则不少于 12 段"，公式本身与常量必须一致
    expect(PARA_CHARS_PER_PARAGRAPH).toBe(130)
    expect(sectionPrompt(1500)).toContain("÷ 130")
  })

  it("PARA_SHAPE_RULE 同时声明句数与段落数下限（单一常量，两处共用）", () => {
    expect(PARA_SHAPE_RULE).toContain("每段 2-3 句")
    expect(PARA_SHAPE_RULE).toContain("每句 45-65 字")
    expect(PARA_SHAPE_RULE).toContain("段落数不少于")
    expect(PARA_SHAPE_RULE).toContain(String(PARA_CHARS_PER_PARAGRAPH))
  })

  it("【关键·真跑修正】必须给总字数下限，防「段落短＝篇幅缩水」", () => {
    // ⚠️ 这条是 2026-10-17 真跑实测后加的，起因是第一版规则把正文写薄了：
    //    第一版 = 「每段 1-3 句 + 每句≤40 字 + 段落数≥12」，三条相乘的最小可行解是
    //    12 段 × 1 句 × 30 字 = 360 字，而字数预算要 1500 字 —— **规则允许写 360 字就交卷**。
    //    真跑 3 轮实测：总字数 145 / 567 / 918，均值 543，只达预算 36%；
    //    段长中位 29.7 字（真实标书 82）、句长 29.7 字（真实 49）。
    //    病根与第一版要治的病**同型**：规则自身与字数预算互相矛盾，只是方向反了。
    //    修法：规则里必须显式写「总字数要达到预算的 90% 以上」，否则模型只会取下限。
    expect(PARA_SHAPE_RULE, "必须显式要求总字数达标，否则模型只写下限").toContain("总字数必须达到字数预算的 90% 以上")
    // 且预算下限必须被两个生成器真实注入（不是只写在常量里）
    for (const [label, p] of [
      ["小节", sectionPrompt(1500)],
      ["章节", chapterPrompt(2000)],
    ] as const) {
      expect(p, `${label} 缺总字数下限`).toContain("总字数必须达到字数预算的 90% 以上")
    }
  })

  it("句长必须给区间而非只有上限（真跑：只有上限导致句长掉到 29.7 字）", () => {
    // 真实标书句长中位 49 字；区间 35-60 的中值是 47.5，贴合真实。
    // 只有上限（如「不超过 40 字」）会把下限一并压掉——模型没有下限可依，就取最短。
    expect(PARA_SHAPE_RULE).toContain("每句 45-65 字")
    expect(PARA_SHAPE_RULE, "不许退回只有上限的写法").not.toContain("每句不超过 40 字")
    expect(PROSE_RULE_4, "文风硬条款里也必须是区间").toContain("每句 45-65 字")
    expect(PROSE_RULE_4, "不许退回只有上限的写法").not.toContain("每句不超过 40 字")
  })

  it("两个生成器用的是同一份规则（改一处即两处生效，不许各写一份）", () => {
    // 两边必须逐字包含同一常量文本——若有人复制一份改一边，这里立刻红
    expect(sectionPrompt()).toContain(PARA_SHAPE_RULE)
    expect(chapterPrompt()).toContain(PARA_SHAPE_RULE)
  })
})

describe("REQ-022 ④ 原有 200 字上限与首句规则不得被顺带改掉（R-302 已验收口径）", () => {
  it("「每段控制在 200 字以内，长段落拆为 2-3 段」原样保留", () => {
    for (const [label, p] of [
      ["小节", sectionPrompt()],
      ["章节", chapterPrompt()],
    ] as const) {
      expect(p, `${label} 丢了 200 字上限`).toContain("每段控制在 200 字以内，长段落拆为 2-3 段")
      expect(p, `${label} 丢了首句规则`).toContain("首句必须给结论或事实")
      expect(p, `${label} 丢了 30 字规则`).toContain("首句超过 30 字还没出现数字/系统名/措施的")
    }
  })

  it("【关键】句长上限必须挂在 PROSE_LINT_RULES 第 4 条那条上，不能只靠 PARA_SHAPE_RULE 兜", () => {
    // ⚠️ 这条是修测试漏洞后加的（变异验证抓出来的）：
    //    最初我只断言"提示词里包含「每句 45-65 字」"，但 PARA_SHAPE_RULE 里也含同一句话，
    //    于是把 PROSE_LINT_RULES 第 4 条的句长上限删掉，提示词里仍有那句 —— 9 例全绿，变异存活。
    //    真正的需求是"**两条规则串都要有句长上限**"：段落规则串（① ②）与文风硬条款（③）各一份，
    //    因为它们在不同位置注入、模型可能只读到其中一段。
    //    故这里必须**按规则串定位**，而不是全文 contains。
    const RULE4 = PROSE_RULE_4
    // PROSE_LINT_RULES 第 4 条（段落首句规则）本身必须带句长上限
    expect(RULE4).toContain("每段控制在 200 字以内，长段落拆为 2-3 段")
    expect(RULE4).toContain("每句 45-65 字")
    // 且它确实被注入到两个生成器的提示词里
    expect(sectionPrompt()).toContain(RULE4)
    expect(chapterPrompt()).toContain(RULE4)
  })
})

// ---------------------------------------------------------------------------
// REQ-022 ⑤（2026-10-17 补齐）：正文一共五条生成路径，此前只覆盖了 2 条
//
// 缺口事实（按快照块逐个数规则条数得出，非推断）：
//   buildBidChapterMessages   54 条  ✅完整
//   buildBidSectionMessages   54 条  ✅完整
//   buildBidRefineMessages    40 条  ❌缺「每段 2-3 句」与「段落数下限」
//   buildBidContinueMessages  39 条  ❌全缺，连老的 200 字都没有
//   buildWordAdjustmentMessages —    ❌全缺
//
// 为什么这四条必须补：续写（continue）是「自动补足 / 继续生成」走的路径，
// 任务本身就是「续写约 N 字使整章达到篇幅预算」——一条专门灌字的路径若没有段落形态
// 约束，模型凑预算最省力的做法就是写长段落；扩写（refine expand / wordAdjust expand）
// 的手段原文写着「补写承接句与过渡说明」，补承接句必然把两段粘成一段。
// 即：**只补首次生成路径，补足与重写路径仍会把病改回来。**
//
// 断言措辞纪律（M3 变异的教训）：一律用**全文逐字包含** PARA_SHAPE_RULE，
// 不许用片段 contains——PARA_SHAPE_RULE 里含「每句 45-65 字」等通用短语，
// 用片段匹配会被别处的同一句话骗过，变异存活。
// ---------------------------------------------------------------------------
describe("REQ-022 ⑤ 五条正文生成路径全部注入段落形态规则", () => {
  /** 取一段提示词文本里的全部内容（每个生成器返回结构不同，统一摊平） */
  const flat = (msgs: Array<{ role: string; content: string }>) => msgs.map((m) => m.content).join("\n")

  it("续写 continue：含 PARA_SHAPE_RULE 全文 + 老的 200 字规则", () => {
    const p = flat(
      buildBidContinueMessages(
        "医院一体化核心业务系统",
        "安徽中医药大学第一附属医院",
        null,
        "第五章 安全设计",
        5,
        "安全体系按等保三级设计，边界防护与主机防护同步建设。",
        800,
        "【全局事实】本项目工期：90 天",
        {},
      ) as Array<{ role: string; content: string }>,
    )
    expect(p, "续写路径必须含段落形态规则全文").toContain(PARA_SHAPE_RULE)
    expect(p, "续写路径丢了老的 200 字上限（本文件此前从未注入 PROSE_LINT_RULES）").toContain(
      "每段控制在 200 字以内，长段落拆为 2-3 段",
    )
    expect(p, "续写路径必须注入 PROSE_LINT_RULES 第 4 条").toContain(PROSE_RULE_4)
  })

  it("整章重写 refine：含 PARA_SHAPE_RULE 全文", () => {
    const p = flat(
      buildBidRefineMessages("expand", "医院一体化核心业务系统", "安徽中医药大学第一附属医院", "第五章 安全设计", 5, "安全体系按等保三级设计。", {}) as Array<{
        role: string
        content: string
      }>,
    )
    expect(p, "重写路径必须含段落形态规则全文").toContain(PARA_SHAPE_RULE)
    // 重写路径原有的 PROSE_LINT_RULES 第 4 条（含句长）不得被本次改动挤掉
    expect(p).toContain(PROSE_RULE_4)
  })

  it("字数精调 wordAdjust 扩写：禁止靠插承接句扩写", () => {
    const p = flat(
      buildWordAdjustmentMessages({
        title: "第五章 安全设计",
        content: "安全体系按等保三级设计。边界防护与主机防护同步建设。",
        direction: "expand",
        granularity: "paragraph",
        targetWords: 800,
        maxChangeWords: 200,
      }) as Array<{ role: string; content: string }>,
    )
    // 扩写方向必须写清段落形态，且点名"禁止在现有段落内部追加承接句"
    expect(p, "扩写必须约束每段句数").toContain("每段 2-3 句")
    expect(p, "扩写必须禁止靠插承接句膨胀段落").toContain("禁止在现有段落内部追加承接句")
    expect(p, "扩写必须要求优先插入独立新段落").toContain("插入独立的新段落")
  })

  it("反证：缩写 shrink 方向不许被误塞扩写规则（规则只加给 expand）", () => {
    const p = flat(
      buildWordAdjustmentMessages({
        title: "第五章 安全设计",
        content: "安全体系按等保三级设计。边界防护与主机防护同步建设。",
        direction: "shrink",
        granularity: "paragraph",
        targetWords: 200,
        maxChangeWords: 100,
      }) as Array<{ role: string; content: string }>,
    )
    expect(p).not.toContain("禁止在现有段落内部追加承接句")
  })
})
