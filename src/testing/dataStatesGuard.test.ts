// 「失败不能伪装成空态」的全库防回潮哨兵（2026-11-04）
//
// R69 审计一次挖出 4 处同类缺陷：
//   · 知识库正文检索 401 → 显示「没有找到包含该关键词的文档」
//   · 素材选择器 500   → 显示「素材库为空，可先到素材库页导入」
//   · 多处筛选后 0 条    → 显示「库是空的」
// 根因是全仓 123 处空态各写一遍。已建 src/components/common/DataStates.tsx 收敛，
// 并把已发现的 2 处真实缺陷改成 ErrorState。
//
// 本哨兵做两件事，防止「修过的又回去」和「新写的再犯」：
//  ① 已接入统一组件的两处，源码里不许再出现「裸空态 + 失败分支共用」的旧写法；
//  ② 扫全库 tsx：凡是 catch/错误分支里出现「暂无 / 没有找到 / 为空」这类空态措辞的，
//     一律列为可疑（要求人判读或改用 ErrorState）。
//
// ② 会有一定误报（有些文案确实该同时覆盖两种情况），所以做成**白名单 + 精确断言**：
// 只允许「同时出现错误语义」或「在已登记白名单里」的写法，新增可疑点会让本用例变红，
// 逼着后人来判一次，而不是悄悄混过去。
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// 本文件位于 src/testing/ → REPO_ROOT 上溯两级；扫描根是 REPO_ROOT/src
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const SRC_ROOT = path.join(REPO_ROOT, "src")

function walkTsx(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (["node_modules", "dist", ".git", ".scratch"].includes(name)) continue
      walkTsx(p, out)
    } else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) {
      out.push(p)
    }
  }
}

const FILES: string[] = []
walkTsx(SRC_ROOT, FILES)

/** 空态措辞（表示「没有数据」） */
const EMPTY_PHRASES = /暂无|没有找到|还没有|为空|没有任何|未命中/

/**
 * 已登记的可疑点白名单：每条都要写清为什么「虽然同时出现空态与失败词，但写法是对的」。
 * 新增条目必须先判断，不许为了过测试而随手加。
 */
const ALLOWLIST: { file: string; why: string }[] = [
  { file: "src/components/common/DataStates.tsx", why: "统一组件本体，本身就是空态/失败态的唯一定义处" },
]

function isAllowlisted(rel: string): boolean {
  return ALLOWLIST.some((a) => rel === a.file || rel.endsWith(a.file.replace(/^src\//, "")))
}

/**
 * 找出「**三元条件由错误状态本身驱动**、却在该分支给出空态结论」的可疑写法。
 *
 * 判据演进（两次都被实测打回，记在这里省得后人重走）：
 *   v1「文件里既有空态措辞、又有任何 catch」→ 扫出 60+ 文件，全是噪音
 *      （组件既有正常空态、又恰好在别处有 catch）。
 *   v2「问号前 200 字符里出现 error/fail」→ 剩 3 个，人工判读后**全是误报**：
 *      · ComplianceMatrixPanel：`{scanError}` 单独渲染在前，条件只判 rows.length
 *      · ParseSectionReader：`status === "failed" ? "没取到" : "还没有解析"` ——这恰恰是正确的区分写法
 *      · DocListPanel：条件里显式写了 `!serverDeletedError`（有错就不显示空态）
 *   v3（当前）：条件必须是**错误状态本身**（`loadError` / `failMessage` / `xxxError` 等）
 *      作为真值判断，且该分支直接输出空态措辞。这才对应真实缺陷结构：
 *      `loadError ? <失败态> : items.length===0 ? "没有找到" : ...` 的反面——
 *      即 `loadError ? "没有找到" : ...` 这种把失败直接说成没有。
 */
function suspect(rel: string, code: string): string | null {
  if (isAllowlisted(rel)) return null
  const usesUnified = /from\s+["']@\/components\/common\/DataStates["']/.test(code)
  if (usesUnified) return null

  const re = /\?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const branch = code.slice(m.index, m.index + 200)
    if (!EMPTY_PHRASES.test(branch)) continue
    // 条件区：从问号往前取，直到上一个 { 、; 或 ) 为止（同一表达式内）
    const condStart = Math.max(0, m.index - 160)
    const cond = code.slice(condStart, m.index)
    // 判据：条件区**以错误状态变量结尾**（允许 ! 取反），且该变量不用来渲染失败态。
    //   缺陷形态：`{loadError ? <p>暂无文档</p> : null}`      ← 错误时告诉用户"没有数据"
    //   正确形态：`{!loadError ? (... 空态 ...) : null}`       ← 有错则不显示空态
    //             `{status === "failed" ? "没取到" : "还没有"}` ← 条件不是错误变量
    const endsWithErrorVar = /(?:^|[\s({&|!])((?:load|fetch|scan|save|delete|request|query|search|submit)?[Ee]rror[A-Za-z]*|[Ee]rror[A-Za-z]*|[Ff]ail[A-Za-z]*|[Ff]ailMessage|[Ee]rrMsg)\s*$/.test(
      cond,
    )
    const negated = /!\s*((?:load|fetch|scan|save|delete|request|query|search|submit)?[Ee]rror[A-Za-z]*|[Ee]rror[A-Za-z]*|[Ff]ail[A-Za-z]*|[Ff]ailMessage|[Ee]rrMsg)\s*$/.test(
      cond,
    )
    if (endsWithErrorVar && !negated) {
      return "三元条件由「错误状态」直接驱动（错误时显示），却在该分支给出「暂无/没有找到/为空」的结论"
    }
  }
  return null
}

describe("失败不许伪装成空态（防回潮）", () => {
  it("全库扫描：可疑文件必须为 0（或已登记白名单并写明理由）", () => {
    const offenders: string[] = []
    for (const abs of FILES) {
      const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, "/")
      const code = readFileSync(abs, "utf-8")
      const why = suspect(rel, code)
      if (why) offenders.push(`${rel}\n    ${why}`)
    }
    expect(
      offenders,
      `以下文件疑似「把失败说成没数据」。判读后：真有问题 → 改用 DataStates 的 ErrorState；\n` +
        `确认写法正确 → 加进本文件 ALLOWLIST 并写明理由。\n  ${offenders.join("\n  ")}`,
    ).toEqual([])
  }, 60_000)

  it("已修的两处真实缺陷不许回退：素材选择器 / 知识库检索必须用 ErrorState", () => {
    const mustUse = [
      "src/components/ppt-quote/MaterialPickerDialog.tsx",
      "src/components/knowledge/KbContentSearchPanel.tsx",
    ]
    for (const rel of mustUse) {
      const code = readFileSync(path.join(REPO_ROOT, rel), "utf-8")
      expect(code, `${rel} 应使用统一 ErrorState 展示失败`).toContain("ErrorState")
      // 旧写法：失败分支里自己拼「不是『库里没有』」这类手写文案
      expect(code, `${rel} 不应再手写失败态容器（应走 ErrorState）`).not.toMatch(/技术原因：\{/)
    }
  })

  it("统一组件本身必须同时提供空态与失败态两个不同出口", () => {
    const code = readFileSync(path.join(REPO_ROOT, "src/components/common/DataStates.tsx"), "utf-8")
    expect(code).toContain("export function EmptyState")
    expect(code).toContain("export function ErrorState")
    // ErrorState 必须带 role=alert（可被无障碍工具与测试识别为「这是错误」）
    expect(code).toContain('role="alert"')
  })

  /**
   * 「筛选后 0 条一律说成库是空的」是 R69 审计 P2-7 的具体缺陷：
   * DocListPanel 空态只判 searchQuery、不判 categoryFilter，于是选了空分类就显示
   * 「团队知识库还是空的 / 上传第一批文档」，而左栏写着 2175 篇。
   * 这里把「空态必须区分是否处于筛选态」钉住，防止以后又只判搜索词。
   */
  it("知识库列表空态必须同时考虑搜索与分类筛选（不许只说「库是空的」）", () => {
    const code = readFileSync(path.join(REPO_ROOT, "src/components/knowledge/DocListPanel.tsx"), "utf-8")
    // 必须出现「筛选态」与「真空库」两套文案分支
    expect(code).toContain("当前筛选条件下没有文档")
    expect(code).toContain("团队知识库还是空的")
    // 筛选判定必须把 categoryFilter 算进去（而非只看 searchQuery）
    expect(code, "空态判定漏了 categoryFilter：选了空分类会显示成「库是空的」").toMatch(
      /hasCategory/,
    )
    // 清除入口必须同时清搜索与分类
    expect(code, "「清除筛选」应同时清空搜索词与分类").toMatch(/onClearSearch\(\)[\s\S]{0,120}setCategoryFilter\(""\)/)
  })
})
