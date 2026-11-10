/**
 * 健康看板「失败告警」口径测试。
 *
 * 钉三件事：
 *   ① 只把确定性失效说成告警（限流/超时根本进不了档案，这里也不许出现）；
 *   ② 文案里不出现内部类别码与接口字段名——用户看不懂，也不该看；
 *   ③ 「仍启用」「已停用」「配置已删」三种状态要分开说，否则用户不知道要不要处理。
 */
import { describe, expect, it } from "vitest"
import { buildHealthAlerts, splitHealthKey, summarizeHealthAlerts } from "./modelHealthAlerts"
import type { HealthMap } from "./modelHealth"

const NOW = Date.now()

const HEALTH: HealthMap = {
  "personal:c1:gone": { cls: "model_missing", reason: "HTTP 404", at: NOW - 1000 },
  "personal:c1:quota": { cls: "quota_exhausted", reason: "quota exceeded", at: NOW - 2000 },
  "personal:c2:badkey": { cls: "auth", reason: "401", at: NOW - 3000 },
}

const TARGETS = {
  "personal:c1:gone": { configName: "Open Design", modelId: "gone", enabled: true },
  "personal:c1:quota": { configName: "Open Design", modelId: "quota", enabled: true },
  "personal:c2:badkey": { configName: "直连 DeepSeek", modelId: "badkey", enabled: false },
}

describe("splitHealthKey", () => {
  it("三段 key 反解出模型 id，脏值返回 null", () => {
    expect(splitHealthKey("personal:c1:m")).toEqual({ source: "personal", configId: "c1", modelId: "m" })
    expect(splitHealthKey("personal:c1")).toBeNull()
    expect(splitHealthKey("personal::m")).toBeNull()
  })
})

describe("buildHealthAlerts —— 只报确定性失效，说成人话", () => {
  it("每个档案一条告警，danger 在前、同类按挂账时间倒序", () => {
    const alerts = buildHealthAlerts(HEALTH, TARGETS)
    expect(alerts.map((a) => a.modelId)).toEqual(["gone", "badkey", "quota"])
    expect(alerts[0].tone).toBe("danger")
    expect(alerts[2].tone).toBe("warning") // 额度耗尽可充值恢复，不算「坏掉」
  })

  it("文案带真因与下一步，且不泄露内部类别码", () => {
    for (const a of buildHealthAlerts(HEALTH, TARGETS)) {
      expect(a.title).toContain(a.modelId)
      expect(a.detail).toContain(a.configName)
      expect(a.actionLabel.length).toBeGreaterThan(0)
      for (const leak of ["model_missing", "model_disabled", "quota_exhausted", "personal:", "last_check", "HTTP 404", "401"]) {
        expect(`${a.title}${a.detail}`).not.toContain(leak)
      }
    }
  })

  it("仍启用 / 已停用 / 配置已删 三种状态分开说", () => {
    const [gone, badkey, quota] = buildHealthAlerts(HEALTH, TARGETS)
    expect(gone.detail).toContain("仍处于启用状态")
    expect(badkey.detail).toContain("已在配置中停用")
    expect(quota.detail).toContain("仍处于启用状态")

    // 配置被删 → 孤儿档案仍留痕，但如实说通道已不存在
    const orphan = buildHealthAlerts(HEALTH, {})
    expect(orphan[0].detail).toContain("配置已被删除")
    expect(orphan[0].configName).toBe("已删除的通道")
  })

  it("空档案 = 零告警（不编造「暂无失败」以外的结论）", () => {
    expect(buildHealthAlerts({}, TARGETS)).toEqual([])
    expect(summarizeHealthAlerts([])).toEqual({ pending: 0, warning: 0, total: 0 })
  })

  it("汇总计数把 danger 与 warning 分开（不与「坏了」混谈）", () => {
    expect(summarizeHealthAlerts(buildHealthAlerts(HEALTH, TARGETS))).toEqual({ pending: 2, warning: 1, total: 3 })
  })
})
