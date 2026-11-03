// 竞品基线数据：来源《医疗信息化公司软件著作权汇总.xlsx》「公司概览」表的确切事实。
// 仅录入可核对字段（名称/主体/软著总数/最早最近登记日期），source 标注来源。
// 官网 / 微信公众号属公开信息，经联网核实后回填；未核实者留空并标「待核实」，遵循防幻觉诚实兜底，绝不编造。
import type { CompetitorPatch } from "./competitorsCore"

export interface CompetitorSeed {
  name: string
  legal_name: string
  software_copyrights: number
  earliest_cr_date: string
  latest_cr_date: string
  website?: string
  wechat?: string
  positioning?: string
  source: string
}

// 20 家核心医疗信息化厂商（软著数据取自 Excel 公司概览，登记截至 2026-09）
export const COMPETITOR_SEED: CompetitorSeed[] = [
   { name: "卫宁健康", legal_name: "卫宁健康科技集团股份有限公司", software_copyrights: 640, earliest_cr_date: "2005-05-09", latest_cr_date: "2026-08-06", website: "https://www.winning.com.cn/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
  { name: "东软集团", legal_name: "东软集团股份有限公司", software_copyrights: 2860, earliest_cr_date: "2001-04-04", latest_cr_date: "2026-09-01", website: "https://www.neusoft.com/cn/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
  { name: "东华医为", legal_name: "东华医为科技有限公司", software_copyrights: 514, earliest_cr_date: "2018-08-02", latest_cr_date: "2026-08-27", website: "http://www.imedway.com", source: "软著汇总Excel + 官网核实(LinkedIn) · 公众号待核实" },
  { name: "创业慧康", legal_name: "创业慧康科技股份有限公司", software_copyrights: 864, earliest_cr_date: "2003-02-10", latest_cr_date: "2026-08-18", website: "https://bsoft.com.cn/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
  { name: "久远银海", legal_name: "四川久远银海软件股份有限公司", software_copyrights: 1316, earliest_cr_date: "2009-10-20", latest_cr_date: "2026-07-31", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "万达信息", legal_name: "万达信息股份有限公司", software_copyrights: 1868, earliest_cr_date: "2000-10-17", latest_cr_date: "2026-08-20", source: "软著汇总Excel · 官网/公众号待核实（注意区别于万达集团 wanda.cn）" },
  { name: "嘉和美康", legal_name: "嘉和美康（北京）科技股份有限公司", software_copyrights: 880, earliest_cr_date: "2006-04-20", latest_cr_date: "2026-08-26", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "麦迪科技", legal_name: "苏州麦迪斯顿医疗科技股份有限公司", software_copyrights: 338, earliest_cr_date: "2010-03-17", latest_cr_date: "2026-09-03", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "和仁科技", legal_name: "浙江和仁科技股份有限公司", software_copyrights: 362, earliest_cr_date: "2011-04-28", latest_cr_date: "2026-06-17", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "智业软件", legal_name: "智业软件股份有限公司", software_copyrights: 340, earliest_cr_date: "2004-03-04", latest_cr_date: "2026-05-28", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "中联信息", legal_name: "重庆中联信息产业有限责任公司", software_copyrights: 201, earliest_cr_date: "2000-12-15", latest_cr_date: "2026-03-26", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "众阳健康", legal_name: "众阳健康科技集团有限公司", software_copyrights: 422, earliest_cr_date: "2007-07-12", latest_cr_date: "2026-06-11", website: "http://www.msunsoft.com/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
  { name: "医惠科技", legal_name: "医惠科技有限公司", software_copyrights: 497, earliest_cr_date: "2010-01-12", latest_cr_date: "2026-04-10", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "荣科科技", legal_name: "荣科科技股份有限公司", software_copyrights: 452, earliest_cr_date: "2008-07-08", latest_cr_date: "2026-08-26", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "易联众", legal_name: "易联众信息技术股份有限公司", software_copyrights: 521, earliest_cr_date: "2009-09-22", latest_cr_date: "2026-09-03", website: "http://www.ylzinfo.com/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
  { name: "天健科技", legal_name: "北京天健源达科技股份有限公司", software_copyrights: 124, earliest_cr_date: "2005-12-26", latest_cr_date: "2024-06-26", website: "https://www.medvision.com.cn/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
  { name: "海泰医疗", legal_name: "南京海泰医疗信息系统有限公司", software_copyrights: 325, earliest_cr_date: "2009-09-24", latest_cr_date: "2026-08-04", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "科大讯飞医疗", legal_name: "讯飞医疗科技股份有限公司", software_copyrights: 336, earliest_cr_date: "2016-08-10", latest_cr_date: "2026-08-17", website: "https://www.xunfeihealthcare.com/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
  { name: "北大医信", legal_name: "北京医信数智科技有限公司", software_copyrights: 328, earliest_cr_date: "2014-04-24", latest_cr_date: "2025-12-30", source: "软著汇总Excel · 官网/公众号待核实" },
  { name: "金蝶医疗", legal_name: "金医慧通科技有限公司", software_copyrights: 317, earliest_cr_date: "2001-04-03", latest_cr_date: "2026-08-24", website: "http://www.wisetop.cn/", source: "软著汇总Excel + 官网核实 · 公众号待核实" },
]

export function seedToPatch(seed: CompetitorSeed): CompetitorPatch {
  return {
    name: seed.name,
    legal_name: seed.legal_name,
    software_copyrights: seed.software_copyrights,
    earliest_cr_date: seed.earliest_cr_date,
    latest_cr_date: seed.latest_cr_date,
    website: seed.website ?? "",
    wechat: seed.wechat ?? "",
    positioning: seed.positioning ?? "",
    source: seed.source,
    visibility: "team",
  }
}
