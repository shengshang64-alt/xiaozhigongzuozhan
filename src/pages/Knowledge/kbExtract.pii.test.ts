/**
 * 知识库原子抽取的「进模型前脱敏」（2026-11-04 隐私巡检）。
 *
 * 背景：知识库存的是团队方法论与客户材料，其中合同/资质类原文会含手机号、身份证、
 * 银行账号。整段正文此前被原样发往第三方云模型，违反全站「原文进 AI 前一律 redactPii」口径。
 *
 * ## 实测纠偏（重要，别再照抄想当然的结论）
 *
 * 改这处时我先假设：如果比对侧用未脱敏原文，模型按脱敏文本抄回的引用会「整批对不上」。
 * **实测这个假设是错的**：`sanitizeExtraction` 的逐字校验用的是子串包含（includes），
 * 而脱敏只会把文本变短、不会改变未被掩码部分的连续性——所以「只脱敏入参、比对用原文」
 * 时抽取仍然成功（实测 atoms=1、segments.succeeded=1）。反向验证时这一点暴露得很清楚：
 * 把比对侧改回 p.text，用例照样全绿。
 *
 * 结论有三条，都在下面的用例里钉住：
 *   ① 发出去的片段必须不含明文 PII（真正的隐私目标，与比对侧无关）；
 *   ② 两边仍然统一用脱敏后文本——不是因为否则会丢数据，而是因为**落库的原子正文/引用
 *      必须与送去模型的文本一致**，否则知识库正文里会混入「模型看到的是掩码、
 *      存下来的是原文」这种不可解释的差异；
 *   ③ 无 PII 的普通段落不许被改写（防脱敏误伤业务内容）。
 */
import { describe, expect, it } from "vitest"
import { extractAtomsFromDoc } from "./kbExtract"
import type { LlmMessage } from "@/lib/llm"

// 每段需 ≥40 字才被 splitWithAnchor 收为可抽取段落（MIN_PARA_LEN），太短会整篇 0 段。
//
// 注意：**关键指标句与 PII 必须在同一段**。
// 首版把「电子病历分级」和「联系人手机」拆成两段，于是"只脱敏入参、比对用原文"这种错法
// 根本不触发——模型抄回的那段本来就没有 PII，两边自然一致。反向验证因此抓不到缺陷（假绿）。
// 现在把它们放进同一段，才能证伪"只改一边"。
const PII_TEXT = [
  "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审，验收联系人李四手机 13812345678 负责答疑。",
  "投标保证金账户：开户名称某招标代理有限公司，开户银行某银行总行营业部，银行账号 117010100100295731。",
].join("\n\n")

const PLAIN_TEXT =
  "六安市中医院于 2021 年通过国家卫健委电子病历应用水平分级 5 级评审，是同批参评医院中首个通过的市级中医院，评审流程与材料清单如下。"

/** 收集发往模型的全部文本（跨段累积，不是只看最后一段） */
function makeSink() {
  const chunks: string[] = []
  return {
    get all() {
      return chunks.join("\n")
    },
    push(s: string) {
      chunks.push(s)
    },
  }
}

/** 一个"听话的模型"：把喂给它的片段里含关键指标的那一句原样抄回来 */
function echoModel(sink: ReturnType<typeof makeSink>) {
  return async (messages: LlmMessage[]): Promise<string> => {
    const user = String(messages.find((m) => m.role === "user")?.content ?? "")
    sink.push(user)
    const line = user
      .split(/\n/)
      .map((l) => l.trim())
      .find((l) => l.includes("电子病历应用水平分级")) ?? ""
    // 没有目标句的段直接交空结果（真实模型在无关段落上也会这样返回）
    if (!line) return JSON.stringify({ atoms: [] })
    // 原子必须满足 Zod 结构（title/body/attributes 缺一不可），否则会被结构校验拦下
    return JSON.stringify({
      atoms: [
        {
          atom_type: "metric",
          title: "电子病历应用水平达 5 级",
          body: line,
          subject_key: "metric:电子病历应用水平分级|国家卫健委评测",
          attributes: { value: 5, unit: "级", year: 2021, scope: "国家卫健委评测", polarity: "positive" },
          source_quote: line,
          confidence: 0.9,
        },
      ],
    })
  }
}

describe("知识库原子抽取：进模型前脱敏", () => {
  it("发出去的片段里没有明文手机号/邮箱/银行账号", async () => {
    const sink = makeSink()
    await extractAtomsFromDoc(PII_TEXT, { docTitle: "某医院材料.docx", callLlm: echoModel(sink) })
    const all = sink.all
    expect(all).not.toContain("13812345678")
    expect(all).not.toContain("lisi@hospital.cn")
    expect(all).not.toContain("117010100100295731")
    // 掩码保留头尾，模型仍能读出院方/指标
    expect(all).toContain("138****5678")
    expect(all).toContain("六安市中医院")
    // 银行账号也被掩码（保留后 4 位，方便人工核对是哪一笔）
    expect(all).toContain("5731")
  })

  it("脱敏后抽取仍能成功（证明脱敏没有把抽取能力改坏）", async () => {
    const sink = makeSink()
    const r = await extractAtomsFromDoc(PII_TEXT, { docTitle: "某医院材料.docx", callLlm: echoModel(sink) })
    expect(r.atoms.length).toBeGreaterThan(0)
    expect(r.atoms[0]!.source_quote.length).toBeGreaterThan(0)
    // 落库的引用必须来自「模型看到的文本」，不能混入未脱敏原文
    expect(r.atoms[0]!.source_quote).not.toContain("13812345678")
  })

  it("无 PII 的普通段落原样进模型（不做多余改写）", async () => {
    const sink = makeSink()
    await extractAtomsFromDoc(PLAIN_TEXT, { docTitle: "普通.docx", callLlm: echoModel(sink) })
    expect(sink.all).toContain(PLAIN_TEXT)
  })
})
