// 2026-10-20：bid_projects 的「类型字段 ↔ 后端列 / 写入白名单」契约守卫。
//
// 由来是**真实事故**，不是假想：`BidProjectRecord` 里的 `text_audit` 一直在前端被写入
// （useBidWorkspace.ts `updateProject({ text_audit: report })`），但 pb_hooks/bid_projects.pb.js
// 的 PATCH 白名单里没有它。PocketBase 侧是纯 `if ("x" in body) rec.set(...)` 串——没有 else、
// 不报错，`$app.save` 照常成功并返回 200；于是前端弹「结果已存档，可到「交卷体检」逐条复核」，
// 而 SubmissionCheckPanel 读的 `activeProject.text_audit` 刷新后必然是 null。
// `bid_source_mode` / `bid_external_text` 是同一类的第二个实例（Q28 外部投标文件：上传后刷新即丢）。
//
// 为什么单测抓不到：它不是「改坏了什么」，而是「从来没通过」。既有的行为网与哨兵都在验
// 「我改的东西有没有坏」，没有一条在验「写进去的东西读不读得回来」。本文件补的就是这一层：
// 以类型为契约真源，强制它与 pb_hooks 的列声明、写入白名单三方对齐。
//
// 读取走 `src/testing/hookSources.ts` 单一入口（R57 口径）：不自行算路径、不自行处理行尾。
import { describe, expect, it } from "vitest"
import { sourceText } from "@/testing/hookSources"

const TYPES_PATH = "src/pages/BidWorkspace/bidTypes.ts"
const HOOK_PATH = "pocketbase/pb_hooks/bid_projects.pb.js"

/** PocketBase 自持、业务侧不通过 body 写入的字段（创建时服务端赋值，且归属转移被刻意禁用）。 */
const SERVER_MANAGED = ["id", "rh_user_id", "created", "updated"]

/**
 * 从 `BidProjectRecord` 类型体里取字段名。
 * 只认顶层 2 空格缩进、形如 `name: Type` / `name?: Type` 的行——类型体里的 `/** ... *\/`
 * 注释以 `/` 开头，不会被这条正则误收。
 */
function recordFields(src: string): string[] {
  const marker = "export type BidProjectRecord = {"
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`未找到 BidProjectRecord 定义：${TYPES_PATH}`)
  const rest = src.slice(at + marker.length)
  const end = rest.indexOf("\n}")
  if (end < 0) throw new Error(`BidProjectRecord 类型体未正常闭合：${TYPES_PATH}`)
  const block = rest.slice(0, end)
  const out: string[] = []
  const re = /^ {2}([a-z_][a-z0-9_]*)\??:/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) out.push(m[1])
  return out
}

/** PATCH 白名单：`if ("x" in body) rec.set("x", ...)` 里的字段名（本文件里该形态只出现在 PATCH）。 */
function patchWhitelist(src: string): string[] {
  const out: string[] = []
  const re = /if \("([a-z_][a-z0-9_]*)" in body\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.push(m[1])
  return out
}

/** onBootstrap 里 `addField({ name: 'x', ... })` 声明的列（存量库靠它补列，是线上真实生效的那条路）。 */
function declaredColumns(src: string): string[] {
  const out: string[] = []
  // 引号两种都有：业务字段用单引号，created/updated 用双引号——只认一种会把它们误判成缺列
  const re = /addField\(\{ name: ['"]([a-z_][a-z0-9_]*)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.push(m[1])
  return out
}

const FIELDS = recordFields(sourceText(TYPES_PATH))
const WHITELIST = patchWhitelist(sourceText(HOOK_PATH))
const COLUMNS = declaredColumns(sourceText(HOOK_PATH))

describe("bid_projects 字段契约：类型 ↔ 列 ↔ 写入白名单", () => {
  it("地板检查：三份清单都真的解析到了内容（防正则失配导致的空集全绿）", () => {
    // 25 个项目 43 个业务字段是 R56/R57 期的实测量级；取下限而非精确值，避免正常增删字段就变红
    expect(FIELDS.length).toBeGreaterThan(40)
    expect(WHITELIST.length).toBeGreaterThan(40)
    expect(COLUMNS.length).toBeGreaterThan(40)
    // 抽样钉住解析确实落在真内容上
    expect(FIELDS).toContain("bid_chapters")
    expect(WHITELIST).toContain("bid_chapters")
    expect(COLUMNS).toContain("bid_chapters")
  })

  it("类型里每个字段都能被 PATCH 写入（漏一个就是静默丢数据）", () => {
    const missing = FIELDS.filter((f) => !SERVER_MANAGED.includes(f) && !WHITELIST.includes(f))
    expect(
      missing,
      `BidProjectRecord 声明了但这些字段不在 PATCH 白名单里，前端写入会被静默忽略（返回 200 但不落库）：\n` +
        `  ${missing.join("、")}\n` +
        `  修法：在 ${HOOK_PATH} 的 PATCH 处理里补 \`if ("字段" in body) rec.set("字段", body.字段)\`。`,
    ).toEqual([])
  })

  it("类型里每个字段都有列声明（addField 是存量库补列的真实路径）", () => {
    const missing = FIELDS.filter((f) => f !== "id" && !COLUMNS.includes(f))
    expect(
      missing,
      `BidProjectRecord 声明了但这些字段没有 addField 列声明，存量库不会有这一列：\n  ${missing.join("、")}`,
    ).toEqual([])
  })

  it("PATCH 白名单不含类型里没有的字段（防拼写漂移与僵尸字段）", () => {
    const extra = WHITELIST.filter((f) => !FIELDS.includes(f))
    expect(
      extra,
      `PATCH 白名单里有 BidProjectRecord 不认识的字段（多半是改名后漏改一侧）：\n  ${extra.join("、")}`,
    ).toEqual([])
  })

  it("回归：text_audit / bid_source_mode / bid_external_text 必须同时有列且有写权限", () => {
    // 这三个是 2026-10-20 修复的真实静默丢数据字段，单独钉一条便于将来一眼看出是它们被拆掉了
    for (const f of ["text_audit", "bid_source_mode", "bid_external_text"]) {
      expect(FIELDS, `类型里缺 ${f}`).toContain(f)
      expect(COLUMNS, `缺 ${f} 的列声明`).toContain(f)
      expect(WHITELIST, `缺 ${f} 的 PATCH 写权限——前端写入会被静默丢弃`).toContain(f)
    }
  })
})
