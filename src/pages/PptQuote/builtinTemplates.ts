// ---------------------------------------------------------------------------
// 内置公司模板（2026-11-05）
//
// 背景：用户提供了公司自己的 PPT 技能包 GordenPPTSkill v1.2.0（MIT 许可，技能脚本/元数据可商用），
// 其 templates/zoe-light-internal/template.pptx 就是**智业软件自己的浅色母版**
// （实测该模板内确有「智业软件股份有限公司」「www.zoesoft.com.cn」「智慧医疗·健康天下」文案，
//  26 页样例 + 6 个母版版式：封面/目录/章节过渡页/内页1/2_仅标题/封底）。
//
// 为什么不能像「用户上传模板」那样走 localStorage：
//   该模板 4.93 MB，而 localStorage 预算上限（MAX_TEMPLATE_BYTES）是 3 MB，
//   encodeTemplateBytes 会返回 null → 母版保真通道被**静默关闭**，
//   用户只会得到「已套用主题（主色 #xxxxxx）」的降级结果——这正是"套了模板还是不像公司模板"的根源之一。
//
// 现改为：模板文件随应用一起发布（public/ppt-templates/），选中时按需 fetch 进内存，
// 不占 localStorage、也不受体积上限约束。用户上传的模板仍走原通道（体积上限保留）。
// ---------------------------------------------------------------------------

/** 内置模板标识 */
export type BuiltinDeckTemplateKey = "zoe-light-internal"

export interface BuiltinDeckTemplate {
  key: BuiltinDeckTemplateKey
  /** 界面展示名 */
  label: string
  /** 一句话说明 */
  desc: string
  /** 随应用发布的相对路径（Vite public 目录） */
  path: string
  /** 主题令牌：实测自模板 theme1.xml（accent1..6）+ 母版/样例页实际用字 */
  theme: {
    accents: string[]
    headFont: string
    bodyFont: string
  }
  /** 该模板有哪些版式（界面提示用，实测值） */
  layouts: string[]
}

/**
 * 内置模板清单。
 *
 * 色值来历（不是猜测）：解析 template.pptx 的 ppt/theme/theme1.xml
 *   accent1 #0045E2 / accent2 #1EABEC / accent3 #4472C4 / accent4 #FFC000 / accent5 #4472C4 / accent6 #70AD47
 * 但样例页实际高频用色是 #0145F7(41次) #0448F7(31次) #4D81F7(31次) —— 版式里的装饰形状用的是手工色，
 * 与主题声明不完全一致。生成器套主题时以**主题声明**为准（它决定占位符/继承样式），
 * 装饰形状随母版原样带过，所以这里取主题声明值。
 *
 * 字体：#0045E2 同批实测 —— 蓝latin 主题字体为 Arial，中文字体样例页 181 次「微软雅黑」，
 * 且 GordenPPTSkill 的 detail.json 明确声明 fonts: { cn: "微软雅黑", en: "Arial" }。三者一致。
 */
export const BUILTIN_DECK_TEMPLATES: BuiltinDeckTemplate[] = [
  {
    key: "zoe-light-internal",
    label: "智业官方浅色母版",
    desc: "公司真实母版（封面/目录/章节/内页/封底 6 版式），导出走母版级保真",
    path: "/ppt-templates/zoe-light-internal.pptx",
    theme: {
      accents: ["0045E2", "1EABEC", "4472C4", "FFC000", "4472C4", "70AD47"],
      headFont: "微软雅黑",
      bodyFont: "微软雅黑",
    },
    layouts: ["封面", "目录", "章节过渡页", "内页1", "2_仅标题", "封底"],
  },
]

export function findBuiltinTemplate(key: string | null | undefined): BuiltinDeckTemplate | null {
  if (!key) return null
  return BUILTIN_DECK_TEMPLATES.find((t) => t.key === key) ?? null
}

/** 进程内字节缓存：同一模板只下载一次（4.93MB，重复拉取会明显卡顿） */
const byteCache = new Map<string, Uint8Array>()

/**
 * 取内置模板字节。失败返回 null 并给出原因，调用方据此降级为「仅套主题」而不是静默失败。
 *
 * @param fetchImpl 注入 fetch 便于单测（默认用全局 fetch）
 */
export async function loadBuiltinTemplateBytes(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array } | { failure: string }> {
  const t = findBuiltinTemplate(key)
  if (!t) return { failure: `未知的内置模板：${key}` }
  const cached = byteCache.get(t.key)
  if (cached) return { bytes: cached }
  try {
    const res = await fetchImpl(t.path)
    if (!res.ok) return { failure: `模板下载失败（HTTP ${res.status}）：${t.path}` }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (!buf.length) return { failure: "模板文件为空" }
    // 粗校验：pptx 必须是 zip（PK\x03\x04），否则说明返回的是 404 HTML 页
    if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return { failure: "模板文件不是有效的 pptx（可能被 404 页面替代）" }
    byteCache.set(t.key, buf)
    return { bytes: buf }
  } catch (e) {
    return { failure: `模板下载异常：${e instanceof Error ? e.message : String(e)}` }
  }
}

/** 单测用：清空字节缓存 */
export function __clearBuiltinTemplateCache(): void {
  byteCache.clear()
}
