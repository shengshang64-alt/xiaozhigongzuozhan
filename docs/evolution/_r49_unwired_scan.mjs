// R48 代码考古（只读）：扫描「导出但生产代码从未调用」的函数/常量。
// 本项目已知失效模式 = R38 教训「有算法没入口」（B12 价格分、A1-A6 编制门禁都栽在这）。
// 口径：统计每个 export 符号在【其他非测试文件】里的出现次数；0 次 = 疑似没入口。
// 只读，不改任何代码；排除 .test. / .d.ts / 备份文件。
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const SRC = join(ROOT, "src")

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name) && !name.includes(".bak")) out.push(p)
  }
  return out
}

const files = walk(SRC)
const sources = files.map((f) => ({ f, text: readFileSync(f, "utf8") }))

// 抽取 export function/const/type/class 名
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
const exports = [] // {name, file}
for (const { f, text } of sources) {
  for (const m of text.matchAll(EXPORT_RE)) exports.push({ name: m[1], file: f })
}

// 统计：排除定义文件本身
const usage = new Map() // name -> Set(files)
for (const { name } of exports) {
  if (usage.has(name)) continue
  const set = new Set()
  for (const { f, text } of sources) {
    if (text.includes(name)) set.add(f)
  }
  usage.set(name, set)
}

const rows = []
for (const { name, file } of exports) {
  const used = usage.get(name)
  const others = [...used].filter((f) => f !== file)
  if (others.length === 0) rows.push({ name, file: relative(ROOT, file).replace(/\\/g, "/") })
}

// 按文件聚合输出
const byFile = new Map()
for (const r of rows) {
  if (!byFile.has(r.file)) byFile.set(r.file, [])
  byFile.get(r.file).push(r.name)
}
const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)
console.log(`扫描文件 ${files.length} 个；导出符号 ${exports.length} 个；生产代码零引用的符号 ${rows.length} 个\n`)
for (const [f, names] of sorted) {
  console.log(`${f}  (${names.length})`)
  console.log(`   ${names.join(", ")}`)
}
