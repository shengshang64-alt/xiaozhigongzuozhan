#!/usr/bin/env node
/**
 * 全站用户可见文案的禁用词检查（UI/UX 升级 Phase 1 · 任务 1.2）。
 *
 * 背景：docs/UI-UX-Diagnosis-and-Optimization-Recommendations.md §3.2 ——
 * 「作战 / 制胜 / 决胜」等军事化黑话抬高理解成本。术语规范见 docs/术语规范表.md。
 *
 * 检查范围：src 下全部 .ts/.tsx（含注释——注释里的黑话会继续扩散到文案，一并拦住）。
 * 例外白名单 ALLOW_FILES：黑话本身是「功能内容」的文件，改词会改变行为或破坏数据真实性：
 *  - bidProseLinter：标书文案反 AI 套话检查器的规则表（赋能/抓手就是要拦的词）
 *  - bidTypes / pptQuoteTypes / solutionTypes：AI 提示词里的反套话黑名单（同上）
 *  - deckVisualPlan：PPT 配图抽象词判定表（功能性关键词列表）
 *  - marketIntel：竞品研究数据（「AI 赋能临床」是对东软公开战略的转述，属事实数据）
 *  - intelBodyClean.test：真实抓取页面清洗夹具（词是清洗逻辑的输入样本）
 *  - BidWarRoom：在途工作文件（另一会话未提交改动），其「作战室」文案待该文件
 *    落地后再统一替换（见 docs/术语规范表.md 的待办段）
 *
 * 用法：node scripts/check-prohibited-words.js（也可 npm run check:terms）
 * 退出码：0 = 通过；1 = 发现违禁词（打印文件、行号、词语、行内容）
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const SCAN_DIR = join(ROOT, "src")
const EXTENSIONS = [".ts", ".tsx"]

/** 禁用词表（与 docs/术语规范表.md 同源，改词先改文档） */
const PROHIBITED_WORDS = ["作战", "制胜", "决胜", "杀手锏", "利器", "赋能", "抓手"]

/**
 * 白名单：这些文件里的命中属于功能内容 / 在途文件，不算文案违例。
 * key 为相对仓库根的 posix 路径；value 为留档理由（审查时看得懂为什么放行）。
 */
const ALLOW_FILES = {
  "src/pages/BidWorkspace/bidProseLinter.ts": "反 AI 套话检查器的规则词表，赋能/抓手是被拦截词",
  "src/pages/BidWorkspace/bidProseLinter.test.ts": "规则词表的行为测试夹具",
  "src/pages/BidWorkspace/bidTypes.ts": "AI 提示词反套话黑名单（禁词表本体）",
  "src/pages/PptQuote/pptQuoteTypes.ts": "AI 提示词反套话铁律（禁词表本体）",
  "src/pages/SolutionStudio/solutionTypes.ts": "AI 提示词反套话约束（禁词表本体）",
  "src/pages/PptQuote/deckVisualPlan.ts": "PPT 配图抽象词判定表（功能关键词）",
  "src/pages/PptQuote/deckVisualPlan.test.ts": "抽象词判定的行为测试夹具",
  "src/pages/Competitors/marketIntel.ts": "竞品研究数据（转述东软公开战略，事实内容）",
  "src/pages/IntelCenter/intelBodyClean.test.ts": "真实抓取页面的清洗夹具（词是输入样本）",
  "src/components/bid-workspace/BidWarRoom.tsx": "在途工作文件（另一会话未提交），「作战室」文案待其落地后替换",
}

function listFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...listFiles(full))
    else if (EXTENSIONS.some((ext) => name.endsWith(ext))) out.push(full)
  }
  return out
}

const toPosix = (p) => p.split(sep).join("/")

let allowHits = 0
let failHits = 0
const files = listFiles(SCAN_DIR)
for (const file of files) {
  const rel = toPosix(relative(ROOT, file))
  const allowReason = ALLOW_FILES[rel]
  const lines = readFileSync(file, "utf8").split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const word of PROHIBITED_WORDS) {
      if (lines[i].includes(word)) {
        if (allowReason) {
          allowHits += 1
          console.log(`ALLOW  ${rel}:${i + 1}  [${word}]  ${allowReason}`)
        } else {
          failHits += 1
          console.error(`FAIL   ${rel}:${i + 1}  [${word}]  ${lines[i].trim()}`)
        }
      }
    }
  }
}

console.log(`\n扫描 ${files.length} 个文件，白名单 ${Object.keys(ALLOW_FILES).length} 个文件。`)
if (failHits === 0) {
  console.log(`未发现违禁词（白名单放行 ${allowHits} 处）。`)
  process.exit(0)
}
console.error(`\n发现 ${failHits} 处违禁词（白名单放行 ${allowHits} 处）。`)
console.error("用户可见文案请改用 docs/术语规范表.md 的推荐词；若属于功能内容，请更新 ALLOW_FILES 并写明理由。")
process.exit(1)
