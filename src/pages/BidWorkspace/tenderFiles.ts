// ---------------------------------------------------------------------------
// 招标文件「多份文件 + 角色路由」（用户需求 2026-10-21）
//
// 背景：真实招标包常常是多份文件——招标正文一份、技术需求/规格书作为单独附件一份、
// 评分办法或评分细则可能再一份。改造前上传区只认单份且是「后传覆盖先传」
// （TenderStep 只取 files[0]，handleTenderFile 直接 setTenderDraft(text)），
// 用户只能自己把几份文件拼进一个输入框。
//
// 本模块只做纯逻辑，不依赖 React / 后端 / DOM，便于脱离渲染单测：
//   ① 合并：每份文件前插一行来源标记「〖附件1｜技术附件｜技术需求书.docx〗」，
//      合并后的文本仍然是 `tender_text` 这一个字段——下游 113 处消费点零改动。
//   ② 拆分：任何时刻都能按标记把合并文本切回「文件块」，块内正文原样保留
//      （用户在右侧文本框里的手工修订不会因为调序/删文件而丢）。
//   ③ 路由：解析时按解析项挑相关角色的文件，技术附件只进技术类项，
//      评分办法只进评分类项，避免「每项都把全文重读一遍」的线性费用。
//
// 兼容铁律：没有 tender_files（存量项目）或所有文件都是「招标正文」时，
// parseTextForItem 必须原样返回传入文本——行为与改造前完全一致。
// ---------------------------------------------------------------------------

/** 文件角色：决定这份文件会被哪些解析项读到 */
export type TenderFileRole = "main" | "tech" | "scoring" | "commercial" | "drawing" | "other"

export type TenderFileMeta = {
  name: string
  role: TenderFileRole
  /** 该份文件的正文字数（不含来源标记），用于清单展示 */
  chars: number
}

/** 合并文本切出来的块：tracked=由标记框住的文件块；untracked=标记之外（粘贴或手工补充）的正文 */
export type TenderBlock = {
  role: TenderFileRole
  name: string
  text: string
  tracked: boolean
  /** 来源标记里的序号；untracked 块为 null */
  seq: number | null
}

export const TENDER_FILE_ROLE_LABELS: Record<TenderFileRole, string> = {
  main: "招标正文",
  tech: "技术附件",
  scoring: "评分办法",
  commercial: "商务/资格",
  drawing: "清单/图纸",
  other: "其他",
}

/** 角色 → 会被哪些解析项读到（给上传区做说明文案，与 allowedRolesForParseKey 同源） */
export const TENDER_FILE_ROLE_HINTS: Record<TenderFileRole, string> = {
  main: "默认角色，所有解析项都会读",
  tech: "只进交货和服务要求、采购清单、编制依据等技术类项",
  scoring: "只进技术评分、商务评分、评标要求、废标项等评分类项",
  commercial: "只进资格性审查、符合性检查、合同条款、响应文件要求等商务类项",
  drawing: "只进采购清单、交货和服务要求等技术类项",
  other: "保守处理：所有解析项都会读（不确定用途时选这个）",
}

export const TENDER_FILE_ROLES: TenderFileRole[] = ["main", "tech", "scoring", "commercial", "drawing", "other"]

export function isTenderFileRole(value: unknown): value is TenderFileRole {
  return typeof value === "string" && (TENDER_FILE_ROLES as string[]).includes(value)
}

const ROLE_BY_LABEL = new Map<string, TenderFileRole>(
  TENDER_FILE_ROLES.map((role) => [TENDER_FILE_ROLE_LABELS[role], role] as [string, TenderFileRole]),
)

/** 来源标记：〖附件1｜技术附件｜技术需求书.docx〗  —— 用〖〗与全角竖线，正常公文正文几乎不会出现 */
export const TENDER_FILE_MARKER_RE = /^〖附件(\d+)｜([^｜\n]*)｜([^〗\n]*)〗$/

/** 文件名里的分隔符会破坏标记结构，落进标记前先替换掉 */
function markerSafeName(name: string): string {
  return String(name ?? "").replace(/[｜〗\n]/g, " ").replace(/\s+/g, " ").trim()
}

export function tenderFileMarker(seq: number, meta: Pick<TenderFileMeta, "name" | "role">): string {
  return `〖附件${seq}｜${TENDER_FILE_ROLE_LABELS[meta.role]}｜${markerSafeName(meta.name)}〗`
}

/** 标记行里出现未知角色名（用户手改过标记）时按「其他」处理——其他角色在所有解析项里都会读到，不会漏内容 */
function roleFromLabel(label: string): TenderFileRole {
  return ROLE_BY_LABEL.get(label.trim()) ?? "other"
}

/**
 * 把合并文本切成块。无标记时返回单个 untracked 块（= 改造前的单段文本）。
 * 块内首尾空白会被裁掉，保证「切→拼→切」幂等。
 */
export function splitTenderText(text: string): TenderBlock[] {
  const blocks: TenderBlock[] = [{ role: "main", name: "", text: "", tracked: false, seq: null }]
  const lines = String(text ?? "").split(/\r?\n/)
  for (const line of lines) {
    const marker = line.trim().match(TENDER_FILE_MARKER_RE)
    if (marker) {
      blocks.push({
        role: roleFromLabel(marker[2]),
        name: marker[3].trim(),
        text: "",
        tracked: true,
        seq: Number(marker[1]),
      })
      continue
    }
    const cur = blocks[blocks.length - 1]
    cur.text = cur.text ? `${cur.text}\n${line}` : line
  }
  return blocks
    .map((b) => ({ ...b, text: b.text.trim() }))
    .filter((b) => b.tracked || b.text.length > 0)
}

/**
 * 拼回合并文本。renumber=true 用于「清单变更后重建」（按当前顺序重排名），
 * false 用于解析路由（保留原序号，模型侧看到的附件号与界面清单一致）。
 */
export function composeTenderText(blocks: TenderBlock[], opts?: { renumber?: boolean }): string {
  const parts: string[] = []
  let running = 0
  for (const block of blocks) {
    if (!block.text.trim()) continue
    if (!block.tracked) {
      parts.push(block.text.trim())
      continue
    }
    running += 1
    const seq = opts?.renumber ? running : block.seq ?? running
    parts.push(`${tenderFileMarker(seq, block)}\n${block.text.trim()}`)
  }
  return parts.join("\n\n")
}

/** 从文件块推导清单（清单永远与合并文本同源，避免「清单说 3 份、文本里只有 2 份」的漂移）。
 *  prev 仅用于保持清单条目的既有顺序语义，实际取值一律以文本里的块为准。 */
function filesFromBlocks(blocks: TenderBlock[]): TenderFileMeta[] {
  return blocks
    .filter((b) => b.tracked)
    .map((b) => ({ name: b.name, role: b.role, chars: b.text.length }))
}

/** 存量项目 / 脏数据的容错：只要 name+role 合法就保留，chars 缺失按 0 计 */
export function normalizeTenderFiles(raw: unknown): TenderFileMeta[] {
  if (!Array.isArray(raw)) return []
  const out: TenderFileMeta[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const rec = item as Record<string, unknown>
    const name = typeof rec.name === "string" ? rec.name.trim() : ""
    if (!name) continue
    const role = isTenderFileRole(rec.role) ? rec.role : "main"
    const charsRaw = Number(rec.chars)
    out.push({ name, role, chars: Number.isFinite(charsRaw) && charsRaw > 0 ? Math.round(charsRaw) : 0 })
  }
  return out
}

/** 是否需要按文件角色路由：全部是「招标正文」时等价于改造前的单文件行为 */
export function hasTenderRoleRouting(files: TenderFileMeta[] | null | undefined): boolean {
  return !!files?.length && files.some((f) => f.role !== "main")
}

/**
 * 解析项 → 允许读哪些角色。main/other 恒选（保守兜底，宁可贵一点也不能漏项）；
 * 返回 null = 不做路由（未知解析项、本地产出项），按全文读。
 */
export function allowedRolesForParseKey(key: string): TenderFileRole[] | null {
  const extra = PARSE_ROLE_ROUTING[key]
  if (!extra) return null
  return ["main", "other", ...extra]
}

/**
 * 解析项角色路由表（只列 main/other 之外的角色）。
 * 口径：法律/格式/资格类条款几乎都在正文与商务附件；技术参数在技术附件与清单；
 * 评分办法单独成册时只在评分类项里读，避免每个解析项都重读一遍评分册。
 */
const PARSE_ROLE_ROUTING: Record<string, TenderFileRole[]> = {
  overview: [],
  tech_score: ["scoring"],
  project_info: [],
  purchaser_info: [],
  delivery_req: ["tech", "drawing"],
  response_req: ["commercial"],
  biz_score: ["scoring", "commercial"],
  bid_outline_req: ["commercial"],
  purchase_list: ["tech", "drawing"],
  agency_info: [],
  bid_nodes: [],
  bid_deposit: ["commercial"],
  qualification: ["commercial"],
  compliance: ["commercial", "scoring"],
  bid_open_req: [],
  eval_req: ["scoring"],
  void_items: ["commercial", "scoring"],
  contract_terms: ["commercial"],
  compilation_basis: ["tech", "drawing"],
  lots: ["commercial"],
}

/**
 * 解析某项时实际喂给模型的文本。
 * ① 无清单 / 全是招标正文 → 原样返回（存量项目行为完全不变）
 * ② 文本里没有任何来源标记 → 原样返回（标记被删干净时也不猜，宁可全读）
 * ③ 路由结果为空 → 回退全文
 */
export function parseTextForItem(
  text: string,
  files: TenderFileMeta[] | null | undefined,
  key: string,
): string {
  if (!hasTenderRoleRouting(files)) return text
  const allowed = allowedRolesForParseKey(key)
  if (!allowed) return text
  const blocks = splitTenderText(text)
  if (!blocks.some((b) => b.tracked)) return text
  const picked = blocks.filter((b) => !b.tracked || allowed.includes(b.role))
  const routed = composeTenderText(picked, { renumber: false }).trim()
  return routed || text
}

/**
 * 按文件名推断角色（只是省一次下拉选择，用户随时可改）。
 * 顺序有意为之：「商务评分办法」要先命中 scoring，不能先被「商务」吃掉。
 */
export function inferTenderFileRole(name: string): TenderFileRole {
  const n = String(name ?? "").toLowerCase()
  if (/(评分|评标|评审|打分|scoring|score)/.test(n)) return "scoring"
  if (/(技术|需求书|需求规格|规格书|参数|指标|技术要求)/.test(n)) return "tech"
  if (/(清单|图纸|工程量|报价表|设备表|货物表|明细)/.test(n)) return "drawing"
  if (/(合同|商务|资格|资质|格式|条款|须知)/.test(n)) return "commercial"
  return "main"
}

export type TenderFileAddition = { name: string; role: TenderFileRole; text: string }

/** 追加一份文件；同名视为「新版覆盖旧版」，就地替换，不产生重复块 */
export function appendTenderFile(
  currentText: string,
  addition: TenderFileAddition,
): { text: string; files: TenderFileMeta[]; replaced: boolean } {
  const blocks = splitTenderText(currentText)
  const name = markerSafeName(addition.name) || "未命名文件"
  const idx = blocks.findIndex((b) => b.tracked && b.name === name)
  let replaced = false
  if (idx >= 0) {
    blocks[idx] = { ...blocks[idx], role: addition.role, text: addition.text.trim() }
    replaced = true
  } else {
    blocks.push({ role: addition.role, name, text: addition.text.trim(), tracked: true, seq: null })
  }
  return {
    text: composeTenderText(blocks, { renumber: true }),
    files: filesFromBlocks(blocks),
    replaced,
  }
}

/** 按清单下标删除一份文件块（块之外的粘贴正文保持原位） */
export function removeTenderFile(
  currentText: string,
  index: number,
): { text: string; files: TenderFileMeta[] } {
  const blocks = splitTenderText(currentText)
  const trackedPositions = blocks.reduce<number[]>((acc, b, i) => (b.tracked ? [...acc, i] : acc), [])
  const pos = trackedPositions[index]
  if (pos === undefined) return { text: currentText, files: filesFromBlocks(blocks) }
  const next = blocks.filter((_, i) => i !== pos)
  return {
    text: composeTenderText(next, { renumber: true }),
    files: filesFromBlocks(next),
  }
}

/** 上下移动一份文件块（只调整文件块之间的次序，untracked 正文不参与排序） */
export function moveTenderFile(
  currentText: string,
  index: number,
  direction: -1 | 1,
): { text: string; files: TenderFileMeta[] } {
  const blocks = splitTenderText(currentText)
  const trackedPositions = blocks.reduce<number[]>((acc, b, i) => (b.tracked ? [...acc, i] : acc), [])
  const from = trackedPositions[index]
  const to = trackedPositions[index + direction]
  if (from === undefined || to === undefined) return { text: currentText, files: filesFromBlocks(blocks) }
  const next = [...blocks]
  const tmp = next[from]
  next[from] = next[to]
  next[to] = tmp
  return {
    text: composeTenderText(next, { renumber: true }),
    files: filesFromBlocks(next),
  }
}

/** 改角色：只改标记行里的角色名（块内正文一字不动） */
export function setTenderFileRole(
  currentText: string,
  index: number,
  role: TenderFileRole,
): { text: string; files: TenderFileMeta[] } {
  const blocks = splitTenderText(currentText)
  const trackedPositions = blocks.reduce<number[]>((acc, b, i) => (b.tracked ? [...acc, i] : acc), [])
  const pos = trackedPositions[index]
  if (pos === undefined) return { text: currentText, files: filesFromBlocks(blocks) }
  const next = [...blocks]
  next[pos] = { ...next[pos], role }
  return {
    text: composeTenderText(next, { renumber: true }),
    files: filesFromBlocks(next),
  }
}

/** 清单与合并文本的结构是否一致（只比条数/文件名/角色，不比字数）。
 * 只用来判断「用户是否手工改过来源标记行」——正常打字、块内修订不该触发提示。 */
export function tenderFilesInSync(currentText: string, files: TenderFileMeta[]): boolean {
  const fromBlocks = filesFromBlocks(splitTenderText(currentText))
  if (fromBlocks.length !== files.length) return false
  return fromBlocks.every((f, i) => f.name === files[i].name && f.role === files[i].role)
}
