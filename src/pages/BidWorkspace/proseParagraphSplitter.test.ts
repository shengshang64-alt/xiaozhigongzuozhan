import { describe, it, expect } from "vitest"
import { splitLongParagraph, splitLongParagraphs } from "./proseParagraphSplitter"
import { LONG_PARAGRAPH_MAX_CHARS, lintProse } from "./bidProseLinter"

/** 造一个指定字数的句子（用真实中文短句拼，避免出现假标点） */
function sentenceOf(chars: number): string {
  const base = "本项目按招标文件要求组织设计并落地实施措施。"
  let s = ""
  while (s.length < chars) s += base
  return s.slice(0, chars - 1) + "。"
}

/** 去掉所有空白后比较（拆段只允许改变换行，不允许改变文字） */
const nows = (s: string) => s.replace(/\s/g, "")

describe("REQ-025 长段落本地重排", () => {
  it("短段（≤300 字）原样返回，不动", () => {
    const p = sentenceOf(150)
    expect(splitLongParagraph(p)).toEqual([p])
    const r = splitLongParagraphs([p, "", sentenceOf(200)].join("\n"))
    expect(r.splitParagraphs).toBe(0)
    expect(r.content.split("\n").length).toBe(3)
  })

  it("超长段按句号断开，且拼回去逐字等于原文（零失真）", () => {
    const p = [sentenceOf(120), sentenceOf(120), sentenceOf(120)].join("")
    expect(p.length).toBeGreaterThan(LONG_PARAGRAPH_MAX_CHARS)
    const parts = splitLongParagraph(p)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join("")).toBe(p) // 一个字不增不删不改
    for (const x of parts) expect(x.length).toBeLessThanOrEqual(300)
  })

  it("【关键】分号不作为切点——「一是…；二是…；三是…」并列结构不得被切散", () => {
    // 真实稿里 1358 处含分号片段，绝大多数是并列链。在这里断开会读者以为并列项没说完。
    const p =
      "痛点集中体现为三方面：一是各系统间患者身份标识不统一，跨院区调阅需要多次核对或人工干预；" +
      "二是门诊、急诊、住院业务链路在不同系统中各自运行，关键环节存在流程断点与重复录入；" +
      "三是现有无纸化数据尚未纳管，电子病历、护理文书的签署与归档状态未形成统一闭环；" +
      "四是历史数据跨越多个厂商与多个版本，字段口径、编码体系、字典值域在长期运行中已多次变更；" +
      "五是预交金在原系统中与患者身份标识、就诊卡号、账户余额、冻结金额、退费记录强关联，历史未结清状态需一并治理；" +
      "六是院内三方系统与利旧设备对接面广，涉及实验室信息系统、输血管理信息系统、临床决策支持、HRP、专病库管理系统、OA 系统、网站系统、院感监测管理系统、医学影像存档与通信系统等十余类系统。"
    expect(p.length).toBeGreaterThan(LONG_PARAGRAPH_MAX_CHARS)
    const parts = splitLongParagraph(p)
    // 整段只有「；」没有「。」——不切分号则只能是一段（拆不动）
    expect(parts.length).toBe(1)
    expect(parts[0]).toBe(p)
  })

  it("【关键】「。」后紧跟编号处必须能断开（真实稿有 3 段因此少断一次）", () => {
    // 实证：608 个超长段里，有 3 段的形态是「……直接衔接。6.4节已明确……」
    // 若切分正则加了「后面不能是数字」的假保护，这里就断不开，整句被粘连。
    const head = "多院区风险管控的组织基础与已写各节的协同保障机制直接衔接。"
    const tail = "6.4节已明确多院区实施协同与驻场人员组织保障、一体化运维与主数据治理口径。"
    const p = (head + tail).repeat(6)
    const parts = splitLongParagraph(p)
    expect(parts.join("")).toBe(p)
    // 【核心】「直接衔接。6.4节」必须成为切点：拆段里有段落**以「6.4节」开头**。
    // 若加了「后面不能是数字」的假保护，这句话会与上一句粘连，永远不会有段以它开头。
    // （用段内句号数统计是无效判据：粘连后句号仍在段内，总数不变——这里踩过。）
    expect(parts.some((x) => /^6\.4节/.test(x))).toBe(true)
    expect(parts.length).toBeGreaterThan(1)
  })

  it("半角小数点不是切点：「3.5 万元」「1.1 节」完整保留（切点是中文句号 ，不是 .）", () => {
    const p =
      "本项目建设周期 180 天，投资约 3.5 万元，按 1.1 节的架构设计执行，并发不低于 3000 人。".repeat(5)
    const parts = splitLongParagraph(p)
    expect(parts.join("")).toBe(p)
    // 小数必须完整保留在原地
    expect(parts.join("")).toContain("3.5 万元")
    for (const x of parts) {
      expect(x).not.toMatch(/^\d+\s*万元/) // 不允许出现「5 万元」这种被切掉整数部分的碎片
    }
  })

  it("【关键】「。」后跟编号/数字必须能被当作句子边界（不得加「后面不能是数字」的假保护）", () => {
    // 本模块第一版给切分正则加了 (?![0-9])，那是错的：
    // 切点是中文句号「。」，小数点是半角「.」，两者不同 → 该保护永不可能触发；
    // 但它会拦住「。」后紧跟编号的**断句能力**（真实稿 149 处这种形态）。
    // 判据：句号+编号处必须存在切分边界（splitSentences 层面），否则长段永远拆不动。
    // 真实形态：正文段落里既有普通句，也有以编号开头的句子（如引用小节号）。
    const seg = "我公司按分析结论配置资源并组织需求确认工作。1.2 节已界定统一与特色双重需求。"
    const p = seg.repeat(8) // 一段 16 个句子、远超 260 字
    const parts = splitLongParagraph(p)
    expect(parts.length).toBeGreaterThan(1)
    // 每一段都必须是完整的句子集合，且整体拼回逐字等于原文
    expect(parts.join("")).toBe(p)
    // 【核心判据】断句能力：原文 16 个句子，拆段后每一段都应由若干**完整句子**构成。
    // 若加了「后面不能是数字」的假保护，「。1.2」处不成为切点 → 句子数会少于 16。
    const countSent = (s: string) => (s.match(/[。！？]/g) ?? []).length
    const totalSents = parts.reduce((n, x) => n + countSent(x), 0)
    expect(totalSents).toBe(countSent(p)) // 句子一个不少
    expect(countSent(p)).toBe(16)
    // 且每一段都以句号收尾（没有把句子从中间断开）
    for (const x of parts) expect(/[。！？]$/.test(x)).toBe(true)
  })

  it("单句枚举段（拆不动）原样返回并计入 unsplittable，绝不硬拆", () => {
    // 真实形态：一个 300+ 字的并列枚举句（系统名罗列），只有句号在末尾
    const names = Array.from({ length: 40 }, (_, i) => `第${i + 1}业务系统`)
    const p = "本项目需完成新系统与" + names.join("、") + "等系统的对接改造工作。"
    expect(p.length).toBeGreaterThan(LONG_PARAGRAPH_MAX_CHARS)
    expect(splitLongParagraph(p)).toEqual([p])

    const r = splitLongParagraphs(p)
    expect(r.splitParagraphs).toBe(0)
    expect(r.unsplittable).toBe(1)
    expect(r.longBefore).toBe(1)
    expect(r.longAfter).toBe(1)
    expect(r.content).toBe(p)
  })

  it("表格行不进段落池：长表格行不得被拆散", () => {
    const row = ["序号", ...Array.from({ length: 40 }, (_, i) => `第${i + 1}列参数响应值为支持且满足招标要求`)].join("\u3000")
    expect(row.length).toBeGreaterThan(LONG_PARAGRAPH_MAX_CHARS)
    const content = [row, row, sentenceOf(120)].join("\n")
    const r = splitLongParagraphs(content)
    expect(r.splitParagraphs).toBe(0)
    expect(r.content).toBe(content)
  })

  it("空内容 / 纯空白安全返回", () => {
    expect(splitLongParagraphs("").content).toBe("")
    expect(splitLongParagraphs("   \n\n  ").splitParagraphs).toBe(0)
  })

  it("【验收】真实形态样本：拆后 linter 的长段落显著下降，且数字集合完全一致", () => {
    // 用 5 个 400+ 字的多句段模拟真实病灶（每段 4-5 句、句长 80-120）
    const paras = Array.from({ length: 5 }, (_, k) =>
      [sentenceOf(95), sentenceOf(105), sentenceOf(110), sentenceOf(100)].join("") + `第${k + 1}项验收标准。`,
    )
    const before = paras.join("\n")
    const r = splitLongParagraphs(before)
    const lb = lintProse(before).stats.rawCounts.long_paragraph
    const la = lintProse(r.content).stats.rawCounts.long_paragraph
    expect(lb).toBe(5)
    expect(la).toBe(0) // 全部拆到阈值内
    expect(r.splitParagraphs).toBe(5)

    // 数字 + 文字零改动
    const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(",")
    expect(nums(r.content)).toBe(nums(before))
    expect(nows(r.content)).toBe(nows(before))
  })
})
