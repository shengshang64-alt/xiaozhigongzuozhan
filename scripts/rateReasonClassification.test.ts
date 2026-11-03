// R301：429 上游原文「额度耗尽 vs 速率限制」分类口径的回归测试
//
// 为什么必须锁这条口径（真实踩坑链）：
//   1. 原实现的 429 分支在解析 res.raw **之前**就 return，上游那句能区分
//      「等一会儿就好」与「必须去充值」的 error.message 被整段丢弃；
//   2. R300 复测拿到 xiaomi / Intern 两个 429 通道，结论只能写「限流或余额不足」——
//      无法判定，用户拿不到可行动结论（实测原文见下表）；
//   3. 补上分类后第一版口径把 quota 族写成含 exceed.{0,12}(limit|quota)，
//      结果把实测的 "inference exceeds tpm/rpm limit"（纯速率限制，退避 25s 即成功）
//      误判成额度耗尽 → 引导用户去给一个根本没问题的账号充值。
//   → 分类必须由「原文实测样本」锁死，且测试直接复用 pb_hooks 里的真实正则，
//     实现改了而样本没更新时本测试立刻红（不靠复制一份正则到测试里蒙对）。
//
// 实测原文样本（2026-10-13，网关 → 上游，逐字）：
//   大模型/deepseek-v4-flash        "inference exceeds tpm/rpm limit"  退避 25s 后成功 → freq
//   xiaomi/mimo-v2.6-pro            "quota exhausted"                 3 次全败        → quota
//   Intern/deepseek-v4-flash-vision "quota exceeded"                  3 次全败        → quota
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const HOOK_PATH = join(__dirname, "..", "pocketbase", "pb_hooks", "model_gateway.pb.js")

/** 从钩子源码抽真实正则：测试与运行时永远同一份实现，不复制、不脱钩 */
function loadClassifier() {
  const src = readFileSync(HOOK_PATH, "utf8")
  // 锚点取 chat 路由那一处（rateReason 在 5 个路由各有一份自包含副本，口径必须一致，
  // 一致性由下面的「五处副本口径相同」用例单独守住）
  const chatAt = src.indexOf('routerAdd("POST", "/api/model-gw/chat"')
  expect(chatAt, "未能定位 chat 路由（钩子结构可能已变，请同步本测试）").toBeGreaterThan(-1)
  const q = src.slice(chatAt).match(/var quota = (\/.*?\/)\.test\(hay\)/)
  const f = src.slice(chatAt).match(/var freq = (\/.*?\/)\.test\(hay\)/)
  expect(q, "未能从 chat 路由抽到 quota 判定式").not.toBeNull()
  expect(f, "未能从 chat 路由抽到 freq 判定式").not.toBeNull()
  const QUOTA = eval(q![1]) as RegExp
  const FREQ = eval(f![1]) as RegExp
  return {
    kind: (detail: string) => {
      const hay = String(detail ?? "").toLowerCase()
      if (QUOTA.test(hay)) return "quota"
      if (FREQ.test(hay)) return "freq"
      return "unknown"
    },
    quotaCount: (src.match(/var quota = /g) ?? []).length,
    freqCount: (src.match(/var freq = /g) ?? []).length,
    quotaRules: [...src.matchAll(/var quota = (\/.*?\/)\.test\(hay\)/g)].map((m) => m[1]),
  }
}

const classify = loadClassifier()

/** 实测原文 + 常见方言，期望分类口径 */
const CASES: Array<[string, string, string]> = [
  // —— 实测真实原文（本机2026-10-13 网关 → 上游逐字取得）——
  ["inference exceeds tpm/rpm limit", "freq", "实测 sensenova deepseek-v4-flash，退避 25s 成功"],
  ["quota exhausted", "quota", "实测 xiaomi mimo-v2.6-pro，3 次全败"],
  ["quota exceeded", "quota", "实测 Intern deepseek-v4-flash-vision，3 次全败"],
  // —— 各家方言护栏 ——
  ["insufficient_balance", "quota", "下划线方言"],
  ["insufficient balance", "quota", "空格方言"],
  ["Insufficient Balance", "quota", "大小写"],
  ["You exceeded your current quota", "quota", "OpenAI 方言"],
  ["rate_limit_exceeded", "freq", "下划线方言"],
  ["Rate limit reached for model", "freq", "常见方言"],
  ["Too Many Requests", "freq", "常见方言"],
  ["429 Too Many Requests", "freq", "常见方言"],
  ["RPM limit exceeded", "freq", "速率族"],
  ["You exceeded your token budget", "freq", "字面含 exceeded 但属速率/预算族"],
  ["余额不足", "quota", "中文"],
  ["额度不足，请充值", "quota", "中文"],
  ["请求过于频繁，请稍后重试", "freq", "中文"],
  // —— 不可判定：不得硬猜成某一类 ——
  ["", "unknown", "空原文"],
  ["opaque failure", "unknown", "不可判定"],
]

describe("R301 429 上游原文分类", () => {
  it.each(CASES)("%j → %s（%s）", (raw, want) => {
    expect(classify.kind(raw)).toBe(want)
  })

  // 关键防回归：速率限制绝不能被归成额度耗尽（否则引导用户给正常账号充值）
  it("实测的速率限制原文不得被判成额度耗尽", () => {
    expect(classify.kind("inference exceeds tpm/rpm limit")).not.toBe("quota")
  })

  // 关键防回归：额度耗尽绝不能被归成速率限制（否则用户只会干等，永远等不到恢复）
  it("实测的额度耗尽原文不得被判成速率限制", () => {
    expect(classify.kind("quota exhausted")).not.toBe("freq")
    expect(classify.kind("quota exceeded")).not.toBe("freq")
  })

  // 五个路由（POST configs / PATCH configs / refresh-models / test / chat）各有一份
  // 自包含副本（pb_hooks 顶部约定 Goja 并发安全）。口径漂移会让同一上游 429 在不同
  // 入口给出不同结论——锁死一致性。
  it("五处自包含副本的判定式必须完全一致", () => {
    expect(classify.quotaCount).toBe(5)
    expect(classify.freqCount).toBe(5)
    expect(new Set(classify.quotaRules).size).toBe(1)
  })
})