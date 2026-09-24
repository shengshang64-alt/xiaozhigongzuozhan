import { describe, expect, it } from "vitest"
import { cleanIntelBody, cleanIntelLine, displayizeIntel } from "./intelBodyClean"

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
})
