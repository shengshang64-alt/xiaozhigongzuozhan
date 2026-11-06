/** @vitest-environment jsdom */
/**
 * R4（横切与边界清理）**横切断言网**：错误文案层与幽灵模型推荐。
 *
 * R4 清理的是「同一件事在不同页面有不同说法」，最典型的两类：
 *
 *   ① **幽灵模型推荐**：一个可用模型都没有时，界面仍写「平台内置 gpt-5.5」。
 *      这是「推荐一个不存在的模型」的标准形态——用户以为有模型能用，点了才失败。
 *      R3 已修「下拉」与「公共模型卡」，R4 补上「默认模型横幅」「删除确认对话框」
 *      「测试面板说明」三处残留，并钉住它们不许回退。
 *
 *   ② **死路台词**：本机/内网部署下，任何「回退到平台内置」「切换平台内置」的建议
 *      都是死路（必然 412）。文档与界面都不该这么写——这是 D3 §3.2 明确要求的
 *      「禁止推荐用户未配置的模型」的另一面。
 */
import { describe, expect, it } from "vitest"
import {
  PLATFORM_LOCAL_UNAVAILABLE_REASON,
  describeDefaultAfterDelete,
  isLocalOrPrivateHostname,
} from "@/lib/platformModelAvailability"

describe("① 删除默认模型配置时：默认会落到哪里，必须按部署域如实说", () => {
  it("本机/内网域：**不许**承诺「自动回退平台内置」（那是死路）", () => {
    for (const host of ["127.0.0.1", "192.168.1.3", "10.0.0.9", "localhost"]) {
      const text = describeDefaultAfterDelete(host)
      expect(text, host).not.toContain("自动回退平台内置")
      expect(text, host).toContain("RunningHub")
      // 必须给可执行动作，而不是只说「会回退」
      expect(text, host).toContain("设为默认")
    }
  })

  it("线上域：维持原口径（线上平台内置是可用的，不该改文案）", () => {
    const text = describeDefaultAfterDelete("vibex.cn")
    expect(text).toContain("自动回退平台内置")
  })

  it("主机名缺失（浏览器外调用）：按线上口径处理，不误伤", () => {
    expect(describeDefaultAfterDelete(null)).toContain("自动回退平台内置")
    expect(isLocalOrPrivateHostname(null)).toBe(false)
  })
})

describe("② 横切口径一致性：不可用解释只说一遍，别处不许各写一份", () => {
  it("解释里同时给出「真因」与「下一步」，否则用户没法自查", () => {
    expect(PLATFORM_LOCAL_UNAVAILABLE_REASON).toContain("RunningHub")
    expect(PLATFORM_LOCAL_UNAVAILABLE_REASON).toContain("个人模型")
  })

  it("解释里不出现内部字段名 / 错误码（D7：用户可见文案禁止暴露内部标识）", () => {
    for (const leak of ["rh_login_required", "x-rh-api-key", "RH_LLM_API_KEY", "412", "is_platform"]) {
      expect(PLATFORM_LOCAL_UNAVAILABLE_REASON).not.toContain(leak)
    }
  })
})

describe("③ 源码哨兵：幽灵模型推荐的残留必须为零（代码行，注释不算）", () => {
  const codeLines = (src: string): string[] =>
    src
      .split("\n")
      .filter((line) => {
        const t = line.trim()
        return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))
      })

  it("模型配置页与弹窗里，不许再出现「回退平台内置 gpt-5.5」这种死路承诺", async () => {
    const { sourceText } = await import("@/testing/hookSources")
    const files = [
      "src/components/model-config/PersonalConfigList.tsx",
      "src/components/model-config/PlatformModelCard.tsx",
      "src/components/model-config/TestPanel.tsx",
      "src/pages/ModelConfig/useModelConfig.ts",
    ]
    for (const rel of files) {
      const offenders = codeLines(sourceText(rel)).filter((line) =>
        /回退平台内置 gpt-5\.5|平台内置模型与个人模型都支持测试/.test(line),
      )
      expect(offenders, `${rel} 又写回了死路承诺：\n${offenders.join("\n")}`).toEqual([])
    }
  })

  it("默认模型横幅的兜底标签不再硬编码「平台内置 gpt-5.5」（没有模型时如实说未配置）", async () => {
    const { sourceText } = await import("@/testing/hookSources")
    const src = sourceText("src/pages/ModelConfig/useModelConfig.ts")
    const offenders = codeLines(src).filter((line) => /:\s*"平台内置 gpt-5\.5"/.test(line))
    expect(offenders, `默认标签仍硬编码平台内置 gpt-5.5：\n${offenders.join("\n")}`).toEqual([])
    expect(src).toContain("未配置可用模型")
  })
})
