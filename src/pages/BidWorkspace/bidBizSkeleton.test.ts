import { describe, expect, it } from "vitest"
import {
  buildBizSkeleton,
  buildSkeletonsForEmptyBizChapters,
  classifyBizChapter,
} from "./bidBizSkeleton"

// ---------------------------------------------------------------------------
// 商务章节骨架生成验收测试（2026-10-31 标书生成打磨）
//
// 背景（真实项目实测）：
//   19 章里 10 章是商务章（part=biz），全部 content 为空、gen_status=pending。
//   这是**设计正确**的——投标函/授权书/报价表是法律文件，AI 不能代写。
//   但用户看到空白章节不知道怎么办，缺的是行动指引。
//
// 本测试锁住两条底线：
//   ① 骨架只留【待填】，绝不生成任何实质内容（公司名/金额/承诺/业绩）
//   ② 分类要准（业绩承诺函 ≠ 服务承诺函）
// ---------------------------------------------------------------------------

describe("classifyBizChapter：商务章节分类", () => {
  it("投标函 / 开标一览表", () => {
    expect(classifyBizChapter("投标函")).toBe("bid_letter")
    expect(classifyBizChapter("投标书")).toBe("bid_letter")
    expect(classifyBizChapter("开标一览表")).toBe("open_summary")
  })

  it("资格与授权类", () => {
    expect(classifyBizChapter("投标人资格声明书及营业执照等证明文件")).toBe("qualification")
    expect(classifyBizChapter("授权书及法定代表人身份证明")).toBe("authorization")
  })

  it("报价与响应表", () => {
    expect(classifyBizChapter("投标分项报价表")).toBe("price_sheet")
    expect(classifyBizChapter("投标响应表（商务响应表及其他材料）")).toBe("response_sheet")
  })

  it("业绩类优先于承诺类（真实踩坑：业绩承诺函含承诺函字样）", () => {
    expect(classifyBizChapter("投标业绩承诺函及类似项目业绩")).toBe("performance")
    expect(classifyBizChapter("类似项目业绩")).toBe("performance")
    // 纯服务承诺仍归 commitment
    expect(classifyBizChapter("服务承诺及售后服务承诺函")).toBe("commitment")
  })

  it("人员与政策性声明", () => {
    expect(classifyBizChapter("人员配备及项目团队资格证明")).toBe("team")
    expect(classifyBizChapter("政策性声明、诚信履约承诺及其他证明材料")).toBe("policy_declaration")
  })

  it("无法识别时归 generic（不硬套）", () => {
    expect(classifyBizChapter("其他商务材料")).toBe("generic")
  })
})

describe("buildBizSkeleton：骨架不含任何编造内容", () => {
  const kinds = [
    "投标函",
    "开标一览表",
    "投标人资格声明书及营业执照等证明文件",
    "授权书及法定代表人身份证明",
    "投标分项报价表",
    "投标响应表",
    "人员配备",
    "服务承诺及售后服务承诺函",
    "投标业绩承诺函及类似项目业绩",
    "政策性声明",
  ]

  it("所有类型都有【待填】占位（不写实质内容）", () => {
    for (const k of kinds) {
      const s = buildBizSkeleton(k)
      expect(s.content).toContain("【待填")
    }
  })

  it("骨架不出现具体金额（防止误填假价格）", () => {
    for (const k of kinds) {
      const s = buildBizSkeleton(k)
      // 不允许出现像「￥123,456」或「123 万元」这类具体金额
      expect(s.content).not.toMatch(/[¥￥]\s*\d/)
      expect(s.content).not.toMatch(/\d+\s*(万元|元整)/)
    }
  })

  it("骨架不编造业绩数字或客户名", () => {
    for (const k of kinds) {
      const s = buildBizSkeleton(k)
      expect(s.content).not.toMatch(/已完成\s*\d+\s*个项目/)
      expect(s.content).not.toMatch(/\d{2,}家医院/)
    }
  })

  it("每类都带 why 说明（告知用户为何不代写）", () => {
    for (const k of kinds) {
      const s = buildBizSkeleton(k)
      // 说明必须足够具体（不能一句话敷衍）
      expect(s.why.length).toBeGreaterThan(15)
      // 且必须点明"要用户自己填"的性质（真实/如实/你方/盖章/承诺 之类）
      expect(
        ["法律", "无效", "虚假", "真实", "废标", "承诺", "责任", "法规", "你方", "填写", "盖章", "签署", "决策"].some(
          (w) => s.why.includes(w),
        ),
      ).toBe(true)
    }
  })

  it("投标函含关键字段占位（项目名称/报价/有效期/盖章）", () => {
    const s = buildBizSkeleton("投标函")
    expect(s.content).toContain("项目名称")
    expect(s.content).toContain("大写")
    expect(s.content).toContain("投标有效期")
    expect(s.content).toContain("盖章")
  })

  it("业绩章提醒需可查证材料", () => {
    const s = buildBizSkeleton("类似项目业绩")
    expect(s.content).toContain("证明材料")
    expect(s.requiredAttachments.length).toBeGreaterThan(0)
  })

  it("资格章列出需准备附件", () => {
    const s = buildBizSkeleton("资格声明")
    expect(s.requiredAttachments).toContain("营业执照")
  })
})

describe("buildSkeletonsForEmptyBizChapters：只补空的商务章", () => {
  const chapters = [
    { node_id: "c1", title: "投标函", part: "biz", content: "" },
    { node_id: "c2", title: "总体技术解决方案", part: "tech", content: "技术内容" },
    { node_id: "c3", title: "授权书", part: "biz", content: "已有内容不覆盖" },
    { node_id: "c4", title: "分项报价表", part: "biz", content: "   " }, // 空白字符也算空
  ]

  it("只处理 part=biz 且正文为空的章", () => {
    const out = buildSkeletonsForEmptyBizChapters(chapters)
    expect(out.map((x) => x.nodeId).sort()).toEqual(["c1", "c4"])
  })

  it("已有内容不覆盖（用户可能已填）", () => {
    const out = buildSkeletonsForEmptyBizChapters(chapters)
    expect(out.find((x) => x.nodeId === "c3")).toBeUndefined()
  })

  it("技术章不处理", () => {
    const out = buildSkeletonsForEmptyBizChapters(chapters)
    expect(out.find((x) => x.nodeId === "c2")).toBeUndefined()
  })

  it("返回分类结果便于界面提示", () => {
    const out = buildSkeletonsForEmptyBizChapters(chapters)
    expect(out[0].kind).toBeTruthy()
    expect(out[0].content.length).toBeGreaterThan(50)
  })

  it("空数组安全", () => {
    expect(buildSkeletonsForEmptyBizChapters([])).toHaveLength(0)
  })
})
