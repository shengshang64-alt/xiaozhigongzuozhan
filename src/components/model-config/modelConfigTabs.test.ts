/**
 * 模型配置 · UX-v2 三屏拆分的口径与「不许抄原型演示数」哨兵。
 *
 * 背景：docs/ux-v2-2026-11/prototype/model/ 的三个 HTML 里数字全是**设计稿演示数据**
 * （1,284 次 / 98.7% / P95 4.2s / ¥186.4 / 缓存 31% / 3 个通道已连通 / 今日 62 次 …），
 * 现网没有按次调用台账、没有计价模块、后端也从不写 last_check_status。
 * 验收口径写得很明确：只要界面出现与原型一模一样的数，就判「抄了演示数据」直接打回。
 *
 * 本文件钉五件事：
 *   ① 三个 SubTab 的名称与顺序 = 原型 manifest；
 *   ② 三屏源码里不许出现原型演示值（注释里引用说明是允许的，写进 JSX 才是缺陷）；
 *   ③ 原型的 .note「拆前 / 拆后」说明条不许进生产；
 *   ④ 拆屏不许丢原有配置能力（平台卡 / 个人配置 / 表单弹窗 / 测试入口）；
 *   ⑤ 不许假造「按功能分层的默认模型链」——现网只有全局默认一层。
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MODEL_CONFIG_TABS, modelConfigTabHref, parseModelConfigTab } from "./modelConfigTabs"
import { channelStatusOf, DEFAULT_CHAIN_LEVELS, describeKey, summarizeChannels, buildChannelViews } from "@/lib/modelChannelsView"

// 本文件位于 src/components/model-config/ → 仓库根上溯三级
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf-8")

/** 代码行（注释不算）：注释里引用原型数字做说明是允许的，写进 JSX 才是缺陷 */
function codeLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => {
      const t = line.trim()
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))
    })
}

const SCREEN_FILES = [
  "src/components/model-config/ModelChannelsScreen.tsx",
  "src/components/model-config/HealthBoard.tsx",
  "src/components/model-config/ModelTestScreen.tsx",
  "src/pages/ModelConfig/ModelConfigPage.tsx",
]

describe("① 三个 SubTab 的名称与顺序 = 原型 manifest", () => {
  it("标签文案逐字一致", () => {
    expect(MODEL_CONFIG_TABS.map((t) => t.label)).toEqual(["通道与默认", "健康看板", "连通测试"])
  })

  it("?tab= 解析：非法值与缺省都落「通道与默认」，旧书签行为不变", () => {
    expect(parseModelConfigTab(null)).toBe("channels")
    expect(parseModelConfigTab("garbage")).toBe("channels")
    expect(parseModelConfigTab("health")).toBe("health")
    expect(parseModelConfigTab("test")).toBe("test")
    expect(modelConfigTabHref("channels")).toBe("/model-config")
    expect(modelConfigTabHref("health")).toBe("/model-config?tab=health")
  })
})

describe("② 三屏不许抄原型演示数（打回判据）", () => {
  it("health.html / channels.html / test.html 的演示值都不许出现在代码行里", () => {
    const demo = [
      /\b1,?284\b/, // 本期调用
      /98\.7/, // 成功率
      /186\.4/, // 本期费用
      /\b31%/, // 缓存命中
      /\b268\b/, // 趋势峰值
      /\b11-06\b/, // 峰值日期
      /4\.2s/, // P95
      /0\.8s/, // 首字延迟
      /¥\s?500/, // 月预算
      /104\.2/, // 输入 token 费用
      /82\.2/, // 输出 token 费用
      /\b62 次\b/, // 通道卡「今日调用 62 次」
      /\b3 个通道已连通\b/, // 页头徽标的演示文案
      /\b18\.4\b/, // 今日费用
    ]
    for (const rel of SCREEN_FILES) {
      const lines = codeLines(read(rel))
      for (const re of demo) {
        const hits = lines.filter((l) => re.test(l))
        expect(hits, `${rel} 出现原型演示数 ${re}：\n${hits.join("\n")}`).toEqual([])
      }
    }
  })

  it("无真源时用「—」占位，不填 0（0 会被读成「统计过，结果是零」）", () => {
    const health = read("src/components/model-config/HealthBoard.tsx")
    expect(health).toContain('value="—"')
    expect(health).toContain("暂无调用台账")
    expect(health).toContain("暂无费用采集")
    // 通道卡的「今日调用」同样必须是 —
    const channels = read("src/components/model-config/ModelChannelsScreen.tsx")
    expect(channels).toContain("网关不落按次调用台账")
    expect(channels).toContain("还没测过")
  })

  it("趋势与功能维度走空态，不画假柱", () => {
    const src = read("src/components/model-config/HealthBoard.tsx")
    expect(src).toContain("暂无调用量数据")
    expect(src).toContain("暂无功能维度数据")
    expect(src).not.toMatch(/height:\s*\d+%/)
  })
})

describe("③ 原型的 .note「拆前 / 拆后」说明条不许进生产", () => {
  it("三屏与页面壳里都没有拆前/拆后文案", () => {
    for (const rel of SCREEN_FILES) {
      const src = read(rel)
      expect(src.includes("拆前") || src.includes("拆后"), `${rel} 残留设计说明条文案`).toBe(false)
    }
  })
})

describe("④ 拆屏不许丢原有配置能力", () => {
  it("通道与默认屏仍渲染平台卡 + 个人配置列表 + 默认横幅", () => {
    const src = read("src/components/model-config/ModelChannelsScreen.tsx")
    for (const part of ["PlatformModelCard", "PersonalConfigList", "DefaultModelBanner"]) {
      expect(src, `拆屏后丢了 ${part}`).toContain(part)
    }
  })

  it("表单弹窗仍挂在页面壳上（三屏共用）", () => {
    const src = read("src/pages/ModelConfig/ModelConfigPage.tsx")
    expect(src).toContain("ConfigFormDialog")
    expect(src).toContain("formOpen")
  })

  it("通道卡的「测试」跨屏时要先把人带到连通测试屏（否则结果渲染在看不见的面板里）", () => {
    const src = read("src/pages/ModelConfig/ModelConfigPage.tsx")
    expect(src).toContain("onOpenTest")
    expect(src).toContain('go("test")')
  })
})

describe("⑤ 不许假造「按功能分层的默认模型链」", () => {
  it("默认链只有「全局默认」一层（现网无按功能路由字段）", () => {
    expect(DEFAULT_CHAIN_LEVELS).toHaveLength(1)
    expect(DEFAULT_CHAIN_LEVELS[0].key).toBe("global")
  })

  it("通道与默认屏明确说出「暂不支持按功能分别指定模型」，不画改不动的三层", () => {
    const src = read("src/components/model-config/ModelChannelsScreen.tsx")
    expect(src).toContain("暂不支持按功能分别指定模型")
    // 原型的三层文案（② 方案生成 / ③ 标书正文）不许作为层级行出现
    expect(src).not.toContain("② 方案生成")
    expect(src).not.toContain("③ 标书正文")
  })
})

describe("⑥ 通道状态口径：空串不许当「已连通」", () => {
  it("只有显式 ok 才算连通，空/未知一律 untested", () => {
    expect(channelStatusOf("ok")).toBe("ok")
    expect(channelStatusOf("error")).toBe("error")
    expect(channelStatusOf("")).toBe("untested")
    expect(channelStatusOf(null)).toBe("untested")
    expect(channelStatusOf(undefined)).toBe("untested")
    expect(channelStatusOf("weird")).toBe("untested")
  })

  it("页头统计把未测过与失败分开算，不合并成「可用」", () => {
    const cfg = (over: Partial<Parameters<typeof buildChannelViews>[0][number]>) =>
      ({
        id: "c1",
        config_name: "通道",
        base_url: "",
        api_key_masked: "",
        has_key: true,
        models: [],
        default_model: "",
        is_platform: false,
        last_check_status: "",
        last_check_error: "",
        last_checked_at: "",
        created: "",
        updated: "",
        ...over,
      }) as Parameters<typeof buildChannelViews>[0][number]

    const views = buildChannelViews(
      [cfg({ id: "a", last_check_status: "ok" }), cfg({ id: "b", last_check_status: "error" }), cfg({ id: "c" })],
      [],
      null,
    )
    expect(summarizeChannels(views)).toMatchObject({ total: 3, connected: 1, errored: 1, untested: 1 })
  })

  it("Key 回显：平台内置说「无需 Key」，未配置说「未配置」，有 Key 用后端掩码", () => {
    expect(describeKey({ is_platform: true, has_key: false, api_key_masked: "" })).toBe("无需 Key")
    expect(describeKey({ is_platform: false, has_key: false, api_key_masked: "" })).toBe("未配置 Key")
    expect(describeKey({ is_platform: false, has_key: true, api_key_masked: "sk-***woQ7" })).toBe("sk-***woQ7")
  })
})
