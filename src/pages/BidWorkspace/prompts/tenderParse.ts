// ---------------------------------------------------------------------------
// R69 提示词搬迁第五批，自 bidTypes.ts 原样搬迁：只搬不改字（快照锁字见 promptsSnapshot.test.ts）
// ---------------------------------------------------------------------------

import { MAX_TENDER_CHARS, clipText, parseSectionDef, requestedKeys, truthPreamble } from "../bidTypes"
import type { ParseConfig } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"

export const PROMPT_VERSION = 1

export function buildTenderParseMessages(tenderText: string, cfg: ParseConfig, onlyKeys?: string[]): LlmMessage[] {
  const keys = onlyKeys && onlyKeys.length ? onlyKeys : requestedKeys(cfg)
  const specLines = keys
    .map((k) => {
      const d = parseSectionDef(k)
      return `- "${k}"（${d?.title ?? k}）：${d?.guide ?? ""}`
    })
    .join("\n")
  const system = [
    "你是一位深耕医疗信息化行业招投标十余年的资深标书专家，长期为医院 HIS、EMR、LIS、PACS、集成平台、数据中心、互联网医院等项目做投标决策与标书评审，熟悉《政府采购法》《招标投标法》及各地公共资源交易中心的评标规则。",
    truthPreamble("parse"),
    "当前任务：从招标文件全文中提取结构化要点，供投标团队快速决策与编制投标文件。",
    `本次只输出以下解析项（未列出的项一律不要输出）：\n${specLines}`,
    "提取铁律：以招标文件原文为准，禁止编造；某项内容找不到时省略对应行；每项内容为纯文本多行，行内不使用 markdown 符号；",
    "要点化铁律（2026-09-16 用户要求只提重点）：每项内容必须是【要点清单】——一行一条要点，每条直接给出硬指标或结论（金额/限价/工期/天数/份数/比例/资质证照名称/标准等级/系统名称/人员数量），形如「预算金额：3500 万元」「免费质保期：验收合格起 5 年」「核心系统上线：开工通知后 30 日历天内」；",
    "禁止整段抄原文、禁止复述章节标题、禁止「本项目旨在…」式铺垫句；描述性内容（背景/技术特点/实施范围）压缩为「主题词：核心短语」式要点（如「一体化管理：两院系统兼容、数据统一」「信创适配：国产服务器/操作系统/数据库」）；单条要点 ≤60 字，每项 ≤25 条，宁缺毋滥；",
    "出处回指（合并稿 §三铁律 2 的解析侧落地）：每条要点能在原文定位出处时，行末以简短括号标注来源，形如（出处：第三章3.2）或（出处：P17）；出处标注不计入 60 字要点上限、本身不超过 12 字；无法确定出处时不标注，禁止臆造出处；",
    "分块解析铁律：分段解析时，非首段只输出本段新出现的关键字段；已在首段或标题中可确定的字段禁止重复输出；本段找不到的字段直接省略对应行，禁止输出「未明确/未提及」类说明行（缺失汇总由系统统一生成）；",
    "输出严格 JSON，键为上述解析项 key，值为多行纯文本（换行用 \\n），禁止解释文字、禁止 markdown 代码围栏，格式示例：",
    `{${keys.map((k) => `"${k}": "……"`).join(", ")}}`,
  ].join("\n")
  const user = `【招标文件全文】\n${clipText(tenderText, MAX_TENDER_CHARS)}`
  // 第十六轮 A：多消息缓存序——全文稳定块独立成第一条 user，解析项任务差异置后
  return [
    { role: "system", content: system },
    { role: "user", content: user },
    { role: "user", content: "请按上述解析项提取并输出 JSON。" },
  ]
}

/**
 * 2026-09-23 用户反馈轮（评分办法解析不到）：本地定位招标文件中的评分办法相关章节，零 AI 调用。
 * 背景：逐项分段解析时每段只看 ~14k 窗口，评分表跨段断裂/窗口内无完整表是「评分解析不到」主因；
 * 用标题同义词（评标办法/评分办法/评分标准/评审细则/技术评分表/商务评分表/附件…）扫描标题行，
 * 命中后取到下一个章/件级标题为止；多处命中（正文+前附表/附件）合并，单块 ≤30000 字、总 ≤40000 字。
 * R48b 修「评分办法假阴性解析不到」：①跳过目录页码行（如「第四章 评标方法和标准（综合评分法)\t32」）
 * 不作锚点——否则它白占块槽位；②块上限 4→8——评分章内「评审标准/评分标准」等小标题会把章切成多块，
 * 旧上限被目录stub+前附表叙述+章首块用完，真正的逐条分值表块（多在章后半）永远轮不到，AI 便回「缺失」。
 * 返回空串 = 本地未定位到（调用方回退全文分段解析，行为同现状）。
 */
export function extractScoringSectionExcerpt(text: string): string {
  const src = (text ?? "").trim()
  if (!src) return ""
  const lines = src.split(/\r?\n/)
  // 标题行：可带「第X章/部分/篇」「附件X」「一、」「2.3」前缀 + 评分类关键词，行短且不含句读（排除正文叙述句）
  const headingRe =
    /^\s*(?:第\s*[0-9一二三四五六七八九十百]+\s*(?:章|部分|篇)[\s、.．]*)?(?:附\s*件\s*[0-9一二三四五六七八九十甲乙丙丁]*[\s、.．:：]*)?(?:[0-9]+(?:\.[0-9]+)*\s*)?(?:评标办法|评标方法|评标方案|评分办法|计分办法|评审办法|评审因素|评审要素|评分标准|评标标准|评审标准|评分细则|评标细则|详细评审|综合评分|技术评分|商务评分|价格评分|打分表|评分表|评分见附件)/
  const isHeadingLine = (line: string) => headingRe.test(line) && line.length <= 60 && !/[。；;]/.test(line)
  // R48b：目录页码行（行尾「\t数字」或「 数字」= 页码）不是正文标题，跳过不作锚点，避免白占块槽位
  const isTocEntry = (line: string) => /[\t ]\d{1,4}\s*$/.test(line)
  // 块终止行：下一个章/件/部分级标题（不用「一、二、」中文序号作边界——评分办法内部小节常用该格式，误切会把评分表本身切掉；也不用小数编号）
  const isChapterBoundary = (line: string) =>
    /^\s*(?:第\s*[0-9一二三四五六七八九十百]+\s*(?:章|部分|篇)|附\s*件\s*[0-9一二三四五六七八九十]+\s*[、.．:：]?\s*\S{0,40}$)/.test(line)
  const blocks: string[] = []
  let i = 0
  while (i < lines.length && blocks.length < 8) {
    if (!isHeadingLine(lines[i].trim()) || isTocEntry(lines[i])) {
      i += 1
      continue
    }
    const buf: string[] = []
    let chars = 0
    let j = i
    for (; j < lines.length; j++) {
      if (j > i && (isChapterBoundary(lines[j]) || isHeadingLine(lines[j].trim()))) break
      chars += lines[j].length + 1
      if (chars > 30000) break
      buf.push(lines[j])
    }
    const block = buf.join("\n").trim()
    // 与已收块重叠（前缀命中）则跳过，避免同一评分表重复入块
    const normAll = blocks.join("\n").replace(/\s+/g, "")
    if (block.length >= 20 && !normAll.includes(block.replace(/\s+/g, "").slice(0, 60))) blocks.push(block)
    i = j > i ? j : i + 1
  }
  if (!blocks.length) return ""
  let out = ""
  for (const b of blocks) {
    if (out.length + b.length + 2 > 40000) break
    out += `${out ? "\n\n" : ""}${b}`
  }
  return out
}
