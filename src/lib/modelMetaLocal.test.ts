// R-038 模型元数据 localStorage 单测（node 环境手动 mock localStorage）
import { beforeEach, describe, expect, it, vi } from "vitest"

// 在 import 目标模块之前先 mock localStorage（node 环境默认没有）
const mem = new Map<string, string>()
const mockLS = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
  key: (i: number) => Array.from(mem.keys())[i] ?? null,
  get length() { return mem.size },
}
vi.stubGlobal("localStorage", mockLS)
vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: mockLS })

const {
  clearConfigMeta,
  clearUserMetaBucket,
  metaKey,
  readAllModelMeta,
  readModelMeta,
  upsertModelMeta,
} = await import("./modelMetaLocal")

beforeEach(() => mem.clear())

describe("R-038 modelMetaLocal 读写", () => {
  it("upsert 后 read 能取到（R-041 量化）", () => {
    upsertModelMeta("u1", "cfg1", "deepseek-v4-flash", { specialty: "长上下文", quota: { tier: "go", requests5h: 34670, monthlyUsd: 80 } })
    const got = readModelMeta("u1", "cfg1", "deepseek-v4-flash")
    expect(got?.specialty).toBe("长上下文")
    expect(got?.quota).toEqual({ tier: "go", requests5h: 34670, monthlyUsd: 80 })
    expect(got?.updatedAt).toBeTruthy()
  })
  it("按用户分桶：u1 存的 u2 读不到", () => {
    upsertModelMeta("u1", "cfg1", "m1", { specialty: "only-u1" })
    expect(readModelMeta("u2", "cfg1", "m1")).toBeNull()
  })
  it("合并式更新：只改 quota 保留 specialty", () => {
    upsertModelMeta("u1", "c", "m", { specialty: "A", quota: { tier: "go", requests5h: 100, monthlyUsd: 100 } })
    upsertModelMeta("u1", "c", "m", { quota: { tier: "go", requests5h: 50, monthlyUsd: 50 } })
    const got = readModelMeta("u1", "c", "m")
    expect(got?.specialty).toBe("A")
    expect(got?.quota).toEqual({ tier: "go", requests5h: 50, monthlyUsd: 50 })
  })
  it("全空自动删除条目", () => {
    upsertModelMeta("u1", "c", "m", { specialty: "A" })
    upsertModelMeta("u1", "c", "m", { specialty: "" })
    expect(readModelMeta("u1", "c", "m")).toBeNull()
  })
  it("clearConfigMeta 清该配置下所有", () => {
    upsertModelMeta("u1", "c1", "m1", { specialty: "A" })
    upsertModelMeta("u1", "c1", "m2", { specialty: "B" })
    upsertModelMeta("u1", "c2", "m3", { specialty: "C" })
    clearConfigMeta("u1", "c1")
    const all = readAllModelMeta("u1")
    expect(all[metaKey("c1", "m1")]).toBeUndefined()
    expect(all[metaKey("c1", "m2")]).toBeUndefined()
    expect(all[metaKey("c2", "m3")]).toBeDefined()
  })
  it("clearUserMetaBucket 登出清桶", () => {
    upsertModelMeta("u1", "c", "m", { specialty: "A" })
    upsertModelMeta("u2", "c", "m", { specialty: "B" })
    clearUserMetaBucket("u1")
    expect(readAllModelMeta("u1")).toEqual({})
    expect(readAllModelMeta("u2")['personal:c:m']?.specialty).toBe("B")
  })
})
