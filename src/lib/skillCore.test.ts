// ---------------------------------------------------------------------------
// skillCore 全站技能带入核心口径单测（此前 0 独立单测，却被 11 处页面/组件共用）
// 重点钉 R128 修复：自定义技能异步到达前「不可校验」，不得裁剪持久化勾选，
// 否则刷新页面就把用户带入的技能静默清空并回写 localStorage。
// ---------------------------------------------------------------------------
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SkillRow } from "@/lib/assistantCore"
import {
  injectSkillBlock,
  loadSkillSelection,
  missingSelectedIds,
  normalizeScopes,
  parseSkillPlaceholders,
  presetSkillsForScope,
  pruneSkillSelection,
  registerScopeSkills,
  saveSkillSelection,
  SCOPE_CATALOG,
  scopeLabel,
  SKILL_SEL_PREFIX,
  skillBlockFor,
  skillCostSuffix,
  skillCountFor,
  skillPromptBlock,
  unregisterScopeSkills,
  type SkillScope,
} from "@/lib/skillCore"

function skill(id: string, name: string, template: string): SkillRow {
  return {
    id,
    rh_user_id: "u1",
    skill_name: name,
    prompt_template: template,
    created: "",
    applicable_scopes: ["all"],
  }
}

/** node 环境无 DOM，按仓库既有做法（teamAuth.test.ts）stub 出 localStorage */
function stubStorage(impl?: Partial<Record<"getItem" | "setItem", (k: string, v?: string) => unknown>>) {
  const store = new Map<string, string>()
  const localStorage = {
    getItem: (k: string) => impl?.getItem?.(k) ?? (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => {
      if (impl?.setItem) return impl.setItem(k, v)
      store.set(k, v)
      return undefined
    },
    removeItem: (k: string) => store.delete(k),
  }
  vi.stubGlobal("window", { localStorage })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("normalizeScopes · 适用功能点归一", () => {
  it("非数组 / 空数组 / 无有效值一律回退为仅小智对话（存量兼容）", () => {
    expect(normalizeScopes(undefined)).toEqual(["assistant"])
    expect(normalizeScopes(null)).toEqual(["assistant"])
    expect(normalizeScopes("assistant")).toEqual(["assistant"])
    expect(normalizeScopes([])).toEqual(["assistant"])
    expect(normalizeScopes(["", "  ", 42, null])).toEqual(["assistant"])
    expect(normalizeScopes(["不存在的功能点"])).toEqual(["assistant"])
  })
  it("合法值 trim 后保留、重复去重、非法值丢弃", () => {
    expect(normalizeScopes([" bid-parse "])).toEqual(["bid-parse"])
    expect(normalizeScopes(["bid-parse", "bid-parse", "ppt-deck"])).toEqual(["bid-parse", "ppt-deck"])
    expect(normalizeScopes(["bogus", "kb-qa"])).toEqual(["kb-qa"])
  })
  it("all 是保留原值的通配标记，不与具体功能点合并展开", () => {
    expect(normalizeScopes(["all"])).toEqual(["all"])
    expect(normalizeScopes(["all", "bogus"])).toEqual(["all"])
    expect(normalizeScopes(["all", "bid-parse"])).toEqual(["all", "bid-parse"])
  })
})

describe("SCOPE_CATALOG / scopeLabel · 功能点目录", () => {
  // R195：功能点目录含「产品映射对照 product-map」共 16 项；计数写死是刻意的漂移报警——
  // 增删功能点时必须同步这里，逼一次人工确认（口径、预置技能归属、页面入口是否齐）。
  it("16 个功能点、scope 唯一、都有中文标签", () => {
    expect(SCOPE_CATALOG).toHaveLength(16)
    expect(new Set(SCOPE_CATALOG.map((s) => s.scope)).size).toBe(16)
    for (const def of SCOPE_CATALOG) {
      expect(def.label.length).toBeGreaterThan(1)
      expect(scopeLabel(def.scope)).toBe(def.label)
    }
  })
  it("未知 scope 原样回显（不崩、不显示 undefined）", () => {
    expect(scopeLabel("totally-unknown")).toBe("totally-unknown")
    expect(scopeLabel("")).toBe("")
  })
})

describe("presetSkillsForScope · 预置技能归一", () => {
  it("id 加 preset: 前缀、归属预置账号，与用户自定义行天然隔离", () => {
    const rows = presetSkillsForScope("bid-parse")
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(r.id.startsWith("preset:")).toBe(true)
      expect(r.rh_user_id).toBe("preset")
      expect(r.prompt_template).toBeTruthy()
    }
  })
  it("只返回适用该功能点的预置技能；无预置的功能点返回空池", () => {
    expect(presetSkillsForScope("quote-draft")).toEqual([])
    expect(presetSkillsForScope("solution-chapter")).toEqual([])
  })
})

describe("skillPromptBlock / parseSkillPlaceholders · 提示词块拼装", () => {
  it("未勾选技能返回空串（不给 system prompt 添空段）", () => {
    expect(skillPromptBlock([], {})).toBe("")
  })
  it("按勾选顺序编号，标题与说明行固定", () => {
    const block = skillPromptBlock([skill("a", "甲技能", "做甲"), skill("b", "乙技能", "做乙")], {})
    expect(block).toContain("## 用户指定工作技能")
    expect(block).toContain("1. 「甲技能」：做甲")
    expect(block).toContain("2. 「乙技能」：做乙")
    expect(block.indexOf("1. ")).toBeLessThan(block.indexOf("2. "))
  })
  it("空位已填用填值，未填回退空位名本身（与 fillTemplate 一致，不留 {{}} 残渣）", () => {
    const s = skill("x", "跟进邮件", "给「{{客户名称}}」写{{跟进背景}}")
    const filled = skillPromptBlock([s], { x: { 客户名称: "协和" } })
    expect(filled).toContain("给「协和」写跟进背景")
    const bare = skillPromptBlock([s], {})
    expect(bare).toContain("给「客户名称」写跟进背景")
    expect(bare).not.toContain("{{")
  })
  it("占位解析去重保序", () => {
    expect(parseSkillPlaceholders("{{b}}{{a}}{{b}}")).toEqual(["b", "a"])
    expect(parseSkillPlaceholders("无空位")).toEqual([])
  })
})

describe("injectSkillBlock · 技能块注入 system prompt", () => {
  it("空块原样返回同一引用（不产生无谓的数组拷贝）", () => {
    const msgs = [{ role: "user", content: "hi" }]
    expect(injectSkillBlock(msgs, "")).toBe(msgs)
  })
  it("无 system 时头部补一条，并去掉块首空行", () => {
    const out = injectSkillBlock([{ role: "user", content: "hi" }], "\n## 用户指定工作技能\n1. 甲")
    expect(out[0].role).toBe("system")
    expect(String(out[0].content).startsWith("## 用户指定工作技能")).toBe(true)
    expect(out).toHaveLength(2)
  })
  it("追加到首条 system 末尾，且不改写入参数组（React 状态不可变）", () => {
    const msgs = [
      { role: "system", content: "你是小智" },
      { role: "user", content: "hi" },
      { role: "system", content: "第二条 system 不动" },
    ]
    const out = injectSkillBlock(msgs, "\n技能块")
    expect(out[0].content).toBe("你是小智\n\n技能块")
    expect(out[2].content).toBe("第二条 system 不动")
    expect(msgs[0].content).toBe("你是小智")
    expect(out).not.toBe(msgs)
  })
  it("多模态 content（数组）不做字符串拼接，退化为换行 + 块", () => {
    const out = injectSkillBlock([{ role: "system", content: [{ type: "text", text: "x" }] }], "\n块")
    expect(out[0].content).toBe("\n\n块")
  })
})

describe("scope 注册表与计费文案", () => {
  it("scope 缺省时安全返回空/0", () => {
    expect(skillBlockFor()).toBe("")
    expect(skillBlockFor(null)).toBe("")
    expect(skillCountFor(undefined)).toBe(0)
    expect(skillCostSuffix(undefined)).toBe("")
    expect(skillCostSuffix("bid-outline")).toBe("")
  })
  it("注册后按 scope 取块与数量，计费文案追加「带入 n 个技能」", () => {
    const src = { getBlock: () => "块", getCount: () => 2 }
    registerScopeSkills("bid-parse", src)
    expect(skillBlockFor("bid-parse")).toBe("块")
    expect(skillCountFor("bid-parse")).toBe(2)
    expect(skillCostSuffix("bid-parse")).toBe("，带入 2 个技能")
    unregisterScopeSkills("bid-parse", src)
    expect(skillBlockFor("bid-parse")).toBe("")
  })
  it("反注册只在来源匹配时生效，避免旧卸载把新注册者摘掉", () => {
    const a = { getBlock: () => "A", getCount: () => 1 }
    const b = { getBlock: () => "B", getCount: () => 3 }
    registerScopeSkills("kb-qa", a)
    registerScopeSkills("kb-qa", b)
    unregisterScopeSkills("kb-qa", a)
    expect(skillBlockFor("kb-qa")).toBe("B")
    unregisterScopeSkills("kb-qa", b)
    expect(skillBlockFor("kb-qa")).toBe("")
  })
})

describe("pruneSkillSelection · R128 异步竞态护栏", () => {
  it("自定义技能未拉取成功时保留自定义勾选（刷新页面不再失效的回归钉）", () => {
    const avail = ["preset:follow-email"]
    expect(pruneSkillSelection(["preset:follow-email", "pb-custom-1"], avail, false)).toEqual([
      "preset:follow-email",
      "pb-custom-1",
    ])
  })
  it("预置项始终可校验：拉取未完成也照样裁掉失效的预置勾选", () => {
    expect(pruneSkillSelection(["preset:gone", "custom-1"], ["preset:live"], false)).toEqual(["custom-1"])
  })
  it("拉取成功后按全量池校验，真失效的技能被清理", () => {
    expect(pruneSkillSelection(["preset:live", "custom-1"], ["preset:live"], true)).toEqual(["preset:live"])
    expect(pruneSkillSelection(["preset:live", "custom-1"], ["preset:live", "custom-1"], true)).toEqual([
      "preset:live",
      "custom-1",
    ])
  })
  it("保持原顺序、空输入返回空数组（不返回 undefined）", () => {
    expect(pruneSkillSelection(["c", "a", "b"], ["a", "b", "c"], true)).toEqual(["c", "a", "b"])
    expect(pruneSkillSelection([], ["a"], true)).toEqual([])
    expect(pruneSkillSelection(["a"], [], false)).toEqual(["a"])
    expect(pruneSkillSelection(["a"], [], true)).toEqual([])
  })
})

describe("技能选择持久化", () => {
  it("按 scope 分 key 存取，勾选顺序与空位值原样回读", () => {
    const scope: SkillScope = "bid-parse"
    stubStorage()
    saveSkillSelection(scope, { ids: ["b", "a"], vars: { a: { 客户: "协和" } } })
    const back = loadSkillSelection(scope)
    expect(back).toEqual({ ids: ["b", "a"], vars: { a: { 客户: "协和" } } })
  })
  it("未写过的功能点返回空选", () => {
    stubStorage()
    expect(loadSkillSelection("quote-draft")).toEqual({ ids: [], vars: {} })
  })
  it("脏数据（非法 JSON / 非字符串项）不崩，只挑出合法部分", () => {
    const store = stubStorage()
    store.set(`${SKILL_SEL_PREFIX}kb-qa`, "{不是 JSON")
    expect(loadSkillSelection("kb-qa")).toEqual({ ids: [], vars: {} })
    store.set(
      `${SKILL_SEL_PREFIX}kb-qa`,
      JSON.stringify({ ids: ["ok", 42], vars: { s: { a: "v", b: 7 } }, extra: 1 }),
    )
    expect(loadSkillSelection("kb-qa")).toEqual({ ids: ["ok"], vars: { s: { a: "v" } } })
  })
  it("存储不可用（隐私模式/配额）时静默降级，不影响功能", () => {
    stubStorage({
      getItem: () => {
        throw new Error("SecurityError")
      },
      setItem: () => {
        throw new Error("QuotaExceeded")
      },
    })
    expect(loadSkillSelection("assistant")).toEqual({ ids: [], vars: {} })
    expect(() => saveSkillSelection("assistant", { ids: ["a"], vars: {} })).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// R129：自定义技能拉取失败时「已勾选但没带上」的显式统计（picker 失败横幅数据源）
// ---------------------------------------------------------------------------
describe("missingSelectedIds · R129 拉取失败缺口统计", () => {
  it("勾选全部在池中时返回空数组", () => {
    expect(missingSelectedIds(["a", "b"], ["a", "b", "c"])).toEqual([])
  })
  it("勾选了池中不存在的自定义技能时按原顺序捞出缺口", () => {
    expect(missingSelectedIds(["preset:x", "c1", "c2"], ["preset:x"])).toEqual(["c1", "c2"])
  })
  it("空勾选返回空数组，不抛错", () => {
    expect(missingSelectedIds([], ["a"])).toEqual([])
    expect(missingSelectedIds([], [])).toEqual([])
  })
  it("池为空时全部勾选都是缺口（拉取失败首屏的典型形态）", () => {
    expect(missingSelectedIds(["a", "b"], [])).toEqual(["a", "b"])
  })
  it("不修改入参数组", () => {
    const ids = ["a", "b"]
    missingSelectedIds(ids, ["a"])
    expect(ids).toEqual(["a", "b"])
  })
  it("与 pruneSkillSelection 口径互补：未拉到时的勾选既不被裁剪、又被计为缺口提示", () => {
    const ids = ["preset:x", "c1"]
    const presetPool = ["preset:x"]
    // customLoaded=false：prune 保留 c1（R128 护栏），但 c1 不会注入生成——正是缺口要提示的部分
    expect(pruneSkillSelection(ids, presetPool, false)).toEqual(ids)
    expect(missingSelectedIds(ids, presetPool)).toEqual(["c1"])
    // 拉取成功后池含 c1：缺口清零，prune 也无事可做
    const fullPool = ["preset:x", "c1"]
    expect(missingSelectedIds(ids, fullPool)).toEqual([])
    expect(pruneSkillSelection(ids, fullPool, true)).toEqual(ids)
  })
})
