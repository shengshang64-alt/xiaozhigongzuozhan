// 多份招标文件 · 接线守卫（2026-10-21 用户需求）
//
// 纯逻辑在 tenderFiles.test.ts 里验；这里只验「接线没断」——因为一旦少了任何一环，
// 功能会静默退化：上传区不收多份、清单不渲染、解析不按角色路由，而单元测试仍然全绿。
// 与 proseFallbackWiring / composeOutlineRegenWiring 同类，读源码断言（走 hookSources 单一入口）。
import { countMatches, hookSources, sourceText } from "@/testing/hookSources"
import { describe, expect, it } from "vitest"

// God Hook 一律走 hookSources() 单一入口（R57 收敛边界：路径字面量只许出现在 hookSources.ts）
const HOOK = hookSources()
const TENDER_STEP = sourceText("src/components/bid-workspace/TenderStep.tsx")
const PAGE = sourceText("src/pages/BidWorkspace/BidWorkspacePage.tsx")
const PB_HOOK = sourceText("pocketbase/pb_hooks/bid_projects.pb.js")

describe("多份招标文件接线守卫", () => {
  it("上传框接受多选，并且走多份导入入口（不是只取 files[0]）", () => {
    expect(TENDER_STEP).toContain("multiple")
    expect(TENDER_STEP).toContain("handleTenderFiles(e.target.files)")
    expect(TENDER_STEP).not.toContain("handleTenderFile(e.target.files?.[0])")
  })

  it("上传区支持拖拽（PRD FR-03-01 的「拖拽 + 点击」此前只有点击）", () => {
    expect(TENDER_STEP).toContain("onDrop")
    expect(TENDER_STEP).toContain("dataTransfer.files")
  })

  it("文件清单渲染角色下拉与删/调序入口", () => {
    expect(TENDER_STEP).toContain("tenderFiles.map")
    expect(TENDER_STEP).toContain("setTenderFileRoleAt")
    expect(TENDER_STEP).toContain("removeTenderFileAt")
    expect(TENDER_STEP).toContain("moveTenderFileAt")
  })

  it("页面把清单相关句柄透传给第 1 步面板", () => {
    for (const prop of ["handleTenderFiles", "tenderFiles", "removeTenderFileAt", "moveTenderFileAt", "setTenderFileRoleAt"]) {
      expect(PAGE).toContain(`${prop}={p.${prop}}`)
    }
  })

  it("批量解析逐项走角色路由（主调用 + 限流重试两处都走）", () => {
    expect(countMatches(HOOK, /parseSectionItem\(textForItem\(key\), key, channel\)/g)).toBe(2)
  })

  it("空项兜底重跑仍用全文（角色标错时的最后一道网）", () => {
    expect(countMatches(HOOK, /parseSectionItem\(text, key, channel\)/g)).toBe(1)
  })

  it("单项重解析与批量同口径（按角色路由）", () => {
    expect(HOOK).toContain("parseTextForItem(text, itemFiles, key)")
  })

  it("多份导入落库时同时写 tender_text 与 tender_files", () => {
    // 2026-10-22 B4：落库时多了 tender_tables（docx 还原的表格），断言改为按字段存在性判，不锁死单行写法
    expect(HOOK).toMatch(/updateProject\(\{\s*tender_text: text,\s*tender_files: files,/)
  })

  it("B4：docx 表格落库字段齐全（列 + 写入白名单 + 同名文件替换）", () => {
    expect(PB_HOOK).toContain("addField({ name: 'tender_tables', type: 'json' })")
    expect(countMatches(PB_HOOK, /\{ name: 'tender_tables', type: 'json' \},/g)).toBe(3)
    expect(PB_HOOK).toContain('rec.set("tender_tables", body.tender_tables)')
    expect(HOOK).toContain("mergeTenderTables")
    expect(HOOK).toContain("capTenderTables")
  })

  it("PocketBase 集合含 tender_files 列（bootstrap 自动补列，存量库无需手工迁移）", () => {
    expect(PB_HOOK).toContain("addField({ name: 'tender_files', type: 'json' })")
    expect(countMatches(PB_HOOK, /\{ name: 'tender_files', type: 'json' \},/g)).toBe(3)
  })
})
