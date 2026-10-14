const { execSync } = require("child_process")
const fs = require("fs"), path = require("path")
const d = "pocketbase/pb_hooks"
const files = fs.readdirSync(d).filter(f => f.endsWith(".pb.js"))
const variants = new Map()
let total = 0
for (const f of files) {
  let src
  try { src = execSync(`git show HEAD:${d}/${f}`, { encoding: "utf8", maxBuffer: 1 << 28 }) } catch { continue }
  src.split(/\r?\n/).forEach((l) => {
    if (!/x_rh_user_id|x-rh-user-id/i.test(l)) return
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return
    total++
    let kind = "other"
    if (/requestInfo\(\)/.test(l)) kind = "requestInfo.headers"
    if (/^var\s+h\s*=/.test(l.trim())) kind = "var-h-alias"
    if (/headers\.headers|\.headers\[/.test(l) && !/requestInfo\(\)/.test(l)) kind = "headers[]-direct"
    const t = l.trim()
    variants.set(t, (variants.get(t) || 0) + 1)
  })
}
console.log("HEAD non-comment identity lines:", total)
console.log("distinct literals:", variants.size)
;[...variants.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v + " x  " + k.slice(0, 170)))
