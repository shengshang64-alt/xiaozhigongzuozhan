// P2-8：上传历史本机记录的纯函数口径——FIFO 上限 / 脏值防御 / 匿名桶。
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest"
import { clearKbUploadHistory, pushKbUploadHistory, readKbUploadHistory } from "./kbUploadHistory"

const U = "test-user"
const KEY = "kb_upload_history_" + U

afterEach(() => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
})

describe("上传历史（P2-8）", () => {
  it("无记录返回 []；写入后可读回且新→旧", () => {
    expect(readKbUploadHistory(U)).toEqual([])
    pushKbUploadHistory(U, { fileName: "a.md", okCount: 1 })
    pushKbUploadHistory(U, { fileName: "b.docx", okCount: 0, failReason: "解析失败", targetFolder: "评审" })
    const items = readKbUploadHistory(U)
    expect(items).toHaveLength(2)
    expect(items[0].fileName).toBe("b.docx")
    expect(items[0].failReason).toBe("解析失败")
    expect(items[1].fileName).toBe("a.md")
    expect(items[0].at).toBeTruthy()
  })
  it("FIFO 上限 50 条", () => {
    for (let i = 0; i < 55; i++) pushKbUploadHistory(U, { fileName: `f${i}`, okCount: 1 })
    const items = readKbUploadHistory(U)
    expect(items).toHaveLength(50)
    expect(items[0].fileName).toBe("f54")
    expect(items[49].fileName).toBe("f5")
  })
  it("脏值防御（非数组 / 混杂类型只收合法条目 / 全脏视作空）", () => {
    localStorage.setItem(KEY, '{"x":1}')
    expect(readKbUploadHistory(U)).toEqual([])
    localStorage.setItem(KEY, JSON.stringify(["bad", { at: "t", fileName: "ok.md", okCount: 2 }, { at: 1, fileName: 3 }]))
    const items = readKbUploadHistory(U)
    expect(items).toHaveLength(1)
    expect(items[0].fileName).toBe("ok.md")
    localStorage.setItem(KEY, JSON.stringify({ bad: 1 }))
    expect(readKbUploadHistory(U)).toEqual([])
  })
  it("未登录记入 anonymous 桶（与登录桶隔离）", () => {
    pushKbUploadHistory(null, { fileName: "anon.md", okCount: 1 })
    expect(readKbUploadHistory(null)).toHaveLength(1)
    expect(readKbUploadHistory(U)).toEqual([])
    clearKbUploadHistory(null)
    expect(readKbUploadHistory(null)).toEqual([])
  })
})
