// ---------------------------------------------------------------------------
// anbid.ts —— L5 合规层（暗标）检测引擎。零 AI、确定性规则（正则 + OOXML 节点 + 文档属性）。
//
// ⚠️ 只标不改：本模块只读 DocContext，输出证据清单，绝不修改正文、绝不写回文件。
// 仅在「暗标严格模式」运行；普通模式返回空数组（L5 不启用）。
//
// 覆盖：A 类主体身份泄露 · B 类元数据与痕迹 · C 类格式合规（读配置）· E 类文件形态 · F 类第一人称/荣誉（正则）。
// C 类与页数/边距等以招标文件暗标条款为准，未配置标 unconfigured，绝不瞎判。
// ---------------------------------------------------------------------------

import type { CheckHit, CheckItem, DocContext, Severity } from "../bidCheckTypes"
import type { AnbidCheckConfig } from "../config/anbidCheckConfig"
import { isSameFont } from "../engine/fontResolve"
import { formatLabel } from "../engine/numberingResolve"

const MAX_HITS_PER_ITEM = 6

function clip(s: string): string {
  const t = (s || "").trim().replace(/\s+/g, " ")
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

function mkItem(
  code: string,
  category: string,
  title: string,
  severity: Severity,
  basis: string,
  suggestion: string,
  hits: CheckHit[],
): CheckItem {
  return {
    code,
    level: "L5",
    category,
    title,
    severity,
    status: hits.length ? (severity === "medium" || severity === "info" ? "warn" : "fail") : "pass",
    basis,
    suggestion,
    hits: hits.slice(0, MAX_HITS_PER_ITEM),
    confidence: null,
  }
}

function unconfigured(code: string, category: string, title: string, severity: Severity, basis: string, suggestion: string): CheckItem {
  return { code, level: "L5", category, title, severity, status: "unconfigured", basis, suggestion, hits: [], confidence: null }
}

function skipped(code: string, category: string, title: string, severity: Severity, basis: string, suggestion: string): CheckItem {
  return { code, level: "L5", category, title, severity, status: "skipped", basis, suggestion, hits: [], confidence: null }
}

// ---- A 类正则库（通用可确定性判定的部分；公司名/人名/品牌走配置词库）------
const RE_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/
const RE_LANDLINE = /(?:0\d{2,3}-)\d{7,8}(?:-\d{1,4})?/
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w-]+/
const RE_FAX = /传真[:：]?\s*\d[\d\s-]{5,}/
const RE_IM = /(?:微信|QQ|扣扣)[:：]?\s*[A-Za-z0-9_-]{5,}/i
const RE_CREDIT_CODE = /(?<![0-9A-Z])[0-9A-HJ-NP-RT-UW-Y]{2}\d{6}[0-9A-HJ-NP-RT-UW-Y]{10}(?![0-9A-Z])/
const RE_CERT = /(?:ISO\s?\d{4,7}|CMMI\s?\d|ITSS|CS\d|等保[一二三]级)/
const RE_CASE = /(?:医院|卫生院|卫生中心|中心血站)[^\n，。]{0,14}(?:上线|部署|承建|服务|实施|运行|投用|落地)|(?:典型案例|成功案例)[^\n，。]{0,14}(?:医院|项目)/
const RE_GENERIC_COMPANY = /[\u4e00-\u9fa5]{2,12}(?:有限公司|股份有限公司|集团(公司)?|科技(有限)?公司|信息技术(有限)?公司|软件(有限)?公司)/
const RE_VERSION_CODE = /[A-Za-z][A-Za-z0-9_-]{2,}\s?[Vv]\d+(?:\.\d+){1,3}/

/** 词库子串命中（大小写敏感，中文为主） */
function wordHits(ctx: DocContext, words: string[], rule: string, basis: string): CheckHit[] {
  const hits: CheckHit[] = []
  if (!words.length) return hits
  for (const ch of ctx.chapters) {
    for (const line of (ch.content || "").split(/\r?\n/)) {
      for (const w of words) {
        if (w && line.includes(w)) {
          hits.push({ location: ch.title || "（正文）", text: clip(line), rule, basis })
          break
        }
      }
    }
  }
  return hits
}

function regexHitsOnText(text: string, re: RegExp, location: string, rule: string, basis: string): CheckHit[] {
  const hits: CheckHit[] = []
  for (const line of (text || "").split(/\r?\n/)) {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")
    const m = r.exec(line)
    if (m) hits.push({ location, text: clip(line), rule, basis })
  }
  return hits
}

/**
 * L5 主入口。
 * @param ctx  文档上下文
 * @param cfg  暗标配置（词库 + 格式标准）
 * @param sealedMode 是否暗标严格模式（false→返回 []，普通模式不跑 L5）
 */
export function runAnbidChecks(ctx: DocContext, cfg: AnbidCheckConfig, sealedMode: boolean): CheckItem[] {
  if (!sealedMode) return []
  const items: CheckItem[] = []

  // ============ A 类 · 主体身份泄露 ============
  const identityBasis = "A1 公司名/简称/曾用名命中——暗标出现即废标（词库来自暗标配置）"
  items.push(
    mkItem(
      "L5-A1",
      "主体身份",
      "公司名称泄露",
      "critical",
      identityBasis,
      "删除或改为「投标人」「本公司」等中性表述；由人工在 Word 中处理",
      wordHits(ctx, cfg.identityWords, "company_word", identityBasis),
    ),
  )
  items.push(
    mkItem(
      "L5-A2",
      "主体身份",
      "品牌 / 产品 / 平台名泄露",
      "critical",
      "A2 自有软件名/平台名/商标名命中",
      "以通用功能描述替代专有品牌名",
      wordHits(ctx, cfg.brandProductWords, "brand_word", "A2 品牌/产品名"),
    ),
  )
  items.push(
    mkItem(
      "L5-A3",
      "主体身份",
      "人名泄露",
      "critical",
      "A3 法人/投标代表/项目经理/技术负责人姓名命中",
      "删除具体姓名，仅保留角色（如「项目经理」）",
      wordHits(ctx, cfg.personNames, "person_name", "A3 人名"),
    ),
  )
  const contactBasis = "A4 联系方式（手机/座机/邮箱/传真/微信QQ）——暗标禁用"
  const contactHits = [
    ...regexHitsOnText(ctx.fullText, RE_MOBILE, "正文", "mobile", contactBasis),
    ...regexHitsOnText(ctx.fullText, RE_LANDLINE, "正文", "landline", contactBasis),
    ...regexHitsOnText(ctx.fullText, RE_EMAIL, "正文", "email", contactBasis),
    ...regexHitsOnText(ctx.fullText, RE_FAX, "正文", "fax", contactBasis),
    ...regexHitsOnText(ctx.fullText, RE_IM, "正文", "im", contactBasis),
  ]
  items.push(mkItem("L5-A4", "主体身份", "联系方式泄露", "critical", contactBasis, "删除全部联系方式", dedupe(contactHits)))

  items.push(
    mkItem(
      "L5-A6",
      "主体身份",
      "统一社会信用代码泄露",
      "critical",
      "A6 18 位统一社会信用代码格式",
      "删除代码",
      regexHitsOnText(ctx.fullText, RE_CREDIT_CODE, "正文", "credit_code", "A6 信用代码"),
    ),
  )
  items.push(
    mkItem(
      "L5-A7",
      "主体身份",
      "资质证书编号泄露",
      "high",
      "A7 ISO/CMMI/ITSS/等保 等证书号（常含公司名）",
      "暗标中移除可识别资质编号",
      regexHitsOnText(ctx.fullText, RE_CERT, "正文", "cert", "A7 资质编号"),
    ),
  )
  items.push(
    mkItem(
      "L5-A8",
      "主体身份",
      "案例 / 项目名称泄露",
      "critical",
      "A8 「本院已在 XX 医院上线」等可反查投标人的案例",
      "删除具体客户/项目名，改为不指向特定主体的能力描述",
      regexHitsOnText(ctx.fullText, RE_CASE, "正文", "case_name", "A8 案例名"),
    ),
  )
  items.push(
    mkItem(
      "L5-A10",
      "主体身份",
      "独特标识 / 内部代号",
      "high",
      "A10 内部系统名、方案代号、版本前缀（如 XX 智慧医院 V3.2）",
      "移除专属代号与版本前缀",
      regexHitsOnText(ctx.fullText, RE_VERSION_CODE, "正文", "version_code", "A10 独特标识"),
    ),
  )
  // 通用公司名模式（未配置词库时的兜底提示，medium=需人工确认，避免把架构描述里的「有限公司」误杀）
  items.push(
    mkItem(
      "L5-A1G",
      "主体身份",
      "疑似公司名模式（待人工确认）",
      "medium",
      "A1 通用「××有限公司/集团」模式命中，可能为误报（如架构描述）",
      "确认是否为投标人名称；如是则删除，如否可标记「不改」",
      regexHitsOnText(ctx.fullText, RE_GENERIC_COMPANY, "正文", "generic_company", "A1 通用模式"),
    ),
  )

  // ============ B 类 · 元数据与痕迹 ============
  const m = ctx.meta
  // B1/B2/B3：读元数据字段（docx 与 pdf 均可取到 creator/company/title 等），无字段即 pass
  items.push(
    mkItem(
      "L5-B1",
      "元数据痕迹",
      "作者 / 最后保存者泄露",
      "critical",
      "core.xml → dc:creator / cp:lastModifiedBy（PDF 取 Info.Author/ModDate）",
      "清除文档作者信息（文件→信息→文档属性→删除个人信息）",
      [
        ...(m.creator ? [{ location: "core.xml → dc:creator", text: clip(m.creator), rule: "creator", basis: "" }] : []),
        ...(m.lastModifiedBy ? [{ location: "core.xml → cp:lastModifiedBy", text: clip(m.lastModifiedBy), rule: "lastModifiedBy", basis: "" }] : []),
      ],
    ),
  )
  items.push(
    mkItem(
      "L5-B2",
      "元数据痕迹",
      "公司 / 管理者字段泄露",
      "critical",
      "docProps/app.xml → Company / Manager（PDF 取 Info.Creator）",
      "清空扩展属性中的公司/管理者",
      [
        ...(m.company ? [{ location: "app.xml → Company", text: clip(m.company), rule: "company", basis: "" }] : []),
        ...(m.manager ? [{ location: "app.xml → Manager", text: clip(m.manager), rule: "manager", basis: "" }] : []),
      ],
    ),
  )
  const metaTitleLeaks = [
    ...wordHitsTextOnly(m.title, "core.xml → dc:title", cfg.identityWords),
    ...wordHitsTextOnly(m.subject, "core.xml → dc:subject", cfg.identityWords),
    ...wordHitsTextOnly(m.keywords, "core.xml → cp:keywords", cfg.identityWords),
  ]
  items.push(
    mkItem(
      "L5-B3",
      "元数据痕迹",
      "标题 / 主题 / 关键词含公司名",
      "critical",
      "core.xml → dc:title / dc:subject / cp:keywords",
      "清理元数据中的公司/项目标识",
      metaTitleLeaks,
    ),
  )
  // B4~B11：OOXML 节点级痕迹，仅 docx 包可取；非包输入标 skipped
  if (!m.available) {
    const why = ctx.inputKind === "project" ? "选择项目正文不含文件包，节点痕迹需上传 .docx 文件" : "该痕迹项仅对 .docx 文件生效"
    for (const [code, title] of [
      ["L5-B4", "批注作者泄露"],
      ["L5-B5", "隐藏文字残留"],
      ["L5-B6", "修订标记残留"],
      ["L5-B8", "页眉页脚泄露"],
    ] as [string, string][]) {
      items.push(skipped(code, "元数据痕迹", title, "critical", why, "上传 .docx 文件后自动检查"))
    }
  } else {
    items.push(
      mkItem(
        "L5-B4",
        "元数据痕迹",
        "批注作者泄露",
        "critical",
        "word/comments.xml 存在且含 w:author",
        "接受/删除全部批注（暗标不得留审阅痕迹）",
        m.hasComments
          ? [{ location: "comments.xml", text: clip(m.commentAuthors.join("、") || "存在批注"), rule: "comments", basis: "" }]
          : [],
      ),
    )
    items.push(
      mkItem(
        "L5-B5",
        "元数据痕迹",
        "隐藏文字残留",
        "critical",
        "document.xml 存在 w:vanish 隐藏文字节点",
        "显示隐藏文字并删除（审阅/打印均会暴露）",
        m.hasHiddenText ? [{ location: "document.xml", text: "存在 w:vanish 隐藏文字", rule: "vanish", basis: "" }] : [],
      ),
    )
    items.push(
      mkItem(
        "L5-B6",
        "元数据痕迹",
        "修订标记残留",
        "high",
        "document.xml 存在 w:ins / w:del 修订节点",
        "接受全部修订并关闭跟踪",
        m.revisionIns + m.revisionDel > 0
          ? [{ location: "document.xml", text: `修订插入 ${m.revisionIns} 处 / 删除 ${m.revisionDel} 处`, rule: "revision", basis: "" }]
          : [],
      ),
    )
    const leakedBookmarks = m.bookmarkNames.filter((n) => !/^_GoBack$|^_Toc\d+$|^OLE_LINK\d*$|^_Go/i.test(n))
    items.push(
      mkItem(
        "L5-B7",
        "元数据痕迹",
        "书签名泄露",
        "medium",
        "w:bookmarkStart w:name 非内置书签名可能携带标识",
        "删除自定义书签或改名",
        leakedBookmarks.map((n) => ({ location: "document.xml → bookmarkStart", text: clip(n), rule: "bookmark", basis: "" })),
      ),
    )
    const hfIdentity = cfg.identityWords.filter((w) => w && m.headerFooterText.includes(w))
    const hfLeaks: CheckHit[] = hfIdentity.length
      ? [{ location: "页眉/页脚", text: clip(m.headerFooterText), rule: "hf_identity", basis: "页眉页脚命中身份词" }]
      : [
          ...regexHitsOnText(m.headerFooterText, RE_MOBILE, "页眉/页脚", "hf_mobile", "页眉页脚含联系方式"),
          ...regexHitsOnText(m.headerFooterText, RE_EMAIL, "页眉/页脚", "hf_email", "页眉页脚含邮箱"),
        ]
    items.push(
      mkItem(
        "L5-B8",
        "元数据痕迹",
        "页眉页脚泄露",
        "critical",
        "word/header*.xml / footer*.xml 全文扫描",
        "暗标通常要求页眉页脚留空（仅裸页码），删除公司名/联系方式",
        hfLeaks,
      ),
    )
    items.push(
      mkItem(
        "L5-B10",
        "元数据痕迹",
        "文档保护 / 水印",
        "high",
        "settings.xml documentProtection / 水印 shape",
        "解除保护、删除水印",
        [
          ...(m.hasProtection ? [{ location: "settings.xml", text: "存在文档保护", rule: "protection", basis: "" }] : []),
          ...(m.hasWatermark ? [{ location: "document/header", text: "疑似水印", rule: "watermark", basis: "" }] : []),
        ],
      ),
    )
    items.push(
      mkItem(
        "L5-B11",
        "元数据痕迹",
        "自定义 XML / 数据源绑定",
        "medium",
        "customXml/ 或 w:dataBinding",
        "移除自定义 XML 部件与数据绑定",
        m.hasCustomXml ? [{ location: "customXml/", text: "存在自定义 XML 部件", rule: "customxml", basis: "" }] : [],
      ),
    )
    items.push(
      mkItem(
        "L5-B9",
        "元数据痕迹",
        "图片 EXIF（人工抽检）",
        "info",
        `内嵌图片 ${m.imageCount} 张，EXIF/XMP 未逐项解析`,
        m.imageCount > 0 ? "对含截图/照片的图片抽检 Artist/Copyright/设备信息" : "无内嵌图片",
        m.imageCount > 0 ? [{ location: "word/media", text: `共 ${m.imageCount} 张图片，建议抽检 EXIF`, rule: "exif", basis: "" }] : [],
      ),
    )
  }
  // B13 PDF 元数据（pdf 输入）：列出非空 Info 字段供人工确认（B1-B3 已先拦 creator/company/title）
  if (ctx.inputKind === "file" && /\.pdf$/i.test(ctx.sourceName)) {
    const known = new Set(["Author", "ModDate", "Title", "Subject", "Keywords", "Creator"])
    const pdfLeaks = Object.entries(ctx.meta.pdfMetadata)
      .filter(([k, v]) => v && !known.has(k))
      .map(([k, v]) => ({ location: `PDF Info.${k}`, text: clip(v), rule: "pdf_meta", basis: "PDF 元数据字段，确认是否含可识别信息" }))
    items.push(
      mkItem("L5-B13", "元数据痕迹", "PDF 其它元数据残留", "medium", "PDF 文档信息（Producer/PDFX 等，B1-B3 已单列）", "用无痕工具清除 PDF 元数据后再交", pdfLeaks),
    )
  }

  // ============ C 类 · 格式合规（读暗标配置标准；未配置不瞎判） ============
  const fs = cfg.formatStandard
  items.push(fs.bodyFont ? compareFont(fs.bodyFont, m) : unconfigured("L5-C1", "格式合规", "正文字体合规", "high", "C1 暗标要求字体（招标文件条款）", "请在暗标配置填入招标文件要求的字体后自动判定"))
  if (fs.maxPages != null) {
    const over = m.pageEstimate > fs.maxPages
    items.push(
      mkItem("L5-C9", "格式合规", "页数超限", "critical", `C9 暗标页数上限=${fs.maxPages}，估算=${m.pageEstimate}（字数粗估，需人工核）`, "压缩至上限内", over ? [{ location: "全文", text: `估算 ${m.pageEstimate} 页 > 上限 ${fs.maxPages} 页`, rule: "max_pages", basis: "" }] : []),
    )
  } else {
    items.push(unconfigured("L5-C9", "格式合规", "页数超限", "high", "C9 页数上限（招标文件条款）", "请在暗标配置填入页数上限"))
  }
  if (fs.allowColor === false) {
    const colored = checkColor(ctx)
    items.push(mkItem("L5-C7", "格式合规", "禁止彩色（要求全黑白）", "high", "C7 暗标要求全黑白", "图片/文字改黑白（由人工处理）", colored))
  } else if (fs.allowColor === null) {
    items.push(unconfigured("L5-C7", "格式合规", "颜色限制", "medium", "C7 是否要求全黑白（招标文件条款）", "请在暗标配置声明颜色要求"))
  }
  if (fs.allowPageNumber === false) {
    items.push(mkItem("L5-C6", "格式合规", "禁止页码", "medium", "C6 暗标要求不得编页码", "按裸页码口径核对（当前仅提示）", m.hasPageNumber ? [{ location: "页脚/域", text: "检测到页码域/页码设置", rule: "pagenum", basis: "" }] : []))
  }

  // C10 编号形式：暗标常见「不得使用项目符号，须用 1. 2. 3. 数字编号」
  // （格式镖师 §8.5/§11 把「项目符号 → 数字编号」列为一等修复项；本项只判定、只标不改）
  if (fs.allowBulletNumbering === false) {
    if (!m.available) {
      items.push(skipped("L5-C10", "格式合规", "编号形式（禁用项目符号）", "high", "C10 需读 word/numbering.xml，非 .docx 包无法判定", "上传 .docx 文件后自动检查"))
    } else {
      const dist = m.numberingFormats.length
        ? m.numberingFormats.map((f) => `${formatLabel(f.format)}×${f.count}处`).join("、")
        : "无自动编号"
      const hits: CheckHit[] = m.bulletParagraphs
        ? [{ location: "document.xml", text: `项目符号段落 ${m.bulletParagraphs} 处（本文档自动编号段落共 ${m.numberedParagraphs} 处）`, rule: "bullet_numbering", basis: "" }]
        : []
      items.push(
        mkItem("L5-C10", "格式合规", "编号形式（禁用项目符号）", "high", `C10 暗标要求用数字编号；自动编号形式分布：${dist}`, "改回 1. 2. 3. 数字编号（由人工在 Word 处理）", hits),
      )
    }
  } else if (fs.allowBulletNumbering === null) {
    items.push(unconfigured("L5-C10", "格式合规", "编号形式（是否禁用项目符号）", "medium", "C10 招标文件对编号形式的规定（招标文件条款）", "请在暗标配置声明编号形式要求"))
  }

  // ============ E 类 · 文件与交付形态 ============
  const nameLeaks = [...cfg.identityWords, ...cfg.brandProductWords].filter((w) => w && ctx.sourceName.includes(w))
  items.push(
    mkItem("L5-E1", "文件形态", "文件名含公司/项目标识", "high", "E1 文件名 = " + ctx.sourceName, "重命名为不含身份信息的文件名", nameLeaks.map((w) => ({ location: "文件名", text: w, rule: "filename", basis: "" }))),
  )
  if (fs.requireSeparateBooklet === null) {
    items.push(unconfigured("L5-E2", "文件形态", "是否需单独成册/单独 PDF", "critical", "E2 暗标是否单独成册（招标文件条款）", "请在暗标配置声明交付形态"))
  }

  // ============ F 类 · 语义（v1 仅确定性正则） ============
  items.push(
    mkItem(
      "L5-F1",
      "语义自指",
      "第一人称（我司/本公司/我方）",
      "critical",
      "F1 暗标中第一人称本身即高风险表述（正则，非语义判定）",
      "改为不指向特定投标人的中性表述（人工判断）",
      regexHitsOnText(ctx.fullText, buildTermRe(cfg.firstPersonTerms), "正文", "first_person", "F1 第一人称"),
    ),
  )
  items.push(
    mkItem(
      "L5-F3",
      "语义自指",
      "荣誉 / 资质自述",
      "high",
      "F3 「本公司荣获」「我司拥有 XX 资质」等自述",
      "删除可识别主体的荣誉/资质自述",
      regexHitsOnText(ctx.fullText, buildTermRe(cfg.honorPhrases), "正文", "honor", "F3 荣誉自述"),
    ),
  )

  return items
}

// ---- 小工具 -------------------------------------------------------------

function buildTermRe(terms: string[]): RegExp {
  const esc = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (!esc.length) return /(?!)/ // 永不匹配
  return new RegExp(esc.join("|"), "g")
}

function wordHitsTextOnly(text: string, location: string, words: string[]): CheckHit[] {
  const hit = words.find((w) => w && text.includes(w))
  return hit ? [{ location, text: clip(text), rule: "meta_word", basis: `元数据命中身份词「${hit}」` }] : []
}

function checkColor(ctx: DocContext): CheckHit[] {
  // 彩色判定依赖渲染层；此处以「存在内嵌图片」作弱提示，诚实标注需人工核。
  if (ctx.meta.imageCount > 0) {
    return [{ location: "word/media", text: `含 ${ctx.meta.imageCount} 张图片，彩色与否需人工抽检`, rule: "color_hint", basis: "C7 全黑白要求" }]
  }
  return []
}

function compareFont(stdFont: string, meta: DocContext["meta"]): CheckItem {
  // 优先用「生效字体」分布（R45，继承链解析）：run 自身不写字体时也能拿到真实字体，
  // 且别名归一（宋体 ↔ SimSun 不再互判为不同字体）；解析不到时回退 fontsUsed 旧口径。
  const eff = meta.fontsEffective ?? []
  if (eff.length) {
    const dist = eff.map((u) => `${u.font}×${u.count}处`).join("、")
    const basis =
      `C1 暗标要求字体「${stdFont}」；生效字体分布：${dist}` +
      (meta.fontsUnresolvedRuns ? `；另有 ${meta.fontsUnresolvedRuns} 处含中文 run 未能解析到字体` : "")
    const off = eff.filter((u) => !isSameFont(u.font, stdFont))
    if (!off.length && !meta.fontsUnresolvedRuns) {
      return mkItem("L5-C1", "格式合规", "正文字体合规", "critical", basis, "字体与要求一致，无需处理", [])
    }
    if (!off.length) {
      // 分布与要求一致，但有段落取不到字体：既不判 pass 也不判废标，降级 warn 交人工核对
      // （medium + 有命中 → mkItem 判 warn；无命中会被判 pass，故这里必须给一条命中）
      const undetermined: CheckHit[] = [{
        location: "正文",
        text: `${meta.fontsUnresolvedRuns} 处含中文 run 未能解析到字体`,
        rule: "font",
        basis: "",
      }]
      return mkItem("L5-C1", "格式合规", "正文字体合规", "medium", basis, `请人工核对未能解析到字体的段落是否确为「${stdFont}」`, undetermined)
    }
    const hits: CheckHit[] = off.map((u) => ({
      location: "正文",
      text: `非要求字体「${u.font}」×${u.count} 处，例：${u.sample}`,
      rule: "font",
      basis: "",
    }))
    return mkItem("L5-C1", "格式合规", "正文字体合规", "critical", basis, `统一为「${stdFont}」（由人工在 Word 处理）`, hits)
  }
  // 回退（无 styles.xml / 无 rFonts 数据，如手工拼接的 XML）：仅罗列 run 自身声明的东亚字体
  const used = meta.fontsUsed
  if (!used.length) return unconfigured("L5-C1", "格式合规", "正文字体合规", "high", `C1 要求字体「${stdFont}」，但未解析到字体信息`, "确认文件为 docx 且含字体定义")
  const off = used.filter((f) => !isSameFont(f, stdFont))
  return mkItem("L5-C1", "格式合规", "正文字体合规", "critical", `C1 暗标要求字体「${stdFont}」，实际出现：${used.join("、")}`, "统一为要求字体（由人工在 Word 处理）", off.length ? [{ location: "document.xml", text: `非要求字体：${off.join("、")}`, rule: "font", basis: "" }] : [])
}

function dedupe(hits: CheckHit[]): CheckHit[] {
  const seen = new Set<string>()
  const out: CheckHit[] = []
  for (const h of hits) {
    const k = `${h.location}#${h.text}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(h)
  }
  return out
}
