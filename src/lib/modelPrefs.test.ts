import { beforeEach, describe, expect, it } from "vitest"
import {
  clearModelChoice,
  clearPreferredModel,
  normalizeModelKey,
  readModelChoice,
  saveModelChoice,
  pickPreferredModelRef,
  readPreferredModelKey,
  rememberUsedModel,
  resolvePreferredRef,
} from "@/lib/modelPrefs"
import type { ModelRef } from "@/lib/modelGateway"
import { AUTO_MODEL_KEY } from "@/lib/modelRouting"

// R216 缺陷修复配套测试：锁死「选 A 调 B」静默路由错乱的修复口径。
// 回归价值：一旦有人把偏好优先级改回「数组第一个」，本文件立即变红。

/**
 * 内存版 localStorage 桩。
 * 必要性：项目 vitest 为 node 环境（见 vitest.config.ts environment: "node"），
 * 没有 window / localStorage——直接跑会被 safeStorage() 判为「无偏好」而全红，
 * 测不出真实逻辑。此桩按 Storage 接口实现 getItem / setItem / removeItem，
 * 并可在个别用例里替换为抛错实现，验证「存储不可用时必须降级而非崩」。
 */
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const stub = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  }
  // globalThis.window 在 node 环境不存在，需整体造一个最小宿主
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = { localStorage: stub }
  return store
}

/** 带类型的 localStorage 取值器：替代散落各处的 as unknown as 断言，避免 tsc 报 unknown */
function ls(): Storage {
  return (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage
}

/** 直接向存储写入「外部脏数据」，用于验证读取侧的清洗能力 */
function seedRaw(k: string, v: string): void {
  ls().setItem(k, v)
}

const USER = "local-user"
const OTHER_USER = "viewer-team"

function ref(source: "platform" | "personal", configId: string, modelId: string): ModelRef {
  return { source, configId, configName: `${configId}-名称`, modelId } as ModelRef
}

beforeEach(() => {
  installMemoryStorage()
  // 每个用例从干净状态起步，防止用例间通过 localStorage 互相污染
  clearPreferredModel(USER)
  clearPreferredModel(OTHER_USER)
  clearModelChoice(USER)
  clearModelChoice(OTHER_USER)
})

describe("normalizeModelKey", () => {
  it("接受合法的三段键（platform / personal 两种来源）", () => {
    expect(normalizeModelKey("personal:cfg1:model-a")).toBe("personal:cfg1:model-a")
    expect(normalizeModelKey("platform:plat:gpt-5.5")).toBe("platform:plat:gpt-5.5")
  })

  it("首尾空白被裁剪后仍视为合法", () => {
    expect(normalizeModelKey("  personal:cfg1:model-a  ")).toBe("personal:cfg1:model-a")
  })

  it("非三段 / 段内为空 / 来源非法 / 非字符串一律拒绝（脏值不得污染默认选择）", () => {
    expect(normalizeModelKey("personal:cfg1")).toBeNull()
    expect(normalizeModelKey("personal::model-a")).toBeNull()
    expect(normalizeModelKey("personal:cfg1:")).toBeNull()
    expect(normalizeModelKey("unknown:cfg1:model-a")).toBeNull()
    expect(normalizeModelKey("")).toBeNull()
    expect(normalizeModelKey("   ")).toBeNull()
    expect(normalizeModelKey(null)).toBeNull()
    expect(normalizeModelKey(undefined)).toBeNull()
    expect(normalizeModelKey(123)).toBeNull()
    expect(normalizeModelKey({})).toBeNull()
  })
})

describe("rememberUsedModel / readPreferredModelKey", () => {
  it("记忆后可原样读回", () => {
    rememberUsedModel(USER, "personal:cfgA:sensenova")
    expect(readPreferredModelKey(USER)).toBe("personal:cfgA:sensenova")
  })

  it("最近一次使用排在最前（重复记忆只前移不重复入列）", () => {
    rememberUsedModel(USER, "personal:cfgA:m1")
    rememberUsedModel(USER, "personal:cfgB:m2")
    rememberUsedModel(USER, "personal:cfgA:m1")
    expect(readPreferredModelKey(USER)).toBe("personal:cfgA:m1")
    // 序列去重后长度为 2，不因重复调用而膨胀
    rememberUsedModel(USER, "personal:cfgA:m1")
    expect(readPreferredModelKey(USER)).toBe("personal:cfgA:m1")
  })

  it("按用户分桶隔离：A 的选择不会串到 B", () => {
    rememberUsedModel(USER, "personal:cfgA:m1")
    rememberUsedModel(OTHER_USER, "personal:cfgB:m2")
    expect(readPreferredModelKey(USER)).toBe("personal:cfgA:m1")
    expect(readPreferredModelKey(OTHER_USER)).toBe("personal:cfgB:m2")
  })

  it("非法键不写入，不污染已有偏好", () => {
    rememberUsedModel(USER, "personal:cfgA:m1")
    rememberUsedModel(USER, "垃圾值")
    expect(readPreferredModelKey(USER)).toBe("personal:cfgA:m1")
  })

  it("从未记忆过时返回 null（干净降级，不抛错）", () => {
    expect(readPreferredModelKey("nobody-ever-used")).toBeNull()
  })

  // ---- 容错分支：偏好记忆是体验优化，任何存储故障都不得让AI 功能不可用 ----

  it("存储抛错（隐私模式）→读返回 null、写静默忽略，绝不把异常抛给业务调用方", () => {
    const boom = {
      getItem: () => {
        throw new Error("SecurityError: 隐私模式禁用存储")
      },
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
      removeItem: () => {
        throw new Error("SecurityError")
      },
    }
    ;(globalThis as unknown as { window: Record<string, unknown> }).window = { localStorage: boom }
    expect(() => rememberUsedModel(USER, "personal:cfgA:m1")).not.toThrow()
    expect(readPreferredModelKey(USER)).toBeNull()
    expect(() => clearPreferredModel(USER)).not.toThrow()
  })

  it("已存内容不是合法 JSON → 当作无历史，不抛错", () => {
    installMemoryStorage()
    seedRaw(`xz_model_pref:${USER}`, "{ 这不是合法 JSON")
    expect(readPreferredModelKey(USER)).toBeNull()
    // 脏数据被下一次正常写入覆盖
    rememberUsedModel(USER, "personal:cfgA:m1")
    expect(readPreferredModelKey(USER)).toBe("personal:cfgA:m1")
  })

  it("已存内容是 JSON 但非数组（外部写脏）→ 当作无历史", () => {
    installMemoryStorage()
    seedRaw(`xz_model_pref:${USER}`, JSON.stringify({ not: "an array" }))
    expect(readPreferredModelKey(USER)).toBeNull()
  })

  it("已存数组内混入脏元素 → 读出时剔除脏值，不把垃圾键当偏好", () => {
    installMemoryStorage()
    seedRaw(`xz_model_pref:${USER}`, JSON.stringify(["personal:cfgA:m1", "垃圾", 123, null, "personal:cfgB:m2"]))
    expect(readPreferredModelKey(USER)).toBe("personal:cfgA:m1")
  })

  it("容量上限：记录数超限后截断，且最早的偏好被挤出（防localStorage 无限增长）", () => {
    for (let i = 0; i < 20; i += 1) rememberUsedModel(USER, `personal:cfg${i}:m${i}`)
    const stored = JSON.parse(ls().getItem(`xz_model_pref:${USER}`) as string) as string[]
    expect(stored.length).toBeLessThanOrEqual(12)
    // 最近使用的排最前
    expect(readPreferredModelKey(USER)).toBe("personal:cfg19:m19")
  })
})

describe("pickPreferredModelRef（默认模型挑选口径：偏好 > 兜底 > 首项）", () => {
  const list = [ref("personal", "cfgA", "m-a"), ref("personal", "cfgB", "m-b")]
  const keyOf = (m: ModelRef) => `${m.source}:${m.configId}:${m.modelId}`

  it("偏好命中时优先选偏好项，而非列表首项", () => {
    const got = pickPreferredModelRef(list, "personal:cfgB:m-b", null, keyOf)
    expect(got?.configId).toBe("cfgB")
  })

  it("偏好已失效（配置被删 / 模型被停用）时降级到兜底，绝不返回 null", () => {
    const got = pickPreferredModelRef(list, "personal:cfgGONE:m-x", list[0], keyOf)
    expect(got?.configId).toBe("cfgA")
  })

  it("无偏好时用调用方传入的兜底", () => {
    const got = pickPreferredModelRef(list, null, list[1], keyOf)
    expect(got?.configId).toBe("cfgB")
  })

  it("既无偏好又无兜底时退到列表首项", () => {
    const got = pickPreferredModelRef(list, null, null, keyOf)
    expect(got?.configId).toBe("cfgA")
  })

  it("空候选 + 空兜底 → null（无模型可选时不硬造默认值）", () => {
    expect(pickPreferredModelRef([], null, null, keyOf)).toBeNull()
  })

  it("非数组入参（脏数据）不抛错，按空列表处理", () => {
    expect(pickPreferredModelRef(null as unknown as ModelRef[], "personal:c:m", null, keyOf)).toBeNull()
  })
})

describe("resolvePreferredRef（偏好 → 结构化 ModelRef 的解析）", () => {
  const models = [ref("personal", "cfgA", "m-a"), ref("personal", "cfgB", "m-b")]

  it("命中返回完整结构化引用", () => {
    const got = resolvePreferredRef(models, "personal:cfgB:m-b")
    expect(got).not.toBeNull()
    expect(got?.configId).toBe("cfgB")
    expect(got?.modelId).toBe("m-b")
    expect(got?.source).toBe("personal")
  })

  it("偏好不存在时返回 null（由调用方决定回退策略，不越权挑模型）", () => {
    expect(resolvePreferredRef(models, "personal:cfgX:m-x")).toBeNull()
  })

  it("空偏好 / 空候选 / 脏入参均安全返回 null", () => {
    expect(resolvePreferredRef(models, null)).toBeNull()
    expect(resolvePreferredRef([], "personal:cfgA:m-a")).toBeNull()
    expect(resolvePreferredRef(null as unknown as ModelRef[], "personal:cfgA:m-a")).toBeNull()
  })
})

describe("跨模块闭环：记忆 → 解析 → 成为默认（复现原缺陷并证明已修复）", () => {
  it("用户实际用过的模型成为 defaultRef，而非接口顺序上的第一条", () => {
    // 实测原缺陷：网关 configs 返回顺序里 bailing 排首位且是唯一声明 default_model 的配置，
    // 于是用户选 sensenova 后，未显式传参的调用仍静默落到 bailing。
    const returnedOrder = [ref("personal", "cfgBailing", "Ling-3.1-flash"), ref("personal", "cfgBig", "sensenova-6.8-flash-lite")]
    const keyOf = (m: ModelRef) => `${m.source}:${m.configId}:${m.modelId}`

    // 步骤1：用户在顶部选了 sensenova 并成功生成一次
    rememberUsedModel(USER, "personal:cfgBig:sensenova-6.8-flash-lite")
    const preferredKey = readPreferredModelKey(USER)

    // 步骤2：下次加载模型清单（网关仍按原顺序返回 bailing 在前）
    const defaultRef = pickPreferredModelRef(returnedOrder, preferredKey, null, keyOf)

    // 断言：默认落在用户真正用过的 sensenova，而不是数组第一条 bailing
    expect(defaultRef?.configId).toBe("cfgBig")
    expect(defaultRef?.modelId).toBe("sensenova-6.8-flash-lite")
  })
})
// R-latest（用户反馈）：默认模型不能再是「系统按环节自动挑」——用户显式选择优先级最高，
// 且连「自动」档也照记（用户点了自动就是明确想要自动，不能被系统改回去）。
// 回归价值：一旦有人把默认值改回 AUTO_MODEL_KEY，或让显式选择被「成功用过」覆盖，本段立即变红。
describe("显式选择记忆（用户选谁就用谁）", () => {
  it("存读往返：记个人模型键", () => {
    saveModelChoice(USER, "personal:cfg1:model-a")
    expect(readModelChoice(USER)).toBe("personal:cfg1:model-a")
  })

  it("用户点过「自动」档也照记（不能被系统改回别的）", () => {
    saveModelChoice(USER, AUTO_MODEL_KEY)
    expect(readModelChoice(USER)).toBe(AUTO_MODEL_KEY)
  })

  it("非法键不写入；脏数据读出为 null", () => {
    saveModelChoice(USER, "不是合法键")
    expect(readModelChoice(USER)).toBeNull()
    seedRaw(`xz_model_choice:${USER}`, "personal:only-two-parts")
    expect(readModelChoice(USER)).toBeNull()
    seedRaw(`xz_model_choice:${USER}`, "垃圾值")
    expect(readModelChoice(USER)).toBeNull()
  })

  it("与「成功用过」互不覆盖：清了显式选择仍保留使用历史", () => {
    rememberUsedModel(USER, "personal:cfg1:model-a")
    saveModelChoice(USER, "personal:cfg2:model-b")
    expect(readModelChoice(USER)).toBe("personal:cfg2:model-b")
    expect(readPreferredModelKey(USER)).toBe("personal:cfg1:model-a")

    clearModelChoice(USER)
    expect(readModelChoice(USER)).toBeNull()
    expect(readPreferredModelKey(USER)).toBe("personal:cfg1:model-a")
  })

  it("按用户分桶：别人的选择读不到", () => {
    saveModelChoice(USER, "personal:cfg1:model-a")
    expect(readModelChoice(OTHER_USER)).toBeNull()
  })
})
