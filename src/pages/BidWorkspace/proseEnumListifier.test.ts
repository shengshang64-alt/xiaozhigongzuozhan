// REQ-026 单测：超长顿号清单 → 分行条目（顿号换换行，不加编号、不增字）。
// 断言对象是行为与不变量。核心不变量只有一条，但必须守住：
//   输出的各行用「、」拼回去，与原句**逐字相同**（零增字、零改字）。
// 其余断言都是「不该动的别动」。
import { describe, it, expect } from "vitest"
import {
  listifySentence,
  listifyEnumeration,
  findSplittableDunhao,
  splitKeepingEnds,
  ENUM_MIN_SENT_CHARS,
  ENUM_MIN_ITEMS,
  ENUM_ITEM_MAX_CHARS,
} from "./proseEnumListifier"

/** 造一个超长顿号清单句（项名取真实系统名量级 10-13 字，才能到真实病灶长度） */
function makeEnum(n: number, item = "某某业务管理系统平台"): string {
  const items = Array.from({ length: n }, (_, i) => `${item}${i + 1}期`)
  return `实验室信息系统与${items.join("、")}等系统的对接。`
}

describe("REQ-026 超长顿号清单 → 分行", () => {
  it("★ 核心不变量：分行后用「、」拼回，与原句逐字相同", () => {
    const src = makeEnum(20)
    expect(src.length).toBeGreaterThan(ENUM_MIN_SENT_CHARS)
    const lines = listifySentence(src)
    expect(lines).not.toBeNull()
    expect(lines!.length).toBeGreaterThan(ENUM_MIN_ITEMS)
    expect(lines!.join("、")).toBe(src)
  })

  it("不加编号、不加冒号：除顿号变换行外不新增任何字符", () => {
    const src = makeEnum(20)
    const lines = listifySentence(src)!
    // 每行不得以「N.」开头（有序列表只用于步骤/流程，罗列系统名不编号）
    expect(lines.every((l) => !/^\d+\.\s/.test(l))).toBe(true)
    // 不新增冒号
    expect(lines.join("、")).not.toContain("：")
  })

  it("每一行都短于阈值（这才是分行的意义）", () => {
    const lines = listifySentence(makeEnum(20))!
    const longs = lines.filter((l) => l.length > ENUM_MIN_SENT_CHARS)
    expect(longs).toEqual([])
  })

  it("项长按「去掉括注后」计：括注很长也仍算短项（否则真实系统名会被误拒）", () => {
    // 真实形态：项名 7 字 + 括注 40 字 ≈ 47 字原始长度，去括注后仅 7 字。
    // 若按原始长度判，这一项超阈值 → 整句被拒；按去括注后判则能正常分行。
    const note = "（现用系统：北京CA、院感监测管理系统、医学影像存档与通信系统等）"
    const items = Array.from({ length: 20 }, (_, i) =>
      i === 2 ? `电子签名${note}` : `某某业务管理系统平台${i + 1}期`,
    )
    const src = `实验室信息系统与${items.join("、")}等系统的对接。`
    expect(src.length).toBeGreaterThan(ENUM_MIN_SENT_CHARS)
    const lines = listifySentence(src)
    expect(lines).not.toBeNull()
    expect(lines!.join("、")).toBe(src)
    // 该项必须完整成一行（括注里的顿号都是不切点）
    expect(lines!.some((l) => l.includes(note))).toBe(true)
  })

  it("括号内的顿号不切（括注属于同一项）", () => {
    const items = Array.from({ length: 22 }, (_, i) =>
      i === 3 ? `专病库管理系统（含高质量数据集、随访库）` : `某某业务管理系统平台${i + 1}期`,
    )
    const src = `实验室信息系统与${items.join("、")}等系统的对接。`
    expect(src.length).toBeGreaterThan(ENUM_MIN_SENT_CHARS)
    const lines = listifySentence(src)
    expect(lines).not.toBeNull()
    expect(lines!.join("、")).toBe(src)
    // 括注里的顿号没被当成切点：那一项仍完整在一行内
    expect(lines!.some((l) => l.includes("（含高质量数据集、随访库）"))).toBe(true)
    expect(findSplittableDunhao("甲（乙、丙）、丁")).toEqual([6])

    // ★ 关键断言：任意一行内不得出现「括号不配对」——
    //   「拼回等于原文」挡不住这个错误（切点本身就是顿号，切开后照样能拼回），
    //   故必须直接验证每行的括号自闭合。这是变异 M1（删括号过滤）唯一能杀死的形态。
    for (const l of lines!) {
      const open = (l.match(/[（(]/g) ?? []).length
      const close = (l.match(/[）)]/g) ?? []).length
      expect(open, `行内括号必须自闭合：${l}`).toBe(close)
    }
  })

  it("并列项过长（复句而非罗列）→ 整句放弃", () => {
    const longItem = "该项目建设完成之后需在院内开展为期不少于三个月的并行运行并完成全部科室的全量数据迁移与核验"
    expect(longItem.length).toBeGreaterThan(ENUM_ITEM_MAX_CHARS)
    const items = Array.from({ length: 22 }, (_, i) => (i === 2 ? longItem : `某某业务管理系统平台${i}期`))
    const src = `实验室信息系统与${items.join("、")}等系统的对接。`
    expect(src.length).toBeGreaterThan(ENUM_MIN_SENT_CHARS)
    expect(listifySentence(src)).toBeNull()
  })

  it("短于触发阈值 → 不处理", () => {
    const short = `实验室信息系统与${Array.from({ length: 5 }, (_, i) => `某某业务管理系统平台${i}期`).join("、")}的对接。`
    expect(short.length).toBeLessThan(ENUM_MIN_SENT_CHARS)
    expect(listifySentence(short)).toBeNull()
    // 对照组：同形态但更长 → 能转换（证明 null 来自阈值，不是别的）
    expect(listifySentence(makeEnum(20))).not.toBeNull()
  })

  it("顿号项不足 ENUM_MIN_ITEMS → 不处理", () => {
    const items = Array.from({ length: ENUM_MIN_ITEMS - 1 }, (_, i) => `某某业务管理系统平台${i + 1}期`)
    const src = `${"本项目需完成以下各业务系统的建设与集成对接工作，".repeat(12)}涉及${items.join("、")}的对接。`
    expect(src.length).toBeGreaterThan(ENUM_MIN_SENT_CHARS)
    expect(listifySentence(src)).toBeNull()
  })

  it("表格行不动（全角空格分列 → 导出器据此建 docx Table）", () => {
    const body = makeEnum(20)
    const table = `序号\u3000名称\u3000说明\n1\u3000${body}`
    const r = listifyEnumeration(table)
    expect(r.hits).toBe(0)
    expect(r.converted).toBe(table)
  })

  it("标题行 / 图位锚点 / markdown 表格行一律不动", () => {
    const src = ["1.1 某某节", "【图：总体架构】", "| 甲 | 乙 |", makeEnum(20)].join("\n")
    const r = listifyEnumeration(src)
    const lines = r.converted.split("\n")
    expect(lines[0]).toBe("1.1 某某节")
    expect(lines[1]).toBe("【图：总体架构】")
    expect(lines[2]).toBe("| 甲 | 乙 |")
    expect(r.hits).toBe(1) // 只有最后一行该转
  })

  it("幂等：已转换的正文再跑一次不再变化", () => {
    const once = listifyEnumeration(makeEnum(20)).converted
    const twice = listifyEnumeration(once).converted
    expect(twice).toBe(once)
  })

  it("没有可转换句子的正文逐字不变（含空串）", () => {
    const plain = "本项目按招标文件要求实施。\n系统上线后提供 7×24 小时运维服务。"
    expect(listifyEnumeration(plain).converted).toBe(plain)
    expect(listifyEnumeration("").converted).toBe("")
  })

  it("整篇：只转换够长的句子，短句原样保留（不跨句乱切）", () => {
    const mid = "普通正文段落一。".repeat(5)
    const src = `${makeEnum(22)}\n${mid}\n${makeEnum(20)}`
    const out = listifyEnumeration(src)
    expect(out.hits).toBe(2)
    expect(out.skipped).toBe(0)
    // 中间那行是短句，必须整行逐字不变地出现在输出里
    expect(out.converted.split("\n")).toContain(mid)
  })

  it("splitKeepingEnds：句末标点留在句尾，不丢字符", () => {
    const t = "第一句。第二句！第三句？尾部无句号"
    expect(splitKeepingEnds(t).join("")).toBe(t)
    expect(splitKeepingEnds(t)).toHaveLength(4)
  })
})
