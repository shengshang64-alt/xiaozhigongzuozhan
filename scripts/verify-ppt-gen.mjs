// 真实生成验证：走系统现有提示词 → LLM → normalizeSlides → reshapeTextHeavySlides
// 目的：验证「图文结合」是否真的达成，而不只是改代码
import { buildDeckSingleMessages } from "../src/pages/PptQuote/pptQuoteTypes.ts"
import { normalizeSlides } from "../src/pages/PptQuote/pptQuoteTypes.ts"
import { reshapeTextHeavySlides } from "../src/pages/PptQuote/deckReshape.ts"

const PB = "http://127.0.0.1:7000"
const UID = "local-user" // 模型配置的 owner 是这个身份
const MODEL = "agnes-3.0-flash"
const CONFIG_ID = "ncvghzzd1xei8vu" // opecode（已配默认模型）

const ctx = {
  deckType: "presale",
  topic: "遂溪县中医院智慧医院信息化建设汇报",
  audience: "院领导与信息科",
  keyPoints: `1. 现状短板：电子病历仅 4 级、三套字典不统一、医保对账滞后 7 天
2. 建设目标：电子病历 5 级 + 互联互通四级甲等
3. 投资与周期：1800 万元，12 个月
4. 我方优势：12 年专注医疗信息化，260 个项目，服务 30 市
5. 实施路径：四阶段推进（调研/建设/试运行/验收）`,
  materialText: `
客户：遂溪县中医院（二级甲等，编制床位 300 张，年门诊量约 42 万人次）
现状：
- 电子病历应用水平 4 级（2019 版口径），无全程结构化病历
- HIS/EMR/LIS 三套字典不统一，药名不互通
- PACS 影像与病历系统脱钩，调阅靠人工
- 医保对账手工导数，月末滞后 7 天
- 数据中台缺主索引，患者 ID 三套并存
- 中医四诊数据仍靠纸质，未进 EMR
- 中药房调配走纸质流程，闭环未打通
目标：
- 电子病历应用水平达到 5 级
- 互联互通标准化成熟度测评达到四级甲等
- 建设周期 12 个月，投资预算 1800 万元
我方优势：
- 成立于 2014 年，专注医疗信息化 12 年
- 累计交付项目 260 个，覆盖 4 省 30 市
- 服务三级医院 38 家、二级医院 82 家
实施：四阶段推进，调研 2 周、建设 6 个月、试运行 3 个月、验收 1 个月
`,
}

function pickArray(raw) {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === "object") {
    for (const k of ["slides", "pages", "data"]) if (Array.isArray(raw[k])) return raw[k]
  }
  return []
}

async function callLlm(messages, maxTokens) {
  const res = await fetch(`${PB}/api/model-gw/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Rh-User-Id": UID },
    body: JSON.stringify({ config_id: CONFIG_ID, model: MODEL, messages, max_tokens: maxTokens, temperature: 0.6 }),
  })
  const j = await res.json()
  if (!j?.ok) throw new Error(JSON.stringify(j).slice(0, 400))
  return j.content ?? j.text ?? ""
}

function parseJsonLoose(text) {
  const t = String(text ?? "").trim()
  const stripped = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
  try {
    return JSON.parse(stripped)
  } catch {
    const m = /\{[\s\S]*\}/.exec(stripped)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* ignore */
      }
    }
    throw new Error("无法解析 JSON：" + stripped.slice(0, 200))
  }
}

const PAGE_COUNT = 12

console.log("=".repeat(70))
console.log("真实生成验证 ·", ctx.topic, "·", PAGE_COUNT, "页")
console.log("=".repeat(70))

const messages = buildDeckSingleMessages(ctx, PAGE_COUNT)
console.log("\n[1/4] 已构建提示词，system 长度:", messages[0].content.length, "字符")

console.log("\n[2/4] 调用 LLM（", MODEL, "）…")
const t0 = Date.now()
let raw
try {
  raw = await callLlm(messages, 8192)
} catch (e) {
  console.error("LLM 调用失败:", e.message)
  process.exit(1)
}
console.log("     耗时", ((Date.now() - t0) / 1000).toFixed(1), "s，返回", raw.length, "字符")

console.log("\n[3/4] 解析并归一化…")
let slides
try {
  slides = normalizeSlides(parseJsonLoose(raw), null, PAGE_COUNT)
} catch (e) {
  console.error("归一化失败:", e.message)
  console.error("原始返回:", raw.slice(0, 800))
  process.exit(1)
}
console.log("     得到", slides.length, "页")

function countByLayout(list) {
  const c = {}
  for (const s of list) {
    const visual = s.chart ? "chart" : s.kpi?.length ? "kpi" : s.figures?.length ? s.figures[0].type : s.image ? "image" : s.layout || "bullets"
    c[visual] = (c[visual] ?? 0) + 1
  }
  return c
}

const beforeVisual = slides.filter((s) => s.chart || s.kpi?.length || s.figures?.length || s.image).length
console.log("\n     【整形前】视觉页:", beforeVisual, "/", slides.length, " 纯文字:", slides.length - beforeVisual)
console.log("     版式分布:", JSON.stringify(countByLayout(slides)))

console.log("\n[4/4] 自动整形…")
const { slides: out, stats } = reshapeTextHeavySlides(slides)
const afterVisual = out.filter((s) => s.chart || s.kpi?.length || s.figures?.length || s.image).length
console.log("     reshaped:", JSON.stringify(stats))
console.log("     【整形后】视觉页:", afterVisual, "/", out.length, " 纯文字:", out.length - afterVisual)
console.log("     版式分布:", JSON.stringify(countByLayout(out)))

console.log("\n" + "=".repeat(70))
console.log("逐页明细")
console.log("=".repeat(70))
out.forEach((s, i) => {
  const kind = s.chart ? `chart(${s.chart.type})` : s.kpi?.length ? `kpi(${s.kpi.length})` : s.figures?.length ? s.figures[0].type : s.image ? "image" : "bullets"
  const role = s.role ?? "-"
  const changed = beforeVisual !== afterVisual && !slides[i].chart && !slides[i].kpi?.length && !slides[i].figures?.length && (s.chart || s.kpi?.length || s.figures?.length)
  console.log(
    `P${String(i + 1).padStart(2)} [${role.padEnd(9)}] [${kind.padEnd(12)}] ${changed ? "★" : " "} ${s.title.slice(0, 34)}`,
  )
})

// 保存结果供后续渲染验证
const fs = await import("node:fs")
fs.writeFileSync("gen-result.json", JSON.stringify(out, null, 1), "utf8")
console.log("\n已保存 gen-result.json（", out.length, "页）")

