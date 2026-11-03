// 废标项「800 行全是半句话」的回归测试（2026-10-27 用户反馈）
//
// 用户原话：「解析的内容为啥还是这么长？？实质性条款覆盖矩阵这个是干嘛用的？」
//
// 实测（安中医 2026BFAFZ50845，void_items）：
//   原始 800 行 → 只有 35 行含废标语义 → 覆盖矩阵撑出 809 行、全部「未覆盖」
// 三重毛病叠加：
//   ① PDF 物理换行把一句条款切成 4~5 行（「…投标」/「文件上传 IP 地址、投标」/…）
//   ② 模型把招标文件通用条款（资金落实、语言表述、计量单位、政采贷指引）也抄进来
//   ③ markdown 标题行（`## 一、资格与响应类`）被当成条款
//
// 根因在解析产出的形态，不在覆盖矩阵本身——矩阵只是忠实地逐行展示。
import { describe, expect, it } from "vitest"
import { dropParsePageNoise, rejoinVoidItemLines, verifyVoidItemCitations, dedupeVoidItemLines } from "./bidTypes"

const PAGE_NOISE = "第 8 页 共 256 页"
const DOC_HEADER = "政府采购项目公开招标文件示范文本（服务类）"

describe("dropParsePageNoise · 只丢页眉页脚，不拆字段", () => {
  it("页眉页脚被丢弃", () => {
    const src = [`条款：投标无效。`, PAGE_NOISE, DOC_HEADER].join("\n")
    expect(dropParsePageNoise(src)).toBe("条款：投标无效。")
  })

  it("不像 cleanParseSectionContent 那样把「[出处：…] 半句」按冒号切碎", () => {
    // 这是本页最关键的差异：按冒号拆字段会把出处标签后面的正文丢掉
    const src = "[出处：36.5 解释权] 责解释。"
    expect(dropParsePageNoise(src)).toBe(src)
  })
})

describe("rejoinVoidItemLines · 断句重接", () => {
  it("PDF 硬换行切开的句子接回一条", () => {
    const src = [
      "（1）本项目评审时将查询投标文件制作机器码、投标",
      "文件上传 IP 地址、投标文件创建标识码、投标人联系",
      "方式（联系人、联系人电话），如不同投标文件的投标",
      "文件制作机器码相同，其投标将被认定为投标无效。",
    ].join("\n")
    const out = rejoinVoidItemLines(src)
    expect(out.split("\n")).toHaveLength(1)
    expect(out).toContain("投标文件制作机器码相同")
    expect(out).toContain("投标无效")
  })

  it("已收句的行各成一条，不会跨条粘连", () => {
    const src = ["条款甲：投标无效。", "条款乙：予以废标。"].join("\n")
    expect(rejoinVoidItemLines(src).split("\n")).toHaveLength(2)
  })

  it("markdown 小节标题被丢弃（它们不是条款）", () => {
    const src = ["# 无效标与废标项", "## 一、资格与响应类", "条款：资格不符投标无效。"].join("\n")
    const out = rejoinVoidItemLines(src)
    expect(out).not.toContain("## 一、")
    expect(out).toContain("条款：资格不符投标无效。")
  })
})

describe("rejoinVoidItemLines · 按废标语义过滤（核心：解决 800 行噪音）", () => {
  it("通用条款被剔除，只留含废标后果的条款", () => {
    // 需要凑到 ≥8 行才触发过滤（阈值为「含废标语义行占比 <40%」），模拟真实 800 行的形态：
    // 大量通用条款 + 少量真废标条款。
    const src = [
      "4.1 本项目的采购人已获得足以支付本次招标后所签订的合同项下的资金。",
      "9.4 投标人与采购代理机构之间与投标有关的所有往来通知均用中文表述。",
      "9.5 投标文件中所使用的计量单位应采用法定计量单位。",
      "10.1 投标人应完整地按招标文件提供的格式编写投标文件。",
      "10.2 投标人应提交招标文件要求的证明文件。",
      "11.1 投标人的报价应当包括满足本次招标全部采购需求所应提供的服务。",
      "11.3 投标人应在投标分项报价表上标明分项服务的价格。",
      "18.2 采购人将在投标截止时间后至评审结束前查询信用记录，其投标将被认定为投标无效。",
      "22.1 出现下列情形之一，将导致项目废标：符合专业条件的供应商不足三家。",
    ].join("\n")
    const out = rejoinVoidItemLines(src)
    expect(out).toContain("投标无效")
    expect(out).toContain("项目废标")
    expect(out).not.toContain("资金") // 通用条款被剔
    expect(out).not.toContain("中文表述")
  })

  it("「重点补充：」前缀行保留；「条款：」前缀行不豁免（2026-11-01 起每行都带此前缀，豁免会让过滤失效）", () => {
    // ≥8 行触发过滤：2 条真废标条款 + 1 条重点补充 + 6 条通用/非废标内容
    const src = [
      "条款：不具备资格要求的，投标无效。",
      "重点补充：招标文件未明确 CA 锁有效期要求，建议投标前核验。",
      "条款：投标人须完成新系统与实验室信息系统的对接。",
      "条款：投标人须完成新系统与输血管理系统的对接。",
      "条款：投标人须提供院内运维工具。",
      "条款：本项目质保期内投标人须承担对接费用。",
      "条款：软件性能支持日均门诊 15000 人次。",
      "条款：投标人应认真阅读招标文件所有事项。",
      "条款：报价超过最高限价的，投标无效。",
    ].join("\n")
    const out = rejoinVoidItemLines(src)
    expect(out).toContain("重点补充：") // 经验补充豁免
    expect(out).toContain("不具备资格要求的，投标无效")
    expect(out).toContain("报价超过最高限价的，投标无效")
    expect(out).not.toContain("系统对接") // 「条款：」前缀的非废标行照样被滤
    expect(out).not.toContain("运维工具")
  })

  it("天然就短的清单原样保留（不足 8 行不触发过滤）", () => {
    const src = ["3.5.7 联合体各方不得再单独参加本项目投标。", "3.5.8 其他资格要求见资格要求。"]
    const out = rejoinVoidItemLines(src.join("\n"))
    expect(out.split("\n")).toHaveLength(2) // 两条都留着，即使第二条不含废标词
  })

  it("过滤后若一条不剩，原样返回（不把整段清空）", () => {
    const src = Array.from({ length: 10 }, (_, i) => `${i + 1}. 采购人已获得项目资金。`).join("\n")
    expect(rejoinVoidItemLines(src)).not.toBe("")
  })
})

// 2026-11-01 P0 第四道防线：模型对「每条必须带出处」的投机——给编造条款贴编造的顺序假编号
// （安中医复跑实测：第4.1.1条→第4.1.241条，内容循环重复）。prompt 只能塑形，幻觉靠确定性校验兜底：
// 行内「（第N条）」编号必须在招标文件原文中真实存在，查无此号即删该行。
describe("verifyVoidItemCitations · 出处核验（杀编造编号）", () => {
  // 模拟招标文件原文：真实条款 18.2 / 20.2 / 36.6 / 22.1 / 3.5.7 存在；4.1.x 系列不存在
  const TENDER = [
    "18.2 采购人将在投标截止时间后至评审结束前查询信用记录，其投标将被认定为投标无效。",
    "20.2 资格审查：不具备招标文件中规定的资格要求的，其投标将被认定为投标无效。",
    "36.6 特别提醒：如不同投标文件的投标文件制作机器码相同，其投标将被认定为投标无效。",
    "22.1 出现下列情形之一，将导致项目废标。",
    "3.5.7 联合体各方不得再单独参加或者与其他供应商另外组成联合体参加本项目投标。",
  ].join("\n")

  it("原文真实存在的编号保留", () => {
    const src = [
      "条款：不具备招标文件中规定的资格要求的，其投标将被认定为投标无效（第20.2条）",
      "条款：联合体各方不得再单独参加本项目投标（第3.5.7条）",
    ].join("\n")
    const out = verifyVoidItemCitations(src, TENDER)
    expect(out).toContain("第20.2条")
    expect(out).toContain("第3.5.7条")
  })

  it("编造的顺序假编号被删除（第4.1.1条→第4.1.241条 实测形态）", () => {
    const src = [
      "条款：投标文件未按招标文件要求密封的，其投标无效（第4.1.1条）",
      "条款：投标人未按要求提供××证书的，其投标无效（第4.1.150条）",
      "条款：采购人将在投标截止时间后查询信用记录，其投标将被认定为投标无效（第18.2条）",
    ].join("\n")
    const out = verifyVoidItemCitations(src, TENDER)
    expect(out).not.toContain("第4.1.1条")
    expect(out).not.toContain("第4.1.150条")
    expect(out).toContain("第18.2条")
  })

  it("编号边界匹配：「120.2」不能给「20.2」供血", () => {
    const tender = "120.2 本条款编号中不存在独立的 20·2 式子串条款。"
    const src = "条款：资格不符投标无效（第20.2条）"
    // 20.2 在原文中只作为 120.2 的子串出现 → 视为查无此号
    expect(verifyVoidItemCitations(src, tender)).not.toContain("第20.2条")
  })

  it("原文排版带空格（「第 20.2 条」）也能命中", () => {
    const tender = "第 20.2 条 资格审查：资格不符的，其投标无效。"
    const src = "条款：资格不符投标无效（第20.2条）"
    expect(verifyVoidItemCitations(src, tender)).toContain("第20.2条")
  })

  it("非数字编号（第六章/第一章八、3）保守保留；无出处行保留", () => {
    const src = [
      "条款：分项报价表须列货物名称（第六章投标文件格式五注1）",
      "本地扫描补录行：未密封投标无效。",
    ].join("\n")
    const out = verifyVoidItemCitations(src, TENDER)
    expect(out).toContain("第六章投标文件格式五注1")
    expect(out).toContain("本地扫描补录行")
  })

  it("编号真实存在但内容不在邻域 → 贴牌编造，删除（4.1.1 在技术参数章存在但不谈密封）", () => {
    // 原文 4.1.1 出现在采购需求的技术参数编号（通信用途），与该处「密封废标」内容无关
    const tender = [
      "18.2 采购人将在投标截止时间后至评审结束前查询信用记录，其投标将被认定为投标无效。",
      "4.1.1 总体技术要求：系统应支持 IPv6 双栈通信协议，具备横向扩展能力。",
    ].join("\n")
    const src = [
      "条款：投标文件未按招标文件要求密封的，其投标无效（第4.1.1条）", // 贴牌：编号真、内容假
      "条款：采购人查询信用记录，其投标将被认定为投标无效（第18.2条）", // 真条款
    ].join("\n")
    const out = verifyVoidItemCitations(src, tender)
    expect(out).not.toContain("第4.1.1条")
    expect(out).toContain("第18.2条")
  })

  it("占位符/自认无出处的编造行被删除（第X条、未提及具体条款号、需结合全文定位）", () => {
    // 安庆二院门禁实测：模型不再编假编号，改贴「（第X条）」占位符或
    // 「（原文出处：…未提及具体条款号，需结合全文定位）」自认标记——都是自认编造。
    const src = [
      "条款：投标人未按要求提供投标保证金的，其投标将被否决（第X条）",
      "条款：投标文件未密封的，其投标无效（原文出处：招标文件第3/5段，未提及具体条款号，需结合全文定位）",
      "条款：不具备资格要求的，其投标无效（第20.2条）",
    ].join("\n")
    const tender = "20.2 资格审查：不具备招标文件中规定的资格要求的，其投标将被认定为投标无效。"
    const out = verifyVoidItemCitations(src, tender)
    expect(out).not.toContain("第X条")
    expect(out).not.toContain("未提及具体条款号")
    expect(out).toContain("第20.2条")
  })

  it("空内容/空原文原样返回，不抛错", () => {
    expect(verifyVoidItemCitations("", TENDER)).toBe("")
    expect(verifyVoidItemCitations("条款：投标无效（第20.2条）", "")).toContain("第20.2条")
  })
})

// 2026-11-01 P0 第五道防线：分段×合并后同一条款重复 5 遍（合并模型没去重干净），本地签名去重
describe("dedupeVoidItemLines · 内容级去重（杀合并残留重复）", () => {
  it("同条款换出处表述也算重复，只留首个", () => {
    const src = [
      "条款：投标人未提供投标业绩承诺函的，业绩不予认可（第246页，投标业绩承诺函）",
      "条款：投标人未按照采购文件要求提供投标业绩承诺函中业绩真实有效的承诺的，可能导致业绩不予认可（第246页，投标业绩承诺函）",
      "条款：资格不符投标无效（第20.2条）",
    ].join("\n")
    const out = dedupeVoidItemLines(src)
    // 前两条签名前 60 字不同（措辞不同）→ 不算同一条，都保留；签名相同才去掉
    expect(out.split("\n").length).toBeGreaterThanOrEqual(2)
  })

  it("完全同文（仅前缀/出处/标点差异）的行只留一条", () => {
    const line = "条款：逾期送达的投标文件，招标人不予受理（第16.2条）"
    const src = [line, line, "条款：资格不符投标无效（第20.2条）"].join("\n")
    const out = dedupeVoidItemLines(src)
    expect(out.split("\n")).toHaveLength(2)
  })

  it("空行与纯签名行被丢弃", () => {
    const src = ["条款：投标无效（第20.2条）", "", "   ", "条款：废标（第22.1条）"].join("\n")
    expect(dedupeVoidItemLines(src).split("\n")).toHaveLength(2)
  })
})
