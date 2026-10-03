import { describe, expect, it } from "vitest"
import {
  parseAiHotRss,
  aiHotCategories,
  aiHotSourceOf,
  rssHtmlToText,
  decodeXmlEntities,
  type AiHotItem,
} from "./aiHotFeed"

// ---------------------------------------------------------------------------
// AI 动态（R139）：RSS 解析纯函数。样本取自 2026-10-03 aihot.news/feed 真实结构。
// ---------------------------------------------------------------------------

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>AIHOT — 精选</title>
  <item>
    <title>Baseten 工程师实测：LLM 生成的推理引擎比 vLLM 快最多 90%</title>
    <link>https://aihot.news/items/uwm1ml1igd8k2u81g14uf8pc3</link>
    <description>&lt;p&gt;Baseten 工程师参考 MetaInfer 论文，让 Claude Code 自动构建推理引擎 VibeQwen，单流解码比 vLLM 快最多 90%。&lt;/p&gt;&lt;p&gt;推荐理由：工程可复现。&lt;/p&gt;</description>
    <category>技巧观点</category>
    <pubDate>Fri, 02 Oct 2026 21:09:34 GMT</pubDate>
    <guid>uwm1ml1igd8k2u81g14uf8pc3</guid>
    <author>noreply@aihot.news (Baseten 工程博客)</author>
  </item>
  <item>
    <title>某新模型发布</title>
    <link>https://aihot.news/items/second002</link>
    <description><![CDATA[<p>直接发布，支持 <b>多模态</b>。</p>]]></description>
    <category>AI 模型</category>
    <pubDate>Fri, 02 Oct 2026 20:37:23 GMT</pubDate>
    <guid>second002</guid>
    <author>noreply@aihot.news (官方博客)</author>
  </item>
  <item>
    <title>重复guid条目</title>
    <link>https://aihot.news/items/uwm1ml1igd8k2u81g14uf8pc3</link>
    <description>x</description>
    <category>技巧观点</category>
    <pubDate>Fri, 02 Oct 2026 21:09:34 GMT</pubDate>
    <guid>uwm1ml1igd8k2u81g14uf8pc3</guid>
  </item>
</channel>
</rss>`

describe("parseAiHotRss", () => {
  it("解析全部字段（转义 HTML description / author 括号信源名 / RFC1123 时间）", () => {
    const items = parseAiHotRss(SAMPLE_RSS)
    expect(items).toHaveLength(2) // 同 guid 第 3 条被去重
    const first = items[0]
    expect(first.id).toBe("uwm1ml1igd8k2u81g14uf8pc3")
    expect(first.title).toContain("Baseten")
    expect(first.link).toBe("https://aihot.news/items/uwm1ml1igd8k2u81g14uf8pc3")
    expect(first.summary).toContain("VibeQwen")
    expect(first.summary).not.toContain("<p>")
    expect(first.category).toBe("技巧观点")
    expect(first.source).toBe("Baseten 工程博客")
    expect(first.publishedAt).toBe("2026-10-02T21:09:34.000Z")
  })
  it("CDATA description 同样去 HTML 成纯文本", () => {
    const items = parseAiHotRss(SAMPLE_RSS)
    const c = items[1]
    expect(c.summary).toContain("多模态")
    expect(c.summary).not.toContain("<b>")
    expect(c.category).toBe("AI 模型")
  })
  it("空/垃圾输入容错返回空数组", () => {
    expect(parseAiHotRss("")).toEqual([])
    expect(parseAiHotRss("<html>not a feed</html>")).toEqual([])
  })
  it("guid 缺失回退 link 作幂等键", () => {
    const xml = `<item><title>t</title><link>https://x/y</link><pubDate>bad</pubDate></item>`
    const items = parseAiHotRss(xml)
    expect(items[0].id).toBe("https://x/y")
    expect(items[0].publishedAt).toBe("") // 非法时间容错空串
  })
})

describe("aiHotCategories", () => {
  it("按出现频次降序", () => {
    const mk = (c: string): AiHotItem => ({ id: Math.random() + "", title: "t", link: "", summary: "", category: c, source: "", publishedAt: "" })
    expect(aiHotCategories([mk("行业动态"), mk("行业动态"), mk("论文")])).toEqual(["行业动态", "论文"])
  })
})

describe("辅助纯函数", () => {
  it("decodeXmlEntities 处理成对实体且 &amp; 不被二次解码", () => {
    expect(decodeXmlEntities("&lt;p&gt;a &amp; b&lt;/p&gt;")).toBe("<p>a & b</p>")
    expect(decodeXmlEntities("&#39;q&#39; &quot;w&quot; &nbsp;x")).toBe(`'q' "w"  x`)
  })
  it("rssHtmlToText 收敛空白", () => {
    expect(rssHtmlToText("&lt;p&gt;你好   &lt;b&gt;世界&lt;/b&gt;！&lt;/p&gt;")).toBe("你好 世界 ！")
  })
  it("aiHotSourceOf 取括号内信源名，无括号回退原串", () => {
    expect(aiHotSourceOf("noreply@aihot.news (官方博客)")).toBe("官方博客")
    expect(aiHotSourceOf("裸名")).toBe("裸名")
    expect(aiHotSourceOf("")).toBe("")
  })
})
