// ---------------------------------------------------------------------------
// toHtml.ts —— 体检报告（自包含 HTML）。零依赖、离线可看，用于随标书归档 / 转发复核。
//
// ⚠️ 只读产出：报告是检查结果的静态呈现，不含任何对正文的改动，也不内联可编辑控件。
// ---------------------------------------------------------------------------

import { buildSafeFileName } from "@/lib/fileName"
import { triggerBlobDownload } from "@/lib/download"
import {
  CHECK_LEVEL_LABEL,
  ITEM_STATUS_LABEL,
  SEVERITY_DOT,
  SEVERITY_LABEL,
  type BidCheckResult,
  type CheckItem,
  type CheckLevel,
} from "../bidCheckTypes"

function esc(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function levelStat(items: CheckItem[], lv: CheckLevel): { total: number; issue: number; rate: number } {
  const g = items.filter((it) => it.level === lv)
  const issue = g.filter((it) => it.status === "fail" || it.status === "warn").length
  const total = g.length
  const rate = total ? Math.round(((total - issue) / total) * 100) : 100
  return { total, issue, rate }
}

/** 生成完整 HTML 文本（供测试断言与预览复用） */
export function buildHtmlReport(result: BidCheckResult): string {
  const s = result.summary
  const modeText = result.mode === "sealed" ? "暗标严格模式" : "普通模式"
  const levels: CheckLevel[] = ["L1", "L2", "L3", "L4", "L5"]

  const levelCards = levels
    .filter((lv) => result.items.some((it) => it.level === lv))
    .map((lv) => {
      const st = levelStat(result.items, lv)
      const cls = st.rate >= 95 ? "ok" : st.rate >= 80 ? "warn" : "bad"
      return `<div class="card ${cls}"><div class="card-lv">${CHECK_LEVEL_LABEL[lv]}</div><div class="card-rate">${st.rate}%</div><div class="card-sub">${st.issue}/${st.total} 命中</div></div>`
    })
    .join("")

  const sevBars = (["critical", "high", "medium", "info"] as const)
    .map(
      (sv) =>
        `<div class="sev"><span class="dot">${SEVERITY_DOT[sv]}</span><span class="sev-name">${SEVERITY_LABEL[sv]}</span><span class="sev-num">${s.bySeverity[sv]}</span></div>`,
    )
    .join("")

  const groups = levels
    .filter((lv) => result.items.some((it) => it.level === lv))
    .map((lv) => {
      const rows = result.items
        .filter((it) => it.level === lv)
        .map((it) => {
          const hitHtml = it.hits.length
            ? `<ul class="hits">${it.hits
                .map((h) => `<li><b>${esc(h.location)}</b>：${esc(h.text)}${h.basis ? `<em>（${esc(h.basis)}）</em>` : ""}</li>`)
                .join("")}</ul>`
            : `<div class="nohit">${it.status === "unconfigured" ? "标准未配置，不判定" : it.status === "skipped" ? "当前输入无法检测" : it.status === "pass" ? "未发现问题" : "无定位命中"}</div>`
          return `<tr class="row-${it.status}">
            <td class="c-code">${esc(it.code)}</td>
            <td class="c-title"><span class="dot">${SEVERITY_DOT[it.severity]}</span>${esc(it.title)}<span class="cat">${esc(it.category)}</span></td>
            <td class="c-status">${ITEM_STATUS_LABEL[it.status]}</td>
            <td class="c-detail">${esc(it.basis)}<br/><span class="sug">建议：${esc(it.suggestion)}</span>${hitHtml}</td>
          </tr>`
        })
        .join("")
      return `<h2>${CHECK_LEVEL_LABEL[lv]}</h2><table><thead><tr><th>编号</th><th>检查项</th><th>状态</th><th>依据 / 建议 / 命中</th></tr></thead><tbody>${rows}</tbody></table>`
    })
    .join("")

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>标书检查体检报告 - ${esc(result.sourceName)}</title>
<style>
:root{--red:#d33;--org:#e8801a;--yel:#e0b400;--blu:#2b7fd1;--ink:#222;--line:#e5e5e5;}
*{box-sizing:border-box}body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--ink);margin:0;padding:24px;line-height:1.6;background:#fafafa;}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-left:4px solid var(--blu);padding-left:8px}
.meta{color:#666;font-size:13px;margin-bottom:16px}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 18px;min-width:130px}
.card-lv{font-size:13px;color:#666}.card-rate{font-size:26px;font-weight:700}.card-sub{font-size:12px;color:#888}
.card.ok .card-rate{color:#2a9d4a}.card.warn .card-rate{color:var(--yel)}.card.bad .card-rate{color:var(--red)}
.sevs{display:flex;gap:20px;flex-wrap:wrap;margin:8px 0 4px;font-size:14px}.sev .num{font-weight:700}
.dot{margin-right:6px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top;font-size:13px}
th{background:#f2f5f8}tr.row-fail{background:#fff4f4}tr.row-warn{background:#fffdf3}tr.row-unconfigured{background:#f6f7f9;color:#888}tr.row-skipped{color:#999}
.c-code{white-space:nowrap;font-family:monospace}.cat{color:#888;font-size:11px;margin-left:8px}
.sug{color:#2a7d5a;font-size:12px}.hits{margin:6px 0 0;padding-left:18px}.hits li{margin:2px 0}
.nohit{color:#999;font-size:12px}.foot{margin-top:32px;color:#999;font-size:12px;border-top:1px dashed var(--line);padding-top:10px}
.banner{background:${result.mode === "sealed" ? "#fff4f4" : "#eef6ff"};border:1px solid ${result.mode === "sealed" ? "#f3c2c2" : "#cfe3f7"};padding:10px 14px;border-radius:8px;margin:12px 0;font-size:14px}
</style></head>
<body>
<h1>标书检查体检报告</h1>
<div class="meta">对象：${esc(result.sourceName)} ｜ 输入：${result.inputKind === "file" ? "上传文件" : "选择项目"}${result.hasPackage ? "（含文件包）" : "（无文件包）"} ｜ 生成时间：${esc(result.generatedAt)}</div>
<div class="banner">检查模式：<b>${modeText}</b>。本报告为只读检测结论，<b>不修改任何正文</b>；每条命中附「位置 / 原文 / 依据 / 建议」，改法由人工在 Word 中落地。</div>
<div class="cards">${levelCards}</div>
<div class="sevs">${sevBars}</div>
<div class="meta">合计 ${s.total} 项检查：通过 ${s.passed}、命中必改 ${s.fail}、命中建议 ${s.warn}、标准未配置 ${s.unconfigured}、无法检测 ${s.skipped}。</div>
${groups}
<div class="foot">标书检查中枢（BidCheck）· 纯规则零 AI · 只标不改。未配置项以「标准未配置」呈现，不做臆测判定。</div>
</body></html>`
}

/** 生成 HTML Blob */
export function buildHtmlBlob(result: BidCheckResult): Blob {
  return new Blob([buildHtmlReport(result)], { type: "text/html;charset=utf-8" })
}

/** 导出 HTML 报告并触发下载 */
export function exportHtmlReport(result: BidCheckResult): void {
  const blob = buildHtmlBlob(result)
  const name = buildSafeFileName(`${result.sourceName}-体检报告`, "html", "标书体检报告")
  triggerBlobDownload(blob, name)
}
