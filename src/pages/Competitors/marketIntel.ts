// 竞品订单情报数据集：来源《竞品分析重构》静态稿内嵌数据（剑鱼标讯中标订单 2021–2025 +
// 订单分析 PPT 定性档案，2026-09 整理）。订单为对照主线、软著仅作参考。
// 本模块是「市场级」策展数据（随标讯年度更新），与 competitors 集合的用户可编辑档案（DB）
// 按厂商名合并使用；数字与研判文案保持原始口径，待核字段以 null/「待补」如实标注，勿臆造。

import { buildCsv } from "@/lib/csv"

/** 单厂商五年订单事实（金额单位：万元；null=该口径无数据） */
export interface VendorOrder {
  name: string
  legalName: string
  /** 五年中标金额（万元） */
  bid5y: number | null
  /** 2025 中标金额（万元） */
  bid25: number | null
  /** 五年项目数 */
  projects5y: number | null
  /** 五年千万级金额（万元） */
  big5y: number | null
  /** 千万级金额占比 % */
  bigShare: number | null
  /** 500–1000 万金额占比 % */
  midShare: number | null
  /** 2025 千万级项目数 */
  bigCount25: number | null
  /** 2025 千万级金额（万元） */
  bigAmount25: number | null
  /** 客户覆盖（家，约数） */
  customerCoverage: number | null
  /** 三甲医院金额占比 % */
  tertiaryShare: number | null
  /** 医院/区域/医共体金额结构 % */
  hospitalMix: [number, number, number] | null
  /** 专科医院占比（五年）% */
  specialtyShare: number | null
  /** 软著总数（参考位） */
  copyrights: number | null
  crEarliest: string | null
  crLatest: string | null
}

/** 关键评估指标定性档案（据订单分析 PPT 整理，正式版需人工核验） */
export interface VendorProfile {
  history?: string
  positioning?: string
  strategy?: string
  regions?: string
  coverage?: string
  business?: string
  products?: string
  techStrategy?: string
  advantageTrack?: string
  proof?: string
  certifications?: string
  benchmarks?: string
  finance?: string
}

export const SELF_NAME = "智业软件"

export const DATA_CALIBER =
  "数据口径：剑鱼标讯，全医疗行业 100 万元以上政府采购中标项目（含建设、维保、接口及分子公司），2021–2025。" +
  "行业大盘含运营商总集；「15 家核心厂商」为母公司投标口径、不含运营商/第三方总集。软著仅作参考，不作对照主线。"

/** 总览四张大盘卡（2025 年度口径） */
export const MARKET_CARDS = [
  { label: "2025 百万级市场", value: "181.9", unit: "亿", hint: "同比 +30%（+41.45 亿）" },
  { label: "其中运营商", value: "42.2", unit: "亿", hint: "+29%，移动 21.3 亿居首" },
  { label: "15 家核心厂商", value: "53.7", unit: "亿", hint: "2024 见底 50.4 亿后回升" },
  { label: "千万级大单", value: "23.7", unit: "亿", hint: "占 44% · 111 个 · 均价 2,123 万", accent: true },
] as const

/** 行业年度中标趋势（15 家核心厂商口径，亿元；2024 为见底年高亮） */
export const MARKET_TREND = {
  years: ["2021", "2022", "2023", "2024", "2025"],
  values: [76.2, 71.1, 57.1, 50.4, 53.7],
  highlightIndex: 3,
}

/** 2025 订单金额区间结构（金额占比 %） */
export const MARKET_AMOUNT_MIX = [
  { label: "100万以下", value: 13 },
  { label: "100-500万", value: 25 },
  { label: "500-1000万", value: 17 },
  { label: "1000万以上", value: 44 },
]

/** 23 家厂商五年订单数据集（剑鱼标讯 2021–2025；金额万元。联众/森亿/盛博汇主体待核） */
export const VENDOR_ORDERS: VendorOrder[] = [
  { name: "卫宁健康", legalName: "卫宁健康科技集团股份有限公司", bid5y: 587710, bid25: 109682, projects5y: 451, big5y: 62809, bigShare: 55, midShare: 11, bigCount25: 24, bigAmount25: 55138, customerCoverage: 6000, tertiaryShare: 63, hospitalMix: [68, 14, 17], specialtyShare: 36, copyrights: 640, crEarliest: "2005-05-09", crLatest: "2026-08-06" },
  { name: "东软集团", legalName: "东软集团股份有限公司", bid5y: 415510, bid25: 75648, projects5y: 247, big5y: 49766, bigShare: 58, midShare: 15, bigCount25: 15, bigAmount25: 24631, customerCoverage: 4800, tertiaryShare: 68, hospitalMix: [66, 30, 4], specialtyShare: 30, copyrights: 2860, crEarliest: "2001-04-04", crLatest: "2026-09-01" },
  { name: "东华医为", legalName: "东华医为科技有限公司", bid5y: 384012, bid25: 62574, projects5y: 226, big5y: 65572, bigShare: 77, midShare: 9, bigCount25: 15, bigAmount25: 30704, customerCoverage: 2000, tertiaryShare: 78, hospitalMix: [86, 12, 2], specialtyShare: 23, copyrights: 514, crEarliest: "2018-08-02", crLatest: "2026-08-27" },
  { name: "创业慧康", legalName: "创业慧康科技股份有限公司", bid5y: 333609, bid25: 58362, projects5y: 259, big5y: 29273, bigShare: 51, midShare: 18, bigCount25: 17, bigAmount25: 33991, customerCoverage: 7000, tertiaryShare: 43, hospitalMix: [65, 31, 4], specialtyShare: 34, copyrights: 864, crEarliest: "2003-02-10", crLatest: "2026-08-18" },
  { name: "万达信息", legalName: "万达信息股份有限公司", bid5y: 226536, bid25: 15483, projects5y: 181, big5y: 27247, bigShare: 50, midShare: 16, bigCount25: 3, bigAmount25: 5320, customerCoverage: 3000, tertiaryShare: 52, hospitalMix: [54, 46, 0], specialtyShare: 46, copyrights: 1868, crEarliest: "2000-10-17", crLatest: "2026-08-20" },
  { name: "众阳健康", legalName: "众阳健康科技集团有限公司", bid5y: 213975, bid25: 43754, projects5y: 165, big5y: 11204, bigShare: 34, midShare: 13, bigCount25: 8, bigAmount25: 18229, customerCoverage: 2000, tertiaryShare: 9, hospitalMix: [82, 6, 12], specialtyShare: 32, copyrights: 422, crEarliest: "2007-07-12", crLatest: "2026-06-11" },
  { name: "联众医疗", legalName: "杭州联众医疗科技（待核）", bid5y: 161441, bid25: 32390, projects5y: 142, big5y: 6889, bigShare: 33, midShare: 25, bigCount25: 6, bigAmount25: 12672, customerCoverage: 3000, tertiaryShare: 55, hospitalMix: [83, 2, 15], specialtyShare: 43, copyrights: null, crEarliest: null, crLatest: null },
  { name: "嘉和美康", legalName: "嘉和美康（北京）科技股份有限公司", bid5y: 147221, bid25: 19528, projects5y: 146, big5y: 7694, bigShare: 26, midShare: 27, bigCount25: 2, bigAmount25: 4376, customerCoverage: 2000, tertiaryShare: 67, hospitalMix: [92, 8, 0], specialtyShare: 30, copyrights: 880, crEarliest: "2006-04-20", crLatest: "2026-08-26" },
  { name: "和仁科技", legalName: "浙江和仁科技股份有限公司", bid5y: 145656, bid25: 37413, projects5y: 23, big5y: 11990, bigShare: 69, midShare: 20, bigCount25: 7, bigAmount25: 29228, customerCoverage: 1000, tertiaryShare: 85, hospitalMix: [88, 0, 12], specialtyShare: 43, copyrights: 362, crEarliest: "2011-04-28", crLatest: "2026-06-17" },
  { name: "中联信息", legalName: "重庆中联信息产业有限责任公司", bid5y: 124615, bid25: 24826, projects5y: 167, big5y: 0, bigShare: 0, midShare: 36, bigCount25: 1, bigAmount25: 2450, customerCoverage: 2000, tertiaryShare: 22, hospitalMix: [74, 19, 7], specialtyShare: 42, copyrights: 201, crEarliest: "2000-12-15", crLatest: "2026-03-26" },
  { name: "医惠科技", legalName: "医惠科技有限公司", bid5y: 100704, bid25: 2088, projects5y: 88, big5y: 3857, bigShare: 30, midShare: 22, bigCount25: 0, bigAmount25: 0, customerCoverage: 2000, tertiaryShare: 82, hospitalMix: [94, 2, 5], specialtyShare: 43, copyrights: 497, crEarliest: "2010-01-12", crLatest: "2026-04-10" },
  { name: "北大医信", legalName: "北京医信数智科技有限公司", bid5y: 78168, bid25: 5798, projects5y: 41, big5y: 18144, bigShare: 90, midShare: 0, bigCount25: 1, bigAmount25: 4080, customerCoverage: 1000, tertiaryShare: 93, hospitalMix: [99, 1, 0], specialtyShare: 23, copyrights: 328, crEarliest: "2014-04-24", crLatest: "2025-12-30" },
  { name: "森亿", legalName: "森亿智医（待核）", bid5y: 49970, bid25: 2413, projects5y: 29, big5y: 0, bigShare: 0, midShare: 0, bigCount25: 0, bigAmount25: 0, customerCoverage: 500, tertiaryShare: 71, hospitalMix: [93, 7, 0], specialtyShare: 23, copyrights: null, crEarliest: null, crLatest: null },
  { name: "盛博汇", legalName: "盛博汇（待核）", bid5y: 45509, bid25: 5344, projects5y: 16, big5y: 0, bigShare: 0, midShare: 0, bigCount25: 1, bigAmount25: 2618, customerCoverage: 500, tertiaryShare: 48, hospitalMix: [47, 2, 51], specialtyShare: 13, copyrights: null, crEarliest: null, crLatest: null },
  { name: "智业软件", legalName: "智业软件股份有限公司", bid5y: 22468, bid25: null, projects5y: 152, big5y: 4775, bigShare: 21, midShare: 37, bigCount25: null, bigAmount25: null, customerCoverage: 2000, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 340, crEarliest: "2004-03-04", crLatest: "2026-05-28" },
  { name: "久远银海", legalName: "四川久远银海软件股份有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 1316, crEarliest: "2009-10-20", crLatest: "2026-07-31" },
  { name: "易联众", legalName: "易联众信息技术股份有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 521, crEarliest: "2009-09-22", crLatest: "2026-09-03" },
  { name: "荣科科技", legalName: "荣科科技股份有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 452, crEarliest: "2008-07-08", crLatest: "2026-08-26" },
  { name: "麦迪科技", legalName: "苏州麦迪斯顿医疗科技股份有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 338, crEarliest: "2010-03-17", crLatest: "2026-09-03" },
  { name: "科大讯飞医疗", legalName: "讯飞医疗科技股份有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 336, crEarliest: "2016-08-10", crLatest: "2026-08-17" },
  { name: "海泰医疗", legalName: "南京海泰医疗信息系统有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 325, crEarliest: "2009-09-24", crLatest: "2026-08-04" },
  { name: "金蝶医疗", legalName: "金医慧通科技有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 317, crEarliest: "2001-04-03", crLatest: "2026-08-24" },
  { name: "天健科技", legalName: "北京天健源达科技股份有限公司", bid5y: null, bid25: null, projects5y: null, big5y: null, bigShare: null, midShare: null, bigCount25: null, bigAmount25: null, customerCoverage: null, tertiaryShare: null, hospitalMix: null, specialtyShare: null, copyrights: 124, crEarliest: "2005-12-26", crLatest: "2024-06-26" },
]

/** 11 家关键评估指标定性档案（PPT 整理，正式版需人工核验） */
export const VENDOR_PROFILES: Record<string, VendorProfile> = {
  智业软件: { history: "1997 年成立于厦门，深耕医疗信息化近三十年。", positioning: "区域型综合厂商，健康城市＋智慧医院双轮，以高性价比和本地化交付见长。", strategy: "健康城市＋智慧医院双轮驱动，深耕区域、辐射全国。", regions: "福建＋华南（辐射全国），本地服务网密。", coverage: "2000+ 家", business: "智慧医院、智慧健康城市、基层卫生、妇幼保健。", products: "智慧医院六类应用、健康城市八类平台、HIS/EMR/集成平台/CDR/互联网医院/DRG·DIP。", techStrategy: "融合一体＋智能互动。", advantageTrack: "健康城市＋智慧医院＋信创。", proof: "厦门市民健康信息系统被誉为最成功实践蓝本；ONE-LINK 信创方案入选福建典型案例。", certifications: "CS4（优秀级）、DCMM3、ITSS 二级、ISO9001/20000/27000、互联互通四乙（示例，待核验）。", benchmarks: "电子病历、互联互通具体级数待补。", finance: "非上市主体，公开披露有限（待补）。" },
  卫宁健康: { history: "1994 年涉足医疗信息化，2011 年深交所上市（国内医疗信息化首家）。", positioning: "市场绝对龙头，以 AI＋医疗引领，连续多年份额第一。", strategy: "1+X+AI，WiNEX 一体化。", regions: "全国均衡（华东/华南/华北均强），总部上海。", coverage: "6000+ 家（三级医院 400+）", business: "智慧医院、区域卫生、互联网医疗、医保、医疗 AI。", products: "WiNEX 基座、WiNGPT 大模型、HIS/EMR/LIS、Copilot。", techStrategy: "1+X+AI。", advantageTrack: "智慧医院＋区域卫生＋AI。", proof: "市占率约 12.6% 行业第一；WiNGPT 已在 150+ 医院落地。", certifications: "CS4、DCMM3、ITSS 一级、CMMI5、互联互通五乙、电子病历六级、HIMSS7（示例）。", benchmarks: "电子病历六级 5、五级 47；互联互通五乙 2、区域 29；智慧服务三级 14。", finance: "2025 归母净亏 3.74 亿（上年盈利 0.88 亿，同比 -525%）。" },
  东软集团: { history: "1991 年始于东北大学，1996 年成为中国首家上市软件公司。", positioning: "老牌劲旅，综合 IT＋医疗巨头，AI 赋能临床。", strategy: "AI＋数据＋国产化。", regions: "东北＋全国医保系统，覆盖 31 省及海外。", coverage: "4800+ 家（医保服务约 8 亿人）", business: "智慧医院、区域卫生、医保、医疗设备、智慧城市。", products: "RealOne HIS/EMR、医保核心、领智/添翼大模型、望海 HRP。", techStrategy: "AI＋数据＋国产化。", advantageTrack: "医保平台＋医疗设备。", proof: "医保系统市占率第一，服务约 8 亿参保人；CT/MRI 国产龙头。", certifications: "CS5（杰出级）、DCMM4、ITSS 一级、CMMI5、互联互通五乙、电子病历六级、HIMSS7。", benchmarks: "电子病历六级 17、五级 59；五乙 3、区域 18；智慧服务 27。", finance: "2025 预亏 3.0–3.7 亿（上年盈利 0.63 亿）。" },
  东华医为: { history: "前身 1999 年东华软件医疗卫生事业部，2018 年独立公司化。", positioning: "高端医院核心系统厂商，聚焦大型医院升级与信创。", strategy: "数智化＋信创，iMedical HOS / CMOS。", regions: "全国高端医院（百强密集），总部北京。", coverage: "2000+ 家（覆盖 30 省、1000+ 机构，百强占比超 30%）", business: "智慧医院、区域医疗、医保、互联网医疗、养老。", products: "iMedical 系列、iBDP 数智平台、DTS 决策平台。", techStrategy: "数智化＋信创。", advantageTrack: "三甲医院＋DRG/DIP。", proof: "百强医院覆盖深，顶级三甲标杆集中。", certifications: "CS5、ITSS 二级、互联互通四甲、电子病历五级、HIMSS6（示例）。", benchmarks: "电子病历六级 10、五级 50；五乙 1、区域 5；智慧服务 14。", finance: "2025 上半年新增订单（详情待补）。" },
  创业慧康: { history: "1997 年创立于杭州（前身创业软件），2015 年创业板上市。", positioning: "院端＋区域双轮，数据驱动的智慧医疗生态。", strategy: "云＋AI 双轮，慧康云。", regions: "华东＋中西部（公卫基因强），总部杭州。", coverage: "7000+ 家", business: "智慧医院、医共体、医保、医疗 AI、智慧物联。", products: "HI-HIS、慧康云、APGS 医生助手、PACS。", techStrategy: "云＋AI 双轮驱动。", advantageTrack: "公卫＋基层医疗＋云化。", proof: "承建约 3 亿份健康档案，公卫覆盖 370+ 区县；慧康云 3.0 推进 SaaS。", certifications: "CS4、DCMM3、ITSS 二级、互联互通四甲、电子病历五级。", benchmarks: "电子病历六级 7、五级 50；五乙 1、区域 22；智慧服务 7。", finance: "2025 归母净亏 4.02 亿（上年亏 1.74 亿）。" },
  万达信息: { history: "城市数字化与民生信息化龙头，医疗健康为核心板块。", positioning: "城市数字化＋民生，区域卫健强势。", strategy: "平台＋信创全栈。", regions: "长三角与区域卫健，总部上海。", coverage: "3000+ 家（估）", business: "区域卫生、公卫、医保、互联网医院、HIS。", products: "区域卫生、公卫、医保、数据中心平台。", techStrategy: "平台＋信创全栈。", advantageTrack: "区域 / 公卫 / 医保。", proof: "大型区域与政府平台项目多。", certifications: "CS4、DCMM4、ITSS 一级。" },
  众阳健康: { history: "山东本土医疗信息化厂商。", positioning: "二级与三乙市场为主的综合厂商。", strategy: "院端＋区域＋医共体。", regions: "山东大本营，辐射多省。", coverage: "2000+ 家（估）", business: "智慧医院、区域、医共体。", products: "HIS、电子病历、区域卫生、医共体。", techStrategy: "一体化交付。", advantageTrack: "二级 / 三乙医院。", proof: "二级与三乙医院合计约 87%，山东项目密集。" },
  和仁科技: { history: "2010 年成立于杭州，2016 年创业板上市。", positioning: "聚焦高端市场，千万级大单驱动。", strategy: "临床为核心＋数据治理。", regions: "浙江＋长三角。", coverage: "服务 300+ 医疗机构，三级占比超 90%", business: "临床信息、集成平台、智慧医院、医共体。", products: "云架构 HIS&EMR、医疗大数据、集成平台。", techStrategy: "临床为核心＋数据治理。", advantageTrack: "电子病历＋集成平台。", proof: "三甲占比约 85% 行业第一，高客单价。", certifications: "CS4、DCMM3、ITSS 二级。", finance: "2025 营收 4.35 亿（+7.2%），净利约 4766 万。" },
  联众医疗: { history: "1999 年始于杭州，2015 年挂牌新三板。", positioning: "聚焦大型医院一体化，云原生＋AI。", strategy: "信创＋数智化双轮。", regions: "浙江＋华东。", coverage: "3000+ 家，杭州三甲覆盖 90%+", business: "医院一体化、集成平台、区域云、信创、输血管理。", products: "HALO 一体化、Lyra 数智云、集成平台、输血系统。", techStrategy: "信创＋数智化双轮。", advantageTrack: "浙江医共体＋智慧医院。", proof: "主导浙江省医共体信息化标准。", certifications: "CS2、ITSS 二级。" },
  嘉和美康: { history: "电子病历起家的临床信息化专业厂商。", positioning: "电子病历与临床信息化专家。", strategy: "临床深度＋过级能力。", regions: "总部北京，服务全国三级医院。", coverage: "2000+ 家（估）", business: "电子病历、临床数据中心、病历质控、专科。", products: "电子病历、CDR、病历质控、专科系统。", techStrategy: "临床为核心。", advantageTrack: "电子病历。", proof: "三级医院 EMR 市场领先，过级能力强。", certifications: "电子病历高分级（待补）。" },
  科大讯飞医疗: { history: "依托科大讯飞与星火大模型。", positioning: "AI 医疗龙头，智医助理为核心。", strategy: "AI＋国产算力全栈。", regions: "总部合肥，全国基层与区域 AI 项目。", coverage: "基层覆盖广", business: "智医助理、AI 辅诊、电子病历、医保、区域 AI 平台。", products: "智医助理、星火医疗大模型、AI 辅诊。", techStrategy: "AI＋国产算力全栈。", advantageTrack: "AI / 大模型。", proof: "智医助理行业领先，基层覆盖广。", certifications: "AI 资质领先。" },
}

// ---------------------------------------------------------------------------
// 派生查询与纯函数（总览/对标/档案三视图共用，全部确定性计算、零 AI）
// ---------------------------------------------------------------------------

/** 核心 15 家：有五年中标数据的厂商，按金额降序 */
export function coreVendors(): VendorOrder[] {
  return VENDOR_ORDERS.filter((v) => v.bid5y != null).sort((a, b) => (b.bid5y ?? 0) - (a.bid5y ?? 0))
}

/** 扩展层：未纳入 15 家订单口径的厂商，按软著降序（仅作参考位） */
export function extendedVendors(): VendorOrder[] {
  return VENDOR_ORDERS.filter((v) => v.bid5y == null).sort((a, b) => (b.copyrights ?? 0) - (a.copyrights ?? 0))
}

/** 订单口径名次（1 起；非核心口径返回 0） */
export function orderRankOf(name: string): number {
  return coreVendors().findIndex((v) => v.name === name) + 1
}

export function vendorByName(name: string): VendorOrder | undefined {
  return VENDOR_ORDERS.find((v) => v.name === name)
}

/** 订单能力六维（对齐重构稿 ODIMS） */
export const ORDER_DIMS = ["五年规模", "项目数量", "大单金额", "大单占比", "中段交付", "客户广度"] as const

// 归一化基准取数据集内实际最大值（五年规模=卫宁 587710、项目数=卫宁 451、大单金额=东华 65572、
// 客户覆盖=创业慧康 7000）；无订单数据者以软著规模做 2 分封顶的参考位代理，界面须注明。
const SCALE_MAX = 587710
const PROJECTS_MAX = 451
const BIG_MAX = 65572
const COVERAGE_MAX = 7000
const CR_MAX = 2860
const MID_CAP = 40

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

/** 单厂商订单能力六维分（0–5，真实订单归一化） */
export function orderScores(v: VendorOrder): number[] {
  return [
    v.bid5y ? r2((v.bid5y / SCALE_MAX) * 5) : 0,
    v.projects5y ? r2((v.projects5y / PROJECTS_MAX) * 5) : v.copyrights ? r2((v.copyrights / CR_MAX) * 2) : 0,
    v.big5y ? r2((v.big5y / BIG_MAX) * 5) : 0,
    v.bigShare ? r2((v.bigShare / 100) * 5) : 0,
    v.midShare ? r2((Math.min(v.midShare, MID_CAP) / MID_CAP) * 5) : 0,
    v.customerCoverage ? r2((v.customerCoverage / COVERAGE_MAX) * 5) : 0,
  ]
}

/** 默认对标集合：我方 + 五年中标金额前三 */
export function defaultBenchmarkPicks(): string[] {
  const top = coreVendors().filter((v) => v.name !== SELF_NAME).slice(0, 3).map((v) => v.name)
  return [SELF_NAME, ...top]
}

export type OrderTakeaway = { kind: "opportunity" | "gap" | "defense"; text: string }

/** 对比重点（订单口径）：售前 2 分钟看清机会、差距、防谁——仅在我方入选对标集合时产出 */
export function buildOrderTakeaways(picked: VendorOrder[]): OrderTakeaway[] {
  const self = picked.find((v) => v.name === SELF_NAME)
  if (!self) return []
  const rivals = picked.filter((v) => v !== self)
  const out: OrderTakeaway[] = []
  if (self.midShare) {
    out.push({ kind: "opportunity", text: `中型项目交付见长：500–1000 万金额占比 ${self.midShare}%（行业约 17%）；2025 千万级项目数量、金额同比回升。` })
  }
  const biggest = rivals.filter((v) => v.bid5y).sort((a, b) => (b.bid5y ?? 0) - (a.bid5y ?? 0))[0]
  if (biggest?.bid5y && self.bid5y) {
    out.push({ kind: "gap", text: `规模差距：五年中标 ${(self.bid5y / 10000).toFixed(2)} 亿、第 ${orderRankOf(self.name)}；${biggest.name} ${(biggest.bid5y / 10000).toFixed(1)} 亿，约 ${Math.round(biggest.bid5y / self.bid5y)} 倍。` })
  }
  if (self.bigShare != null) {
    out.push({ kind: "defense", text: `大单短板：千万级金额占比仅 ${self.bigShare}%（行业约 53%），三甲整体方案能力需补；客户等级结构数据待补。` })
  }
  return out
}

/** 导出订单能力对比 CSV（含 BOM；转义/BOM/CRLF 统一走 @/lib/csv，厂商名含逗号/引号不窜列） */
export function buildOrderCompareCsv(entries: { name: string; scores: number[] }[]): string {
  return buildCsv(
    ["订单能力维度", ...entries.map((e) => e.name)],
    ORDER_DIMS.map((dim, d) => [dim, ...entries.map((e) => e.scores[d] ?? 0)]),
  )
}

/** 万元金额 → 「x.xx 亿」展示（null 走调用方兜底） */
export function fmtYi(wan: number | null, digits = 2): string {
  if (wan == null) return "—"
  return `${(wan / 10000).toFixed(digits)} 亿`
}
