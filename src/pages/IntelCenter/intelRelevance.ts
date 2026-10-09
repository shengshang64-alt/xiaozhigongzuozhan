// ---------------------------------------------------------------------------
// intelRelevance — 情报「医疗软件信息化相关性」判定的前端镜像
//
// 与 pocketbase/pb_hooks/intel_center.pb.js 里 4 处 medicalRelevant / isIrrelevant 保持
// 同口径（tick 抓取过滤、fetch-now 手动抓取过滤、GET items 存量懒迁移、cleanup 反向清理）。
// pb_hook 因 Goja 回调自持原则不能跨文件共享 helper，前端这份镜像用于：
//   1) vitest 单测锈死词表（防止未来扩词误伤或漏收）
//   2) 「清理预览」提供即时反馈，无需回环服务端
//
// v3.3（2026-10-08 R214 交付测试修复·子串误命中两例）：
//   · FACILITY_NOISE：`施工`→`施工(?!图)`（「AI+医疗有了国家级施工图」被误判工程噪音）、
//     `新风`→`新风(?!险)`（「AI时代医院网络安全新风险」被误判新风空调）
//   · STRONG_T 补 `AI+医疗`（政策标题常用形态，此前仅「互联网+医疗」命中）
// v3.2（2026-10-08 R209：前端镜像追平 pb_hook v3.1 + 补 R-005 工程/物业/设备黑名单）：
//   · 追平 v3.1：STRONG_T 去裸「数据中心/互联互通」（保留带语境形态）、新增 infraNonMedical
//     （数据中心硬件/网络产品营销不收）、CLINICAL_NOISE 补行业活动噪声（竞赛/巡讲/落幕等）
//   · v3.2 新增 FACILITY_NOISE 工程/物业/设备采购黑名单——文档点名「医院三个字不等于医疗信息化」，
//     「污水站运维」「空调自控」这类因含 医院+运维/系统 被弱判定误收的最大误判源，
//     置于强词之后、弱判定之前一律拒（强词命中优先于此，不误杀真·医疗信息化）
//   · 与 pb_hook v3.2 同序：噪音行→非医疗行业→infraNonMedical→强词→临床噪声→工程物业噪声→弱判定
//
// v3（2026-10-07 用户口径收紧：只收「医疗软件信息化/智慧医院建设」）：
//   · 用户点名单：HIS、EMR、集成平台、数据中心、一体化系统、电子病历评级、互联互通评级、
//     智慧服务评级、智慧管理评级、智慧医院建设、信创等
//   · v2 的「核心医疗词（医院/患者/急诊/健康/疫苗/中医）单独命中即收」是情报流被
//     纯临床生活新闻（养生/流感疫苗/抢救新闻）刷屏的根因，v3 移除该通道
//   · 新增 clinicalNoise 临床生活噪声黑名单（养生/疫苗/义诊/抢救/排班/流感等）
//   · 强词表收紧：移除 医保/卫健/公立医院/医院管理/分级诊疗/疾控/病案/医学影像 等
//     纯临床政务词；补入 集成平台/数据中心/一体化系统/信息平台/信创/国产化/各评级全称
//   · 弱判定改为 医疗词 AND 医疗IT词 双命中
//   · 学院误杀修复：皖南医学院 等先剥离「医学院/医科大学」再判行业黑名单
// ---------------------------------------------------------------------------

const NOISE_RE = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
const OTHER_INDUSTRY =
  /电信|运营商|能源|电力|电网|交通|轨交|地铁|航空|金融|银行|保险|证券|制造|工业互联|政务|海关|税务|教育|校园|教学|学院|水利|水文|矿山|钢铁|冶金|汽车|座舱|行泊|车联|车载|石化|化工|煤炭|矿业|烟草|邮政|物流|供应链|地产|园区|文旅|旅游|游戏|传媒|自媒体|流媒体|媒体采访|消防|救援|认证工程师|证书|药企|制药|医药公司|生物制药|农业|农机|光伏|农田|环保|色谱|开挖|信号分析仪/i
const INFRA_NON_MEDICAL =
  /数据中心(互联|虚拟化|管理|服务|双活|光网)|（DCS）|（DME）|（HCI）|\(DCS\)|\(DME\)|\(HCI\)|IDC(数据中心|机房|服务)|智算中心|算力中心/i
const FACILITY_NOISE =
  /污水站|污水处理|给排水|电梯|扶梯|中央空调|通风空调|暖通|新风(?!险)|空调|配电房|供配电|变压器|发电机|UPS电源|锅炉|空气能|太阳能|绿化|园林|景观|保安|安保|保洁|洗涤|被服|食堂|餐饮|物业|后勤|基建|土建|桩基|基坑|幕墙|装饰装修|装修|装饰|改扩建|改建|扩建|施工(?!图)|监理|工程造价|整体搬迁|拆除|印刷|差旅|租车|班车|公务用车/i
const STRONG_T =
  /电子病历|智慧医院|互联网医院|智慧医疗|智慧服务|智慧病房|智慧管理|智慧后勤|卫生信息化|医疗信息化|医院信息化|区域卫生信息|全民健康信息|数字医院|数字健康|互联网\+医疗|AI\+医疗|AI医疗|医疗健康信息|远程医疗|医院信息|医疗信息|临床信息系统|医院信息系统|医疗信息系统|医院数据中心|医疗数据中心|集成平台|一体化系统|一体化平台|信息平台|信息系统|信息中心|信创|国产化|CDSS|临床决策|医疗大模型|医疗人工智能|医疗AI|医学人工智能|医疗知识图谱|医院物联网|医疗物联网|移动护理|移动查房|掌上医院|电子病历评级|电子病历分级|电子病历应用水平|互联互通测评|互联互通评级|互联互通标准化成熟度|智慧服务评级|智慧服务分级|智慧服务测评|智慧管理评级|智慧管理分级|医院信息标准化|医院信息互联互通|智慧医院分级|DRG|DIP|医保信息化|医保信息平台|医保信息系统|医保电子凭证|健康医疗大数据|医疗大数据|华为医疗|腾讯健康|京东健康|阿里云医疗|百度灵医|东软集团|卫宁健康|创业慧康|东华医为|和仁科技|麦迪科技|万达信息|久远银海|嘉和美康|讯飞医疗|\bHIS\b|\bEMR\b|\bLIS\b|\bPACS\b|\bCDR\b|\bHRP\b|\bMMIT\b/i
const CLINICAL_NOISE =
  /养生|食疗|药膳|疫苗|辟谣|义诊|科普|健康指南|健康提醒|健康素养|天气预报|寒潮|降温|高温|节气|停诊|排班|义卖|锦旗|感谢信|坚守|抢救|成功救治|假日门诊|节假日门诊|门诊时间|就诊提示|挂号|流感|中暑|献血|急救常识|用药提醒|成功开展|首例手术|救治|竞赛|巡讲|先进事迹|技能大赛|比武|圆满收官|圆满举办|成功举办|顺利举办|落幕/i
const MED_HIT = /医|院|卫|健康/i
const IT_HIT =
  /信息化|数字化|智慧|智能|系统|平台|软件|数据|信创|国产化|人工智能|\bAI\b|大数据|云计算|云化|上云|等保|网络安全|信息安全|集成|接口|机房|弱电|电子|互联网|线上|运维|测评|评级|分级评价|应用水平|解决方案|中台/i

/**
 * 判定一条情报标题是否属于「医疗软件信息化」范畴（抓取过滤与清理预览共用口径）。
 * 与 pb_hook v3.2 同序：噪音行 → 非医疗行业（医学院先剥离再判）→ infraNonMedical →
 * 强词命中即收 → 纯临床生活噪声 → 工程/物业/设备噪声 → 弱判定（医疗词 AND 医疗IT词）。
 * snippet 保留接口位但不参与判定（只看标题）。
 */
export function isIntelRelevant(title: string, _snippet = ""): boolean {
  void _snippet
  const t = String(title || "")
  if (!t) return false
  if (NOISE_RE.test(t)) return false
  const tForIndustry = t.replace(/医学院|医科大学|医学高等专科/g, "医院")
  if (OTHER_INDUSTRY.test(tForIndustry)) return false
  if (INFRA_NON_MEDICAL.test(t)) return false
  if (STRONG_T.test(t)) return true
  if (CLINICAL_NOISE.test(t)) return false
  if (FACILITY_NOISE.test(t)) return false
  return MED_HIT.test(t) && IT_HIT.test(t)
}

/** 反向判定，供 cleanup 预览「这条会被清理吗？」使用。 */
export function isIntelIrrelevant(title: string, snippet = ""): boolean {
  return !isIntelRelevant(title, snippet)
}

/** 展示层用途：告诉用户某条命中了哪一类判定，便于反馈「为什么这条被过滤」。 */
export function explainIntelRelevance(title: string): {
  verdict: "relevant" | "irrelevant"
  reason: "noise" | "strong" | "other-industry" | "infra-hardware" | "clinical-noise" | "facility-procurement" | "loose-medical" | "empty" | "no-signal"
} {
  const t = String(title || "")
  if (!t) return { verdict: "irrelevant", reason: "empty" }
  if (NOISE_RE.test(t)) return { verdict: "irrelevant", reason: "noise" }
  if (OTHER_INDUSTRY.test(t.replace(/医学院|医科大学|医学高等专科/g, "医院"))) {
    return { verdict: "irrelevant", reason: "other-industry" }
  }
  if (INFRA_NON_MEDICAL.test(t)) return { verdict: "irrelevant", reason: "infra-hardware" }
  if (STRONG_T.test(t)) return { verdict: "relevant", reason: "strong" }
  if (CLINICAL_NOISE.test(t)) return { verdict: "irrelevant", reason: "clinical-noise" }
  if (FACILITY_NOISE.test(t)) return { verdict: "irrelevant", reason: "facility-procurement" }
  if (MED_HIT.test(t) && IT_HIT.test(t)) return { verdict: "relevant", reason: "loose-medical" }
  return { verdict: "irrelevant", reason: "no-signal" }
}
