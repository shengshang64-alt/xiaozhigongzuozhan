/**
 * 三份部门检查清单原文回归网（node 环境，零 AI，不触网）。
 *
 * 守的是「原样导入」四个字：条数逐行核对过、条文逐字照抄、序号保留原文形态。
 * 数字来源（openpyxl 逐行解析三份参照 xlsx 后人工核对，非估算）：
 *   招标书   数据区 r5-r16：条目 10 + 分区 2，表尾 r17 → 非表头行 13
 *   投标文件 数据区 r5-r32：条目 24 + 分区 4，表尾 r33 → 非表头行 29
 *   解决方案 数据区 r5-r23：条目 17 + 分区 2，表尾 r24 → 非表头行 20
 * 任一行被改写、精简、合并措辞或被解析器吃掉，这里必须红。
 */
import { describe, expect, it } from "vitest"
import {
  CHECKLIST_DEFS,
  DEPT_CHECK_LOG_CAP,
  buildDeptCheckRows,
  deptCheckEntryCount,
  deptCheckRowTotal,
  deptChecklistDef,
  emptyDeptCheckMeta,
} from "./bidChecklists"

const CN_SECTION_NO = /^[一二三四五六七八九十]+$/
const ARABIC_NO = /^\d+$/

describe("bidChecklists：三份清单条数与结构（与源表逐行核对）", () => {
  it("只定义三份清单，key/title 与源表一致", () => {
    expect(CHECKLIST_DEFS.map((d) => d.key)).toEqual(["tender", "bid", "sol"])
    expect(deptChecklistDef("tender")?.title).toBe("招标书检查表")
    expect(deptChecklistDef("bid")?.title).toBe("投标文件检查表（技术部分）")
    expect(deptChecklistDef("sol")?.title).toBe("解决方案检查表")
    expect(deptChecklistDef("nope")).toBeUndefined()
  })

  it("招标书检查表：条目 10（分区 2），源表非表头行 13", () => {
    const def = deptChecklistDef("tender")!
    expect(deptCheckEntryCount(def)).toBe(10)
    expect(def.items.filter((i) => i.section)).toHaveLength(2)
    expect(deptCheckRowTotal(def)).toBe(13)
  })

  it("投标文件检查表：条目 24（分区 4），源表非表头行 29", () => {
    const def = deptChecklistDef("bid")!
    expect(deptCheckEntryCount(def)).toBe(24)
    expect(def.items.filter((i) => i.section)).toHaveLength(4)
    expect(deptCheckRowTotal(def)).toBe(29)
  })

  it("解决方案检查表：条目 17（分区 2），源表非表头行 20", () => {
    const def = deptChecklistDef("sol")!
    expect(deptCheckEntryCount(def)).toBe(17)
    expect(def.items.filter((i) => i.section)).toHaveLength(2)
    expect(deptCheckRowTotal(def)).toBe(20)
  })

  it("分区行只认中文序号且无细则；条目行只认阿拉伯序号（或原表缺号），内容非空", () => {
    for (const def of CHECKLIST_DEFS) {
      for (const it of def.items) {
        expect(it.content.trim().length).toBeGreaterThan(0)
        // 首尾空白已清理（内部换行原样保留）
        expect(it.content).toBe(it.content.trim())
        expect(it.detail).toBe(it.detail.trim())
        if (it.section) {
          expect(it.no).toMatch(CN_SECTION_NO)
          expect(it.detail).toBe("")
        } else {
          expect(it.no === "" || ARABIC_NO.test(it.no)).toBe(true)
        }
      }
    }
  })

  it("序号保留原文形态：分区用「一/二/三/四」、条目用「1」，原表两处缺号照原样留空", () => {
    const tender = deptChecklistDef("tender")!
    const bid = deptChecklistDef("bid")!
    const sol = deptChecklistDef("sol")!
    expect(tender.items.filter((i) => i.section).map((i) => i.no)).toEqual(["一", "二"])
    expect(bid.items.filter((i) => i.section).map((i) => i.no)).toEqual(["一", "二", "三", "四"])
    expect(sol.items.filter((i) => i.section).map((i) => i.no)).toEqual(["一", "二"])
    // 投标文件 r20「公司红线条款」、解决方案 r14「方案整体架构」在原表没有序号，不改写成数字补号
    const bidNoNo = bid.items.find((i) => i.content === "公司红线条款")
    expect(bidNoNo?.no).toBe("")
    expect(bidNoNo?.section).toBeUndefined()
    const solNoNo = sol.items.find((i) => i.content === "方案整体架构")
    expect(solNoNo?.no).toBe("")
    expect(solNoNo?.section).toBeUndefined()
    // 条目序号形态：阿拉伯数字（原文数值单元格）
    expect(tender.items.find((i) => i.content === "成本检查")?.no).toBe("1")
    expect(sol.items.find((i) => i.content === "竞争对手")?.no).toBe("8")
  })

  it("表头三字段与表尾签名栏原文逐字保留", () => {
    for (const def of CHECKLIST_DEFS) {
      expect(def.headers.projectName).toBe("项目名称:")
      expect(def.headers.owner).toBe("主负责人:")
      expect(def.headers.difficulty).toBe("难度系数：")
      expect(def.footer).toContain("1、可以送出 ；")
      expect(def.footer).toContain("2、重新修改")
      expect(def.footer).toContain("签名：")
    }
    expect(deptChecklistDef("bid")!.footer.startsWith("标书检查结果:")).toBe(true)
    expect(deptChecklistDef("tender")!.footer.startsWith("检查结果:")).toBe(true)
  })
})

describe("bidChecklists：首尾与长条文逐字断言（防解析丢字）", () => {
  it("三份清单首条（分区标题）原文", () => {
    expect(deptChecklistDef("tender")!.items[0]).toEqual({
      no: "一",
      content: "文档基础性检查（自查）",
      detail: "",
      section: true,
    })
    expect(deptChecklistDef("bid")!.items[0]).toEqual({
      no: "一",
      content: "通用资格条件（自查、交叉）",
      detail: "",
      section: true,
    })
    expect(deptChecklistDef("sol")!.items[0]).toEqual({
      no: "一",
      content: "文档基础性检查（自查）",
      detail: "",
      section: true,
    })
  })

  it("三份清单末条原文", () => {
    const tenderLast = deptChecklistDef("tender")!.items.at(-1)!
    expect(tenderLast).toEqual({ no: "7", content: "建议与意见", detail: "" })
    const bidLast = deptChecklistDef("bid")!.items.at(-1)!
    expect(bidLast).toEqual({ no: "6", content: "图片、表格检查", detail: "注意查看三家所提供的图片、表格是否有雷同或重复" })
    const solLast = deptChecklistDef("sol")!.items.at(-1)!
    expect(solLast).toEqual({ no: "9", content: "建议与意见", detail: "" })
  })

  it("多行细则内部换行原样保留（招标书「文件排版」r8 全文）", () => {
    const item = deptChecklistDef("tender")!.items.find((i) => i.content === "文件排版")!
    expect(item.detail).toBe(
      "全文项目名称一致、目录已更新\n检查全文格式、字体、行数是否统一；\n章节点是否准确；\n是否有空白页；\n图片是否模糊歪斜，图片表达的意思是否与标题符合；\n表格风格是否一致；\n是否出现其他医院或项目信息。要求全文完整浏览一遍。",
    )
  })

  it("招标书「公司红线条款」r13 逐字（含全部 7 个小项）", () => {
    const item = deptChecklistDef("tender")!.items.find((i) => i.content === "公司红线条款")!
    expect(item.no).toBe("4")
    expect(item.detail).toBe(
      "1、验收要求：是否难达标\n2、售后：是否超出公司要求1年（招标书给出去的时候必须提供售后的约定，否则容易被模板覆盖）\n3、回款：是否无首款（正常是首款30%）（招标书给出去的时候必须提供回款的约定，否则容易被模板覆盖）\n4、是否有源代码、知识产权归属业主的条款\n5、是否要求提供履约保证金、保函\n6、关于工期是否过短，是否存在交货期：30天，交货条件：验收后交货等矛盾描述导致交货期短的情况\n7、是否有免费升级字眼（必须出现的时候应该写同版本内免费升级）",
    )
  })

  it("投标文件「技术部分」r17 逐字（分号与换行都没被吃）", () => {
    const item = deptChecklistDef("bid")!.items.find((i) => i.content === "技术部分")!
    expect(item.detail).toBe(
      "产品或服务的技术规格、参数、方案是否符合招标文件要求（文字比对软件比对一遍，可以扩展，不能遗漏和改变原意）；不能出现其他项目的信息、别的公司信息、内容与本项目不符；\n主标要重点检查：有无擅自增加模块和招标没有要求的功能描述，以免造成额外的成本；",
    )
  })

  it("投标文件 r20「公司红线条款」无序号条目逐字（原表 A 列空）", () => {
    const item = deptChecklistDef("bid")!.items.find((i) => i.content === "公司红线条款")!
    expect(item.no).toBe("")
    expect(item.detail).toBe(
      "是否要提供著作权、产权、版权；免费维护期超1年；付款条件无首款；要求驻点人员；验收或付款是否绑定评级；要求免费升级（必须写免费升级的话也要加同版本内免费升级）……及时跟销售对接、并确认",
    )
  })

  it("解决方案「详细功能方案」r20 逐字（含 3 个换行）", () => {
    const item = deptChecklistDef("sol")!.items.find((i) => i.content === "详细功能方案")!
    expect(item.detail).toBe(
      "功能方案是否匹配建设oa清单、跟建设内容上下匹配；\n功能方案提供的截图是否体现其他医院名字或患者关键信息；\n功能描述不符合标题意思；\n部分节点功能描述太简单等",
    )
  })

  it("源表三份清单的「名词术语/敏感字眼」条文含原文半角逗号与大小写形态（不擅自规范化）", () => {
    const sol = deptChecklistDef("sol")!.items.find((i) => i.content === "名词术语是否过时或不匹配")!
    expect(sol.detail).toBe(
      "如客户名称卫生计生委-卫健委；人口健康信息平台-全民健康信息平台；3G、4G-5G；\n出现本投标人、本响应文件、出现其他客户名字等",
    )
    const tender = deptChecklistDef("tender")!.items.find((i) => i.content === "敏感字眼检查")!
    expect(tender.detail).toContain("（如onelink）")
  })
})

describe("bidChecklists：可填行与空白元数据", () => {
  it("每个条目/分区都能生成一行可填结构，结果与检查人初始为空", () => {
    for (const def of CHECKLIST_DEFS) {
      const rows = buildDeptCheckRows(def)
      expect(rows).toHaveLength(def.items.length)
      expect(rows.map((r) => r.rid)).toEqual(def.items.map((_, i) => `${def.key}#${i}`))
      for (const r of rows) {
        expect(r.self).toEqual({ result: "", note: "", checker: "" })
        expect(r.cross).toEqual({ result: "", note: "", checker: "" })
      }
      // 原文照搬：行内容与定义逐字一致
      expect(rows.map((r) => r.content)).toEqual(def.items.map((i) => i.content))
      expect(rows.map((r) => r.detail)).toEqual(def.items.map((i) => i.detail))
      expect(rows.filter((r) => r.section)).toHaveLength(def.items.filter((i) => i.section).length)
    }
  })

  it("空白元数据：项目级绑定 + 表头默认项目名 + 留痕上限常量存在", () => {
    const def = deptChecklistDef("tender")!
    const meta = emptyDeptCheckMeta(def, "proj123", "某医院智慧医院项目")
    expect(meta.kind).toBe("dept_check")
    expect(meta.def_key).toBe("tender")
    expect(meta.project_id).toBe("proj123")
    expect(meta.header).toEqual({ projectName: "某医院智慧医院项目", owner: "", difficulty: "" })
    expect(meta.check_dates).toEqual({ self: "", cross: "" })
    expect(meta.signatures).toEqual({ self: { name: "", date: "" }, cross: { name: "", date: "" } })
    expect(meta.result).toBe("")
    expect(meta.log).toEqual([])
    expect(DEPT_CHECK_LOG_CAP).toBeGreaterThan(0)
  })
})
