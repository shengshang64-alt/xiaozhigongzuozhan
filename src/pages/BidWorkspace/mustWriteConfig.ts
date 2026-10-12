/**
 * R-017 必备技术内容清单（可配置下限：凡技术 / 交付 / 服务即必写）——纯本地零 AI。
 * 第 2 轮 R-017 要求「必备技术内容为可配置清单，售前改配置即调整规则、无需改代码」（AGENTS §6 反硬编码）。
 * 本模块是 mustWrite 判定与大纲 prompt 注入的单一真源：默认给出技术/交付/服务三大类下限词，
 * 售前可在 localStorage（键见 REQUIRED_KEYWORDS_STORAGE_KEY）追加本项目特有必备词，读取时与默认并集。
 * mustWrite 命中清单即判 tech 必写（与模型 part 归属解耦）；大纲 prompt 收到同一清单作为独立成章硬约束。
 */

/** 用户追加必备词的存储键（逗号 / 顿号 / 分号 / 换行分隔） */
export const REQUIRED_KEYWORDS_STORAGE_KEY = "bid_mustwrite_required_keywords"

/** 默认必备关键词（下限）：凡命中技术 / 交付 / 服务三大类主题即必写，独立成章不得并入通用章省略 */
export const DEFAULT_REQUIRED_TECH_KEYWORDS: string[] = [
  "技术方案", "系统设计", "部署", "集成", "接口", "性能", "安全", "参数",
  "交付", "验收", "培训", "售后", "运维", "质保", "应急", "重保", "实施",
]

/** 解析配置文本 → 关键词数组：按逗号/顿号/分号/换行切分，去空白去重、保序 */
export function parseRequiredKeywords(raw: string | null | undefined): string[] {
  const parts = (raw ?? "").split(/[,，、；;\n]+/)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const k = p.trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** 生效清单 = 用户追加在前（突出项目特有）+ 默认下限，去重保序 */
export function mergeRequiredKeywords(userExtras: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of [...userExtras, ...DEFAULT_REQUIRED_TECH_KEYWORDS]) {
    const t = (k ?? "").trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 读取当前生效必备清单：localStorage 用户追加 ∪ 默认；无 window / 异常时回退默认（SSR、测试安全） */
export function readRequiredTechKeywords(): string[] {
  let extras: string[] = []
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      extras = parseRequiredKeywords(window.localStorage.getItem(REQUIRED_KEYWORDS_STORAGE_KEY))
    }
  } catch {
    extras = []
  }
  return mergeRequiredKeywords(extras)
}
