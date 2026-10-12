import { describe, expect, it } from "vitest"
import { hitKey } from "@/pages/BidCheck/ReadingView"
import type { CheckHit } from "@/pages/BidCheck/bidCheckTypes"

// R216 缺陷修复配套测试：锁死命中项 key 的唯一性口径。
// 回归价值：旧实现 `code#paragraphIndex` 在同一规则命中同一段落多次时必冲突，
// React 报 "Encountered two children with the same key"（实测三明市中西医结合医院
// 371 页真实招标文件触发 L1-T6#3672，命中项被静默复制/丢弃）。本文件变红即回归。

function hit(paragraphIndex: number | null): CheckHit {
  return { paragraphIndex } as CheckHit
}

describe("R216 hitKey 唯一性（同规则同段多命中不得冲突）", () => {
  it("同规则同段落的多次命中 → key 必须两两不同", () => {
    const keys = [hitKey("L1-T6", hit(3672), 0), hitKey("L1-T6", hit(3672), 1), hitKey("L1-T6", hit(3672), 2)]
    expect(new Set(keys).size).toBe(3)
  })

  it("真实复现场景：L1-T6 在 3672 段命中 2 次（旧实现产生 L1-T6#3672 ×2）", () => {
    expect(hitKey("L1-T6", hit(3672), 0)).toBe("L1-T6#3672#0")
    expect(hitKey("L1-T6", hit(3672), 1)).toBe("L1-T6#3672#1")
  })

  it("混合全量扫描：一条规则跨段落 + 同段多命中，整体 key 集合无重复", () => {
    // 模拟 formatCheckReport 的真实产出：每条规则逐段扫描，同段可多条
    const items = [
      { code: "L1-T1", hits: [hit(10), hit(20), hit(20)] },
      { code: "L1-T6", hits: [hit(3672), hit(3672), hit(3700), hit(null)] },
      { code: "L2-T3", hits: [hit(null), hit(null)] },
    ]
    const keys: string[] = []
    for (const it of items) it.hits.forEach((h, i) => keys.push(hitKey(it.code, h, i)))
    expect(keys.length).toBe(9)
    expect(new Set(keys).size).toBe(9)
  })

  it("paragraphIndex 为 null 时走 @序号 分支，同样不冲突", () => {
    expect(hitKey("L2-T3", hit(null), 0)).toBe("L2-T3@0")
    expect(hitKey("L2-T3", hit(null), 1)).toBe("L2-T3@1")
  })

  it("不同规则即使段落与序号相同也不冲突（code 进 key）", () => {
    expect(hitKey("L1-T1", hit(5), 0)).not.toBe(hitKey("L1-T2", hit(5), 0))
  })
})
