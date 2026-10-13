// ---------------------------------------------------------------------------
// 标书交付门禁（Bid Delivery Gate）· 机器可判定 · 只读 · 零 AI 费用
//
// 目的：回答「这份标书能不能发给客户」，而不是「代码能不能编译」。
//   既有的验证门禁是 tsc / vite build / vitest / eslint —— 它们证明【程序是好的】，
//   但证明不了【交付物是干净的】。本脚本补上这一层。
//
// 为什么必须只读 sqlite 而不能走 REST：
//   bid_chapters 正文体量大（实测 91.7 万字），逐条走 /api/collections 需 superuser 且慢；
//   node:sqlite 只读打开可拿到最原始的事实，脚本不该持有管理凭据。
//   node:sqlite 需 --experimental-sqlite，脚本自检并自动带 flag 重启自身。
//
// 判定分级（对应 docs/17 红线与 docs/18 零折扣标准）：
//   BLOCKER（致命·必须清零才能交付）
//     - 承诺数值空缺：如「应在【待填写】分钟内响应」——实质性参数未填，直接废标风险
//     - 前置承诺句空缺：应/须/必须/承诺 + 空缺
//     - 未替换模板变量：{{var}}
//     - done 章节正文过短（空章/截断）
//     - gen_status=failed 的章节
//   WARN（警告·须人工确认后方可交付）
//     - 材料清单类空缺：证明材料/人员名单/品牌型号——本就该人工附，但必须显式列出
//     - 编号类占位：项目编号含 XXX
//     - 其他无法自动分类的空缺
//
// 退出码：0=无 BLOCKER；1=存在 BLOCKER（可直接作为门禁用）；2=脚本自身故障
//
// 用法：
//   node scripts/bid-delivery-gate.mjs                     # 全量体检
//   node scripts/bid-delivery-gate.mjs --project 三明       # 只查名称含「三明」的项目
//   node scripts/bid-delivery-gate.mjs --json              # 只输出 JSON（供程序消费）
//   node scripts/bid-delivery-gate.mjs --no-write          # 不落盘报告
// ---------------------------------------------------------------------------
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

// ============================ 常量与配置 ============================

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, "..")
const DB_PATH = path.join(PROJECT_ROOT, "pocketbase", "pb_data", "data.db")
const OUT_DIR = path.join(PROJECT_ROOT, "_eval")

/** 自举重启防死循环标记（与 eval-fixtures.mjs 同一约定，各自独立命名空间） */
const RESPAWN_ENV = "BID_GATE_RESPAWNED"

/** done 章节的正文最小字数阈值；低于此值视为空章/截断（标书单章通常数千字） */
const MIN_DONE_CHARS = 500

/**
 * 占位符模式表。
 * fatal=true  → 命中即为 BLOCKER
 * fatal=false → 命中记为 WARN（须人工判定）
 * 顺序即优先级：先判致命，再判警告。
 */
const PLACEHOLDER_RULES = [
  {
    id: "promise-empty-value",
    label: "承诺数值空缺",
    fatal: true,
    re: /【待填写】\s*(?:个)?(工作日|日历天|日历日|分钟|小时|课时|天|元|万元|%|％|台|套|人|次|年|月|倍|个|项|GB|TB|万)/,
    why: "实质性参数未填（如响应时效），投标即废标风险",
  },
  {
    id: "promise-sentence",
    label: "前置承诺句空缺",
    fatal: true,
    re: /(应|须|必须|承诺(?!函)|保证|确保|不低于|不超过|不少于|至少|达到)[^。；\n]{0,25}【待填写】/,
    why: "承诺句未闭环，评标时视为未响应",
  },
  {
    id: "template-var",
    label: "未替换模板变量",
    fatal: true,
    re: /\{\{\s*[A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5]{1,24}\s*\}\}/,
    why: "模板变量未渲染，暴露制作痕迹",
  },
  {
    id: "todo-marker",
    label: "待办标记",
    fatal: true,
    re: /[[【(（]\s*(TODO|TBD|FIXME|待补|待补充|待完善|待定|占位)\s*[\]】)）]/i,
    why: "未完成的编辑残留",
  },
  {
    id: "material-list",
    label: "材料清单类空缺",
    fatal: false,
    re: /(证明|证书|资质|执照|复印件|授权函|承诺函|业绩|合同|名单|清单|型号)[^。；\n]{0,20}【待填写】|【待填写】[^。；\n]{0,12}(证明|证书|复印件|材料|名单)/,
    why: "本就应由人工附证明材料，但交付前必须逐项确认已附",
  },
  {
    id: "code-placeholder",
    label: "编号类占位",
    fatal: false,
    re: /[\[【]?[0-9A-Za-z\u4e00-\u9fa5]{0,12}[X×]{2,}[0-9A-Za-z\u4e00-\u9fa5]{0,8}[\]】]?\s*号/,
    why: "项目/文件编号未填真实值（部分项目编号确由采购人后补，须人工确认）",
  },
  {
    id: "bare-pending",
    label: "其他待填写",
    fatal: false,
    re: /【待填写】/,
    why: "未能自动归类，须人工逐条判定",
  },
  {
    id: "underscore-blank",
    label: "下划线空栏",
    fatal: false,
    re: /[_＿]{5,}/,
    why: "签字/盖章/日期等空栏（纸质件可手填，电子件需确认导出后仍可填）",
  },
]

/**
 * 归责分流（R288 起改为模式表 OWNER_PATTERNS）：同一个【待填写】由不同的人负责，验收动作完全不同。
 *   不分类的后果（实测）：205 处空缺混在一起，商务决策项淹没在材料项里，
 *   交付前无法回答「还有几项要等我拍板」「还有几项要附材料」。
 * 判据表与界面「交付前必办清单」（src/pages/BidWorkspace/deliveryActionList.ts）逐字同源，
 * 由 deliveryActionList.test.ts 的漂移守卫守住，两侧数字必须一致。
 */
/** 标书正文占位符字面量（与 src/pages/BidWorkspace/bidTypes.ts 同源） */
const BASIS_PLACEHOLDER = "【待填写】"
/** 无编号依据的「编号」列填充（与 bidTypes.BASIS_NO_CODE_TABLE_TOKEN 同源） */
const BASIS_NO_CODE_TOKEN = "／"
/** 标准编号特征：名称里已含编号却仍留空 → 属真漏填，规整时必须保留占位暴露问题 */
const BASIS_CODE_RE =
  /((?:GB|WS|GM|YD|HJ|QX)(?:\/[TZ])?[\s]*\d+(?:\.\d+)*(?:[-—]\d{4})?|HL7\s*v?[\dx.]+|FHIR\s*R\d|DICOM(?:\s*[\d.]+)?|IHE(?:\s*TF)?)/i

/** 正则元字符转义（仅用于拼接固定常量，防未来常量混入元字符导致静默失配） */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 归责标签与办结口径（**与 src/pages/BidWorkspace/deliveryActionList.ts 的
 * DELIVERY_OWNER_LABEL / DELIVERY_OWNER_ACTION 逐字同源**）。
 */
const OWNER_LABEL = {
  "biz-decision": "① 商务决策（须拍板）",
  "material-attach": "② 人工附材料（须附原件）",
  "system-refetch": "③ 系统可回取（须查为何没填）",
  unclassified: "④ 待人工判定",
}

const OWNER_ACTION = {
  "biz-decision": "由商务/投标负责人拍板具体承诺值与收费口径，AI 不得代填（代填=承诺风险）",
  "material-attach": "由投标文件制作者附真实材料或补录（证书/截图/名单/记录表），系统无法生成",
  "system-refetch": "招标原文或项目字段里已有该事实，正文却留空——须回查注入链路为何失效",
  unclassified: "未能自动归责，须逐条人工确认责任方",
}

/**
 * 归责模式表：**顺序即优先级**（①→③→②），全部命中不上才落 ④。
 * ① 先判——承诺值/价格是评标打分项，漏一项直接丢分，不允许被材料类关键词抢走。
 * ③ 次判——「系统该填没填」属链路缺陷，判据窗口最窄（10 字）故先跑：既防误报，
 *   也避免「项目编号【待填写】及佐证材料」这类真链路缺陷被放宽后的 ② 抢走（R288 实测纠偏）。
 * ② 后判——人工附材料/补录，词表较宽（前置窗口 40 字，跨小半句仍属同一责任方）。
 *
 * 本表与 src/pages/BidWorkspace/deliveryActionList.ts#DELIVERY_OWNER_PATTERNS 逐字同源，
 * 由 src/pages/BidWorkspace/deliveryActionList.test.ts 的漂移守卫逐条比对模式原文——
 * 界面「交付前必办清单」与本门禁报告必须给出同一份归责数字。
 * R288 扩充依据 2026-10-13 实测「④ 待人工判定 41 处致命 / 117 处警告」的逐条人工核对结论
 * （r283-gate-owner-rules-overbroad）：承诺数值/收费类归 ①，记录/台账/模板/名单/材料/填写指令类归 ②，
 * 招标原文与采购文件已规定的（编号/依据/份数）归 ③，其余诚实留 ④ 交人工。
 */
const OWNER_PATTERNS = [
  { owner: "biz-decision", re: /(质保|保修|免费服务|承诺延长|延长)[^。；\n]{0,20}【待填写】|【待填写】\s*年[^。；\n]{0,10}(质保|保修|免费)|优惠|折扣|让利[^。；\n]{0,15}【待填写】/, why: "质保/延长/优惠类承诺须商务拍板" },
  { owner: "biz-decision", re: /【待填写】\s*(?:个)?(工作日|日历天|日历日|分钟|小时|课时|天|元|万元|%|％|台|套|人|次|年|月|倍|个|项|GB|TB|万)/, why: "承诺数值空缺（时限/人数/金额/数量）" },
  { owner: "biz-decision", re: /(费用|人工费|维护费|报价|单价|价格|收费|计费)[^。；\n]{0,15}【待填写】/, why: "收费与价格口径须商务拍板" },
  { owner: "biz-decision", re: /(承诺(?!函)|保证|确保)[^。；\n]{0,15}【待填写】/, why: "承诺句里的数值/期限须商务拍板" },
  { owner: "system-refetch", re: /(项目依据|编制依据|依据文件|项目编号|招标编号|采购编号|项目名称|采购人|预算金额|最高限价)[^。；\n]{0,10}【待填写】|【待填写】[^。；\n]{0,10}(项目依据|依据文件|项目编号|招标编号|采购编号)/, why: "招标原文/项目字段已有该事实" },
  { owner: "system-refetch", re: /(份数|正本|副本)[^。；\n]{0,10}【待填写】|【待填写】[^。；\n]{0,10}(份数)/, why: "装订份数由采购文件规定，可回取" },
  { owner: "material-attach", re: /【待填写】[^。；\n]{0,12}(证明|证书|资质|复印件|授权函|承诺函|截图|白皮书|检测报告|彩页|名单|社保|型号|清单)|(证明|证书|资质|复印件|授权函|截图|白皮书|检测报告|彩页|名单|社保|型号)[^。；\n]{0,20}【待填写】/, why: "证明材料类，人工附原件" },
  { owner: "material-attach", re: /(佐证材料|证明材料|申报材料|记录单|记录表|实施记录|盘点记录|值守记录|台账|模板|人员信息|对应关系|排班表|留存策略|业绩案例|案例)[^。；\n]{0,40}【待填写】/, why: "记录/台账/模板类，人工补录或附件" },
  { owner: "material-attach", re: /【待填写】[^。；\n]{0,12}(佐证材料|证明材料|记录|台账|模板|名单|业绩|案例|附件)/, why: "材料/记录类占位" },
  { owner: "material-attach", re: /【待填写】[^。；\n]{0,16}(按实补充|人工补充|按实填写|占位处理|人工填写)/, why: "正文自述由投标人按实补录" },
  { owner: "material-attach", re: /【[^】]{0,20}(?:此处插入|插入)[^】]{0,20}】/, why: "插图/附证占位，人工补件" },
  { owner: "material-attach", re: /[（(]\s*(?:请)?填写[^）)]{0,14}[）)]/, why: "正文残留填写指令，人工补录" },
]

const UNCLASSIFIED_WHY = "未能自动归责，须逐条人工确认责任方"

/**
 * 项目级事实缺陷的规则直判：这两类命中本身就在说「源数据里已有该事实却未回取」，
 * 无需再过关键词表（此前落到 ④ 待判定，等于把链路缺陷混进人工待办里）。
 */
const FACT_SYSTEM_REFETCH_RULES = new Set(["tender-no-missing", "basis-refetch-failed"])

const USAGE = [
  "用法：node scripts/bid-delivery-gate.mjs [选项]",
  "  --project <关键词>  只体检 project_name/hospital 含该关键词的项目",
  "  --json              仅输出 JSON（不打印人读摘要）",
  "  --no-write          不落盘报告文件",
  "  --min-chars <n>     done 章节最短字数阈值（默认 500）",
  "  --help              显示本帮助",
].join("\n")

// ============================ 参数解析 ============================

/**
 * 解析 CLI 参数；未识别的参数直接抛错退出，避免「静默接受错参数」造成假通过。
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{project: string|null, json: boolean, write: boolean, minChars: number}}
 */
function parseArgs(argv) {
  const out = { project: null, json: false, write: true, minChars: MIN_DONE_CHARS }

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === "--project") {
      const v = argv[i + 1]
      if (!v) throw new Error("--project 缺少参数值")
      out.project = v
      i += 1
    } else if (a === "--json") {
      out.json = true
    } else if (a === "--no-write") {
      out.write = false
    } else if (a === "--min-chars") {
      const v = Number(argv[i + 1])
      if (!Number.isFinite(v) || v < 0) throw new Error(`--min-chars 需为非负数字，收到：${argv[i + 1]}`)
      out.minChars = Math.floor(v)
      i += 1
    } else if (a === "--help" || a === "-h") {
      console.log(USAGE)
      process.exit(0)
    } else {
      throw new Error(`未识别参数：${a}\n${USAGE}`)
    }
  }
  return out
}

// ============================ 数据库读取 ============================

/**
 * 取 node:sqlite 的 DatabaseSync；未启用时带 --experimental-sqlite 重启自身。
 * 让调用方（Qoder 轮次 / 定时任务）无需记住 flag。
 * @returns {any} DatabaseSync 构造器
 */
function loadSqlite() {
  if (typeof process.getBuiltinModule === "function") {
    try {
      const mod = process.getBuiltinModule("node:sqlite")
      if (mod && mod.DatabaseSync) return mod.DatabaseSync
    } catch (_) {
      /* 落到重启逻辑 */
    }
  }

  if (process.execArgv.includes("--experimental-sqlite")) {
    throw new Error("已带 --experimental-sqlite 仍无法加载 node:sqlite：请确认 Node ≥ 22.5（本机托管 22.22.2 可用）")
  }
  if (process.env[RESPAWN_ENV] === "1") {
    throw new Error("重启后仍无法加载 node:sqlite，已放弃（避免死循环）")
  }

  try {
    const out = execFileSync(
      process.execPath,
      ["--experimental-sqlite", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, [RESPAWN_ENV]: "1" } },
    )
    process.stdout.write(out)
    process.exit(0)
  } catch (e) {
    throw new Error(`自动注入 --experimental-sqlite 失败：${e.message}`)
  }
}

/**
 * 只读打开 PocketBase 数据库。文件不存在时抛错而非静默返回空（避免「0 项目 = 通过」的假绿）。
 * @returns {any} DatabaseSync 实例
 */
function openDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`数据库不存在：${DB_PATH}（请确认 PocketBase 已初始化）`)
  const DatabaseSync = loadSqlite()
  return new DatabaseSync(DB_PATH, { readOnly: true })
}

// ============================ 章节解析 ============================

/**
 * 把 bid_chapters 字段（结构在历史上出现过两种形态）归一为扁平数组。
 * @param {unknown} raw JSON.parse 后的值，可能是 {chapters:[...]} 或 [...]
 * @returns {Array<{title:string, genStatus:string, content:string, path:string}>}
 */
function flattenChapters(raw) {
  let nodes = []
  if (Array.isArray(raw)) nodes = raw
  else if (raw && typeof raw === "object" && Array.isArray(raw.chapters)) nodes = raw.chapters

  const out = []
  /** 深度优先展开；depth 参与 path 构造，用于报告里定位层级 */
  const walk = (list, prefix) => {
    if (!Array.isArray(list)) return
    list.forEach((n, idx) => {
      if (!n || typeof n !== "object") return // 脏数据直接跳过，不臆测
      const title = typeof n.title === "string" ? n.title : ""
      const here = prefix ? `${prefix} > ${title}` : title
      out.push({
        title,
        genStatus: typeof n.gen_status === "string" ? n.gen_status : "",
        content: typeof n.content === "string" ? n.content : "",
        path: here || `(未命名#${idx + 1})`,
      })
      walk(n.children, here)
    })
  }
  walk(nodes, "")
  return out
}

/**
 * 解析 bid_chapters 原始字符串；解析失败不算作门禁失败（记 parseError 由调用方披露）。
 * @param {unknown} raw
 * @returns {{chapters: ReturnType<typeof flattenChapters>, parseError: string|null}}
 */
function parseChapters(raw) {
  if (raw === null || raw === undefined || raw === "") return { chapters: [], parseError: null }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    return { chapters: flattenChapters(parsed), parseError: null }
  } catch (e) {
    return { chapters: [], parseError: `bid_chapters JSON 解析失败：${e.message}` }
  }
}

// ============================ 单章检查 ============================

/**
 * 检查单个章节正文，返回命中的占位项与结构性问题。
 * @param {{title:string, genStatus:string, content:string, path:string}} ch
 * @param {number} minChars
 * @returns {{blockers: Array<object>, warnings: Array<object>}}
 */
function checkChapter(ch, minChars) {
  const blockers = []
  const warnings = []
  const c = ch.content

  // 结构性问题 1：标记失败却留在项目里
  if (ch.genStatus === "failed") {
    blockers.push({
      rule: "gen-failed",
      label: "章节生成失败",
      path: ch.path,
      snippet: "",
      why: "gen_status=failed，该章无可用正文",
    })
  }

  // 结构性问题 2：标记完成但正文为空/过短（截断或空章）
  if (ch.genStatus === "done" && c.length < minChars) {
    blockers.push({
      rule: "done-but-short",
      label: "已完成但正文过短",
      path: ch.path,
      snippet: `实际 ${c.length} 字 < 阈值 ${minChars}`,
      why: "疑似空章或导出截断",
    })
  }

  // 正文为空的章节无论状态如何都要有交代（空正文章节不可交付）
  if (c.length === 0 && ch.genStatus !== "done" && ch.genStatus !== "failed") {
    warnings.push({
      rule: "empty-pending",
      label: "待生成且无正文",
      path: ch.path,
      snippet: "",
      why: "尚未生成，交付前须补全或从目录中移除",
    })
  }

  // 占位符逐规则匹配（同一处命中多条时按致命优先去重：记录已覆盖的偏移区间）
  const covered = []
  for (const rule of PLACEHOLDER_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`)
    for (const m of c.matchAll(re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      // 致命项优先：若该区间已被致命规则覆盖，警告规则不再重复计
      if (covered.some(([s, e]) => start < e && end > s)) continue
      covered.push([start, end])

      const from = Math.max(0, start - 40)
      const to = Math.min(c.length, end + 30)
      const item = {
        rule: rule.id,
        label: rule.label,
        path: ch.path,
        snippet: c.slice(from, to).replace(/\s+/g, " ").trim(),
        why: rule.why,
      }
      if (rule.fatal) blockers.push(item)
      else warnings.push(item)
    }
  }

  return { blockers, warnings }
}

/**
 * 为单条占位项归责（判据表 OWNER_PATTERNS 与界面清单同源）。
 * 优先级：① 规则直判（项目级事实缺陷=③ 系统可回取）→ ② 模式表顺序命中 → ③ 兜底 ④ 待人工判定，
 * 绝不返回空导致统计漏项。
 * @param {{snippet:string, rule?:string, owner?:string}} item
 * @returns {{owner:string, ownerLabel:string, action:string, why:string}}
 */
function classifyOwner(item) {
  if (item.owner) return item
  if (item.rule && FACT_SYSTEM_REFETCH_RULES.has(item.rule)) {
    return {
      owner: "system-refetch",
      ownerLabel: OWNER_LABEL["system-refetch"],
      action: OWNER_ACTION["system-refetch"],
      why: "事实缺陷规则直判（源数据已有该事实）",
    }
  }
  const text = item.snippet || ""
  for (const p of OWNER_PATTERNS) {
    if (p.re.test(text)) {
      return { owner: p.owner, ownerLabel: OWNER_LABEL[p.owner], action: OWNER_ACTION[p.owner], why: p.why }
    }
  }
  return { owner: "unclassified", ownerLabel: OWNER_LABEL.unclassified, action: OWNER_ACTION.unclassified, why: UNCLASSIFIED_WHY }
}


/**
 * 依据表「编号」列的无编号占位规整 —— **与 src/pages/BidWorkspace/bidTypes.ts#normalizeBasisPlaceholders 同源**。
 *
 * 为什么要在这里做一遍：导出链路（bidFiles.ts exportBidDocx*）出件前会对正文调用该规整，
 * 把「无编号依据」的编号列占位 `【待填写】` 换成 `／`。门禁若拿**未规整的库内原文**判定，
 * 就会把「导出后本就不存在」的占位报成致命 —— 判据与交付物不一致，BLOCKER 数字虚高。
 * 因此在判定前先对齐口径。两处实现需同步修改；任一侧调整判据，另一侧必须跟进。
 *
 * 三道判据（同时成立才替换）：① 占位符后紧跟「短词 + 依据类后缀」的类型词且以条目分隔/行尾收束；
 * ② 占位符之前有名称文本；③ 名称文本不含标准编号特征（含则属真漏填，保留占位暴露问题）。
 * @param {string} content 章节正文
 * @returns {string} 规整后正文（无命中时原样返回，幂等）
 */
function normalizeBasisPlaceholders(content) {
  const src = content || ""
  if (!src || !src.includes(BASIS_PLACEHOLDER)) return src
  const re = new RegExp(
    `([^；;。\\n]{1,120}?)(\\s*)${escapeRe(BASIS_PLACEHOLDER)}(\\s*)([\\u4e00-\\u9fa5A-Za-z]{1,16}?(?:依据|标准|规范|文件|法规|导则|指南|准则|规则))(?=[；;。\\n]|$|\\s+\\d)`,
    "g",
  )
  return src.replace(re, (whole, name, preGap, postGap, typeWord) => {
    if (BASIS_CODE_RE.test(name)) return whole
    return `${name}${preGap}${BASIS_NO_CODE_TOKEN}${postGap}${typeWord}`
  })
}

/**
 * 项目级事实一致性硬检查（与逐字比对不同的另一类硬缺陷）。
 * 判据只认「源数据里已有该事实」——没有源就不判，避免制造假警报。
 * @param {string} name 项目名（用于报错定位）
 * @param {string} tenderNo 库中 tender_no 字段
 * @param {string} tenderText 招标原文
 * @param {string} body 该项目已生成正文
 * @returns {Array<object>} 致命项数组
 */
function checkProjectFacts(name, tenderNo, tenderText, body) {
  const out = []
  if (!body || body.length < 500) return out // 无正文不判事实一致性

  // 事实缺陷 1：库里有项目编号，正文却一次都没出现（同源的另一项目注入了 → 注入链路不稳定）
  const no = String(tenderNo || "").trim()
  // 源数据本身含占位（如 [350000]SMZC[GK]2026-XX）不算缺陷：那是忠实传递
  if (no && !/[X×]{2,}/.test(no) && !body.includes(no)) {
    out.push({
      rule: "tender-no-missing",
      label: "项目编号未注入正文",
      path: `${name}（全文）`,
      snippet: `库中 tender_no=${no}，但已生成正文中 0 次出现`,
      why: "同源另一项目的正文里注入了编号，此项目没有 → 注入链路不稳定，须核查",
    })
  }

  // 事实缺陷 2：招标原文明确写了依据文件全名，正文却以【待填写】留空
  const basisInTender = /初步设计与概算|可行性研究报告|项目建议书|编制依据/.test(tenderText || "")
  const basisBlankInBody = /(项目依据|依据文件|编制依据)[^。；\n]{0,30}【待填写】|【待填写】[^。；\n]{0,20}项目依据/.test(body)
  if (basisInTender && basisBlankInBody) {
    out.push({
      rule: "basis-refetch-failed",
      label: "项目依据可回取却留空",
      path: `${name}（全文）`,
      snippet: "招标原文含依据文件全名，正文对应位置仍为【待填写】",
      why: "事实存在于招标原文，属系统未回取（非人工缺料），须修注入/提示词",
    })
  }

  return out
}

// ============================ 主流程 ============================

/** 简单时间戳（本地时区，用于报告文件名） */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/**
 * 体检全部（或指定）标书项目。
 * @param {{project:string|null, minChars:number}} opts
 * @returns {{generatedAt:string, minChars:number, projects:Array<object>, totals:object, notCovered:string[]}}
 */
function runGate(opts) {
  const db = openDb()
  let rows
  try {
    rows = db
      .prepare(
        "select id, project_name, hospital, stage, tender_no, tender_text, bid_chapters " +
          "from bid_projects order by created desc",
      )
      .all()
  } finally {
    // 只读连接也要释放，避免 Windows 下文件句柄悬挂
    try {
      db.close()
    } catch (_) {
      /* 关闭失败不影响结果 */
    }
  }

  const keyword = opts.project
  const projects = []
  const totals = {
    projects: 0,
    chapters: 0,
    done: 0,
    failed: 0,
    pending: 0,
    chars: 0,
    blockers: 0,
    warnings: 0,
    owners: {}, // ownerId → {label, action, blockers, warnings}
  }
  const notCovered = []

  for (const r of rows) {
    const name = String(r.project_name || "") || String(r.hospital || "") || "(未命名)"
    if (keyword && !name.includes(keyword) && !String(r.hospital || "").includes(keyword)) continue

    const { chapters, parseError } = parseChapters(r.bid_chapters)
    // 判据与交付物对齐：导出链路（bidFiles.ts exportBidDocx*）出件前会规整依据表「编号」列的无编号占位，
    // 判定前先做同一规整，否则会把「导出后本就不存在」的占位报成致命，使 BLOCKER 数字虚高。
    for (const c of chapters) c.content = normalizeBasisPlaceholders(c.content || "")
    if (parseError) notCovered.push(`${name}：${parseError}`)

    const project = {
      id: String(r.id),
      name,
      hospital: String(r.hospital || ""),
      stage: String(r.stage || ""),
      chapters: chapters.length,
      done: 0,
      failed: 0,
      pending: 0,
      chars: 0,
      blockers: [],
      warnings: [],
    }

    // 正文汇总：供项目级事实一致性检查（编号注入 / 依据回取）使用
    const bodyParts = []

    for (const ch of chapters) {
      const { blockers, warnings } = checkChapter(ch, opts.minChars)
      project.blockers.push(...blockers)
      project.warnings.push(...warnings)

      if (ch.genStatus === "done") project.done += 1
      else if (ch.genStatus === "failed") project.failed += 1
      else project.pending += 1
      project.chars += ch.content.length
      bodyParts.push(ch.content)
    }

    // 项目级事实缺陷（源数据里已有该事实却未回取）——与逐字比对互补的另一类硬缺陷
    project.blockers.push(...checkProjectFacts(name, r.tender_no, r.tender_text, bodyParts.join("\n")))

    // 所有命中项统一归责，供「交付前必办清单」按责任方汇总
    for (const item of [...project.blockers, ...project.warnings]) {
      Object.assign(item, classifyOwner(item))
    }

    // 无章节的项目不算「通过」，显式披露为未覆盖项而非静默跳过
    if (project.chapters === 0) notCovered.push(`${name}：无章节数据（bid_chapters 为空），未纳入判定`)

    projects.push(project)
    totals.projects += 1
    totals.chapters += project.chapters
    totals.done += project.done
    totals.failed += project.failed
    totals.pending += project.pending
    totals.chars += project.chars
    totals.blockers += project.blockers.length
    totals.warnings += project.warnings.length

    // 归责汇总：区分「要拍板的」「要附材料的」「系统该填没填的」
    for (const item of project.blockers) {
      const k = item.owner || "unclassified"
      totals.owners[k] = totals.owners[k] || { label: item.ownerLabel || k, action: item.action || "", blockers: 0, warnings: 0 }
      totals.owners[k].blockers += 1
    }
    for (const item of project.warnings) {
      const k = item.owner || "unclassified"
      totals.owners[k] = totals.owners[k] || { label: item.ownerLabel || k, action: item.action || "", blockers: 0, warnings: 0 }
      totals.owners[k].warnings += 1
    }
  }

  // 明确声明本门禁不覆盖的范围（诚实原则，避免读者误以为「全过=可交付」）
  notCovered.push("本门禁不校验：① 内容与招标原文的逐字一致性（须跑 L2 比对）② 评分办法覆盖度 ③ 导出 .docx 的真实可用性 ④ 金额大小写一致性")

  return { generatedAt: new Date().toISOString(), minChars: opts.minChars, projects, totals, notCovered }
}

/** 渲染人读 Markdown 报告 */
function renderMarkdown(result) {
  const { projects, totals, notCovered, minChars } = result
  const L = []
  L.push(`# 标书交付门禁体检报告 · ${stamp()}`)
  L.push("")
  L.push(`> 只读体检，零 AI 费用。判定标准见 docs/18；done 章节最短字数阈值 = ${minChars}`)
  L.push("")
  L.push("## 一、总览")
  L.push("")
  L.push("| 指标 | 数值 |")
  L.push("|---|---|")
  L.push(`| 体检项目数 | ${totals.projects} |`)
  L.push(`| 章节总数 | ${totals.chapters}（done ${totals.done} / failed ${totals.failed} / 待生成 ${totals.pending}）|`)
  L.push(`| 已生成正文字数 | ${totals.chars.toLocaleString()} |`)
  L.push(`| **BLOCKER（致命，必须清零）** | **${totals.blockers}** |`)
  L.push(`| WARN（警告，须人工确认） | ${totals.warnings} |`)
  L.push("")
  L.push(`**判定：${totals.blockers === 0 ? "✅ 无致命项" : `❌ 存在 ${totals.blockers} 项致命空缺，不可交付`}**`)
  L.push("")

  // 交付前必办清单：同一个【待填写】由不同人负责，这是把「205 处空缺」变成可执行动作的关键
  L.push("## 二、交付前必办清单（按责任方）")
  L.push("")
  L.push("| 责任方 | 致命 | 警告 | 验收动作 |")
  L.push("|---|---:|---:|---|")
  for (const [, v] of Object.entries(totals.owners)) {
    L.push(`| ${v.label} | ${v.blockers} | ${v.warnings} | ${v.action} |`)
  }
  L.push("")

  L.push("## 三、分项目明细")
  L.push("")
  L.push("| 项目 | 章节 | done | failed | 待生成 | 正文字数 | BLOCKER | WARN |")
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|")
  for (const p of projects) {
    L.push(
      `| ${p.name.slice(0, 26)} | ${p.chapters} | ${p.done} | ${p.failed} | ${p.pending} | ${p.chars.toLocaleString()} | ${p.blockers.length} | ${p.warnings.length} |`,
    )
  }
  L.push("")

  // 致命项按项目逐条列出（含原文摘录，便于人工定位）
  const withBlocker = projects.filter((p) => p.blockers.length > 0)
  if (withBlocker.length > 0) {
    L.push("## 四、致命项清单（按项目）")
    L.push("")
    for (const p of withBlocker) {
      L.push(`### ${p.name}（${p.blockers.length} 项）`)
      L.push("")
      L.push("| 规则 | 章节 | 原文摘录 | 风险 |")
      L.push("|---|---|---|---|")
      for (const b of p.blockers.slice(0, 40)) {
        const snip = b.snippet.replace(/\|/g, "\\|").slice(0, 70)
        L.push(`| ${b.label} | ${b.path.slice(-28).replace(/\|/g, "\\|")} | …${snip}… | ${b.why} |`)
      }
      if (p.blockers.length > 40) L.push(`| … | 另有 ${p.blockers.length - 40} 项 | | |`)
      L.push("")
    }
  }

  const withWarn = projects.filter((p) => p.warnings.length > 0)
  if (withWarn.length > 0) {
    L.push("## 五、警告项汇总（须人工确认）")
    L.push("")
    L.push("| 项目 | 规则 | 数量 | 示例 |")
    L.push("|---|---|---:|---|")
    for (const p of withWarn) {
      const byRule = new Map()
      for (const w of p.warnings) byRule.set(w.label, (byRule.get(w.label) || 0) + 1)
      for (const [label, cnt] of byRule) {
        const sample = p.warnings.find((w) => w.label === label)
        L.push(
          `| ${p.name.slice(0, 20)} | ${label} | ${cnt} | …${(sample?.snippet || "").replace(/\|/g, "\\|").slice(0, 50)}… |`,
        )
      }
    }
    L.push("")
  }

  L.push("## 六、本门禁【未覆盖】范围（诚实声明）")
  L.push("")
  for (const n of notCovered) L.push(`- ${n}`)
  L.push("")
  return L.join("\n")
}

/** 入口：解析参数 → 体检 → 输出/落盘 → 以退出码表达判定 */
function main() {
  const opts = parseArgs(process.argv.slice(2))
  const result = runGate(opts)

  if (opts.write) {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const ts = stamp()
    fs.writeFileSync(path.join(OUT_DIR, `交付门禁-${ts}.md`), renderMarkdown(result), "utf8")
    fs.writeFileSync(path.join(OUT_DIR, `delivery-gate-${ts}.json`), JSON.stringify(result, null, 2), "utf8")
  }

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    const t = result.totals
    console.log(`体检项目 ${t.projects} 个 / 章节 ${t.chapters} / 正文 ${t.chars.toLocaleString()} 字`)
    console.log(`BLOCKER ${t.blockers} / WARN ${t.warnings}`)
    for (const [, v] of Object.entries(t.owners || {})) {
      console.log(`  ${v.label}  致命 ${v.blockers} / 警告 ${v.warnings}`)
    }
    for (const p of result.projects) {
      const flag = p.blockers.length > 0 ? "❌" : "✅"
      console.log(`  ${flag} ${p.name.slice(0, 30)}  done=${p.done} failed=${p.failed} blocker=${p.blockers.length}`)
    }
    if (opts.write) console.log(`\n报告已写入 _eval/交付门禁-${stamp()}.md`)
  }

  process.exit(result.totals.blockers === 0 ? 0 : 1)
}

// 顶层捕获：任何未预期异常都以退出码 2 暴露，绝不静默通过
try {
  main()
} catch (e) {
  console.error(`[bid-delivery-gate] 执行失败：${e.message}`)
  process.exit(2)
}
