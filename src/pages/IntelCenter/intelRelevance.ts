// ---------------------------------------------------------------------------
// intelRelevance — 情报「医疗信息化相关性」判定的前端镜像
//
// 与 pocketbase/pb_hooks/intel_center.pb.js 里 4 处 medicalRelevant / isIrrelevant 保持
// 同口径（tick 抓取过滤、fetch-now 手动抓取过滤、GET items 存量懒迁移、cleanup 反向清理）。
// pb_hook 因 Goja 回调自持原则不能跨文件共享 helper，前端这份镜像用于：
//   1) vitest 单测锈死词表（防止未来扩词误伤或漏收，回归到批次 A 修正前的坑）
//   2) 后续批次 B/C 给「清理预览」提供即时反馈，无需回环服务端
//
// 批次 A 变更（2026-09-23）：
//   · strongT 补齐主流厂商品牌（卫宁健康/东软集团/创业慧康/东华医为/和仁科技/麦迪科技/万达
//     信息/久远银海/华为医疗/腾讯健康/京东健康/阿里云医疗/百度灵医）与评级关键词（电子病历评级/
//     互联互通测评/智慧服务分级/医院智慧管理/医院信息标准化/医院信息互联互通/智慧医院分级）
//   · otherIndustry 移除「媒体」二字（会误杀「医疗媒体报道」），改按更精确的
//     传媒|自媒体|流媒体|媒体采访
// ---------------------------------------------------------------------------

const NOISE_RE = /版权|All Rights|ICP 备|备案号|友情链接|隐私政策|使用条款|网站地图/i
const STRONG_T =
  /电子病历|互联互通|智慧医院|互联网医院|卫生信息化|医疗信息化|医院信息化|数字医院|智慧医疗|智慧服务|智慧病房|医疗数据|医保|远程医疗|全民健康|卫健|CDSS|临床决策|医学影像|医疗影像|医疗知识|医疗大模型|医疗AI|医学人工智能|医院管理|医院信息|公立医院|区域卫生|疾控|病案|DRG|DIP|分级诊疗|华为医疗|腾讯健康|京东健康|阿里云医疗|百度灵医|东软集团|卫宁健康|创业慧康|东华医为|和仁科技|麦迪科技|万达信息|电子病历评级|互联互通测评|智慧服务分级|医院智慧管理|医院信息标准化|医院信息互联互通|智慧医院分级|\bHIS\b|\bLIS\b|\bPACS\b|\bEMR\b|\bCDR\b|\bHRP\b|\bMMIT\b/i
const CORE_MEDICAL =
  /医院|医疗|医学|医患|医用|卫生院|卫生|卫健|医保|健康|临床|诊疗|诊断|患者|病历|护理|透析|影像|检验|体检|病房|手术|会诊|随访|急诊|康复|肿瘤|口腔|专科|病种|质控|血液|中医|西医|公共卫生|基层卫生|药品|药店|处方|疫苗|用药|药学|集采/i
const OTHER_INDUSTRY =
  /电信|运营商|能源|电力|电网|交通|轨交|地铁|航空|金融|银行|保险|证券|制造|工业互联|政务|海关|税务|教育|校园|教学|学院|水利|水文|矿山|钢铁|冶金|汽车|座舱|行泊|车联|车载|石化|化工|煤炭|矿业|烟草|邮政|物流|供应链|地产|园区|文旅|旅游|游戏|传媒|自媒体|流媒体|媒体采访|消防|救援|认证工程师|证书|药企|药械|制药|医药公司|生物制药|农业|农机|光伏|农田|环保|色谱|开挖|信号分析仪/i
const TOPIC_HIT =
  /信息化|数字化|智慧|智能|集成平台|数据中心|数据|信创|国产化|人工智能|\bAI\b|等保|信息系统|信息平台|大数据|云计算|云化|上云|区块链|技术|网络|互联|转型/i
const ACTION_HIT =
  /项目|建设|招标|中标|采购|比选|遴选|公告|公示|上线|验收|升级|改造|集成|实施|部署|标准|规范|评审|立项|解决方案|方案|平台|系统|工作站|服务|产品|中心|机构|研究|应用|实践|探索|能力|生态|大会|论坛|培训|发布|签约|合作|实验室/i
const LOOSE_MED = /医|院|卫|健康/i

/**
 * 判定一条情报标题是否属于「医疗信息化建设」范畴，用于抓取过滤与存量清理预览。
 * 与 pb_hook 里 medicalRelevant 同口径：噪声全域拦截 → 强词命中 → 核心医疗词命中 →
 * 跨行业黑名单剔除 → 弱医疗 + 建设/信息化主题/动作 兜底三命中。
 * snippet 参数保留接口位但当前版本不参与判定（pb_hook 明确「只看标题」以防多行业厂商页导航噪声误放行）。
 */
export function isIntelRelevant(title: string, _snippet = ""): boolean {
  const t = String(title || "")
  if (!t) return false
  if (NOISE_RE.test(t)) return false
  if (STRONG_T.test(t)) return true
  if (CORE_MEDICAL.test(t)) return true
  if (OTHER_INDUSTRY.test(t)) return false
  return LOOSE_MED.test(t) && (TOPIC_HIT.test(t) || ACTION_HIT.test(t))
}

/** 反向判定，供 cleanup 预览「这条会被清理吗？」使用。 */
export function isIntelIrrelevant(title: string, snippet = ""): boolean {
  return !isIntelRelevant(title, snippet)
}

/** 展示层用途：告诉用户某条命中了哪一类判定，便于反馈「为什么这条被过滤」。 */
export function explainIntelRelevance(title: string): {
  verdict: "relevant" | "irrelevant"
  reason: "noise" | "strong" | "core-medical" | "other-industry" | "loose-medical" | "empty" | "no-signal"
} {
  const t = String(title || "")
  if (!t) return { verdict: "irrelevant", reason: "empty" }
  if (NOISE_RE.test(t)) return { verdict: "irrelevant", reason: "noise" }
  if (STRONG_T.test(t)) return { verdict: "relevant", reason: "strong" }
  if (CORE_MEDICAL.test(t)) return { verdict: "relevant", reason: "core-medical" }
  if (OTHER_INDUSTRY.test(t)) return { verdict: "irrelevant", reason: "other-industry" }
  if (LOOSE_MED.test(t) && (TOPIC_HIT.test(t) || ACTION_HIT.test(t))) {
    return { verdict: "relevant", reason: "loose-medical" }
  }
  return { verdict: "irrelevant", reason: "no-signal" }
}
