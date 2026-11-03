// R67 接线哨兵：首页投标节点卡的「开标日期解析」只允许存在于 bidNodesLogic 一处。
//
// 为什么要有这个哨兵：这个缺陷的成因不是算法错，而是**同一件事两处各写一套**——
// 标书工作台列表用 daysUntil（直接 new Date，能认 PB 的日期时间串），首页卡自己拼
// `T00:00:00` 后缀（只认 date-only），于是同一个项目「列表里有倒计时、首页说没有」。
// 只要有人在卡片里再写一次日期解析，这个分歧就会复活，所以钉死：卡片不许出现日期拼装。
import { describe, expect, it } from "vitest"
import { countMatches, sourceText } from "@/testing/hookSources"

const CARD = "src/components/home/BidNodesCard.tsx"
const LOGIC = "src/components/home/bidNodesLogic.ts"
const PARSER = "src/lib/bidOpenDay.ts"

describe("BidNodesCard 开标日期解析接线", () => {
  const card = sourceText(CARD)

  it("卡片调用 buildBidNodeLists 单一真源", () => {
    expect(card).toContain('from "./bidNodesLogic"')
    expect(countMatches(card, /buildBidNodeLists\(/g)).toBe(1)
  })

  it("卡片不再自己拼 T00:00:00 后缀解析日期（缺陷原写法）", () => {
    expect(countMatches(card, /\$\{[^}]+\}T00:00:00/g)).toBe(0)
    expect(countMatches(card, /new Date\(`\$\{/g)).toBe(0)
  })

  it("卡片不再内联分档与排序（upcoming.push / daysLeft 计算都搬进纯函数）", () => {
    expect(countMatches(card, /upcoming\.push\(/g)).toBe(0)
    expect(countMatches(card, /86400000/g)).toBe(0)
  })

  it("未来天数常量来自单一真源，不在两处各写 60", () => {
    expect(card).toContain("BID_NODE_HORIZON_DAYS")
    expect(countMatches(card, /=\s*60\b/g)).toBe(0)
  })
})

describe("bidNodesLogic 解析口径", () => {
  const logic = sourceText(LOGIC)
  const parser = sourceText(PARSER)

  it("R68：解析实现只在 lib/bidOpenDay 一处，首页模块改为引用", () => {
    expect(logic).toContain('from "@/lib/bidOpenDay"')
    expect(countMatches(logic, /new Date\(year, month - 1, day\)/g)).toBe(0)
    expect(countMatches(parser, /new Date\(year, month - 1, day\)/g)).toBe(1)
  })

  it("按前 10 位（年月日）取日期，两种历史格式同口径", () => {
    expect(countMatches(parser, /\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)/g)).toBe(1)
    expect(parser).toContain("bidOpenDayMs")
  })

  it("用本地零点重建（new Date(y, m-1, d)），不用 Date.parse 的 UTC 口径", () => {
    expect(countMatches(parser, /Date\.parse\(/g)).toBe(0)
    expect(countMatches(parser, /new Date\(`\$\{/g)).toBe(0)
  })
})
