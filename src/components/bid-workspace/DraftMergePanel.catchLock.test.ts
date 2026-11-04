// 底稿自动套用格式：catch 不许再静默吞错（2026-11-04 巡检）
//
// 缺陷形态：DraftMergePanel.autoApplyFormat 的 catch 是空的（`catch { /* 静默 */ }`），
// 而它前面刚刚 toast.success 说过「已自动同步底稿格式 N 项」。一旦模板识别真的抛错
// （docx 结构异常 / 动态 import 失败），用户看到的是成功提示，实际一项格式都没写进去，
// 后面润色、导出全部按默认格式走——而且没有任何线索告诉他发生了什么。
//
// 这里用**源码结构锁**（与 scripts/pbHooksIdentity.test.ts 同思路）而不是组件测试：
// 该函数依赖 File + 动态 import + 模板识别链路，搭一整套夹具的成本远大于收益，
// 而这条缺陷的本质就是「catch 里有没有给用户话」，一行源码断言即可钉死。
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const PANEL = join(__dirname, "DraftMergePanel.tsx")

function source(): string {
  return readFileSync(PANEL, "utf-8").replace(/\r\n?/g, "\n")
}

/** 取 autoApplyFormat 函数体（从声明到下一个同级的 `}` 后紧跟空行 + 注释的边界，简单起见取到 catch 块结束） */
function autoApplyBody(): string {
  const src = source()
  const start = src.indexOf("const autoApplyFormat")
  expect(start, "未找到 autoApplyFormat（可能已重构，请同步本测试）").toBeGreaterThan(-1)
  const next = src.indexOf("const applyFormatPatch", start)
  return src.slice(start, next > start ? next : src.length)
}

describe("底稿自动套用格式：失败必须告诉用户", () => {
  it("catch 里不许是空的注释（原来 `catch { /* 静默 */ }`）", () => {
    const body = autoApplyBody()
    // 反例：catch { /* 静默 */ } 或 catch {}
    const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[^*]*\*\/)?\s*\}/.test(body)
    expect(emptyCatch, "autoApplyFormat 的 catch 又变回静默了：格式没同步成功时用户会以为成功了").toBe(false)
  })

  it("catch 里给出用户可执行的提示（toast.warning + 提到格式 + 给下一步）", () => {
    const body = autoApplyBody()
    expect(body).toMatch(/catch\s*\(/)
    expect(body).toContain("toast.warning")
    expect(body).toContain("格式")
    // 必须给出「怎么办」，不能只说失败了
    expect(body).toMatch(/手动|重试|格式同步/)
  })

  it("成功路径的语义没被改动（仍报同步了几项格式）", () => {
    const body = autoApplyBody()
    expect(body).toContain("已自动同步底稿格式")
  })
})
