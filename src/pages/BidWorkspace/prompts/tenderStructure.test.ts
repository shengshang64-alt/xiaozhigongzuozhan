// T13 解析重构·结构感知层单测（2026-09-28 用户反馈轮：评分办法解析不到）
//
// 用例素材取自真实招标文件提取件（中西医结合第四批 / 安庆二院），锁定三类回归：
//  1) 表格行/目录行/叙述句不作章级标题；拆行标题（第四章\n评标方法和标准）能吸收归一；
//  2) 目录 stub 与正文同名时取最长 span；
//  3) 评分素材：章级评分章 + 节级内嵌评分表（26.3、综合评分：）都能命中，参数表不误吞。
import { describe, expect, it } from "vitest"
import {
  buildScoringMaterial,
  classifyChapterTitle,
  dedupeChaptersByTitle,
  detectTenderChapters,
  isChapterHeadingLine,
  categoryAffinity,
} from "./tenderStructure"

describe("isChapterHeadingLine（表格行/目录行/叙述句排除）", () => {
  it("表格行不作标题（实测「8 | 无线键盘鼠标 | …」曾误判，块归属全乱）", () => {
    expect(isChapterHeadingLine("8 | 无线键盘鼠标 | 可通过无线键盘鼠标方便操作系统配套的软件完成各项操作")).toBe(false)
    expect(isChapterHeadingLine("2 | 主机重量 | 最大承重 150kg，允差±10%")).toBe(false)
  })

  it("目录页码行不作标题（行尾纯页码）", () => {
    expect(isChapterHeadingLine("第四章 评标方法和标准（综合评分法） 197")).toBe(false)
    expect(isChapterHeadingLine("第五章 政府采购合同 234")).toBe(false)
  })

  it("章级标题识别：中文/阿拉伯数字、部分/篇、附件、字间空白", () => {
    expect(isChapterHeadingLine("第四章 评标方法和标准（综合评分法）")).toBe(true)
    expect(isChapterHeadingLine("第四章　评标方法和标准")).toBe(true)
    expect(isChapterHeadingLine("第3章 采购需求")).toBe(true)
    expect(isChapterHeadingLine("第二部分 合同一般条款")).toBe(true)
    expect(isChapterHeadingLine("附件1：评分细则")).toBe(true)
  })

  it("叙述句与普通行不作标题", () => {
    expect(isChapterHeadingLine("详细评标方法和标准见招标文件第四章。")).toBe(false)
    expect(isChapterHeadingLine("21.2 评标严格按照招标文件的要求和条件进行。")).toBe(false)
    expect(isChapterHeadingLine("")).toBe(false)
  })
})

describe("detectTenderChapters + dedupeChaptersByTitle（拆行吸收与 stub 去重）", () => {
  it("裸章号行向后吸收标题行（第四章与标题被提取器拆成两行的真实形态）", () => {
    const text = ["封面信息", "第四章", "评标方法和标准（综合评分法）", "197", "一、总则", "本项目采用综合评分法评标。", "第五章", "政府采购合同", "合同条款正文略。"].join("\n")
    const spans = dedupeChaptersByTitle(detectTenderChapters(text))
    const scoring = spans.filter((s) => s.category === "scoring")
    expect(scoring.length).toBe(1)
    expect(scoring[0].title).toContain("评标方法和标准")
    expect(scoring[0].end - scoring[0].start).toBeGreaterThan(30)
  })

  it("同名目录 stub 与正文 span 取最长（stub 正文仅数十字被丢弃）", () => {
    const body = "一、总则\n本项目采用综合评分法评标，总分 100 分，其中技术部分 60 分、商务部分 20 分、价格部分 20 分。\n二、评分细则\n系统架构先进性（10 分）：采用微服务架构得 8-10 分，单体架构得 0-3 分。\n数据库性能（10 分）：支持百万级并发查询得满分，每降低一个量级扣 3 分。\n信创适配（10 分）：完成国产芯片、操作系统、数据库全栈适配得满分，缺一项扣 4 分。"
    const text = [
      "目录",
      "第一章",
      "投标邀请",
      "1",
      "第四章",
      "评标方法和标准",
      "197",
      "第一章",
      "投标邀请",
      "一、项目名称及内容",
      "某医院信息化项目，预算 3500 万元。",
      "第四章",
      "评标方法和标准（综合评分法）",
      body,
      "第五章",
      "政府采购合同",
      "合同条款略。",
    ].join("\n")
    const spans = dedupeChaptersByTitle(detectTenderChapters(text))
    const scoring = spans.filter((s) => s.category === "scoring")
    expect(scoring.length).toBe(1)
    expect(scoring[0].end - scoring[0].start).toBeGreaterThan(120)
    expect(scoring[0].title).toContain("评标方法和标准")
  })

  it("classifyChapterTitle 类别映射", () => {
    expect(classifyChapterTitle("第四章 评标方法和标准（综合评分法）")).toBe("scoring")
    expect(classifyChapterTitle("第三章 采购需求")).toBe("requirements")
    expect(classifyChapterTitle("第二章 投标人须知")).toBe("instructions")
    expect(classifyChapterTitle("第五章 政府采购合同")).toBe("contract")
    expect(classifyChapterTitle("第六章 投标文件格式")).toBe("format")
  })

  // REQ-015（2026-10-17）：福建政采「第四章 资格审查与评标」合写标题。
  // 修复前该章判 other，导致整章评分素材丢空——96 份真语料里 28 例次、17 份文件 0 字。
  it("REQ-015：资格审查与评标「合写」章名判 scoring（修复前判 other → 评分素材整章丢空）", () => {
    expect(classifyChapterTitle("第四章 资格审查与评标")).toBe("scoring")
    expect(classifyChapterTitle("第四章　资格审查与评标")).toBe("scoring")
    expect(classifyChapterTitle("第四章 资格审查和评标")).toBe("scoring")
    expect(classifyChapterTitle("第三章 资格评审与评标办法")).toBe("scoring")
    // 纯资格审查（不含评标）仍不得误判为评分章：它是资格性审查，评分素材另在别章
    expect(classifyChapterTitle("第三章 资格审查")).not.toBe("scoring")
  })

  it("REQ-015：合写评分章整章进入评分素材（海沧/福安真实形态）", () => {
    // 关键：本样例**不含**前附表「评标方法」行、也无节级评分标题，
    // 故素材非空的唯一来源就是「第四章 资格审查与评标」被判为 scoring 章——
    // 词表一旦回退，本用例必红（2026-10-17 变异实测）。
    const text = [
      "第一章 投标邀请",
      "某医院互联互通测评项目公开招标。",
      "第二章 投标人须知前附表（表1、2）",
      "项号 | 条款号 | 编列内容",
      "第三章 投标人须知",
      "投标文件应包含资格及资信证明文件。",
      "第四章 资格审查与评标",
      "一、资格审查",
      "1 | 营业执照 | 提供有效副本复印件 | 符合要求",
      "二、评审因素与分值构成（不是节级评分标题，避免被 section 兜底掩盖）",
      "本项目采用综合评分法，总分 100 分。",
      "1 | 技术功能响应（30 分） | 完全满足第五章要求得满分 | —",
      "第五章 招标内容及要求",
      "★参数：支持互联互通四甲测评指标。",
      "第六章 政府采购合同（参考文本）",
      "合同条款略。",
    ].join("\n")
    const mat = buildScoringMaterial(text)
    expect(mat).not.toBe("")
    expect(mat).toContain("技术功能响应")
    expect(mat).toContain("本项目采用综合评分法")
    // 相邻章不得混入（须知的投标文件句、第五章参数、第六章合同）
    expect(mat).not.toContain("资格及资信证明文件")
    expect(mat).not.toContain("★参数")
    expect(mat).not.toContain("合同条款略")
  })

  it("REQ-015 反向锁：目录页码行仍是目录行，不得因合写修复被重新认成正文标题", () => {
    // 福安真实形态：正文标题行无页码（认）；目录 stub 带页码（不认）——修复只动词表，不动这条判据
    expect(isChapterHeadingLine("第四章   资格审查与评标 17")).toBe(false)
    expect(isChapterHeadingLine("第四章   资格审查与评标")).toBe(true)
    expect(isChapterHeadingLine("第二章 投标人须知前附表（表1、2） 3")).toBe(false)
  })
})

describe("buildScoringMaterial（评分办法解析不到的主修复）", () => {
  it("章级评分章：中西医结合第四批形态——前附表评标方法行 + 第四章全文", () => {
    // 摘自真实提取件的结构（表格竖线行 + 资格审查表/符合性审查表/评分细则）
    const preface = ["第二章 投标人须知", "一、投标人须知前附表", "21.2 | 评标方法 | □最低评标价法 ☑综合评分法", "22 | 投标保证金 | 本项目免收。"].join("\n")
    const ch4 = [
      "第三章 采购需求",
      "重要指标项 | ★ | 评分项，详见评分细则",
      "1 | 呼吸机 | 技术规格略",
      "第四章 评标方法和标准（综合评分法）",
      "一、总则",
      "本项目采用综合评分法。总分 100 分：技术部分 60 分，商务部分 20 分，价格部分 20 分。",
      "2.2 符合性审查",
      "序号 | 评审指标 | 评审标准 | 格式及材料要求",
      "1 | 开标一览表 | 格式、填写要求符合招标文件规定并加盖投标人电子签章 | 详见第六章投标文件格式",
      "三、评分细则",
      "1 | 系统架构先进性（10 分） | 采用微服务架构得 8-10 分，单体架构得 0-3 分 | —",
      "第五章 政府采购合同",
      "合同条款略。",
    ].join("\n")
    const mat = buildScoringMaterial(`${preface}\n${ch4}`)
    expect(mat).not.toBe("")
    expect(mat).toContain("21.2 | 评标方法")
    expect(mat).toContain("总分 100 分")
    expect(mat).toContain("系统架构先进性")
    // 设备参数区（第三章）不得混入
    expect(mat).not.toContain("呼吸机")
  })

  it("节级内嵌评分表：安庆二院形态——评分办法内嵌在须知章（26.3、综合评分：）", () => {
    const text = [
      "第二章 投标人须知",
      "25、评标方法：采用综合评分方法。",
      "26、评标程序：",
      "26.1、符合性审查略。",
      "26.3、综合评分：",
      "序号 | 评审因素 | 分值 | 评分标准说明",
      "1 | 投标价格分 | 30 分 | 投标人报价得分＝（评标基准价/投标报价）×30％×100",
      "2 | 投标人履约能力评分 | 9 分 | 投标人具有 CMMI5 认证的得 3 分",
      "27、澄清：略。",
      "第三章 服务需求及技术要求",
      "设备参数略。",
    ].join("\n")
    const mat = buildScoringMaterial(text)
    expect(mat).not.toBe("")
    expect(mat).toContain("26.3、综合评分")
    expect(mat).toContain("投标价格分")
    expect(mat).toContain("CMMI5")
    // 评分表之后的 27 节与第三章不得混入
    expect(mat).not.toContain("设备参数略")
  })

  it("无评分章节返回空串（调用方回退通用检索，不硬凑）", () => {
    const text = ["第一章 招标公告", "某医院信息化项目公开招标。", "第二章 投标人须知", "投标截止时间略。"].join("\n")
    expect(buildScoringMaterial(text)).toBe("")
  })
})

describe("REQ-020 超长评分章：整行整项取舍，绝不切在句中", () => {
  /** 造一份超长评分章：章内每行都是一个完整评分项 */
  function longScoringChapter(itemCount: number, lineLen = 200): string {
    const lines = ["第一章 投标人须知", "投标须知略。", "第四章 评标办法"]
    for (let i = 1; i <= itemCount; i++) {
      const pad = "本条评分标准说明".repeat(Math.ceil(lineLen / 8)).slice(0, lineLen)
      lines.push(`${i}-${i} | 评分项${i} | ${pad}`)
    }
    lines.push("第五章 合同条款", "合同条款略。")
    return lines.join("\n")
  }

  it("超长评分章不再被句中切断：素材每一行都必须是原文的完整行", () => {
    // 250 项 × 约 220 字 ≈ 55000 字。**显式给小预算**强制触发截断——
    // 否则章长没超默认上限时根本不会截断，断言等于白测（第一版就踩了这个坑）。
    const text = longScoringChapter(250)
    // 精确到「整行」而不是「子串」：句中硬切出来的残行虽然仍是原文的子串，
    // 但它不等于任何一个原文行。用 Set 做整行比对才抓得住（子串判据恒真，测不出东西）。
    const sourceLines = new Set(text.split("\n").map((l) => l.trim()))
    for (const cap of [30000, 8000, 1500]) {
      const mat = buildScoringMaterial(text, { sectionCap: cap, totalCap: 100000 })
      const bodyLines = mat
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("【评分章节") && !l.startsWith("…（本章超长"))
      expect(bodyLines.length).toBeGreaterThan(0)
      // 核心断言：每一行都必须**等于原文的某一行**（不接受残行/半句）
      const broken = bodyLines.filter((l) => !sourceLines.has(l))
      expect({ cap, broken }).toEqual({ cap, broken: [] })
      // 且确实发生了截断（证明上面这条断言是在截断场景下验的）
      expect(mat).toContain("本章超长")
    }
  })

  it("上限放宽后不再产生截断提示（旧版 30000 会截断）", () => {
    const text = longScoringChapter(250)
    const mat = buildScoringMaterial(text)
    expect(mat).not.toContain("本章超长")
    // 与旧预算对比：显式传旧预算时仍会截断，说明是本轮的常量调整起的效
    const old = buildScoringMaterial(text, { sectionCap: 30000, totalCap: 36000 })
    expect(old).toContain("本章超长")
    // 且旧预算取到的内容严格少于新预算
    expect(old.replace(/\s+/g, "").length).toBeLessThan(mat.replace(/\s+/g, "").length)
  })

  it("预算极小时也不返回空串：至少收下第一整行（不让短预算比旧行为更差）", () => {
    const text = [
      "第四章 评标办法",
      "1-1 | 评分项一 | 说明一",
      "1-2 | 评分项二 | 说明二",
      "第五章 合同条款",
      "略。",
    ].join("\n")
    // 预算给到只够一行
    const mat = buildScoringMaterial(text, { sectionCap: 40, totalCap: 100000 })
    expect(mat).not.toBe("")
    expect(mat).toContain("1-1 | 评分项一 | 说明一")
    // 第二行放不下就整行不要，不许取半行
    expect(mat).not.toContain("1-2")
    expect(mat).toContain("本章超长")
  })

  it("截断提示文案改为「已按整行截断」，与句中断开的旧文案区分", () => {
    const text = longScoringChapter(250)
    const old = buildScoringMaterial(text, { sectionCap: 30000, totalCap: 36000 })
    expect(old).toContain("已按整行截断")
    expect(old).not.toContain("已按上限截断")
  })
})

describe("categoryAffinity（章节亲和打分）", () => {
  it("亲和类别 1 倍、表外 0.34 倍、无亲和表的 key 一视同仁", () => {
    expect(categoryAffinity("tech_score", "scoring")).toBe(1)
    expect(categoryAffinity("tech_score", "requirements")).toBeLessThan(0.5)
    expect(categoryAffinity("delivery_req", "requirements")).toBe(1)
    expect(categoryAffinity("unknown_key", "other")).toBe(1)
  })
})
