// ---------------------------------------------------------------------------
// RulesListPanel —— 规则清单页（R262 阶段2b，与检查结果并列的 Tab）。
//
// 每条规则展示：开关 + 规则名 + 所属层 + 严重度 + 规则说明（含命中示例）。
// ⚠️ 复用现有 checkConfig / anbidCheckConfig，配置机制不动：
//    · L1 正文禁则「开关」= checkConfig.formatKeys 勾选；
//    · L5 暗标项随「暗标严格模式」整体启用（sealedLevels 含 L5），词库/标准在配置弹窗回填。
// 不改任何检查逻辑，仅呈现 + 读写既有配置。
// ---------------------------------------------------------------------------

import { FORMAT_CHECK_KEYS, FORMAT_CHECK_LABEL, type FormatCheckKey } from "@/pages/BidWorkspace/bidTypes"
import { Badge } from "@/components/ui/badge"
import { SEVERITY_LABEL, type CheckLevel, type Severity } from "./bidCheckTypes"
import { KEY_SEVERITY } from "./rules/format"
import type { CheckConfig } from "./config/checkConfig"
import type { AnbidCheckConfig } from "./config/anbidCheckConfig"

type Props = {
  checkCfg: CheckConfig
  patchCheckCfg: (patch: Partial<CheckConfig>) => void
  anbidCfg: AnbidCheckConfig
}

/** L1 正文禁则说明与命中示例（展示层文案，不改判定逻辑） */
const L1_NOTE: Record<string, string> = {
  no_color_content: "正文出现非黑/彩色文字。示例：一段红色「重点承诺」。",
  no_color_image: "含彩色图片。⚠️ 依赖渲染层，未随正文提取自动判定——标「需人工抽检」。",
  no_table_shading: "表格单元格加底纹/阴影。⚠️ 表格类需上传 .docx，正文项目不判定。",
  no_color_border: "正文/表格出现彩色边框。",
  no_hyperlink: "正文残留网址/超链接。示例：www.xxx.com。",
  no_watermark: "残留「样稿/草稿/仅供内部」等水印词。",
  no_bold: "正文残留 Markdown 加粗 ** 或 __。",
  no_underline: "正文残留 <u> 下划线标记。",
  no_empty_line_consecutive: "连续空行超过 2 行。",
  no_half_width_punct: "正文使用半角标点 , ; : ! ?（应改全角）。",
  no_blank_page: "残留空白页标记。",
  identity_leak: "公司名/人名/品牌等身份词泄露——统一交由 L5 暗标层处理，此处勾选不重复。",
  wording_scan: "连续重复句 / 叠字 / 括号混用 / 中英之间空格。",
  decoration_leftover: "残留装饰符（【】◆■●✓→）或行首 # - * > 列表符；★/▲ 为招标实质性条款标记，引用照录不算残留。",
}

/** L5 暗标规则目录（展示用；实际判定在 rules/anbid.ts，词库/标准来自配置弹窗） */
const L5_CATALOG: { code: string; title: string; severity: Severity; note: string }[] = [
  { code: "L5-A1", title: "公司名称泄露", severity: "critical", note: "正文/元数据命中暗标词库公司名。示例：「XX科技有限公司」。词库在配置弹窗回填。" },
  { code: "L5-A2", title: "品牌 / 产品 / 平台名泄露", severity: "critical", note: "自有软件名/平台名/商标名。示例：「XX智慧医院系统」。" },
  { code: "L5-A3", title: "人名泄露", severity: "critical", note: "法人/投标代表/项目经理/技术负责人姓名。示例：「项目经理 张三」。" },
  { code: "L5-A4", title: "联系方式泄露", severity: "critical", note: "手机/座机/邮箱/传真/微信QQ。示例：13800138000。" },
  { code: "L5-A6", title: "统一社会信用代码泄露", severity: "critical", note: "18 位统一社会信用代码格式。" },
  { code: "L5-A7", title: "资质证书编号泄露", severity: "high", note: "ISO/CMMI/ITSS/等保 等证书号，常含公司名。" },
  { code: "L5-A8", title: "案例 / 项目名称泄露", severity: "critical", note: "「已在 XX 医院上线/部署」等可反查投标人的案例。" },
  { code: "L5-A10", title: "独特标识 / 内部代号", severity: "high", note: "内部系统名/方案代号/版本前缀。示例：XX 平台 V3.2。" },
  { code: "L5-B1", title: "作者 / 最后保存者泄露", severity: "critical", note: "docx 元数据 dc:creator / lastModifiedBy（需上传 .docx）。" },
  { code: "L5-B2", title: "公司 / 管理者字段泄露", severity: "critical", note: "docProps/app.xml Company / Manager。" },
  { code: "L5-B4", title: "批注作者泄露", severity: "critical", note: "word/comments.xml 存在 w:author（需 .docx）。" },
  { code: "L5-B5", title: "隐藏文字残留", severity: "critical", note: "document.xml 存在 w:vanish 隐藏文字节点。" },
  { code: "L5-B6", title: "修订标记残留", severity: "high", note: "document.xml 存在 w:ins / w:del 修订节点。" },
  { code: "L5-B8", title: "页眉页脚泄露", severity: "critical", note: "页眉/页脚含公司名或联系方式（暗标通常仅裸页码）。" },
  { code: "L5-B9", title: "图片 EXIF（人工抽检）", severity: "info", note: "内嵌图片 EXIF/XMP 未逐项解析，列数量供人工抽检。⚠️ 未自动检测。" },
  { code: "L5-C1", title: "正文字体合规", severity: "high", note: "与暗标配置要求字体比对；未配置标准则标「未配置」不瞎判。" },
  { code: "L5-C10", title: "编号形式（禁用项目符号）", severity: "high", note: "读 word/numbering.xml 判定自动编号形式（bullet/decimal/中文数字…）；要求数字编号时，项目符号判失败。未配置不判。" },
  { code: "L5-C9", title: "页数超限", severity: "critical", note: "字数粗估页数 vs 配置页数上限；未配置则不判。" },
  { code: "L5-C7", title: "禁止彩色（全黑白）", severity: "high", note: "要求全黑白时提示图片彩色需人工核。⚠️ 依赖渲染。" },
  { code: "L5-E1", title: "文件名含公司/项目标识", severity: "high", note: "文件名命中身份/品牌词。示例：「XX公司投标书.docx」。" },
  { code: "L5-F1", title: "第一人称（我司/本公司/我方）", severity: "critical", note: "暗标语境下第一人称本身即高风险表述。" },
  { code: "L5-F3", title: "荣誉 / 资质自述", severity: "high", note: "「本公司荣获」「我司拥有 XX 资质」等可识别自述。" },
]

const LEVELS: CheckLevel[] = ["L1", "L2", "L3", "L4", "L5"]

export function RulesListPanel({ checkCfg, patchCheckCfg, anbidCfg }: Props) {
  const formatOn = new Set(checkCfg.formatKeys)
  const l5On = checkCfg.sealedLevels.includes("L5")

  const toggleKey = (k: string) => {
    const next = new Set(formatOn)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    patchCheckCfg({ formatKeys: [...next] })
  }

  const toggleL5 = () => {
    const cur = new Set<CheckLevel>(checkCfg.sealedLevels)
    if (cur.has("L5")) cur.delete("L5")
    else cur.add("L5")
    patchCheckCfg({ sealedLevels: LEVELS.filter((l) => cur.has(l)) })
  }

  return (
    <div className="space-y-5 text-sm">
      <p className="text-xs text-muted-foreground">
        规则清单为只读呈现 + 既有配置开关（改配置即调规则，无需改代码）。关闭某条规则后重跑，该项不再报。判定权归人，本工具只标不改。
      </p>

      {/* L1 正文禁则 */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          L1 格式层 · 正文禁则
          <Badge variant="neutral">{formatOn.size}/{FORMAT_CHECK_KEYS.length} 启用</Badge>
        </h3>
        <div className="divide-y rounded-lg border bg-background">
          {(FORMAT_CHECK_KEYS as FormatCheckKey[]).map((k) => {
            const sev: Severity = k === "identity_leak" ? "critical" : KEY_SEVERITY[k] ?? "medium"
            const on = formatOn.has(k)
            return (
              <label key={k} className="flex items-start gap-3 px-3 py-2">
                <input type="checkbox" checked={on} onChange={() => toggleKey(k)} className="mt-1" disabled={k === "identity_leak"} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{FORMAT_CHECK_LABEL[k]}</span>
                    <Badge variant="neutral">L1</Badge>
                    <Badge variant={sev === "critical" ? "danger" : sev === "info" ? "neutral" : "warning"}>{SEVERITY_LABEL[sev]}</Badge>
                    {k === "identity_leak" ? <Badge variant="neutral">由 L5 处理</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{L1_NOTE[k]}</p>
                </div>
              </label>
            )
          })}
        </div>
      </section>

      {/* L5 暗标合规 */}
      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          L5 合规层 · 暗标（严格模式）
          <label className="flex items-center gap-1.5 text-xs font-normal">
            <input type="checkbox" checked={l5On} onChange={toggleL5} /> 随暗标模式启用
          </label>
        </h3>
        <p className="text-xs text-muted-foreground">
          身份/品牌/人名词库与暗标格式标准在「配置」弹窗回填（当前：身份词 {anbidCfg.identityWords.length} 个 · 品牌词 {anbidCfg.brandProductWords.length} 个 · 人词 {anbidCfg.personNames.length} 个）。逐条规则仅在暗标严格模式运行时执行。
        </p>
        <div className="divide-y rounded-lg border bg-background">
          {L5_CATALOG.map((r) => (
            <div key={r.code} className="flex items-start gap-3 px-3 py-2">
              <span className="mt-0.5 w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{r.code}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{r.title}</span>
                  <Badge variant="neutral">L5</Badge>
                  <Badge variant={r.severity === "critical" ? "danger" : r.severity === "info" ? "neutral" : "warning"}>{SEVERITY_LABEL[r.severity]}</Badge>
                  {!l5On ? <Badge variant="neutral">暗标模式启用</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* L2/L3/L4 接入态 */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">L2 响应 / L3 内容 / L4 查重</h3>
        <div className="space-y-1 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
          <p>· L2 响应层：已接入（二期）——逐条核对 ★实质性条款正文回应与技术评分项落点，复用本地覆盖审计，只报不拦、需选择已解析并生成正文的项目。</p>
          <p>· L3 内容层：已接入（四期）——本地核对章节正文完整性：单薄/空缺（阈值取配置项 thinChapterMinChars）+ 成稿偏短标记（underlength），只报不拦、需选择已生成正文的项目；语义类判定（AI）仍挂账。</p>
          <p>· L4 查重层：已接入（三期）——复用本地跨章互查（shingles+Jaccard）检出重复段落，段落长度阈值取配置项 dupMinRun，只报不拦、需选择已生成正文且不少于两章的项目。</p>
          <p className="pt-1">当前已接入 L1 格式 + L2 响应 + L3 内容 + L4 查重 + L5 暗标合规（五级全接入，均只报不拦、只标不改）。</p>
        </div>
      </section>
    </div>
  )
}
