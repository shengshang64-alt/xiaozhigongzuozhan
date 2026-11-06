/** @vitest-environment jsdom */
/**
 * R3（整仓重构 · 半残主链路收口）**回归网**。
 *
 * 本文件钉的是 R3 五项里属于「纯判定 / 纯文案」的三项——它们的共同失败形态是**静默**：
 *   ① 模型配置：平台内置在本地**确定调不通**，界面却写「登录后即可使用」、还允许设为默认
 *      → 用户把它设成默认，之后每次生成都 412，而横幅仍写着「当前默认可用」。
 *   ② 方案自动保存：失败时 state 回 idle → 界面从「保存中」直接消失，看起来像存好了，
 *      用户刷新后正文丢失且全程没有任何提示。
 *   ③ 情报抓取：只有页面开着才抓，文案却写「后台定时抓取」→ 用户关页等一天，
 *      以为抓取坏了（实测 40 源里 14 源长期失败，正需要持续重试）。
 *
 * 三项都不是「功能少了」，而是「界面在说假话」。所以断言也针对「话」本身：
 * 文案里必须有真因、必须有可执行动作、且不许出现误导词。
 */
import { describe, expect, it } from "vitest"
import {
  PLATFORM_LOCAL_UNAVAILABLE_REASON,
  isLocalOrPrivateHostname,
  isPlatformModelLocallyUnusable,
} from "@/lib/platformModelAvailability"
import {
  CANCEL_HINT_SEC,
  CANCEL_SEMANTICS_TEXT,
  CLIENT_TIMEOUT_SEC,
  LONG_ANSWER_HINT_SEC,
  MAX_CALLS_PER_TURN,
  longAnswerHint,
  longAnswerHintText,
} from "@/lib/longAnswerTiming"
import { describeAutoFetch, describeWaitForNextRound } from "@/pages/IntelCenter/intelAutoFetchCopy"

describe("① 模型配置：平台内置本地不可用必须标明（D4 点名项）", () => {
  it("本机 / 内网域判定覆盖回环、私有段、link-local", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "192.168.1.3", "10.1.2.3", "172.16.0.5", "169.254.1.1"]) {
      expect(isLocalOrPrivateHostname(h), h).toBe(true)
    }
    for (const h of ["vibex.cn", "llm.runninghub.cn", "223.5.5.5", ""]) {
      expect(isLocalOrPrivateHostname(h), h).toBe(false)
    }
  })

  it("本地部署 + 有个人通道 → 平台内置判为不可用（这是能被禁用的前提）", () => {
    expect(isPlatformModelLocallyUnusable({ hostname: "127.0.0.1", hasPersonalModel: true })).toBe(true)
    expect(isPlatformModelLocallyUnusable({ hostname: "192.168.1.3", hasPersonalModel: true })).toBe(true)
  })

  it("本地部署但一条个人通道都没有 → **不**判不可用（否则退化成没有任何模型可选）", () => {
    expect(isPlatformModelLocallyUnusable({ hostname: "127.0.0.1", hasPersonalModel: false })).toBe(false)
  })

  it("线上域 → 不判不可用（线上拿得到 RunningHub 登录态，行为不得改变）", () => {
    expect(isPlatformModelLocallyUnusable({ hostname: "vibex.cn", hasPersonalModel: true })).toBe(false)
  })

  it("不可用解释里必须说清真因与下一步，且不出现内部字段名", () => {
    expect(PLATFORM_LOCAL_UNAVAILABLE_REASON).toContain("RunningHub")
    expect(PLATFORM_LOCAL_UNAVAILABLE_REASON).toContain("个人模型")
    // 不许出现内部实现名（D7：用户可见文案禁止暴露内部字段）
    for (const leak of ["rh_login_required", "x-rh-api-key", "RH_LLM_API_KEY", "412"]) {
      expect(PLATFORM_LOCAL_UNAVAILABLE_REASON).not.toContain(leak)
    }
  })
})

describe("② 方案自动保存：失败不许回 idle（否则看起来像存好了）", () => {
  it("阈值关系必须成立：提示出现得远早于真实超时点", () => {
    // 提示阈值 ≥ 超时点 = 提示出现时已经失败了，等于没提示
    expect(LONG_ANSWER_HINT_SEC).toBeLessThan(CLIENT_TIMEOUT_SEC)
    expect(CANCEL_HINT_SEC).toBeLessThan(CLIENT_TIMEOUT_SEC)
    // 一轮可能串多次调用：最坏等待远大于单次上限，提示阈值必须按这个量级理解
    expect(MAX_CALLS_PER_TURN).toBeGreaterThanOrEqual(2)
  })
})

describe("③ 助手长答：分档提示 + 取消语义 + 不误报「服务不可用」", () => {
  it("0–29s 无长答提示（太早喊狼来了会让用户习惯性忽略）", () => {
    for (const s of [0, 5, 29]) {
      const h = longAnswerHint({ elapsedSec: s })
      expect(h.phase, `${s}s`).toBe("normal")
      expect(h.showLongHint, `${s}s`).toBe(false)
      expect(longAnswerHintText({ elapsedSec: s })).toBe("")
    }
  })

  it("30s 起提示「还在生成」，但还不催取消", () => {
    const h = longAnswerHint({ elapsedSec: LONG_ANSWER_HINT_SEC })
    expect(h.phase).toBe("long")
    expect(h.showLongHint).toBe(true)
    expect(h.emphasizeCancel).toBe(false)
    expect(longAnswerHintText({ elapsedSec: LONG_ANSWER_HINT_SEC })).toContain("仍在生成中")
  })

  it("60s 起说明「可能要多次取数」并给出取消这条路", () => {
    const text = longAnswerHintText({ elapsedSec: 60 })
    expect(text).toContain("60s")
    expect(text).toContain("取消")
    expect(longAnswerHint({ elapsedSec: 60 }).emphasizeCancel).toBe(true)
  })

  it("120s 起按「接近上限」处理，给的是换模型 / 拆问题这类可执行动作", () => {
    const h = longAnswerHint({ elapsedSec: CANCEL_HINT_SEC })
    expect(h.phase).toBe("near_limit")
    expect(h.nearLimit).toBe(true)
    const text = longAnswerHintText({ elapsedSec: CANCEL_HINT_SEC })
    expect(text).toMatch(/换一个响应更快的模型|拆成几步/)
  })

  it("**所有长答文案都不许说「服务不可用 / 模型挂了」**——慢 ≠ 挂，这是最常见的误报", () => {
    for (const s of [0, 30, 60, 120, 200]) {
      const text = longAnswerHintText({ elapsedSec: s })
      expect(text, `${s}s`).not.toMatch(/服务不可用|模型挂了|服务已挂|服务器挂了|不可用/)
    }
  })

  it("取消语义说清楚「已发出的那次调用撤不回」，避免用户以为点了就退钱", () => {
    expect(CANCEL_SEMANTICS_TEXT).toContain("无法撤回")
    expect(CANCEL_SEMANTICS_TEXT).toContain("取消")
  })

  it("进度百分比按「最坏情况 = 单次上限 × 最多调用次数」算，不会一秒跳满", () => {
    const early = longAnswerHint({ elapsedSec: 30 })
    expect(early.worstCasePct).toBeGreaterThan(0)
    expect(early.worstCasePct).toBeLessThan(20)
    expect(longAnswerHint({ elapsedSec: 9999 }).worstCasePct).toBe(100)
  })
})

describe("④ 情报抓取：关页即停必须说准（原句「后台定时抓取」是误导）", () => {
  it("页面可见：明确说「本页打开期间抓取，关页即停」", () => {
    const text = describeAutoFetch({ pageVisible: true })
    expect(text).toContain("本页打开期间")
    expect(text).toContain("关闭本页后抓取会停止")
  })

  it("**不许再出现「后台」二字**——原句正是靠它让人以为服务端在跑", () => {
    for (const visible of [true, false]) {
      expect(describeAutoFetch({ pageVisible: visible }), `visible=${visible}`).not.toContain("后台定时抓取")
    }
  })

  it("页面不可见：如实说已暂停，并说恢复条件", () => {
    const text = describeAutoFetch({ pageVisible: false })
    expect(text).toContain("已暂停")
    expect(text).toContain("回到本页后会继续")
  })

  it("两种可见性都给出「关页也跑」的可执行办法（计划任务脚本名 + 布点）", () => {
    for (const visible of [true, false]) {
      const text = describeAutoFetch({ pageVisible: visible })
      expect(text, `visible=${visible}`).toContain("intel-tick-timer.ps1")
      expect(text, `visible=${visible}`).toContain("计划任务")
    }
  })

  it("空态里的「等下一轮」也分档：页面关着时不许承诺会自动抓", () => {
    expect(describeWaitForNextRound({ pageVisible: true })).toContain("保持本页打开")
    const hidden = describeWaitForNextRound({ pageVisible: false })
    expect(hidden).toContain("不会继续")
    expect(hidden).toContain("intel-tick-timer.ps1")
  })
})
