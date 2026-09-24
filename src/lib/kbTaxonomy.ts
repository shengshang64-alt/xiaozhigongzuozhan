// 知识库「赛道 × 用途桶」分类法（第一期·组装层赋能）：
// 集中定义赛道(track)与用途桶(bucket)的词表与派生函数，供三处共用，避免口径漂移：
//   1) scripts/backfill-kb-taxonomy.mjs —— 回填 kb_docs.kb_track / kb_bucket
//   2) src/lib/kbAssemble.ts —— 调用时按场景赛道/桶对检索结果软加权
//   3) 入库脚本（.md 白捡补库等）—— 入库即打标签
// 规则对齐 .diag/kb_scan.cjs 与 scripts/extract-solutions.mjs，纯函数、可单测。

// ---------------------------------------------------------------------------
// 赛道（13 档 + 通用兜底）：医疗售前核心赛道，词表尽量召回、由打分选最佳命中
// ---------------------------------------------------------------------------

export const KB_TRACKS = [
  "电子病历评级",
  "互联互通评级",
  "医共体建设",
  "DRG-DIP医保",
  "信创改造",
  "数据安全",
  "智慧医院",
  "中医医院",
  "运营管理HRP",
  "互联网医院",
  "集成平台",
  "移动医疗",
  "HIS系统",
] as const

export type KbTrack = (typeof KB_TRACKS)[number] | "通用"

const TRACK_RULES: [KbTrack, RegExp][] = [
  ["电子病历评级", /电子病历.{0,8}(评级|过级|升级|分级|五[级6]|六[级7]|七[级8])|病历评级|分级评价|EMR[4567]/i],
  ["互联互通评级", /互联互通|标准化成熟度|信息互联互通|四甲|集成平台.{0,4}测评/],
  ["医共体建设", /医共体|医联体|县域.{0,4}(医疗|卫生|影像|心电)|紧密型|区域.{0,3}(医疗|卫生)中心|分级诊疗/],
  ["DRG-DIP医保", /DRG|DIP|医保支付|医保结算|病种分值|医保基金|飞行检查|支付方式/],
  ["信创改造", /信创|国产化|自主可控|麒麟|统信|达梦|人大金仓|鲲鹏|海光/],
  ["数据安全", /等级保护|等保[二三四]级|数据安全|密码改造|国密|灾备|容灾|数据脱敏|防勒索|网络安全|态势感知|隐私/],
  ["中医医院", /中医|中药|辨证|治未病|中医药|中西医结合/],
  ["运营管理HRP", /HRP|绩效|国考|成本核算|运营管理|经济核算/],
  ["互联网医院", /互联网医院|互联网诊疗|在线问诊|远程医疗|远程会诊|掌上医院/],
  ["集成平台", /集成平台|信息集成|\bESB\b|\bHL7\b|数据中心|\bCDR\b|\bODR\b|数据治理|数据中台|健康大脑|全民健康/],
  ["移动医疗", /移动医疗|移动护理|移动医生|床旁|移动医保/],
  ["智慧医院", /智慧医院|智慧服务|智慧管理|智慧医疗|全流程|一院多区|一院两区/],
  ["HIS系统", /\bHIS\b|医院信息系统|门诊住院|收费结算|电子病历系统|一体化.{0,4}(管理|系统)/],
]

/** 从文本派生赛道：正则命中数最多者胜出，全 0 回退「通用」 */
export function deriveTrack(text: string): KbTrack {
  const hay = text ?? ""
  let best: KbTrack = "通用"
  let bestHits = 0
  for (const [track, re] of TRACK_RULES) {
    const hits = (hay.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || []).length
    if (hits > bestHits) {
      bestHits = hits
      best = track
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// 用途桶（9 档 + 其他兜底）：素材在业务流水线中的用途
// ---------------------------------------------------------------------------

export const KB_BUCKETS = [
  "标书弹药",
  "PPT演示",
  "方案素材",
  "政策法规标准",
  "竞品情报",
  "产品资料",
  "客户与项目",
  "行业洞察",
  "公司内部",
] as const

export type KbBucket = (typeof KB_BUCKETS)[number] | "其他"

// 顺序即优先级（对齐 .diag/kb_scan.cjs BUCKETS）：先命中的桶胜出
const BUCKET_RULES: [KbBucket, RegExp][] = [
  ["竞品情报", /竞品|竞对|友商|对手|攻防|话术|东软|卫宁|创业慧康|东华|曼荼罗|鼎新|和仁|易联众|麦迪思/],
  ["标书弹药", /标书|投标|招标|技术偏离|应答|响应文件|评标|开标|可研/],
  ["PPT演示", /PPT|演示|述标|宣传|彩页/],
  ["方案素材", /方案|规划|顶层设计|整体提升/],
  ["政策法规标准", /政策|法规|标准|规范|指南|办法|通知|意见|测评方案|评审标准/],
  ["产品资料", /产品|白皮书|功能清单|架构|接口|操作手册|说明书|技术文档/],
  ["客户与项目", /客户|画像|商机|拜访|台账|项目|合同|验收|复盘|评级清单/],
  ["行业洞察", /行业|趋势|洞察|标杆|案例/],
  ["公司内部", /制度|流程|考核|培训|报销|印章|人事|行政|报价体系/],
]

// 友商/竞品目录硬规则：路径含这些段一律归「竞品情报」，
// 修正现状「友商公司产品」下 150 篇因文件名含「响应/应答」被误判为标书弹药的错桶。
const COMPETITOR_DIR_RE = /友商公司产品|[\\/]竞品|竞对|攻防话术/

/** 从「路径 + 文件名」派生用途桶；竞品目录强制归「竞品情报」 */
export function deriveBucket(pathName: string): KbBucket {
  const hay = pathName ?? ""
  if (COMPETITOR_DIR_RE.test(hay)) return "竞品情报"
  for (const [bucket, re] of BUCKET_RULES) {
    if (re.test(hay)) return bucket
  }
  return "其他"
}

/** 供入库/回填统一调用：给定检索语料的组合文本 + 路径，产出 track/bucket */
export function deriveTaxonomy(input: {
  /** 参与赛道判定的文本（title + keywords + 正文开头等） */
  trackText: string
  /** 参与桶判定的路径/文件名 */
  pathName: string
}): { track: KbTrack; bucket: KbBucket } {
  return { track: deriveTrack(input.trackText), bucket: deriveBucket(input.pathName) }
}

export const isKbTrack = (v: unknown): v is KbTrack =>
  typeof v === "string" && (KB_TRACKS as readonly string[]).includes(v)

export const isKbBucket = (v: unknown): v is KbBucket =>
  typeof v === "string" && (KB_BUCKETS as readonly string[]).includes(v)
