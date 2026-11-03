// ---------------------------------------------------------------------------
// R296（r294-default-model-hygiene）：模型通道「实测不可用」长期健康档案单测。
// 回归价值：一旦有人把 PERSIST_CLASSES 放宽到限流 / 超时，本文件立即变红——
// 那会把「今天限流、明天就好」的通道永久标红，正是本模块刻意避免的误伤。
// ---------------------------------------------------------------------------
import { beforeEach, describe, expect, it } from "vitest"
import {
  clearConfigHealth,
  getModelHealth,
  healthNotice,
  healthShortLabel,
  onHealthChange,
  readModelHealth,
  recordCallFailure,
  recordModelFailure,
  recordModelSuccess,
  resetModelHealth,
} from "@/lib/modelHealth"

/**
 * 内存版 localStorage 桩（与 modelPrefs.test.ts 同款）：
 * vitest 为 node 环境，没有 window / localStorage——不建宿主则 safeStorage() 恒返回 null，
 * 所有用例都会「假绿」地走降级分支，测不出真实读写。
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
  ;(globalThis as unknown as { window: Record<string, unknown> }).window = { localStorage: stub }
  return store
}

function ls(): Storage {
  return (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage
}

function seedRaw(k: string, v: string): void {
  ls().setItem(k, v)
}

const USER = "local-user"
const OTHER = "viewer-team"
const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  installMemoryStorage()
  resetModelHealth(USER)
  resetModelHealth(OTHER)
})

describe("recordModelFailure —— 只挂确定性失效", () => {
  it("模型不存在 / 已停用 / Key 失效三类入档，短标签与处置建议齐备", () => {
    recordModelFailure(USER, "personal:c1:gone-model", "model_missing", "接口返回异常（HTTP 404）")
    recordModelFailure(USER, "personal:c1:off-model", "model_disabled", "模型已停用")
    recordModelFailure(USER, "personal:c2:bad-key", "auth", "认证失败，请检查 API Key 是否有效")
    const map = readModelHealth(USER)
    expect(Object.keys(map).sort()).toEqual([
      "personal:c1:gone-model",
      "personal:c1:off-model",
      "personal:c2:bad-key",
    ])
    expect(healthShortLabel(map["personal:c1:gone-model"].cls)).toBe("已下线")
    expect(healthShortLabel(map["personal:c1:off-model"].cls)).toBe("已停用")
    expect(healthShortLabel(map["personal:c2:bad-key"].cls)).toBe("Key 失效")
    expect(healthNotice(map["personal:c1:gone-model"])).toContain("刷新模型")
  })

  it("限流 / 超时 / 服务不可用 / 其它一律不入档（它们归会话冷却，分钟级自愈）", () => {
    for (const cls of ["rate_limit", "timeout", "unavailable", "empty_reply", "cancelled", "other"] as const) {
      recordModelFailure(USER, `personal:c1:m-${cls}`, cls, "x")
    }
    expect(readModelHealth(USER)).toEqual({})
  })

  it("非法三段键被拒，不写脏档案", () => {
    recordModelFailure(USER, "垃圾值", "model_missing", "x")
    recordModelFailure(USER, "unknown:c1:m", "model_missing", "x")
    expect(readModelHealth(USER)).toEqual({})
  })

  it("reason 截断入库，档案里不留超长上游原文", () => {
    recordModelFailure(USER, "personal:c1:m1", "model_missing", "E".repeat(500))
    expect(getModelHealth(USER, "personal:c1:m1")?.reason.length).toBeLessThanOrEqual(120)
  })
})

describe("recordCallFailure —— 按网关真实错误串归类后挂账", () => {
  it("404 模型不存在入档；429 限流不入档（复现 R294 实测的两类真实失败）", () => {
    recordCallFailure(USER, "personal:c1:sensenova-u1-fast", '接口返回异常（HTTP 404）：The model "sensenova-u1-fast" does not exist')
    recordCallFailure(USER, "personal:c1:mimo-v2.6-pro", "所配置模型的接口限流或余额不足（HTTP 429），请稍后重试或切换模型")
    expect(getModelHealth(USER, "personal:c1:sensenova-u1-fast")?.cls).toBe("model_missing")
    expect(getModelHealth(USER, "personal:c1:mimo-v2.6-pro")).toBeNull()
  })
})

describe("清账闭环：成功即清 / 配置动作按配置清", () => {
  it("该通道实调成功后挂账消失（用户重试或测试通过即洗白）", () => {
    recordModelFailure(USER, "personal:c1:m1", "model_missing", "404")
    expect(getModelHealth(USER, "personal:c1:m1")).not.toBeNull()
    recordModelSuccess(USER, "personal:c1:m1")
    expect(getModelHealth(USER, "personal:c1:m1")).toBeNull()
  })

  it("清一个不存在的键不抛错、也不动其它账", () => {
    recordModelFailure(USER, "personal:c1:m1", "auth", "认证失败")
    recordModelSuccess(USER, "personal:c1:never")
    expect(Object.keys(readModelHealth(USER))).toEqual(["personal:c1:m1"])
  })

  it("clearConfigHealth 只清该配置的账，别的配置原样保留（编辑 Key / 刷新模型 / 删除配置的落点）", () => {
    recordModelFailure(USER, "personal:c1:a", "model_missing", "404")
    recordModelFailure(USER, "personal:c1:b", "auth", "认证失败")
    recordModelFailure(USER, "personal:c2:c", "model_missing", "404")
    clearConfigHealth(USER, "c1")
    expect(Object.keys(readModelHealth(USER))).toEqual(["personal:c2:c"])
    clearConfigHealth(USER, "")
    clearConfigHealth(USER, "nope")
    expect(Object.keys(readModelHealth(USER))).toEqual(["personal:c2:c"])
  })
})

describe("档案健壮性：过期 / 脏值 / 容量 / 分桶 / 存储故障", () => {
  it("超过 7 天 TTL 自动过期读出为空（坏模型长期不碰也不会永远挂着）", () => {
    const now = 1_700_000_000_000
    seedRaw(
      `xz_model_health:${USER}`,
      JSON.stringify({
        "personal:c1:old": { cls: "model_missing", reason: "404", at: now - 8 * DAY },
        "personal:c1:fresh": { cls: "model_missing", reason: "404", at: now - 1000 },
      }),
    )
    expect(Object.keys(readModelHealth(USER, now))).toEqual(["personal:c1:fresh"])
    expect(getModelHealth(USER, "personal:c1:old", now)).toBeNull()
  })

  it("脏 JSON / 非法键 / 非法类别 / 非对象元素一律剔除，绝不抛错", () => {
    seedRaw(`xz_model_health:${USER}`, "{ 这不是合法 JSON")
    expect(readModelHealth(USER)).toEqual({})
    seedRaw(`xz_model_health:${USER}`, JSON.stringify([1, 2]))
    expect(readModelHealth(USER)).toEqual({})
    seedRaw(
      `xz_model_health:${USER}`,
      JSON.stringify({
        "垃圾键": { cls: "model_missing", reason: "", at: Date.now() },
        "personal:c1:x": { cls: "rate_limit", reason: "", at: Date.now() },
        "personal:c1:y": { cls: "model_missing", reason: "", at: "不是数字" },
        "personal:c1:z": "not-an-object",
        "personal:c1:ok": { cls: "auth", reason: "认证失败", at: Date.now() },
      }),
    )
    expect(Object.keys(readModelHealth(USER))).toEqual(["personal:c1:ok"])
  })

  it("容量封顶：超限后只保留最近的若干条，防 localStorage 无限增长", () => {
    for (let i = 0; i < 80; i += 1) recordModelFailure(USER, `personal:c${i}:m${i}`, "model_missing", "404")
    const stored = JSON.parse(ls().getItem(`xz_model_health:${USER}`) as string) as Record<string, unknown>
    expect(Object.keys(stored).length).toBeLessThanOrEqual(60)
  })

  it("按用户分桶隔离：A 的坏消息不会标红 B 的模型", () => {
    recordModelFailure(USER, "personal:c1:m1", "model_missing", "404")
    expect(readModelHealth(OTHER)).toEqual({})
    expect(getModelHealth(OTHER, "personal:c1:m1")).toBeNull()
  })

  it("存储抛错（隐私模式 / 配额满）→ 读写全部静默降级，绝不把异常抛给 AI 主流程", () => {
    const boom = {
      getItem: () => {
        throw new Error("SecurityError")
      },
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
      removeItem: () => {
        throw new Error("SecurityError")
      },
    }
    ;(globalThis as unknown as { window: Record<string, unknown> }).window = { localStorage: boom }
    expect(() => recordModelFailure(USER, "personal:c1:m1", "model_missing", "404")).not.toThrow()
    expect(() => recordModelSuccess(USER, "personal:c1:m1")).not.toThrow()
    expect(() => clearConfigHealth(USER, "c1")).not.toThrow()
    expect(readModelHealth(USER)).toEqual({})
  })
})

describe("onHealthChange 订阅", () => {
  it("挂账 / 清账 / 配置清账都通知；退订后不再收到；无效操作不空通知", () => {
    let hits = 0
    const off = onHealthChange(() => hits++)
    recordModelFailure(USER, "personal:c1:m1", "model_missing", "404")
    expect(hits).toBe(1)
    // 瞬时类不入档也不通知
    recordModelFailure(USER, "personal:c1:m2", "rate_limit", "429")
    expect(hits).toBe(1)
    recordModelSuccess(USER, "personal:c1:m1")
    expect(hits).toBe(2)
    // 清不存在的键不空通知
    recordModelSuccess(USER, "personal:c1:none")
    expect(hits).toBe(2)
    off()
    recordModelFailure(USER, "personal:c1:m3", "auth", "认证失败")
    expect(hits).toBe(2)
  })
})

describe("healthShortLabel / healthNotice 纯函数边界", () => {
  it("非挂账类别与空档案返回空串（UI 据此决定是否渲染徽标）", () => {
    expect(healthShortLabel("rate_limit")).toBe("")
    expect(healthShortLabel("timeout")).toBe("")
    expect(healthNotice(null)).toBe("")
    expect(healthNotice({ cls: "timeout", reason: "", at: 1 })).toBe("")
    expect(healthNotice({ cls: "model_disabled", reason: "", at: 1 })).toContain("启用")
  })
})
