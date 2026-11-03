// R47（B19）按环节自动选模型：纯函数单测（零模型、零网络）
// 回归价值：一旦有人把「非文本模态排除 / 视觉环节宁缺毋滥 / 手选不可被自动覆盖」等口径改掉，
// 本文件立即变红。
import { describe, expect, it } from "vitest"
import {
  AUTO_MODEL_KEY,
  MODEL_ROLE_ORDER,
  MODEL_ROLE_TAGS,
  buildRoleCandidates,
  buildRoleModelMap,
  buildRolePickMap,
  isAutoModelKey,
  matchedTagsForRole,
  pickModelForRole,
  pickModelRefForRole,
  rankModelsForRole,
  resolveRoleModelRef,
  roleForStep,
  rolePickHint,
  scoreRoleCandidate,
  type RoleCandidate,
} from "@/lib/modelRouting"
import type { ModelRef } from "@/lib/modelGateway"

/** 构造候选：只用 id + 标签 + 少量状态位，避免依赖真实模型表（表变了也不该红） */
function cand(
  modelId: string,
  tags: string[],
  extra: Partial<RoleCandidate<string>> = {},
): RoleCandidate<string> {
  return { item: modelId, modelId, tags, ...extra }
}

function refOf(modelId: string, source: "platform" | "personal" = "personal"): ModelRef {
  return { source, configId: `cfg-${source}`, configName: `cfg-${source}`, modelId }
}

describe("R47 角色与标签表", () => {
  it("六个角色齐全且顺序稳定", () => {
    expect(MODEL_ROLE_ORDER).toEqual(["longform", "outline", "extract", "judge", "vision", "chat"])
    for (const role of MODEL_ROLE_ORDER) {
      expect(MODEL_ROLE_TAGS[role].length).toBeGreaterThan(0)
    }
  })

  it("流水线步骤映射：3=正文、4/5/6=判定审查、其余=解析", () => {
    expect(roleForStep(3)).toBe("longform")
    expect([4, 5, 6].map(roleForStep)).toEqual(["judge", "judge", "judge"])
    expect([1, 2, 7].map(roleForStep)).toEqual(["extract", "extract", "extract"])
  })

  it("判定审查环节偏好推理与长上下文（判定失败模式是漏判，不是超时）", () => {
    expect(MODEL_ROLE_TAGS.judge[0]).toBe("推理")
    expect(MODEL_ROLE_TAGS.judge).toContain("长上下文")
    // 解析环节仍以快为先，两者不得混为一谈
    expect(MODEL_ROLE_TAGS.extract[0]).toBe("快速")
  })
})

describe("R47 硬门槛", () => {
  it("非文本模态（向量/作图/视频/语音）一律不进候选，哪怕标签很贴", () => {
    for (const id of ["bge-m3", "dall-e-3", "sora-video", "cosyvoice-v2"]) {
      expect(pickModelForRole("longform", [cand(id, ["长文", "中文", "通用"])]), `应排除 ${id}`).toBeNull()
    }
  })

  it("长期实测不可用档案直接排除（R296 口径）", () => {
    const pick = pickModelForRole("longform", [
      cand("a-strong", ["长文", "中文"], { unavailable: true }),
      cand("b-weak", ["通用"]),
    ])
    expect(pick?.item).toBe("b-weak")
  })

  it("视觉环节宁缺毋滥：无视觉/多模态标签时返回 null 而不是硬塞文本模型", () => {
    expect(pickModelForRole("vision", [cand("plain-long", ["长文", "中文"])])).toBeNull()
    const ok = pickModelForRole("vision", [cand("plain-long", ["长文"]), cand("seer-v", ["视觉"])])
    expect(ok?.item).toBe("seer-v")
  })
})

describe("R47 打分与排序", () => {
  it("靠前的偏好标签更重：解析环节选「快速」而不是「长上下文」", () => {
    const pick = pickModelForRole("extract", [
      cand("ctx-only", ["长上下文"]),
      cand("fast-one", ["快速"]),
    ])
    expect(pick?.item).toBe("fast-one")
    expect(pick?.matchedTags).toEqual(["快速"])
  })

  it("多标签命中累加，且命中标签按偏好表顺序返回（供提示文案用）", () => {
    const pick = pickModelForRole("longform", [cand("twice", ["中文", "长文"])])
    expect(pick?.matchedTags).toEqual(["长文", "中文"])
    expect(pick?.item).toBe("twice")
  })

  it("冷却降权是固定额度，且只降权不排除", () => {
    const warm = scoreRoleCandidate("longform", cand("m", ["长文"]))
    const cooled = scoreRoleCandidate("longform", cand("m", ["长文"], { cooling: true }))
    expect(warm - cooled).toBe(6)
    // 势均力敌时冷却方让位（长文 8-6=2 < 中文 6）
    const two = pickModelForRole("longform", [
      cand("cool-but-fit", ["长文"], { cooling: true }),
      cand("warm-ok", ["中文"]),
    ])
    expect(two?.item).toBe("warm-ok")
    // 只有一个候选时照样返回它（冷却不是禁用：仍会如实先试，失败由网关回退接管）
    const one = pickModelForRole("longform", [cand("cool-but-fit", ["长文"], { cooling: true })])
    expect(one?.item).toBe("cool-but-fit")
  })

  it("人工标注但与本环节无关时不得加分（视觉标注不能压过长文模型）", () => {
    const pick = pickModelForRole("longform", [
      cand("pro-longform", ["长文"]),
      cand("seer-vision", ["视觉"], { profileSource: "user" }),
    ])
    expect(pick?.item).toBe("pro-longform")
  })

  it("人工标注（profileSource=user）加成：压过仅靠内置标签的高分配置", () => {
    const tagged = pickModelForRole("longform", [
      cand("known-heavy", ["长文", "中文"]),
      cand("user-tagged", ["中文"], { profileSource: "user" }),
    ])
    // known-heavy = 8 + 6 = 14；user-tagged = 6 + 12 = 18
    expect(tagged?.item).toBe("user-tagged")
  })

  it("同分兜底：个人配置优先于平台内置，再同分保持候选原顺序（结果确定）", () => {
    const items: ModelRef[] = [refOf("platform-x", "platform"), refOf("personal-y", "personal")]
    const pick = pickModelForRole(
      "chat",
      items.map((r) => ({ item: r, modelId: r.modelId, tags: ["对话"], personal: r.source === "personal" })),
    )
    expect(pick?.item.modelId).toBe("personal-y")

    const stable = rankModelsForRole("chat", [cand("first", ["对话"]), cand("second", ["对话"])])
    expect(stable.map((p) => p.item)).toEqual(["first", "second"])
  })

  it("无候选 / 全被排除 → null（由调用方决定回落口径）", () => {
    expect(pickModelForRole("longform", [])).toBeNull()
    expect(scoreRoleCandidate("longform", cand("bge-m3", ["长文"]))).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe("R47 ModelRef 适配层", () => {
  it("内置知识表 + 用户标注共同决定候选标签", () => {
    const refs = [refOf("deepseek-v4-pro"), refOf("nobody-knows-this")]
    const cands = buildRoleCandidates(refs, {
      userMetaOf: (r) => (r.modelId === "nobody-knows-this" ? { specialty: "我的长文主力", tags: ["长文"] } : null),
    })
    expect(cands[0].tags).toContain("长文")
    expect(cands[1].profileSource).toBe("user")
    expect(cands[1].tags).toEqual(["长文"])
  })

  it("依赖回调抛错（隐私模式读存储失败）降级为「无该状态」，不炸整轮选型", () => {
    const refs = [refOf("deepseek-v4-flash")]
    const cands = buildRoleCandidates(refs, {
      coolingOf: () => {
        throw new Error("storage blocked")
      },
      unavailableOf: () => {
        throw new Error("storage blocked")
      },
    })
    expect(cands[0].cooling).toBe(false)
    expect(cands[0].unavailable).toBe(false)
  })

  it("六个环节一次算好：空清单全 null，有清单时各环节都能拿到人", () => {
    expect(buildRoleModelMap([])).toEqual({
      longform: null,
      outline: null,
      extract: null,
      judge: null,
      vision: null,
      chat: null,
    })
    const refs = [refOf("deepseek-v4-pro"), refOf("deepseek-flash"), refOf("seer-vision")]
    const map = buildRoleModelMap(refs, {
      userMetaOf: (r) =>
        r.modelId === "seer-vision"
          ? { specialty: "看图", tags: ["视觉"] }
          : r.modelId === "deepseek-flash"
            ? { specialty: "快", tags: ["快速"] }
            : null,
    })
    expect(map.vision?.modelId).toBe("seer-vision")
    expect(map.extract?.modelId).toBe("deepseek-flash")
    expect(map.longform?.modelId).toBe("deepseek-v4-pro")
  })

  it("pickModelRefForRole / buildRolePickMap / matchedTagsForRole 三者口径一致", () => {
    const refs = [refOf("deepseek-v4-pro")]
    const direct = pickModelRefForRole("longform", refs)
    const viaMap = buildRolePickMap(refs).longform
    expect(direct?.modelId).toBe(viaMap?.item.modelId)
    expect(matchedTagsForRole("longform", refs)).toEqual(viaMap?.matchedTags)
  })
})

describe("R47 自动档口径", () => {
  const roleMap = {
    longform: refOf("long-writer"),
    outline: refOf("planner"),
    extract: refOf("fast-json"),
    judge: refOf("strict-judge"),
    vision: refOf("seer-vision"),
    chat: refOf("talker"),
  }

  it("手选优先：auto=false 时六个环节全部用他选的那个模型", () => {
    const manual = refOf("manual-pick")
    for (const role of MODEL_ROLE_ORDER) {
      expect(resolveRoleModelRef(role, false, manual, roleMap)?.modelId).toBe("manual-pick")
    }
  })

  it("自动档按环节取人；该环节无候选时回落到手选而不是 null", () => {
    expect(resolveRoleModelRef("extract", true, null, roleMap)?.modelId).toBe("fast-json")
    const holey = { ...roleMap, vision: null }
    expect(resolveRoleModelRef("vision", true, refOf("manual-pick"), holey)?.modelId).toBe("manual-pick")
  })

  it("哨兵值与提示文案", () => {
    expect(isAutoModelKey(AUTO_MODEL_KEY)).toBe(true)
    expect(isAutoModelKey("platform:cfg:gpt-5.5")).toBe(false)
    expect(isAutoModelKey("")).toBe(false)
    expect(rolePickHint("extract", refOf("fast-json"), ["快速"])).toContain("解析抽取")
    expect(rolePickHint("vision", null)).toContain("请手动选一个")
  })
})
