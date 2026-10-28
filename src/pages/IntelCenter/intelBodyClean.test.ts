import { describe, expect, it } from "vitest"
import { cleanIntelBody, cleanIntelLine, cleanIntelSnippet, cleanIntelSummary, displayizeIntel, stripIntelMetaBlobs, stripMoreTokens } from "./intelBodyClean"

// R29（test-net-01）：情报入库正文清洗的行为锈死网
// 锁死点：R26 运行时坐实过的真实脏样本行为——脚本/样式整块剥离、JSON/版权/日期行剔除、实体解码
describe("cleanIntelLine", () => {
  it("去标签 + 解码实体 + 空白归一（R26 缺陷回归位：曾经漏调 decodeEntities）", () => {
    expect(cleanIntelLine("某省 &nbsp;医保局&amp;<b>发布</i>目录　清单")).toBe("某省 医保局& 发布 目录 清单")
  })
  it("数字实体解码", () => {
    expect(cleanIntelLine("A&#39;B&#8212;C")).toBe("A'B—C")
  })
  it("跨行标签拼接为单行", () => {
    expect(cleanIntelLine("第一行\n<script>alert(1)</script>第二行")).toBe("第一行 第二行")
  })
  it("空与安全", () => {
    expect(cleanIntelLine("")).toBe("")
    expect(cleanIntelLine(undefined as unknown as string)).toBe("")
  })
})

describe("cleanIntelBody", () => {
  const dirty = [
    "<script>window.__track={aid:'x'};</script>",
    "<style>.box{color:red}</style>",
    "为深化&nbsp;医疗改革，医保局发布最新目录。",
    '{"code":200,"data":[1,2]}',
    "版权所有 All Rights Reserved 京ICP备12345678号",
    "2026-09-20",
    "<!-- 统计注释 -->",
    "联系电话在页脚 联系我们 | 返回顶部",
  ].join("\n")

  it("有效正文行保留、噪声行剔除（含实体解码）", () => {
    const r = cleanIntelBody(dirty)
    expect(r.text).toContain("为深化 医疗改革，医保局发布最新目录。")
    expect(r.text).not.toContain("__track")
    expect(r.text).not.toContain("color:red")
    expect(r.text).not.toContain("版权所有")
    expect(r.text).not.toContain('"code":200')
    expect(r.text).not.toContain("统计注释")
    expect(r.text).not.toContain("2026-09-20")
    expect(r.text).not.toContain("返回顶部")
  })

  it("changed=true 且 removedLines 只计逐行剔除（script/style 整块剥离不计行）", () => {
    const r = cleanIntelBody(dirty)
    expect(r.changed).toBe(true)
    // JSON 行 + 版权行 + 日期行 + 联系我们行 = 4（script/style/注释为整块剥离不计数）
    expect(r.removedLines).toBe(4)
  })

  it("干净正文原样通过 changed=false", () => {
    const clean = "国家卫生健康委印发规范。\n各省级部门贯彻落实。"
    const r = cleanIntelBody(clean)
    expect(r.text).toBe(clean)
    expect(r.changed).toBe(false)
    expect(r.removedLines).toBe(0)
  })

  it("超长正文按 max 截断并加省略号", () => {
    const r = cleanIntelBody("句".repeat(100), 50)
    expect(r.text).toBe(`${"句".repeat(50)}…`)
  })

  it("HTML 注释整块剥离不留痕", () => {
    const r = cleanIntelBody("正文一\n<!-- 内部备注 敏感 -->\n正文二")
    expect(r.text).not.toContain("内部备注")
    expect(r.text).toContain("正文一")
    expect(r.text).toContain("正文二")
  })
})

// 展示层深度清洗锈死网：真实抓取入库被从中间截断的半截 HTML/CSS 残片（R 首页情报摘要乱码）
describe("displayizeIntel", () => {
  it("无左尖括号的半截属性尾巴 `.jpg\" border=...>` 被清除，正文保留", () => {
    const out = displayizeIntel('.jpg" border="0" width="660" height="320"> 让记忆的“橡皮擦”远离老人')
    expect(out).not.toContain("border")
    expect(out).not.toContain(".jpg")
    expect(out).not.toContain(">")
    expect(out).toContain("让记忆的")
  })
  it("行尾悬挂未闭合标签 `<img ... class=` 被吞掉", () => {
    const out = displayizeIntel('如何闯关大众市场？ 2026-09-22 <img src="///www.news.cn/global/images/icon-weibo.png" alt="" class=')
    expect(out).not.toContain("<img")
    expect(out).not.toContain("icon-weibo")
    expect(out).toContain("如何闯关大众市场")
  })
  it("weibo 分享链接属性与残文本被清除", () => {
    const out = displayizeIntel('ef="//service.weibo.com/share/share.php?url=/health/x.html&title=家里养这种宠物" target="_blank"> 专委会成立')
    expect(out).not.toContain("weibo")
    expect(out).not.toContain("share.php")
    expect(out).toContain("专委会成立")
  })
  it("内联 CSS 规则行整行剔除", () => {
    const out = displayizeIntel("#con-three-1 .szyw li a { display: inline-block; color: #474747; }\n宁波中东欧医药交易平台上线")
    expect(out).not.toContain("inline-block")
    expect(out).not.toContain("{")
    expect(out).toContain("宁波中东欧医药交易平台上线")
  })
  it("超长按 max 截断加省略号；空串安全", () => {
    expect(displayizeIntel("句".repeat(100), 50)).toBe(`${"句".repeat(50)}…`)
    expect(displayizeIntel("")).toBe("")
  })
  it("R53/F10：门户导航残片整段判垃圾返回空（真实广东医保局案例）", () => {
    const raw = "网站支持IPv6 长者助手 机构职能 政务动态 政务公开 政务服务 互动交流 国务院“互联网+督查”平台专题征集 庆祝中国共产党成立105周年 2026年全省医疗保障工作年中座谈会在汕尾召开 强基固本提能力 蓄势赋能促发展 ——全省医保规划财务工作培训班成功举办 1 2 3 4 要闻速递 工作动态 政声传递 各地动态"
    expect(displayizeIntel(raw)).toBe("")
  })
  it("R53/F10：分页指示行整行剔除", () => {
    expect(displayizeIntel("首页 上一页 1 2 3 4 下一页")).toBe("")
    expect(displayizeIntel("1 2 3 4 5")).toBe("")
  })
  it("R53/F10：门户变体——每词独占一行的导航区逐行剔除，真实文章标题保留（真实 cn-witmed 案例）", () => {
    const raw = [
      "广东省医疗保障局",
      "网站支持IPv6",
      "长者助手",
      "机构职能",
      "政务动态",
      "政务公开",
      "政务服务",
      "互动交流",
      "要闻速递",
      "工作动态",
      "政声传递",
      "各地动态",
      "医保码五大使用场景，一“码”全搞定",
      "医保个人账户里的钱，到底怎么用？",
    ].join("\n")
    const out = displayizeIntel(raw, 120)
    expect(out).not.toContain("机构职能")
    expect(out).not.toContain("长者助手")
    expect(out).toContain("医保码五大使用场景")
  })
  it("R54/F21：孤儿属性残片剔除（in_more\" 与 =\"box\" 真实形态）", () => {
    const out1 = displayizeIntel("in_more\" 更多 09-24 洪石陈：AI重构医院网络安全防范全流程")
    expect(out1).not.toContain("in_more")
    expect(out1).toContain("洪石陈")
    const out2 = displayizeIntel('="box" 一院多区 通过构建多院区云网边资源一体化底座助力公立医院')
    expect(out2).not.toContain("box")
    expect(out2).toContain("一院多区")
  })
  it("R53/F10：正常摘要不误杀（连写长句含单个导航词、含空格但导航占比低）", () => {
    expect(displayizeIntel("国家卫生健康委发布电子病历评级新标准，政务服务事项同步纳入互联互通测评范围")).toContain("电子病历评级新标准")
    expect(displayizeIntel("四川省医保局印发门诊统筹新规 覆盖全省城乡居民")).toContain("门诊统筹新规")
  })
})

// R64（intel-summary-meta-blob）：摘要展示层清洗
// 取证来源：库内「健康报·卫健官方媒体」源 11 条里 9 条 summary 是「站点名 + 页面 JSON 元数据 + 真正文」
// 同处一行；情报中心卡片/详情面板原样渲染 → 用户看到的是 {"id":"514749","toptitle":"",…}。
describe("stripIntelMetaBlobs / cleanIntelSummary（R64）", () => {
  // 真实形态（已脱敏为公开新闻文本，结构逐字保留：站点名前缀 + 扁平 JSON + 正文）
  const REAL_SHAPE =
    '－健康报网——健康门户 {"id":"514749","toptitle":"","toptitle_color":"","title":" ","title_color":"",' +
    '"subtitle":"——论学习贯彻全国卫生与健康大会重要讲话","subtitle_color":"","crtime":"2026-10-22 09:49:07",' +
    '"condition":"来源： 健康报 ","thumb": "","topic": "0"} □本报评论员在大会上指出，保障人民健康需要'

  it("真实形态：剥掉站点名前缀与 JSON 元数据块，保留真正文", () => {
    const out = cleanIntelSummary(REAL_SHAPE, 400)
    expect(out).not.toContain("{")
    expect(out).not.toContain('"id"')
    expect(out).not.toContain("健康门户")
    expect(out).toContain("本报评论员在大会上指出")
  })

  it("对照组：不剥元数据时 displayizeIntel 会把真正文一起丢掉（这就是本轮要修的现象）", () => {
    // 整行含花括号 → CSS_LINE_RE 判据整行丢弃，首页原口径下表现为「有摘要但空白」
    expect(displayizeIntel(REAL_SHAPE, 400)).toBe("")
    expect(cleanIntelSummary(REAL_SHAPE, 400).length).toBeGreaterThan(10)
  })

  it("被截断到末尾的半截 JSON（无右花括号）也剥，且保留其前面的正文", () => {
    const out = stripIntelMetaBlobs('省卫健委发布通知 2026年起执行 {"id":"512","title":" ",')
    expect(out).toContain("省卫健委发布通知")
    expect(out).not.toContain('"id"')
  })

  it("只有元数据、没有正文 → 清洗后为空串（卡片据此不渲染空段落）", () => {
    const out = cleanIntelSummary('－健康报网——健康门户 {"id":"1","title":" ","crtime":"2026-10-22 09:49:07"}')
    expect(out).toBe("")
  })

  it("正常中文摘要不误伤：含「网/门户」字样但不紧跟 JSON", () => {
    const normal = "健康报网 报道：该院互联网医院上线一年，累计服务患者 12 万人次"
    expect(stripIntelMetaBlobs(normal)).toBe(normal)
    expect(cleanIntelSummary(normal)).toContain("互联网医院上线一年")
  })

  it("正常正文里的孤立花括号不误伤（判据要求至少一个 \"key\":）", () => {
    const normal = "建设内容 {含接口改造} 与 {含三年质保}，具体见清单"
    expect(stripIntelMetaBlobs(normal)).toBe(normal)
  })

  it("多段元数据连续出现时逐段剥净", () => {
    const raw = '站点门户 {"a":"1"} 正文开始 {"b":"2"} 正文结束'
    const out = stripIntelMetaBlobs(raw)
    expect(out).not.toContain('"a"')
    expect(out).not.toContain('"b"')
    expect(out).toContain("正文开始")
    expect(out).toContain("正文结束")
  })

  it("max 截断与空输入（与 displayizeIntel 同口径）", () => {
    expect(cleanIntelSummary("句".repeat(100), 20)).toBe(`${"句".repeat(20)}…`)
    expect(cleanIntelSummary("")).toBe("")
  })
})

// R65（intel-snippet-listing-residue）：内容片段展示层清洗
// 取证来源（2026-10-28 真实库，728 条 / 672 条有 content_snippet）：
//   188 条是「更多... 更多... 日期 真正文」，342 条是「同站其他文章的标题 + 日期」。
//   首页动态卡与详情面板都把这个字段当摘要显示 → 标题下面读到的是别人的标题列表。
describe("stripMoreTokens / cleanIntelSnippet（R65）", () => {
  it("剥「更多…」导航串，含被截断成「多...」的形态", () => {
    expect(stripMoreTokens("更多... 更多... 更多... 2026-10-26 近日发布")).toBe("2026-10-26 近日发布")
    expect(stripMoreTokens("多... 更多... 更多... 2026-10-23 正文")).toBe("2026-10-23 正文")
  })

  it("句中出现的「更多」不误伤（判据要求独立 token + 省略号）", () => {
    const s = "患者可在小程序查看更多检查报告，并支持在线复诊"
    expect(stripMoreTokens(s)).toBe(s)
  })

  // 真实形态 A：导航串 + 日期 + 真正文（库内 188 条）
  const SHAPE_A = "更多... 更多... 更多... 2026-10-26 近日，由清华大学智能产业研究院（AIR）孵化的AI医疗企业在北京发布多智能体协同生态系统。该系统试图通过构建具备不同专科背景的智能体，让AI在诊疗中开展跨专科协作。"
  it("形态 A：剥掉导航串与行首日期，保留正文", () => {
    const out = cleanIntelSnippet(SHAPE_A, { title: "AI医生分身落地长庚医院18个科室", max: 200 })
    expect(out).not.toContain("更多")
    expect(out).not.toContain("...")
    expect(out.startsWith("近日，由清华大学")).toBe(true)
  })

  // 真实形态 B：整段是「同站其他文章标题 + 日期」，与本条无关（库内 342 条）
  const SHAPE_B =
    "甘肃省进一步健全城市社区卫生服务体系提升服务能力的十项措施 2026-10-27 2026-10-26 江苏省印发《推进江苏省人工智能加医疗健康发展实施方案》 2026-10-23"
  it("形态 B：纯标题列表 → 返回空串（调用方显示兜底文案，而不是把别人的标题当摘要）", () => {
    expect(cleanIntelSnippet(SHAPE_B, { title: "浙江发布会：安诊儿已接入2000+医疗机构" })).toBe("")
  })

  // 真实形态 C：列表残片里夹着「邻篇文章的正文」（标题 3-gram 命中 0）
  const SHAPE_C =
    "2026新版基层医疗能力标准发布 2026-10-27 2026-10-26 罗伊氏乳杆菌DSM17648（商品名Pylopass）是一种经灭活处理的专利菌株，它通过菌体表面的特异性分子以纯物理方式识别并结合幽门螺杆菌，形成共聚物随肠道蠕动排出体外。"
  it("形态 C：片段是邻篇文章的正文（与标题无共同词）→ 返回空串", () => {
    expect(cleanIntelSnippet(SHAPE_C, { title: "2026新版基层医疗能力标准发布：明确信息化评价要点" })).toBe("")
  })

  // 真实形态 D：列表残片里夹着「本文自己的正文」（标题 3-gram 命中 42~66）
  const SHAPE_D =
    "肿瘤患者身体里的能量危机 2026-10-27 2026-10-27 10月22日，科大讯飞全球1024开发者节主论坛于北京国家会议中心举行。会上，讯飞星火医疗大模型V3.7正式发布，基于全国产算力底座实现医学语义、影像、语音深度融合的多模态技术突破。"
  it("形态 D：保留本文正文段（标题词命中），丢掉前面的列表残片", () => {
    const out = cleanIntelSnippet(SHAPE_D, { title: "讯飞星火医疗大模型V3.7升级，AI患者管理3.0发布", max: 200 })
    expect(out.startsWith("10月22日，科大讯飞")).toBe(true)
    expect(out).toContain("讯飞星火医疗大模型V3.7")
  })

  it("无日期的正常片段不误伤（不进列表分支）", () => {
    const normal = "为深化医药卫生体制改革，省医保局发布最新目录，自下月起执行，覆盖全省二级以上医院。"
    expect(cleanIntelSnippet(normal, { title: "省医保局发布最新目录" })).toBe(normal)
  })

  it("行首裸日期剥离（列表页时间戳），正文里的日期不动", () => {
    const out = cleanIntelSnippet("2026-10-27 该院互联网医院上线一年，累计服务患者 12 万人次，覆盖 3 个院区。", { title: "互联网医院上线一年" })
    expect(out.startsWith("该院互联网医院")).toBe(true)
  })

  it("空输入 / 纯噪声 → 空串；max 截断带省略号", () => {
    expect(cleanIntelSnippet("")).toBe("")
    expect(cleanIntelSnippet("更多... 更多...")).toBe("")
    expect(cleanIntelSnippet("句".repeat(300), { max: 20 })).toBe(`${"句".repeat(20)}…`)
  })
})
