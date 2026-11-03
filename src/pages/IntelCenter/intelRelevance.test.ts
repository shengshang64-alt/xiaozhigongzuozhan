import { describe, expect, it } from "vitest"
import { explainIntelRelevance, isIntelIrrelevant, isIntelRelevant } from "./intelRelevance"

// ---------------------------------------------------------------------------
// 情报相关性镜像词表锈死网（批次 A · 2026-09-23 → v3 · 2026-10-07 用户口径收紧）
//
// pb_hook 里 4 份 medicalRelevant / isIrrelevant 拷贝共用同一份口径，Goja 不能跨文件
// 共享 helper，只能靠前端镜像 + 单测防止未来误伤。本文件的用例锁定：
//   1) v3 核心口径（用户点名）：只收「医疗软件信息化/智慧医院建设」——HIS、EMR、集成平台、
//      数据中心、一体化系统、信创、电子病历/互联互通/智慧服务/智慧管理评级等强词必收
//   2) v3 核心口径：纯临床/生活健康新闻（养生/疫苗/义诊/抢救/排班等）必拒——
//      这些是 2026-10-01 前后情报流「太乱」的真实样例
//   3) 跨行业拦截不变（机械加工 / 航空 / 遥感 / 学院），医学院例外不再误杀
// ---------------------------------------------------------------------------

describe("isIntelRelevant · v3 强词命中（用户点名词表）", () => {
  it("厂商品牌与主力系统缩写", () => {
    expect(isIntelRelevant("和仁科技发布新一代临床决策系统")).toBe(true)
    expect(isIntelRelevant("麦迪科技智慧手术部解决方案")).toBe(true)
    expect(isIntelRelevant("万达信息助力上海公立医院数字化转型")).toBe(true)
    expect(isIntelRelevant("久远银海医保信息平台省级项目")).toBe(true)
    expect(isIntelRelevant("华为医疗物联网创新实验室成立")).toBe(true)
    expect(isIntelRelevant("某三甲医院 HIS 系统升级改造招标公告")).toBe(true)
    expect(isIntelRelevant("EMR 电子病历系统替换项目中标公示")).toBe(true)
  })

  it("用户点名词：集成平台 / 数据中心 / 一体化系统 / 信创", () => {
    expect(isIntelRelevant("医院集成平台与数据中心建设项目")).toBe(true)
    expect(isIntelRelevant("医院一体化系统采购需求公示")).toBe(true)
    expect(isIntelRelevant("医疗卫生行业信创替代方案专题")).toBe(true)
    expect(isIntelRelevant("医院信息平台机房等保测评")).toBe(true)
  })

  it("评级 / 测评关键词：电子病历评级、互联互通评级、智慧服务/智慧管理评级", () => {
    expect(isIntelRelevant("2026 年第五批电子病历评级通过医院名单公示")).toBe(true)
    expect(isIntelRelevant("国家医疗健康信息互联互通标准化成熟度测评结果")).toBe(true)
    expect(isIntelRelevant("智慧服务分级评估 3 级医院名单")).toBe(true)
    expect(isIntelRelevant("医院智慧管理分级评估标准发布")).toBe(true)
  })

  it("原有强词不受影响：DRG / 电子病历 / 智慧医院 / 远程医疗", () => {
    expect(isIntelRelevant("DRG 2.0 分组方案调整")).toBe(true)
    expect(isIntelRelevant("电子病历系统应用水平分级评价")).toBe(true)
    expect(isIntelRelevant("智慧医院建设试点公布")).toBe(true)
  })
})

describe("isIntelRelevant · v3 纯临床生活新闻必拒（情报流「太乱」的真实样例）", () => {
  it("2026-10-01 前后实测混入的临床/生活噪声全部拦截", () => {
    expect(isIntelRelevant("急诊普外科的假日坚守：开辟绿色通道 为急腹症患者抢生机")).toBe(false)
    expect(isIntelRelevant("秋季如何养生防病，专家给出这份健康指南")).toBe(false)
    expect(isIntelRelevant("这些流感疫苗传言不可信")).toBe(false)
    expect(isIntelRelevant("推进中医药传承创新的实践进路")).toBe(false)
  })

  it("其他典型临床噪声（义诊/科普/抢救/排班/锦旗）同样拦截", () => {
    expect(isIntelRelevant("某医院周末义诊活动通知")).toBe(false)
    expect(isIntelRelevant("健康科普：高血压患者冬季注意事项")).toBe(false)
    expect(isIntelRelevant("多学科协作成功救治重症患者")).toBe(false)
    expect(isIntelRelevant("元旦期间门诊排班公告")).toBe(false)
    expect(isIntelRelevant("患者家属送锦旗致谢医护团队")).toBe(false)
  })

  it("临床词 + 强词并存时强词优先（不误杀业务情报）", () => {
    expect(isIntelRelevant("疫苗接种点信息系统建设项目")).toBe(true) // 信息系统强词
    expect(isIntelRelevant("义诊预约上线掌上医院")).toBe(true) // 掌上医院强词
  })

  it("纯临床词不再单独放行（v2 刷屏根因）", () => {
    expect(isIntelRelevant("某医院收治了一批患者")).toBe(false)
    expect(isIntelRelevant("三甲医院临床重点专科名单公布")).toBe(false)
  })
})

describe("isIntelRelevant · 跨行业噪声仍拦得住", () => {
  it("机械加工 / 航空 / 遥感 等具体行业黑名单不变", () => {
    expect(isIntelRelevant("机械加工行业数字化转型白皮书")).toBe(false)
    expect(isIntelRelevant("航空公司信息系统建设")).toBe(false)
    expect(isIntelRelevant("遥感技术农业应用")).toBe(false)
  })

  it("以院结尾的非医机构（学院 / 研究院）被拦截", () => {
    expect(isIntelRelevant("某学院信息化建设招标公告")).toBe(false)
  })

  it("医学院例外：剥离「医学院/医科大学」后再判行业，不再误杀", () => {
    expect(isIntelRelevant("皖南医学院弋矶山医院智慧医院建设招标")).toBe(true)
    expect(isIntelRelevant("XX医科大学附属医院数据中心采购")).toBe(true)
  })
})

describe("isIntelRelevant · 边界", () => {
  it("空标题返回 false", () => {
    expect(isIntelRelevant("")).toBe(false)
  })

  it("版权噪声行返回 false", () => {
    expect(isIntelRelevant("版权所有 All Rights Reserved")).toBe(false)
    expect(isIntelRelevant("备案号 xxx 友情链接")).toBe(false)
  })

  it("医疗词 + 医疗IT词 弱判定双命中才放行", () => {
    expect(isIntelRelevant("某医院数据治理项目")).toBe(true)
    expect(isIntelRelevant("数据要素市场化配置")).toBe(false)
  })
})

describe("isIntelIrrelevant", () => {
  it("与 isIntelRelevant 反向一致", () => {
    const titles = ["电子病历评级名单", "机械加工行业", "医院信息化建设", "某传媒集团", "秋季养生指南", "医院数据中心采购"]
    for (const t of titles) {
      expect(isIntelIrrelevant(t)).toBe(!isIntelRelevant(t))
    }
  })
})

describe("explainIntelRelevance", () => {
  it("能定位每条命中的具体理由，供 UI 反馈「为什么被过滤」", () => {
    expect(explainIntelRelevance("和仁科技新品发布")).toEqual({ verdict: "relevant", reason: "strong" })
    expect(explainIntelRelevance("医院数据治理项目中标")).toEqual({ verdict: "relevant", reason: "loose-medical" })
    expect(explainIntelRelevance("航空公司信息系统")).toEqual({ verdict: "irrelevant", reason: "other-industry" })
    expect(explainIntelRelevance("版权所有")).toEqual({ verdict: "irrelevant", reason: "noise" })
    expect(explainIntelRelevance("")).toEqual({ verdict: "irrelevant", reason: "empty" })
    expect(explainIntelRelevance("秋季养生健康指南")).toEqual({ verdict: "irrelevant", reason: "clinical-noise" })
    expect(explainIntelRelevance("完全无关的话题")).toEqual({ verdict: "irrelevant", reason: "no-signal" })
  })
})

describe("isIntelRelevant · v3.2 工程/物业/设备采购黑名单（R-005 最大误判源：医院≠医疗信息化）", () => {
  it("文档点名样例——含「医院+运维/系统」但属工程物业采购一律拒", () => {
    expect(isIntelRelevant("北京中医药大学东直门医院污水站运维服务采购")).toBe(false)
    expect(isIntelRelevant("人民医院污水处理站设备更新项目")).toBe(false)
    expect(isIntelRelevant("某三甲医院住院楼电梯采购项目")).toBe(false)
    expect(isIntelRelevant("医院食堂餐饮服务外包项目")).toBe(false)
    expect(isIntelRelevant("某院智慧楼宇中央空调自控系统招标")).toBe(false)
    expect(isIntelRelevant("医院绿化养护及保洁服务采购")).toBe(false)
  })

  it("负向对照：真·医疗信息化运维/系统不得被黑名单误杀（强词优先于黑名单）", () => {
    expect(isIntelRelevant("医院信息化系统运维服务采购项目")).toBe(true)
    expect(isIntelRelevant("医院智慧后勤管理平台建设")).toBe(true)
  })
})

describe("isIntelRelevant · v3.1/3.2 镜像追平（infraNonMedical 数据中心硬件营销不收）", () => {
  it("裸「数据中心」不再放行，数据中心硬件/网络产品营销被 infraNonMedical 拒", () => {
    expect(isIntelRelevant("数据中心虚拟化运维管理平台发布")).toBe(false)
    expect(isIntelRelevant("某厂商智算中心解决方案推介")).toBe(false)
  })

  it("explain 反映 infra / facility 新理由", () => {
    expect(explainIntelRelevance("医院污水站运维服务")).toEqual({ verdict: "irrelevant", reason: "facility-procurement" })
    expect(explainIntelRelevance("数据中心光网互联方案")).toEqual({ verdict: "irrelevant", reason: "infra-hardware" })
  })
})
