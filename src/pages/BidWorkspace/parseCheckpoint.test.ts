import { describe, expect, it } from "vitest"

import {
  PARSE_KEY_SECTIONS,
  sectionCheckpointable,
  upsertParseSection,
  type ParseReport,
  type ParseSection,
} from "./bidTypes"

// Q27 切片C：逐项 checkpoint 判定 + 串行累加落库语义（模拟并发池中途打断，已完成项保留在库）

describe("sectionCheckpointable 单项落库判定", () => {
  it("正常内容 / 伪空「原文未提及」判真（属成功结果，可入库）", () => {
    expect(sectionCheckpointable("项目名称：某医院HIS采购")).toBe(true)
    expect(sectionCheckpointable("原文未提及")).toBe(true)
  })
  it("真空（熔断置空/未产出）判假", () => {
    expect(sectionCheckpointable("")).toBe(false)
    expect(sectionCheckpointable("   \n ")).toBe(false)
  })
  it("系统降级交付判假（非模型正常结果，交尾部统一处理）", () => {
    expect(sectionCheckpointable("〔系统降级〕AI 解析失败：HTTP 429\n检索原文……")).toBe(false)
  })
})

describe("逐项 checkpoint 累加：中途打断后已完成项仍在库", () => {
  const keys = PARSE_KEY_SECTIONS.map((d) => d.key)
  const mk = (key: string): ParseSection => ({ key, title: key, content: "正文-" + key })

  it("串行 upsert 累加报告随每项成功单调增长，等价于逐项 PATCH", () => {
    let ckpt: ParseReport | null = null
    const patches = 3 // 模拟前 3 项完成后被打断
    for (let i = 0; i < patches; i++) {
      const slot = mk(keys[i])
      if (sectionCheckpointable(slot.content)) {
        ckpt = upsertParseSection(ckpt ?? { scope: "key", sections: [] }, slot)
      }
    }
    expect(ckpt).not.toBeNull()
    expect(ckpt!.sections).toHaveLength(patches)
    expect(ckpt!.sections.map((s) => s.key)).toEqual(keys.slice(0, patches))
  })

  it("降级/空项不进入 checkpoint 报告", () => {
    let ckpt: ParseReport | null = null
    const slots: (ParseSection | undefined)[] = [
      mk(keys[0]),
      { key: keys[1], title: keys[1], content: "" },
      { key: keys[2], title: keys[2], content: "〔系统降级〕失败" },
      mk(keys[3]),
    ]
    for (const slot of slots) {
      if (slot && sectionCheckpointable(slot.content)) {
        ckpt = upsertParseSection(ckpt ?? { scope: "key", sections: [] }, slot)
      }
    }
    expect(ckpt!.sections.map((s) => s.key)).toEqual([keys[0], keys[3]])
  })
})
