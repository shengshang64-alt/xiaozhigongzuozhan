import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Chapter } from "@/pages/SolutionStudio/solutionTypes"
import {
  DELIVERY_FATAL_PATTERNS,
  DELIVERY_OWNER_ORDER,
  DELIVERY_OWNER_PATTERNS,
  buildDeliveryActionList,
  classifyDeliveryOwner,
  isFatalPlaceholderSnippet,
  readDeliveryProgress,
  renderDeliveryActionMarkdown,
  summarizeDeliveryActions,
  writeDeliveryProgress,
  type DeliveryActionItem,
} from "./deliveryActionList"

// ---------------------------------------------------------------------------
// R288（bid-placeholder-owner-split · P1）交付前必办清单的判据回归锈。
// 用例正文全部取自真实库内摘录（2026-10-13 交付门禁体检 19 项目 / 258 处命中的 ④ 残留），
// 因为本项的根因正是「判据凭推理写」——r283 人工核对给出的分流结论在此逐条钉死：
//   ① 承诺数值/时限/收费（评标打分项，漏一项即丢分）
//   ② 记录/台账/模板/名单/材料/填写指令（人工补录或附件）
//   ③ 招标原文或采购文件已规定（项目编号/依据/份数）＝系统该填没填
//   ④ 诚实残余（自动判不出就留给人，不做假装归类）
// 末段是漂移守卫：src 模式表与 scripts/bid-delivery-gate.mjs 必须逐字同源，
// 否则界面清单与门禁报告的数字会各说各话（历史上判据漂移已造成 BLOCKER 虚高）。
// ---------------------------------------------------------------------------

function ch(over: Partial<Chapter> = {}): Chapter {
  return { node_id: "n1", title: "章节", sections: [], content: "", gen_status: "done", ...over } as Chapter
}

describe("classifyDeliveryOwner ① 商务决策（真实摘录）", () => {
  it.each([
    ["SLA 响应时限空缺", "（1）一级问题：驻场人员在【待填写】分钟内响应，持续处理直至业务恢复"],
    ["到场时限空缺", "远程支援团队在【待填写】分钟内接入，必要时安排技术专家赴现场支援"],
    ["试运行/稳定期天数空缺", "切换完成并稳定运行满【待填写】个工作日后提交阶段验收申请"],
    ["培训课时空缺", "日常故障排查与应急处理，共安排不少于【待填写】课时，培训地点在医院信息科机房"],
    ["收费单价空缺", "仅收基本维护费，按次计费，每次【待填写】元，硬件设备检修与零配件更换现场服务"],
    ["年度维护合同价空缺", "采购人可选择按次付费或签订年度维护合同，年度维护合同费用为【待填写】元/年"],
    ["驻场人数空缺", "技术服务人数保障要求，我公司配置驻点维保人员不少于【待填写】人"],
    ["质保延长承诺", "在 3 年免费质保基础上延长【待填写】年，每延长 1 年得 1 分"],
  ])("%s", (_name, snippet) => {
    expect(classifyDeliveryOwner(snippet).owner).toBe("biz-decision")
  })

  it("① 优先于 ②：同句既有承诺数值又有记录类词，仍归拍板（不被材料词抢走）", () => {
    const s = "工单按周汇总、按月形成运维报告，报采购人信息管理部门，重大故障处理后在【待填写】个工作日内提交故障分析报告并留存处置记录"
    expect(classifyDeliveryOwner(s).owner).toBe("biz-decision")
  })
})

describe("classifyDeliveryOwner ② 人工附材料 / 补录（r283 人工核对结论）", () => {
  it.each([
    ["佐证材料与截图占位", "界面截图、软件著作权与第三方软件检测报告等客观证明材料按招标文件要求在投标文件对应位置提供，相关界面样例以实际部署环境为准【待填写】"],
    ["配置参数与实施记录", "接入流程线上记录与统一接入中心功能按招标文件要求响应，具体配置参数与实施记录【待填写】"],
    ["留存策略", "流程记录的保留期限与归档方式按招标文件要求响应，具体留存策略【待填写】"],
    ["节点清单与对应关系表", "监控实施时按业务域对节点进行归类登记，节点清单与源端系统对应关系表【待填写】"],
    ["值守记录表作为佐证材料", "我公司提供售后服务方案、应急预案及值守记录表作为佐证材料【待填写】"],
    ["响应记录单作为考核依据", "记录响应时间、处置方式及下一步计划，提交采购人确认，响应记录单作为售后服务考核依据【待填写】"],
    ["业绩案例", "所投核心软件产品厂商自 2021 年以来协助医院客户通过电子病历五级及以上的业绩案例【待填写】"],
    ["教员名单与人员信息", "教员名单、资质证明及社保证明按招标文件要求随投标文件一并提交，具体人员信息【待填写】"],
    ["应急预案模板与故障台账", "应急预案模板、故障台账字段与升级路径以【待填写】占位"],
    ["正文自述由投标人按实补充", "技术和服务要求中要求提供相应佐证材料的位置，本小节以【待填写】标注，由投标人按实补充后入册"],
    ["占位处理口径", "响应记录单格式模板及考核指标目标值原文未提及，按【待填写】占位处理，由用户人工补充后纳入正式投标文件"],
    ["填写指令残留", "投标人（填写‘全称’）应具备相应资质并在有效期内"],
    ["插图占位", "患者信息脱敏功能如下【此处插入截图】，备注说明另附"],
  ])("%s", (_name, snippet) => {
    expect(classifyDeliveryOwner(snippet).owner).toBe("material-attach")
  })

  it("白皮书/检测报告类维持既有归类能力不回归", () => {
    expect(classifyDeliveryOwner("相关产品技术白皮书及检测机构检测报告【待填写】").owner).toBe("material-attach")
  })
})

describe("classifyDeliveryOwner ③ 系统可回取", () => {
  it.each([
    ["招标编号空缺", "本项目（招标编号【待填写】）按政府采购法组织实施"],
    ["预算金额空缺", "本项目预算金额为【待填写】，投标报价不得超出的最高限价另行公布"],
    ["装订份数由采购文件规定", "响应文件各签署页加盖公章，装订份数按招标文件要求执行，具体份数为【待填写】"],
  ])("%s", (_name, snippet) => {
    expect(classifyDeliveryOwner(snippet).owner).toBe("system-refetch")
  })
})

describe("classifyDeliveryOwner ④ 诚实残余", () => {
  it("自动判不出责任方时落 ④，绝不硬塞进前三类", () => {
    const s = "备件与替换设备储备方案按招标文件要求响应【待填写】，具体策略另行说明"
    const r = classifyDeliveryOwner(s)
    expect(r.owner).toBe("unclassified")
    expect(r.why).toContain("人工确认")
  })
})

describe("isFatalPlaceholderSnippet 致命口径（与门禁同一把尺子）", () => {
  it("承诺数值与前置承诺句为致命；纯材料占位为警告", () => {
    expect(isFatalPlaceholderSnippet("驻场人员在【待填写】分钟内响应")).toBe(true)
    expect(isFatalPlaceholderSnippet("我公司承诺响应时限为【待填写】")).toBe(true)
    expect(isFatalPlaceholderSnippet("教员名单、资质证明及具体人员信息【待填写】")).toBe(false)
  })
})

describe("buildDeliveryActionList", () => {
  it("同形态跨章合并：出现次数累计、章名最多列 3 个", () => {
    const same = "重大故障时驻场人员在【待填写】分钟内响应"
    const items = buildDeliveryActionList([
      ch({ title: "售后服务与运维保障方案", content: same }),
      ch({ title: "应急预案与应急响应方案", content: same }),
      ch({ title: "技术部分", content: same }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].occurrences).toBe(3)
    expect(items[0].chapters).toHaveLength(3)
    expect(items[0].owner).toBe("biz-decision")
    expect(items[0].fatal).toBe(true)
  })

  it("判据与交付物对齐：依据表无编号列的占位被规整，不进清单", () => {
    const items = buildDeliveryActionList([
      ch({ title: "总体方案", content: "编制依据如下：1  建阳区卫生院灾后重建项目初步设计与概算  【待填写】  项目依据；2  数据互联互通平台建设包招标文件  [350703]FJXW[GK]2026009  采购文件" }),
    ])
    expect(items).toEqual([])
  })

  it("名称已含标准编号仍留空＝真漏填，必须进清单", () => {
    const items = buildDeliveryActionList([ch({ title: "编制依据", content: "5  GB/T 22239  【待填写】  强制性国家标准" })])
    expect(items).toHaveLength(1)
    expect(items[0].snippet).toContain("GB/T 22239")
  })

  it("无占位的干净正文不产出条目；空章跳过", () => {
    const items = buildDeliveryActionList([
      ch({ title: "干净章", content: "系统设计遵循集成、先进、可靠的原则，满足三级甲等医院业务连续性要求。" }),
      ch({ title: "空章", content: "" }),
    ])
    expect(items).toEqual([])
  })

  it("排序按责任方①→④，同级致命优先、重复多的靠前", () => {
    const items = buildDeliveryActionList([
      ch({ title: "四", content: `备件储备方案【待填写】${"。".repeat(2)}` }),
      ch({ title: "二", content: "检测报告及截图【待填写】" }),
      ch({ title: "一", content: "驻场人员在【待填写】分钟内响应" }),
    ])
    expect(items.map((i) => i.owner)).toEqual(["biz-decision", "material-attach", "unclassified"])
  })
})

describe("summarizeDeliveryActions", () => {
  const items: DeliveryActionItem[] = [
    { id: "a", owner: "biz-decision", why: "x", snippet: "在【待填写】分钟内响应", chapters: ["一"], occurrences: 1, fatal: true },
    { id: "b", owner: "material-attach", why: "x", snippet: "检测报告【待填写】", chapters: ["二"], occurrences: 1, fatal: false },
  ]

  it("未勾销时 decisionPending/fatalPending 反映待办量", () => {
    const r = summarizeDeliveryActions(items, {})
    expect(r.pending).toBe(2)
    expect(r.decisionPending).toBe(1)
    expect(r.fatalPending).toBe(1)
    expect(r.byOwner.map((g) => g.owner)).toEqual(DELIVERY_OWNER_ORDER)
    expect(r.byOwner[0].label).toContain("①")
  })

  it("勾销与不适用都算办结，只报不拦（不产生拦截语义）", () => {
    expect(summarizeDeliveryActions(items, { a: "done" }).fatalPending).toBe(0)
    expect(summarizeDeliveryActions(items, { a: "na" }).decisionPending).toBe(0)
    expect(summarizeDeliveryActions(items, { a: "done", b: "na" }).pending).toBe(0)
  })

  it("四组之外的未知责任方不会漏计（分组按 ORDER 全量遍历）", () => {
    const r = summarizeDeliveryActions(items, {})
    expect(r.byOwner.reduce((s, g) => s + g.total, 0)).toBe(items.length)
  })
})

describe("renderDeliveryActionMarkdown", () => {
  it("清单含责任方分组、勾选态与致命标记，可直接带进评审会", () => {
    const items = buildDeliveryActionList([
      ch({ title: "售后服务与运维保障方案", content: "驻场人员在【待填写】分钟内响应" }),
      ch({ title: "技术部分", content: "第三方检测机构检测报告【待填写】" }),
    ])
    const md = renderDeliveryActionMarkdown("三明市中西医结合医院项目", summarizeDeliveryActions(items, {}), {})
    expect(md).toContain("交付前必办清单（按责任方）")
    expect(md).toContain("三明市中西医结合医院项目")
    expect(md).toContain("① 商务决策（须拍板）")
    expect(md).toContain("② 人工附材料（须附原件）")
    expect(md).toContain("待办")
    expect(md).toContain("致命")
  })
})

describe("本机进度读写的非浏览器降级", () => {
  it("无 window 环境读取返回空表、写入不抛错（真实浏览器路径由实机验证覆盖）", () => {
    expect(readDeliveryProgress("p1")).toEqual({})
    expect(() => writeDeliveryProgress("p1", { a: "done" })).not.toThrow()
    expect(readDeliveryProgress("")).toEqual({})
  })
})

describe("判据同源漂移守卫（src ↔ scripts/bid-delivery-gate.mjs）", () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
  const gateSrc = readFileSync(path.join(ROOT, "scripts", "bid-delivery-gate.mjs"), "utf-8")

  it("src 每条归责模式逐字出现在门禁脚本里", () => {
    for (const p of DELIVERY_OWNER_PATTERNS) {
      // RegExp.source 不含 / 分隔符，比对门禁字面量时必须补回，否则永远对不上
      const needle = `re: /${p.re.source}/,`
      expect(gateSrc, `门禁脚本缺少同源模式：${p.re.source}`).toContain(needle)
    }
  })

  it("src 每条致命判据逐字出现在门禁脚本里（致命口径两侧不得不一）", () => {
    for (const re of DELIVERY_FATAL_PATTERNS) {
      expect(gateSrc, `门禁脚本缺少同源致命判据：${re.source}`).toContain(`re: /${re.source}/${re.flags},`)
    }
  })

  it("门禁脚本不残留旧版单条 OWNER_RULES 结构（分类必须走同一模式表）", () => {
    expect(gateSrc).not.toContain("OWNER_RULES")
    expect(gateSrc).toContain("OWNER_PATTERNS")
  })

  it("两侧责任方集合一致", () => {
    for (const owner of DELIVERY_OWNER_ORDER) {
      expect(gateSrc).toContain(`owner: "${owner}"`)
    }
  })
})
