// R284（r283-table-empty-cell-placeholder）：全库表格空列占位普查扫描器的判据单测。
// 背景：R283 只修了「编制依据表」编号列占位一类；本扫描器把全库正文里
// 「行内含类型词/表头词但列位为占位」的同类形态普查归类。此处锈死三类判据的边界：
//   结构性空列（可消除候选）/ 信息位空缺（须人工，优先级高于结构性）/ 其余（逐条判）。
// 扫描器带入口守卫（import 不触发扫描），本文件只测导出的纯函数，零 DB、零 AI。
import { describe, expect, it } from "vitest"
import {
  classifyLine,
  familyOf,
  normalizeBasisPlaceholders,
  scanContent,
} from "./bid-table-placeholder-scan.mjs"

const PH = "【待填写】"

describe("normalizeBasisPlaceholders（与 bidTypes 同源判据的脚本侧镜像）", () => {
  it("无编号依据行：编号列占位规整为／，名称与类型词原样保留", () => {
    const line = `3. 信息安全技术 网络安全等级保护基本要求  ${PH}  推荐性国家标准`
    const out = normalizeBasisPlaceholders(line)
    expect(out).not.toContain(PH)
    expect(out).toContain("／")
    expect(out).toContain("推荐性国家标准")
  })

  it("名称已含标准编号 → 真漏填，保留占位不掩盖", () => {
    const line = `GB/T 22239 信息安全技术 ${PH}  强制性国家标准`
    expect(normalizeBasisPlaceholders(line)).toBe(line)
  })

  it("句式「按【待填写】标准执行」不误伤（类型词后另有实词，非条目末列）", () => {
    const line = `本项目全部服务须按${PH}标准执行，验收时逐条核对。`
    expect(normalizeBasisPlaceholders(line)).toBe(line)
  })

  it("幂等：二次调用结果不变", () => {
    const once = normalizeBasisPlaceholders(`项目初步设计报告  ${PH}  项目依据`)
    expect(normalizeBasisPlaceholders(once)).toBe(once)
  })
})

describe("classifyLine 三分判据", () => {
  it("S1：任意表格族中「占位紧跟类型词并以分隔收束」记为结构性", () => {
    const { structural, info, other } = classifyLine(`人员配置表：系统管理员  ${PH}  岗位规范`)
    expect(structural).toBe(1)
    expect(info).toBe(0)
    expect(other).toBe(0)
  })

  it("信息位优先于 S3：「【待填写】年」不得被结构性判据吞掉", () => {
    const { structural, info } = classifyLine(`免费质保延长${PH}年，自终验之日起计算`)
    expect(info).toBe(1)
    expect(structural).toBe(0)
  })

  it("信息位优先于 S3：「【待填写】元/次」记为信息位", () => {
    const { structural, info } = classifyLine(`远程支持  ${PH}元/次`)
    expect(info).toBe(1)
    expect(structural).toBe(0)
  })

  it("S3：占位独占列位（前后 2+ 空白列分隔）记为结构性", () => {
    const { structural, other } = classifyLine(`张三  ${PH}  系统集成工程师  5年`)
    expect(structural).toBe(1)
    expect(other).toBe(0)
  })

  it("裸句中嵌入占位（无列分隔/类型词/单位）记为其余", () => {
    const { structural, info, other } = classifyLine(`具体测评范围见${PH}相关内容说明。`)
    expect(structural).toBe(0)
    expect(info).toBe(0)
    expect(other).toBe(1)
  })

  it("无占位行全零", () => {
    expect(classifyLine("本章无占位符。")).toEqual({ structural: 0, info: 0, other: 0 })
  })
})

describe("familyOf 表格族归类", () => {
  it("S1 类型词行归 basis 而非 param-response（「标准」不得把依据行抢走）", () => {
    expect(familyOf(`等保基本要求  ／  推荐性国家标准`).id).toBe("basis")
  })
  it("参数偏离行归 param-response", () => {
    expect(familyOf(`服务器 CPU 32核  ${PH}  正偏离`).id).toBe("param-response")
  })
  it("人员行归 staffing", () => {
    expect(familyOf(`项目经理  ${PH}  高级职称`).id).toBe("staffing")
  })
  it("纯叙述行归 other", () => {
    expect(familyOf(`我公司高度重视服务质量。`).id).toBe("other")
  })
})

describe("scanContent 行级扫描", () => {
  it("只返回含占位的行，带位置与族标签", () => {
    const content = ["第一行没有占位", `质保延长${PH}年，请商务确认`, `  ${PH}  列位独占  `].join("\n")
    const hits = scanContent(content, "测试章")
    expect(hits).toHaveLength(2)
    expect(hits[0].where).toBe("测试章")
    expect(hits[0].lineNo).toBe(2)
    expect(hits[0].info).toBe(1)
    expect(hits[1].structural).toBe(1)
  })

  it("空正文返回空数组", () => {
    expect(scanContent("", "测试章")).toEqual([])
  })

  it("R283 已修簇经同源规整后不再计入（口径与 gate 对齐）", () => {
    const content = `项目实施方案  ${PH}  项目依据\n其它说明文字。`
    const before = scanContent(content, "x").reduce((n, h) => n + h.structural + h.info + h.other, 0)
    const after = scanContent(normalizeBasisPlaceholders(content), "x").reduce(
      (n, h) => n + h.structural + h.info + h.other,
      0,
    )
    expect(before).toBe(1)
    expect(after).toBe(0)
  })
})
