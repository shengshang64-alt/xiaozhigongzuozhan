import { describe, expect, it } from "vitest"
import {
  canProceedToDelete,
  cleanupBackupFileName,
  formatBackupStamp,
  serializeCleanupBackup,
  type CleanupBackupItem,
} from "./intelCleanupBackup"

// R-033 数据安全：清理不相关由「不可恢复物理删除」改为「先导出本地备份、数量对齐才删」。
// 锈死三件事：备份 JSON 无损 round-trip、文件名/时间戳格式、删除前安全闸的拒绝条件。

const item = (over: Partial<CleanupBackupItem> = {}): CleanupBackupItem => ({
  id: "rec1",
  title: "某机械厂数字化转型新闻",
  url: "https://example.com/a",
  source_name: "示例源",
  content_snippet: "正文片段",
  summary: "摘要",
  tags: ["机械", "制造"],
  item_type: "media",
  region: "江苏",
  added_by: "crawl",
  owner_id: "u1",
  visibility: "public",
  published_at: "2026-10-01 08:00:00.000Z",
  created: "2026-10-01 09:00:00.000Z",
  updated: "2026-10-01 09:00:00.000Z",
  ...over,
})

describe("serializeCleanupBackup · 无损 round-trip", () => {
  it("解析回来与写入条目逐字一致，count 等于条数", () => {
    const items = [item(), item({ id: "rec2", title: "航空发动机展会" })]
    const text = serializeCleanupBackup(items, {
      generatedAt: "2026-10-12T10:00:00.000Z",
      reason: "不相关情报清理前本地备份",
    })
    const back = JSON.parse(text)
    expect(back.kind).toBe("intel-irrelevant-cleanup-backup")
    expect(back.version).toBe(1)
    expect(back.count).toBe(2)
    expect(back.items).toHaveLength(2)
    expect(back.items[0]).toEqual(items[0])
    expect(back.items[1].title).toBe("航空发动机展会")
    expect(back.generatedAt).toBe("2026-10-12T10:00:00.000Z")
  })

  it("中文标题原样保存不被转义为 \\u 序列", () => {
    const text = serializeCleanupBackup([item()], { generatedAt: "x", reason: "y" })
    expect(text).toContain("某机械厂数字化转型新闻")
    expect(text).not.toContain("\\u")
  })

  it("空集与非法入参都归零：count=0、items=[]", () => {
    const t = serializeCleanupBackup([], { generatedAt: "x", reason: "y" })
    expect(JSON.parse(t).count).toBe(0)
    const t2 = serializeCleanupBackup(undefined as unknown as CleanupBackupItem[], {
      generatedAt: "x",
      reason: "y",
    })
    expect(JSON.parse(t2).items).toEqual([])
  })
})

describe("文件名与时间戳", () => {
  it("cleanupBackupFileName 以本地时间戳命名 .json", () => {
    expect(cleanupBackupFileName("20261012_103000")).toBe("情报清理备份-20261012_103000.json")
  })

  it("formatBackupStamp 走本地日历，非 UTC", () => {
    // 2026-01-02 03:04:05 本地（构造用本地分量）
    const d = new Date(2026, 0, 2, 3, 4, 5)
    expect(formatBackupStamp(d)).toBe("20260102_030405")
  })
})

describe("canProceedToDelete · 删除前安全闸", () => {
  it("备份成功且数量对齐才放行", () => {
    expect(canProceedToDelete({ backupOk: true, backupCount: 5, expectedCount: 5 })).toEqual({
      proceed: true,
      reason: "",
    })
  })

  it("未取得备份 → 拒绝", () => {
    expect(canProceedToDelete({ backupOk: false, backupCount: 0, expectedCount: 5 }).proceed).toBe(false)
  })

  it("命中数为 0 → 拒绝（无可清理条目，不该发删除）", () => {
    const r = canProceedToDelete({ backupOk: true, backupCount: 0, expectedCount: 0 })
    expect(r.proceed).toBe(false)
    expect(r.reason).toBe("无可清理条目")
  })

  it("备份条数与命中数漂移 → 拒绝，绝不删未备份的条目", () => {
    const r = canProceedToDelete({ backupOk: true, backupCount: 4, expectedCount: 5 })
    expect(r.proceed).toBe(false)
    expect(r.reason).toContain("不一致")
  })
})
