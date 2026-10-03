import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { triggerBlobDownload } from "./download"

// vitest runs in node env (no jsdom): stub only the DOM surface the helper touches.
let events: string[]
let revoked: string[]
let created: string[]
let anchors: { href: string; download: string; click: () => void; remove: () => void }[]

beforeEach(() => {
  vi.useFakeTimers()
  events = []
  revoked = []
  created = []
  anchors = []
  vi.stubGlobal("document", {
    createElement: () => {
      const a = {
        href: "",
        download: "",
        click: () => events.push("click"),
        remove: () => events.push("remove"),
      }
      anchors.push(a)
      return a
    },
    body: { appendChild: () => events.push("append") },
  })
  let seq = 0
  vi.stubGlobal("URL", {
    createObjectURL: () => {
      const url = `blob:fake/${++seq}`
      created.push(url)
      return url
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("triggerBlobDownload", () => {
  it("appends to body, clicks, removes, in that order", () => {
    triggerBlobDownload(new Blob(["hello"]), "周报.docx")
    expect(events).toEqual(["append", "click", "remove"])
  })
  it("carries the blob url and the exact file name onto the anchor", () => {
    triggerBlobDownload(new Blob(["x"]), "竞品订单能力对比_2026-10-01.csv")
    expect(anchors).toHaveLength(1)
    expect(anchors[0].href).toBe(created[0])
    expect(anchors[0].download).toBe("竞品订单能力对比_2026-10-01.csv")
  })
  it("never revokes synchronously (older engines may abort the download)", () => {
    triggerBlobDownload(new Blob(["xy"]), "a.pptx")
    expect(revoked).toEqual([])
    vi.advanceTimersByTime(2999)
    expect(revoked).toEqual([])
  })
  it("revokes exactly the url it created, at 3s", () => {
    triggerBlobDownload(new Blob(["abc"]), "b.docx")
    triggerBlobDownload(new Blob(["def"]), "c.docx")
    vi.advanceTimersByTime(3000)
    expect(revoked).toEqual(created)
  })
})
