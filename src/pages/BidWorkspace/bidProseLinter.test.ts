// 单元测试：标书版式与文风本地校验（端到端反馈 #5 配套）

import { describe, expect, it } from "vitest"
import {
  LONG_PARAGRAPH_MAX_CHARS,
  LONG_SENTENCE_MAX_CHARS,
  isTableRow,
  lintProse,
} from "./bidProseLinter"

describe("lintProse（标书版式与文风本地校验）", () => {
  it("正常正文 → 0 命中", () => {
    const r = lintProse(
      "本项目采用 B/S 架构开发，部署在 Web 服务器。前端使用 React 18，后端使用 FastAPI。系统支持每天 5000 人次门诊预约。",
    )
    expect(r.hits.length).toBe(0)
  })

  it("AI 套话命中（赋能/打造/抓手/全方位）", () => {
    const r = lintProse(
      "本系统通过赋能业务、打造生态、闭环管理抓手，全方位提升医院信息化水平。",
    )
    expect(r.hits.length).toBeGreaterThanOrEqual(3)
    const kinds = r.hits.map((h) => h.kind)
    expect(kinds.filter((k) => k === "ai_cliche").length).toBeGreaterThanOrEqual(3)
  })

  it("医疗信息化专业术语不得误报（闭环/中台/全生命周期/端到端）", () => {
    // 2026-10-16 实机校准：这些词在安中医真实标书里高频出现且均为专业表述，
    // 曾导致一章 50 处命中且全部是「闭环」。列入黑名单属误报，此处钉死防回归。
    const r = lintProse(
      "本项目实现医嘱闭环管理与处方闭环跟踪，建设数据中台与业务中台，覆盖数据全生命周期治理，提供端到端集成能力。",
    )
    expect(r.hits.filter((h) => h.kind === "ai_cliche").length).toBe(0)
  })

  it("单类命中不超过分类配额（防单一高频词淹没其它类别）", () => {
    const r = lintProse("赋能".repeat(20) + "本项目系统支持每天 5000 人次门诊预约，性能满足要求。")
    const clicheHits = r.hits.filter((h) => h.kind === "ai_cliche")
    expect(clicheHits.length).toBeLessThanOrEqual(15)
  })

  it("内联指引命中（详见/参考/参见）", () => {
    const r = lintProse(
      "本项目采用 B/S 架构（详见第三章 3.2），后端使用 FastAPI（参考 4.1），与现有系统集成（参见 P17）。",
    )
    const linkHits = r.hits.filter((h) => h.kind === "inline_link")
    expect(linkHits.length).toBeGreaterThanOrEqual(2)
  })

  it("裸词「上同」不得误报（多分支必须分组 + 必须带括号）", () => {
    // 2026-10-16 实机回归：/（A|B|上同|同前）/ 的分支未分组，等价于 OR 裸词，
    // 「部署上同步体现」被误判为内联指引。此用例钉死该写法不再回归。
    const r = lintProse(
      "中台与院区特色分治的边界在物理部署上同步体现，集中部署的服务不需要各院区分别维护。",
    )
    expect(r.hits.filter((h) => h.kind === "inline_link").length).toBe(0)
  })

  it("（如前所述）带括号时仍能命中", () => {
    // 注意：正文需 ≥ 30 字才会进入校验主流程（短文本早返回，避免噪音）
    const r = lintProse(
      "本项目的建设目标（如前所述）包括数据治理、业务协同与运维保障三个层面，具体实施措施与责任分工如下。",
    )
    expect(r.hits.filter((h) => h.kind === "inline_link").length).toBe(1)
  })

  it("标题层级断裂：5.1 → 5.3 跳号", () => {
    const text = [
      "5.1 总体设计",
      "本系统采用 B/S 架构，支持 5000 人次/天。",
      "5.3 详细设计",
      "系统分为前端、后端、数据库三层。",
    ].join("\n")
    const r = lintProse(text)
    const titleHits = r.hits.filter((h) => h.kind === "title_break")
    expect(titleHits.length).toBeGreaterThanOrEqual(1)
    expect(titleHits[0].reason).toContain("5.3")
  })

  it("关键章缺表（识别为 missing_table）", () => {
    // 内容需 ≥ 30 字绕过 early return；长一些更贴近真实标书场景
    const text = "本项目对招标技术参数逐条响应，所有参数严格满足招标文件要求；系统支持每天 5000 人次门诊预约等关键指标。"
    const r = lintProse(text, "技术参数与实质性响应")
    expect(r.hits.some((h) => h.kind === "missing_table")).toBe(true)
  })

  it("关键章有 markdown 表格 → 不命中", () => {
    const text = [
      "本项目对招标技术参数逐条响应：",
      "",
      "| 序号 | 招标参数 | 响应值 | 偏离 | 证明材料 |",
      "| --- | --- | --- | --- | --- |",
      "| 1 | 服务时间 ≥ 8 小时/天 | 24 小时/天 | 无偏离 | 详见附件 |",
    ].join("\n")
    const r = lintProse(text, "技术参数与实质性响应")
    expect(r.hits.filter((h) => h.kind === "missing_table").length).toBe(0)
  })

  it("空内容不报错", () => {
    expect(lintProse("").hits.length).toBe(0)
    expect(lintProse("ab").hits.length).toBe(0)
  })

  it("极长正文不卡顿（截断到 8 万字）", () => {
    const long = "本项目系统支持每天 5000 人次门诊预约。\n".repeat(3000) // ~90k
    const t0 = Date.now()
    const r = lintProse(long)
    const dt = Date.now() - t0
    // 长正文中无套话无指引无标题无关键词章标题 → 应为 0 命中
    expect(r.hits.filter((h) => h.kind === "ai_cliche" || h.kind === "inline_link").length).toBe(0)
    expect(dt).toBeLessThan(100) // 100ms 阈值
  })

  it("Mermaid 图也算表（应急章节引用 mermaid 也通过）", () => {
    const text = [
      "本应急预案场景：",
      "",
      "```mermaid",
      "graph TD",
      "  A[系统故障] --> B[启动应急]",
      "```",
    ].join("\n")
    const r = lintProse(text, "应急预案与业务连续性")
    expect(r.hits.filter((h) => h.kind === "missing_table").length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// REQ-021：长段落 / 长句闸门
// 由来：用户反馈「AI 味道太严重」，实测病根不是禁词（30+ 词只命中 29 处），
// 而是"一坨 280 字连续文字"。标尺 = 真实交付《售后服务方案》段落中位 81.5 字。
// ---------------------------------------------------------------------------
describe("REQ-021 长段落 / 长句闸门", () => {
  it("阈值是具名常量，且与真实标尺对齐（300 / 80）", () => {
    // 300：真实交付标书段落 99 分位以上（286 段里仅 2 段 >300，占 0.7%）
    // 80 ：真实交付标书句子 85 分位（79 字）
    expect(LONG_PARAGRAPH_MAX_CHARS).toBe(300)
    expect(LONG_SENTENCE_MAX_CHARS).toBe(80)
  })

  it("301 字的段落 → 命中 long_paragraph，reason 带字数与拆分建议", () => {
    const para = "本系统采用微服务架构。".repeat(27) // 27 × 11 = 297
    const text = para + "补充说明。" // 302 字
    const r = lintProse(text)
    const hits = r.hits.filter((h) => h.kind === "long_paragraph")
    expect(hits.length).toBe(1)
    expect(hits[0].reason).toContain("段落过长")
    expect(hits[0].reason).toContain("建议拆为 2-3 段")
    // 字数必须真实回填（不是写死的 300）
    expect(hits[0].reason).toContain(`${text.length} 字`)
  })

  it("恰好 300 字的段落 → 不命中（阈值是「超过」不是「达到」）", () => {
    const text = "甲".repeat(299) + "。"
    expect(text.length).toBe(300)
    expect(lintProse(text).hits.filter((h) => h.kind === "long_paragraph").length).toBe(0)
  })

  it("超过 80 字的句子 → 命中 long_sentence；短段落里也抓得到", () => {
    // 段落总长 98 字（不到 300，只该报句不该报段），内含一个 90 字长句
    const longSent = "本" + "系统支持".repeat(28) + "。" // 1 + 56 + 1 = 58？→ 精确构造见下
    const sent = "甲乙".repeat(45) + "。" // 91 字
    const text = sent + "短句。" + longSent
    const r = lintProse(text)
    const hits = r.hits.filter((h) => h.kind === "long_sentence")
    expect(hits.length).toBe(1)
    expect(hits[0].reason).toContain("句子过长")
    expect(hits[0].reason).toContain("建议断句")
  })

  it("80 字以内的句子 → 不命中", () => {
    const text = "甲乙".repeat(39) + "。" // 79 字
    expect(lintProse(text).hits.filter((h) => h.kind === "long_sentence").length).toBe(0)
  })

  it("【关键】连续 Word 纯文本表格行（U+3000 分列、每行 200+ 字）→ long_paragraph 必须 0 命中", () => {
    // 参数响应表的真实形态：每行一条记录、列间两个全角空格、每行 200+ 字。
    // 若不跳过表格块，这些行会被逐行当成超长段落，一张参数表就刷出几十条误报。
    const cell = "满足招标文件要求并提供第三方检测报告".repeat(8) // 256 字
    const U = "\u3000" // 全角空格：源码里不直接写，避开 no-irregular-whitespace
    const rows = [
      `序号${U}${U}${U}${U}招标参数${U}${U}${U}${U}响应值${U}${U}${U}${U}偏离说明`,
      `1${U}${U}${cell}${U}${U}完全响应${U}${U}无偏离`,
      `2${U}${U}${cell}${U}${U}完全响应${U}${U}无偏离`,
      `3${U}${U}${cell}${U}${U}完全响应${U}${U}无偏离`,
      `4${U}${U}${cell}${U}${U}完全响应${U}${U}无偏离`,
      `5${U}${U}${cell}${U}${U}完全响应${U}${U}无偏离`,
    ]
    const r = lintProse(rows.join("\n"), "技术参数与实质性响应")
    expect(r.hits.filter((h) => h.kind === "long_paragraph").length).toBe(0)
    expect(r.hits.filter((h) => h.kind === "long_sentence").length).toBe(0)
    // 表格块不该进段落池
    expect(r.stats.paragraphCount).toBe(0)
  })

  it("连续 Markdown 表格行 → long_paragraph 0 命中", () => {
    const cell = "满足招标要求".repeat(50) // 300 字
    const lines = [
      "| 序号 | 招标参数 | 响应值 |",
      "| --- | --- | --- |",
      `| 1 | ${cell} | 完全响应 |`,
      `| 2 | ${cell} | 完全响应 |`,
    ]
    const r = lintProse(lines.join("\n"))
    expect(r.hits.filter((h) => h.kind === "long_paragraph").length).toBe(0)
  })

  it("表格块之外的正文长段落仍必须被抓到（不许因跳过表格而漏报）", () => {
    const cell = "满足招标文件要求".repeat(30)
    const body = "本系统采用微服务架构。".repeat(30) // 330 字正文
    const U = "\u3000"
    const text = [
      `序号${U}${U}参数${U}${U}响应`,
      `1${U}${U}${cell}${U}${U}完全响应`,
      `2${U}${U}${cell}${U}${U}完全响应`,
      "",
      body,
    ].join("\n")
    const r = lintProse(text)
    expect(r.hits.filter((h) => h.kind === "long_paragraph").length).toBe(1)
  })

  it("isTableRow 边界：单列正文含全角空格不算表；连续两个全角空格或 ≥3 列才算", () => {
    const U = "\u3000"
    // 正文里偶然出现**一个**全角空格不是表（这条踩过：宽判据会把真长段落吞掉）
    expect(isTableRow(`这是一段正文，里面恰好有一个${U}全角空格`)).toBe(false)
    // 生成约定「两个全角空格分列」的确定形态 → 是表
    expect(isTableRow(`序号${U}${U}招标参数${U}${U}响应值`)).toBe(true)
    // 折出 3 列以上 → 是表
    expect(isTableRow(`甲${U}乙${U}丙`)).toBe(true)
    expect(isTableRow("| a | b |")).toBe(true)
    expect(isTableRow("<table>")).toBe(true)
    expect(isTableRow("普通正文一行")).toBe(false)
  })

  it("stats.rawCounts 不截断（UI 可见条数受配额，度量口径不受限）", () => {
    // 40 个独立长段落：hits 受 PER_KIND_CAP=15 截断，stats 必须如实给 40
    const para = "本系统采用微服务架构。".repeat(30) // 330 字
    const text = Array.from({ length: 40 }, () => para).join("\n")
    const r = lintProse(text)
    expect(r.stats.rawCounts.long_paragraph).toBe(40)
    expect(r.hits.filter((h) => h.kind === "long_paragraph").length).toBeLessThanOrEqual(15)
  })

  it("stats.paragraphCount 与真实段落数一致（排除表格块）", () => {
    // 注意：内容 < 30 字会走 early return（既有边界，不改），故此处用够长的文案
    const text = ["第一段正文内容足够长了。", "", "第二段正文内容足够长了。", "第三段正文内容足够长了。"].join(
      "\n",
    )
    expect(lintProse(text).stats.paragraphCount).toBe(3)
  })

  it("原有 4 类命中不受影响（长段落与套话可同时命中，互不吞并）", () => {
    const text = "赋能" + "本项目系统支持每天 5000 人次门诊预约。".repeat(30)
    const r = lintProse(text)
    expect(r.hits.filter((h) => h.kind === "ai_cliche").length).toBeGreaterThanOrEqual(1)
    expect(r.stats.rawCounts.long_paragraph).toBeGreaterThanOrEqual(1)
  })

  it("空内容 / 极短内容的 stats 结构完整（不返回 undefined）", () => {
    const r = lintProse("")
    expect(r.stats.rawCounts.long_paragraph).toBe(0)
    expect(r.stats.paragraphCount).toBe(0)
    expect(Object.keys(r.stats.rawCounts).sort()).toEqual(
      [
        "ai_cliche",
        "inline_link",
        "long_paragraph",
        "long_sentence",
        "missing_table",
        "task_dispatch",
        "title_break",
      ].sort(),
    )
    expect(r.severity).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// REQ-021 返工（史矛革复核 §四）：A/B 两项
//   A. rawCounts 不得是死字段 —— summary 必须由它拼出来
//   B. 长段落/长句分 kind + summary 分别计数 + 严重度分档
// ---------------------------------------------------------------------------
describe("REQ-021 返工：summary 按严重度分别计数（A/B）", () => {
  it("summary 报的是未截断真实量，并明写「仅列出前 N 条」", () => {
    // 40 个长段落：hits 被截到 ≤15，但 summary 必须报 40，并说明只列了前 15 条
    const para = "本系统采用微服务架构。".repeat(30) // 330 字
    const text = Array.from({ length: 40 }, () => para).join("\n")
    const r = lintProse(text)
    expect(r.stats.rawCounts.long_paragraph).toBe(40)
    expect(r.summary).toContain("长段落 40")
    expect(r.summary).toContain("仅列出前")
    // 不能谎报成 15
    expect(r.summary).not.toContain("长段落 15")
  })

  it("summary 长段落与长句分别计数（不合并成一个数字）", () => {
    // 长段落（无长句）：1 段
    const longPara = "本系统采用微服务架构。".repeat(30)
    // 长句（段落 <300 但单句 >80）：构造一个 120 字的句子
    const longSent = `${"甲乙丙丁".repeat(29)}。` // 117 字
    const text = [longPara, longSent].join("\n")
    const r = lintProse(text)
    expect(r.stats.rawCounts.long_paragraph).toBe(1)
    expect(r.stats.rawCounts.long_sentence).toBeGreaterThanOrEqual(1)
    expect(r.summary).toContain("长段落 1")
    expect(r.summary).toMatch(/长句 \d+/)
  })

  it("结构性缺陷与文风问题在 summary 里分开报", () => {
    const text = [
      "5.1 总体设计",
      "本系统采用 B/S 架构，支持 5000 人次/天。",
      "5.3 详细设计",
      "增加一行足够长的正文以绕过 30 字早返回的边界，保证进入主流程。",
    ].join("\n")
    const r = lintProse(text)
    expect(r.stats.rawCounts.title_break).toBeGreaterThanOrEqual(1)
    expect(r.summary).toContain("结构性缺陷")
    expect(r.summary).toContain("会被评审扣分")
  })

  it("severity：有结构性缺陷 → structural；只有文风 → style", () => {
    // 只有长段落（文风）
    const styleText = "本系统采用微服务架构。".repeat(30)
    expect(lintProse(styleText).severity).toBe("style")
    // 有标题跳号（结构性）
    const structText = [
      "5.1 总体设计",
      "本系统采用 B/S 架构，支持 5000 人次/天。",
      "5.3 详细设计",
      "系统分为前端、后端、数据库三层结构，满足性能与扩展要求。",
    ].join("\n")
    expect(lintProse(structText).severity).toBe("structural")
    // 只有 AI 套话（文风）。注意需 ≥30 字才进主流程（既有 early return，不改）
    expect(
      lintProse("赋能业务，打造生态，提升医院信息化整体水平与业务协同能力，实现服务能力升级。").severity,
    ).toBe("style")
  })

  it("missing_table 属「建议补充」，不再染红（2026-10-17 史矛革裁决）", () => {
    const text =
      "本项目对招标技术参数逐条响应，所有参数严格满足招标文件要求；系统支持每天 5000 人次门诊预约等关键指标。"
    const r = lintProse(text, "技术参数与实质性响应")
    // 判据照常命中（R-302 的 4 类行为一个字没动）
    expect(r.stats.rawCounts.missing_table).toBe(1)
    // 但不再把整章染成红色「会扣分」
    expect(r.severity).toBe("style")
    expect(r.summary).toContain("建议补充")
    // 不能再说它"会被评审扣分"（那是标题跳号那一档的措辞）
    expect(r.summary).not.toContain("关键章缺表，会被评审扣分")
  })
})

// ---------------------------------------------------------------------------
// REQ-021 最后一处（史矛革裁决 ③）：真实中标文件的**反向判据**
//   真实交付并中标的《售后服务方案》实测 287 段 / **0 张表格**（纯文字承诺书）。
//   旧分档会把它标成红色「会扣分」，让用户白改一遍 —— 这是真误报。
//   本用例钉死：判据可以命中（没表是事实），但严重度必须是 style（琥珀），不得 structural。
// ---------------------------------------------------------------------------
describe("REQ-021 反向判据：真实中标纯文字方案不得被染红", () => {
  it("售后类章节 0 张表 → missing_table 命中但 severity=style", () => {
    // 用真实交付件正文片段（无表格、纯文字承诺书形态，≥30 字进主流程）
    const body = [
      "质保期后，面对各临床科室主任、护士长提出的业务调整需求，我司承诺在 3 个工作日内完成评估并给出实施方案。",
      "我司郑重申明，质保期后签订的有偿维保服务级别协议（SLA），服务响应标准不因合同性质变化而降低。",
      "接到故障报修后，我司技术人员在 30 分钟内响应，4 小时内到达现场，重大问题 24 小时内恢复业务。",
    ].join("\n")
    // 章节标题命中 SLA/售后服务关键词 → 期望出表；但本文确实没有表
    const r = lintProse(body, "售后服务方案")
    expect(r.stats.rawCounts.missing_table).toBe(1) // 判得对：确实没有表
    expect(r.severity).toBe("style") // 但不得染红
    expect(r.summary).toContain("建议补充")
  })

  it("只有标题跳号才算 structural（红），缺表不算", () => {
    // 缺表 + 长段落 → 仍是 style
    const onlySuggestion =
      "本系统采用微服务架构，各服务之间通过集成平台进行消息路由与格式转换。" .repeat(12)
    const r1 = lintProse(onlySuggestion, "售后服务方案")
    expect(r1.stats.rawCounts.missing_table).toBe(1)
    expect(r1.severity).toBe("style")

    // 标题跳号 → structural
    const withBreak = [
      "5.1 总体设计",
      "本系统采用 B/S 架构，支持 5000 人次/天。",
      "5.3 详细设计",
      "系统分为前端、后端、数据库三层结构，满足性能与扩展要求。",
    ].join("\n")
    expect(lintProse(withBreak).severity).toBe("structural")
  })

  // REQ-024（2026-10-17）：任务分派 / 章节自指 / 条款编号进正文
  //
  // 实证基线：用户 45.1 万字真生成稿（bid_projects d3c35o7axkw34wo）「第X章」354 处、
  // 「承接」191、「本小节」154、「落地」150；真实中标标书这几项全部为 0。
  // 本节用例必须同时守住两件事：①真稿那类句子必须被抓到；②行业正常表述不许误报。
  describe("REQ-024 章节分派与自指", () => {
    it("抓到「由第 X 章……承接」这类不带括号的分派句（旧版括号规则漏掉的形态）", () => {
      const text = [
        "5.1 总体架构",
        "统一侧主数据、主索引与资产口径的实现由第3章数据价值闭环核心能力设计方案与第5章一体化核心业务系统详细技术方案承接，两侧交互契约由第8章接口集中管理与系统运维监测能力方案承接。",
        "特色侧配置由第6章多院区分级管理与闭环管理能力方案承接落地，我公司在 180 个日历天内完成全部建设内容。",
      ].join("\n")
      const r = lintProse(text)
      expect(r.stats.rawCounts.task_dispatch).toBeGreaterThanOrEqual(3)
      expect(r.severity).toBe("style") // 观感问题，不染红
      expect(r.summary).toContain("章节分派")
    })

    it("抓到「详见第 X 章」（不带全角括号的指引形态）", () => {
      const text = [
        "5.1 总体架构",
        "驻场人员配置详见第11章项目团队配备与人员资质，指标监测系统的详细设计详见第6章多院区分级管理方案，均按 8 人驻场配置。",
      ].join("\n")
      const r = lintProse(text)
      expect(r.stats.rawCounts.task_dispatch).toBeGreaterThanOrEqual(2)
    })

    it("抓到章节自指「本小节/本节」（真实标书 0 次，AI 稿 156/285 次）", () => {
      // 实证：14 份真实标书里「本小节」「本节」全部为 0；AI 生成稿分别 156 / 285 次。
      // 这是"自指"型 AI 味——正文以大模型视角指称自己在写的那一段，
      // 而真实标书以读者视角直接写内容。
      const text = [
        "5.1 总体架构",
        "本小节界定的现状与痛点，将由第 2 章统分结合总体架构设计承接落地，本节的响应结论为满足招标文件要求。",
        "本节按表现层、业务层、数据层与基础设施层四层划分，各层职责边界清晰、接口标准统一。",
      ].join("\n")
      const r = lintProse(text)
      // 3 处自指（本小节 ×2 + 本节 ×1）
      expect(r.stats.rawCounts.task_dispatch).toBeGreaterThanOrEqual(3)
    })

    it("反向：「本章」不得被当自指（「本章小结」是常见小节标题）", () => {
      // 真实标书里「本节/本小节」为 0，但「本章」只在招标文件侧出现（25-26 次），
      // 投标正文里的「本章小结」是正常小节名——收「本章」会大面积误报。
      const text = [
        "5.1 总体架构",
        "本章小结：总体架构按表现层、业务层、数据层与基础设施层四层划分，各层职责边界清晰、接口标准统一。",
      ].join("\n")
      const r = lintProse(text)
      expect(r.stats.rawCounts.task_dispatch).toBe(0)
    })

    it("反向：真实中标标书的正常表述零命中（不许误伤行业写法）", () => {
      // 以下句子取自真实交付并中标的《售后服务方案》与常见医院集成方案写法，
      // 都不含章节分派，必须一条都不命中。
      const text = [
        "5.1 总体架构",
        "接到故障报修后，我司技术人员在 30 分钟内响应，4 小时内到达现场，重大问题 24 小时内恢复业务。",
        "本章小结：总体架构按表现层、业务层、数据层与基础设施层四层划分，各层职责边界清晰、接口标准统一。",
        "系统按等级保护 2.0 三级要求建设，安全防护覆盖网络、主机、应用与数据四个层面。",
        "集成平台统一承接各业务系统间的接口交互，提供接口注册、消息路由、数据转换与监控告警能力。",
      ].join("\n")
      const r = lintProse(text)
      expect(r.stats.rawCounts.task_dispatch).toBe(0)
    })

    it("反向：不带章节编号的「承接」是正常业务动词，不得被当成分派", () => {
      // 「集成平台承接接口交互」这类是本工具保留的专业术语写法（业务承接），
      // 只有出现「第 N 章」编号时才算章节分派。
      const text = [
        "5.1 总体架构",
        "数据中台承接数据采集、治理与资产沉淀，业务中台承接经营要素与业务能力的统一配置，集成服务引擎承接对外接口的集中管理。",
      ].join("\n")
      const r = lintProse(text)
      expect(r.stats.rawCounts.task_dispatch).toBe(0)
    })

    it("反向：标题行「第五章 总体架构设计承接……」不算分派（真跑 v2-chap-1 误报过）", () => {
      // 章级生成的首段常写「第五章 总体架构设计承接上一章需求分析与现状调研结论……」，
      // 这是正常承接段，不是把内容派给别的章。不排除会稳定误报 1 处。
      const text = [
        "5.1 总体架构",
        "第五章 总体架构设计承接上一章需求分析与现状调研结论，按覆盖 HIS、EMR、LIS、PACS 与集成平台的一体化核心业务系统要求组织设计。",
      ].join("\n")
      const r = lintProse(text)
      expect(r.stats.rawCounts.task_dispatch).toBe(0)
    })

    it("正向：正文中间的分派句仍要抓到（标题行排除不得放过真问题）", () => {
      const text = [
        "5.1 总体架构",
        "总体架构按四层划分，各层职责边界清晰。统一侧主数据与资产口径的实现由第3章数据价值闭环核心能力设计方案承接。",
      ].join("\n")
      const r = lintProse(text)
      expect(r.stats.rawCounts.task_dispatch).toBeGreaterThanOrEqual(1)
    })
  })
})
