// 情报抓取共享纯函数单测（2026-09-26 质量整改 Q1–Q4 的回归锁）
//
// 被测对象是 PocketBase 钩子 pocketbase/pb_hooks/intel_center.pb.js 顶部的
// ===INTEL-SHARED-BEGIN=== … ===INTEL-SHARED-END=== 共享纯函数区。
// 提取方式：读取源码 → 截取标记区间 → eval 到受控作用域 → 取出 __intel* 函数。
// 好处：测试与运行时永远同一份实现，钩子改了算法而测试未更新时这里立刻红。
//
// 用例全部来自真实踩坑数据（docs/全局质量规范-测试与交付门槛.md 附表）：
// Q1 青浦区中心医院(上海) 被标成 青海；叶城县医院(新疆) 被标成 河南
// Q2 发布时间倒挂：URL 里的 t20260925 才是发布日，正文第一个日期 2026-10-16 是截止时间
// Q3 标题被高亮标签污染出「 医院 」
// Q4 摘要因 replace(title) 失配残留半截标题
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const HOOK_PATH = join(__dirname, "..", "pocketbase", "pb_hooks", "intel_center.pb.js")

function loadShared(): Record<string, unknown> {
  const src = readFileSync(HOOK_PATH, "utf8")
  const MARK_BEGIN = "===INTEL-SHARED-BEGIN==="
  const MARK_END = "===INTEL-SHARED-END==="

  // 镜像一致性：4 个回调（tick / fetch-now / items 迁移 / enrich）里的共享区必须逐字节一致。
  // PocketBase v0.40 会把回调重定位到生成的 pb.js 执行，文件顶层作用域对回调不可见，
  // 所以共享函数只能以镜像存在；本断言就是防漂移的锁。
  const sections: string[] = []
  let cursor = 0
  for (;;) {
    const b = src.indexOf(MARK_BEGIN, cursor)
    if (b < 0) break
    const e = src.indexOf(MARK_END, b)
    expect(e, "BEGIN 有而 END 缺").toBeGreaterThan(b)
    sections.push(src.slice(src.indexOf("\n", b) + 1, src.lastIndexOf("\n", e)))
    cursor = e + MARK_END.length
  }
  expect(sections.length, "共享区镜像应恰好 4 份（tick/fetch-now/items/enrich）").toBe(4)
  for (let i = 1; i < sections.length; i++) {
    expect(sections[i], `第 ${i + 1} 份镜像与第 1 份不一致——请把算法改动同步到全部 4 个回调`).toBe(sections[0])
  }

  // 注意：共享区源码里有含「${」的正则字面量，绝不能用模板字符串拼进 new Function，
  // 否则会被当成插值解析 → SyntaxError。必须用普通字符串拼接。
  const section = sections[0]
  const body = [
    "var shared = {};",
    section,
    "shared.__intelTitleFromHtml = __intelTitleFromHtml;",
    "shared.__intelRegion = __intelRegion;",
    "shared.__intelPubAt = __intelPubAt;",
    "shared.__intelCleanTitleSpacing = __intelCleanTitleSpacing;",
    "shared.__intelTextWithoutTitle = __intelTextWithoutTitle;",
    "return shared;",
  ].join("\n")
  return new Function(body)() as Record<string, unknown>
}

const S = loadShared() as {
  __intelTitleFromHtml: (raw: string) => string
  __intelRegion: (title: string, ownBlock: string, strict?: boolean) => string
  __intelPubAt: (url: string, ownBlock: string, body: string) => string
  __intelCleanTitleSpacing: (t: string) => string
  __intelTextWithoutTitle: (text: string, title: string) => string
}

describe("Q3 标题高亮标签剥离（__intelTitleFromHtml）", () => {
  it("政采网搜索高亮：<font>医院</font> 剥离后不得插入空格", () => {
    const raw = "新疆建通工程管理有限责任公司关于第九师白杨市中西医结合<font class=\"red\">医院</font>医疗设备采购项目（第二批）-第一包的公开招标公告"
    expect(S.__intelTitleFromHtml(raw)).toBe(
      "新疆建通工程管理有限责任公司关于第九师白杨市中西医结合医院医疗设备采购项目（第二批）-第一包的公开招标公告",
    )
  })

  it("高亮词与 &nbsp; 实体混排也能还原干净标题", () => {
    const raw = "青浦区中心<font color=red>医院</font>医疗设备第六批的公开招标公告"
    expect(S.__intelTitleFromHtml(raw)).toBe("青浦区中心医院医疗设备第六批的公开招标公告")
  })
})

describe("Q1 区域分层抽取（__intelRegion）", () => {
  it("实锤案例·青浦区中心医院：采购人在上海，代理机构名含「青海」必须不再误标", () => {
    const title = "青浦区中心医院医疗设备第六批的公开招标公告"
    // 模拟邻接污染已消除后的「条目自身块」：本条含采购人与递交地，不含上一条青海项目的字样
    const ownBlock =
      "项目概况青浦区中心医院医疗设备第六批招标项目的潜在投标人应在上海市政府采购网获取招标文件，" +
      "并于2026年10月15日10:00前递交投标文件。项目编号：310118000260903132267-18379100 " +
      "2026.09.25 11:38:54 | 采购人：上海市青浦区中心医院 | 代理机构：上海市青浦区政府采购中心"
    expect(S.__intelRegion(title, ownBlock)).toBe("上海")
  })

  it("实锤案例·青浦区（模拟旧邻接噪声仍在）：采购人证据优先于块内先出现的「青海」", () => {
    const title = "青浦区中心医院医疗设备第六批的公开招标公告"
    // 上一条青海项目残留的代理机构名出现在块首，本条自己的采购人在后——分层策略必须选上海
    const ownBlock =
      "中医院 | 代理机构：青海沃德项目管理有限公司 更正公告 | 青海 | 项目概况青浦区中心医院医疗设备第六批" +
      "招标项目的潜在投标人应在上海市政府采购网获取招标文件，2026.09.25 11:38:54 | 采购人：上海市青浦区中心医院"
    expect(S.__intelRegion(title, ownBlock)).toBe("上海")
  })

  it("实锤案例·叶城县(新疆)：采购人无省份词时，递交地「新疆维吾尔自治区政府采购网」定新疆", () => {
    const title = "叶城县维吾尔医医院网络物理隔离建设项目竞争性磋商公告"
    const ownBlock = "项目概况叶城县维吾尔医医院网络物理隔离建设项目的潜在投标人应在新疆维吾尔自治区政府采购网获取磋商文件"
    expect(S.__intelRegion(title, ownBlock)).toBe("新疆")
  })

  it("实锤案例·叶城县(新疆)真实数据：代理机构「叶城县政府采购中心」无省份词，面包屑 | 新疆 | 定案", () => {
    const title = "叶城县维吾尔医医院网络物理隔离建设项目竞争性磋商公告"
    const ownBlock =
      "代理机构：叶城县政府采购中心 竞争性磋商公告 | 新疆 | 项目概况叶城县维吾尔医医院网络物理隔离建设项目的潜在投标人" +
      "应在新疆维吾尔自治区政府采购网获取磋商文件"
    expect(S.__intelRegion(title, ownBlock)).toBe("新疆")
  })

  it("标题省份词可用（次强证据）", () => {
    expect(S.__intelRegion("温州市中心医院飞利浦DSA设备保修服务项目浙江招标公告", "")).toBe("浙江")
  })

  it("条目块内第一个省份词兜底", () => {
    expect(S.__intelRegion("某系统运维项目采购公告", "广东省某单位日常运维服务项目")).toBe("广东")
  })

  it("无任何证据时返回空串而不是乱猜", () => {
    expect(S.__intelRegion("Hello world announcement", "no chinese region here")).toBe("")
  })

  it("实锤案例·西北大学第一医院(YXZB-08)：面包屑是上一条叶城项目的邻接噪声，代理机构属地定陕西", () => {
    const title = "西北大学第一医院医疗设备（YXZB-08）招标公告"
    // snippet 开头「…叶城县政府采购中心 竞争性磋商公告 | 新疆 |」是上一条的尾巴；
    // 本条自己的代理机构「陕西嘉唐」和采购人信息在后面
    const ownBlock =
      "医医院 | 代理机构：叶城县政府采购中心 竞争性磋商公告 | 新疆 | 采购政策，按最新的文件执行。" +
      "1.采购人信息名称：西北大学第一 医院 地址：西安市新城区咸宁东路512号 " +
      "2026.09.24 21:59:34 | 采购人：西北大学第一医院 | 代理机构：陕西嘉唐建设项目管理有限公司"
    expect(S.__intelRegion(title, ownBlock, true)).toBe("陕西")
  })

  it("strict 模式（存量重算）：只有弱证据兜底可命中时返回空串，宁可保留旧值不改错", () => {
    // 无采购人/递交地/标题/代理机构/面包屑任何强证据 → strict 返回空
    expect(S.__intelRegion("某系统运维项目采购公告", "广东省某单位日常运维服务项目", true)).toBe("")
  })
})

describe("Q2 发布时间抽取（__intelPubAt）", () => {
  it("实锤案例·ccgp：URL 内嵌日期优先，正文第一个日期是截止时间也不能骗过它", () => {
    const url = "http://www.ccgp.gov.cn/cggg/dfgg/gkzb/202609/t20260925_27404346.htm"
    const body = "项目概况……并于2026年10月16日11:00（北京时间）前递交（上传）投标文件。一、项目基本情况……"
    expect(S.__intelPubAt(url, "", body)).toBe("2026-09-25")
  })

  it("「发布时间：」标签优先于正文其他日期", () => {
    expect(S.__intelPubAt("", "发布时间：2026-09-24 18:00 某某系统项目招标公告 于2026年10月01日前递交", "")).toBe("2026-09-24")
  })

  it("列表页条目时间戳（2026.09.25 11:38:54）可作发布日", () => {
    expect(S.__intelPubAt("", "项目概况…… 2026.09.25 11:38:54 | 采购人：某某医院", "")).toBe("2026-09-25")
  })

  it("无 URL/标签/时间戳时取正文第一个非截止上下文日期（同句判断，不跨句株连）", () => {
    const body = "本项目招标公告于2026年9月21日发布，请于2026年10月9日前递交投标文件。"
    expect(S.__intelPubAt("", "", body)).toBe("2026-09-21")
  })

  it("正文只有截止日期时宁缺毋滥（返回空串，由调用方兜底今天）", () => {
    const body = "请各投标人于2026年10月9日前递交投标文件。"
    expect(S.__intelPubAt("", "", body)).toBe("")
  })
})

describe("存量标题空格修复（__intelCleanTitleSpacing）", () => {
  it("折叠汉字间被污染的空格", () => {
    expect(S.__intelCleanTitleSpacing("第九师白杨市中西医结合 医院 医疗设备采购项目")).toBe(
      "第九师白杨市中西医结合医院医疗设备采购项目",
    )
  })

  it("英文/数字与汉字之间的空格保留（只吃汉字-汉字间的空格）", () => {
    expect(S.__intelCleanTitleSpacing("飞利浦 DSA 设备维修项目")).toBe("飞利浦 DSA 设备维修项目")
  })
})

describe("Q4 摘要去标题（__intelTextWithoutTitle）", () => {
  it("标题在文本中被高亮空格打断也能整段移除（旧 replace(title) 失配的根修）", () => {
    const text = "青浦区中心 医院 医疗设备第六批的公开招标公告 更正公告 | 青海 | 项目概况……"
    const got = S.__intelTextWithoutTitle(text, "青浦区中心医院医疗设备第六批的公开招标公告")
    expect(got).not.toContain("青浦区中心")
    expect(got).toContain("项目概况")
  })

  it("无标题输入原样返回", () => {
    expect(S.__intelTextWithoutTitle("abc", "")).toBe("abc")
  })
})
