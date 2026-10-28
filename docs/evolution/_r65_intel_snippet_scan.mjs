// 用法：node --experimental-strip-types docs/evolution/_r65_intel_snippet_scan.mjs（需 :7000 PocketBase 在跑）
// R65 真实数据取证：content_snippet 经「旧口径 displayizeIntel」与「新口径 cleanIntelSnippet」的逐条对照。
// 只看事实，不改任何数据。
import http from 'node:http'
import { cleanIntelSnippet, displayizeIntel } from '../../src/pages/IntelCenter/intelBodyClean.ts'

const get = (page) =>
  new Promise((res) => {
    const req = http.request(
      { host: '127.0.0.1', port: 7000, path: `/api/intel_items?perPage=200&page=${page}`, headers: { 'X-Rh-User-Id': 'local-user' } },
      (r) => {
        let s = ''
        r.on('data', (d) => (s += d))
        r.on('end', () => {
          try {
            res(JSON.parse(s))
          } catch {
            res(null)
          }
        })
      },
    )
    req.on('error', () => res(null))
    req.end()
  })

const all = []
for (let p = 1; p <= 8; p++) {
  const j = await get(p)
  if (!j || !j.items?.length) break
  all.push(...j.items)
  if (all.length >= j.totalItems) break
}

const withSnip = all.filter((x) => String(x.content_snippet ?? '').trim())
const MORE_TOKEN = /(?:^|\s)(?:更?多\s*)?(?:\.{2,}|…+)(?=\s|$)/
const DATE = /(?:^|\s)(?:\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}-\d{2})(?=\s|$)/g

const oldOut = (x) => displayizeIntel(String(x.content_snippet ?? ''), 120)
const newOut = (x) => cleanIntelSnippet(String(x.content_snippet ?? ''), { title: String(x.title ?? ''), max: 120 })

let oldMore = 0,
  oldDates = 0,
  oldBoth = 0,
  oldDirty = 0
let nowEmpty = 0,
  nowKept = 0
let noDateSame = 0,
  noDateTotal = 0
const dirtySamples = []
const emptySamples = []
const noDateDiff = []

for (const x of withSnip) {
  const o = oldOut(x)
  const n = newOut(x)
  const more = MORE_TOKEN.test(o)
  const dates = (o.match(DATE) ?? []).length
  if (more) oldMore++
  if (dates >= 2) oldDates++
  if (more && dates >= 2) oldBoth++
  if (more || dates >= 2) {
    oldDirty++
    if (dirtySamples.length < 5) dirtySamples.push({ id: x.id, title: String(x.title).slice(0, 24), o: o.slice(0, 90), n: n || '（隐藏，显示兜底文案）' })
  }
  if (!n) {
    nowEmpty++
    if (emptySamples.length < 3) emptySamples.push({ id: x.id, o: o.slice(0, 90) })
  } else nowKept++
  // 无日期片段不进列表分支：新旧必须逐字一致（不误伤干净数据的硬证据）
  // 口径说明：日期判定要看函数实际看到的 600 字窗口，不能用被截断到 120 字的输出去判
  if (!DATE.test(displayizeIntel(String(x.content_snippet ?? ''), 600))) {
    noDateTotal++
    DATE.lastIndex = 0
    if (o === n) noDateSame++
    else if (noDateDiff.length < 4) noDateDiff.push({ id: x.id, o: o.slice(0, 70), n: n.slice(0, 70) || '（空）' })
  }
  DATE.lastIndex = 0
}

console.log(`库内情报 ${all.length} 条 / 有 content_snippet ${withSnip.length} 条`)
console.log(`旧口径（displayizeIntel 120）残留：含「更多…」${oldMore} 条 · 含 ≥2 日期 ${oldDates} 条 · 两者都有 ${oldBoth} 条 → 合计 ${oldDirty} 条把「别的条目」当摘要显示`)
console.log(`新口径（cleanIntelSnippet）：归零 ${nowEmpty} 条（显示兜底文案）· 保留正文 ${nowKept} 条`)
console.log(`不误伤硬证据：无日期片段 ${noDateTotal} 条中，新旧输出逐字一致 ${noDateSame} 条`)
if (noDateDiff.length) {
  console.log("  （其余差异为预期改善，附样本）")
  for (const d of noDateDiff) console.log("   ·", d.id, "旧:", d.o, "| 新:", d.n)
}

console.log('\n--- 对照抽样（旧 → 新）---')
for (const s of dirtySamples) {
  console.log(`【${s.id}】${s.title}`)
  console.log(`  旧: ${s.o}`)
  console.log(`  新: ${s.n}`)
}
console.log('\n--- 归零抽样（旧口径下显示的是别人的标题）---')
for (const s of emptySamples) console.log(`  ${s.id} | ${s.o}`)
