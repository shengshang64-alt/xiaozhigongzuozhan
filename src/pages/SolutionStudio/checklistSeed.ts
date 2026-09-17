import type { ProductDraft, RatingTags } from "./checklistTypes"

// ---------------------------------------------------------------------------
// 建设清单行业种子：四级评级标准系统库 + 示例我公司产品
// 首次进入建设清单视图且 check_products 无 is_builtin 行时批量写入（幂等）
// ---------------------------------------------------------------------------

const EMR_ALL = ["4", "5", "6", "7"]
const EMR_HIGH = ["5", "6", "7"]
const EMR_TOP = ["6", "7"]
const HPC_ALL = ["4B", "4A", "5B", "5A"]
const HPC_HIGH = ["4A", "5B", "5A"]
const SS_ALL = ["1", "2", "3", "4"]
const SS_HIGH = ["2", "3", "4"]
const SM_ALL = ["1", "2", "3"]
const SM_HIGH = ["2", "3"]

function industryRow(
  category: string,
  productLine: string,
  productName: string,
  moduleName: string,
  moduleFunc: string,
  ratingTags: RatingTags,
  extra?: Partial<ProductDraft>,
): ProductDraft {
  return {
    is_builtin: true,
    in_company: false,
    category,
    product_line: productLine,
    product_name: productName,
    module_name: moduleName,
    module_func: moduleFunc,
    description: "",
    charge_mode: "模块授权",
    unit_price: 0,
    status: "在售",
    rating_tags: ratingTags,
    ...extra,
  }
}

/** 行业标准系统库种子（公司常无的标 in_company=false 即「外购参考」） */
export function industrySeedRows(): ProductDraft[] {
  return [
    // ---------------- 电子病历评级 ----------------
    industryRow("临床诊疗", "HIS", "HIS", "门诊管理", "门诊挂号、收费、退费结算与门诊医生站医嘱", { emr: EMR_ALL, hpc: HPC_ALL }),
    industryRow("临床诊疗", "HIS", "HIS", "住院管理", "住院入出转、床旁结算与住院医生站医嘱", { emr: EMR_ALL }),
    industryRow("临床诊疗", "EMR", "电子病历", "病历书写", "病历编辑器、模板管理与病历要素结构化", { emr: EMR_ALL }),
    industryRow("临床诊疗", "EMR", "电子病历", "病历质控", "病案首页、环节/终末质控与缺陷病历管理", { emr: EMR_HIGH }),
    industryRow("临床诊疗", "LIS", "LIS", "标本采集运送", "条码标本采集、运送交接与签收确认", { emr: EMR_ALL }),
    industryRow("临床诊疗", "LIS", "LIS", "检验结果发布", "结果审核、发布与危急值提示联动", { emr: EMR_HIGH }),
    industryRow("医学影像", "PACS", "PACS", "影像存储调阅", "DICOM 影像接收、存储与临床调阅", { emr: EMR_ALL, hpc: HPC_ALL }),
    industryRow("医学影像", "RIS", "RIS", "检查预约报告", "检查排程、报告书写与审核发布", { emr: EMR_HIGH }),
    industryRow("临床诊疗", "护理系统", "护士站", "护士站医嘱", "医嘱处理、执行签到与交接班管理", { emr: EMR_ALL }),
    industryRow("药事管理", "药房系统", "药师审核", "处方审核", "处方前置审核、干预与审核意见留痕", { emr: EMR_HIGH }),
    industryRow("临床诊疗", "路径管理", "临床路径", "路径制定与变异", "路径模板制定、入径管理与变异分析", { emr: EMR_TOP }),
    industryRow("临床诊疗", "CDSS", "CDSS", "临床决策支持", "诊断辅助、医嘱审查与指南知识提示", { emr: EMR_TOP }, { status: "在售" }),
    industryRow("闭环管理", "闭环平台", "药品闭环", "闭环药品管理", "医嘱-处方-调配-给药全过程闭环核对", { emr: EMR_TOP }),
    industryRow("闭环管理", "闭环平台", "输血闭环", "闭环输血管理", "用血申请-接收-输血-不良反应闭环记录", { emr: EMR_TOP }),
    industryRow("闭环管理", "闭环平台", "标本闭环", "闭环标本管理", "采集-运送-检验-结果回报闭环跟踪", { emr: EMR_TOP }),
    industryRow("闭环管理", "闭环平台", "手术闭环", "闭环手术管理", "手术申请-排程-术前核查-术后随访闭环", { emr: EMR_TOP }),
    industryRow("闭环管理", "闭环平台", "危急值闭环", "闭环危急值管理", "危急值报告-接收-处理-反馈闭环留痕", { emr: EMR_HIGH }),
    industryRow("病案管理", "病案系统", "病案管理", "病案首页管理", "病案归档、借阅追踪与首页质控上报", { emr: EMR_HIGH, hpc: HPC_HIGH }),
    industryRow("公共卫生", "院感系统", "院感管理", "院感监测", "感染病例监测、暴发预警与目标性监测", { emr: EMR_HIGH }),
    industryRow("临床诊疗", "重症系统", "重症医学", "ICU 临床信息", "重症病历、设备数据采集与评分预警", { emr: EMR_TOP }),
    // ---------------- 互联互通 ----------------
    industryRow("平台集成", "集成平台", "集成平台", "消息交换", "ESB/HIE 消息路由、接口管理与服务监控", { hpc: HPC_ALL, emr: EMR_HIGH }),
    industryRow("平台集成", "集成平台", "集成平台", "服务注册", "服务注册、发布、授权与调用审计", { hpc: HPC_HIGH }),
    industryRow("数据平台", "数据中心", "CDR", "临床数据中心", "临床数据建模、存储与患者 360 视图", { hpc: HPC_ALL }),
    industryRow("数据平台", "数据中心", "ODR", "运营数据中心", "运营指标汇聚与管理分析数据服务", { hpc: HPC_HIGH, sm: SM_ALL }),
    industryRow("数据平台", "数据中心", "RDR", "科研数据中心", "科研数据仓库与专病队列服务", { hpc: ["5A"] }),
    industryRow("数据平台", "主数据", "注册服务", "患者与术语注册", "患者主索引与标准术语注册服务", { hpc: HPC_ALL }),
    industryRow("互联应用", "交互服务", "信息交互", "院间信息交互", "院间文档共享、远程协作与交换监测", { hpc: HPC_HIGH }),
    industryRow("互联应用", "门户平台", "统一门户", "医院统一门户", "统一身份认证、应用聚合与消息中心", { hpc: HPC_ALL }),
    industryRow("数据平台", "主数据", "主数据管理", "主数据维护", "组织、人员、科室、物资主数据维护", { hpc: HPC_HIGH }),
    industryRow("安全运维", "安全体系", "安全体系", "安全技术体系", "边界/应用/数据安全与商用密码应用", { hpc: HPC_ALL }),
    industryRow("安全运维", "运维体系", "运维监控", "统一运维监控", "设备、数据库、接口监控与告警工单", { hpc: HPC_HIGH }),
    // ---------------- 智慧服务 ----------------
    industryRow("智慧服务", "预约平台", "预约诊疗", "预约服务", "多渠道预约、号源管理与诊前提醒", { ss: SS_ALL }),
    industryRow("智慧服务", "自助服务", "自助机", "自助机服务", "建档、挂号缴费与报告打印自助服务", { ss: SS_ALL }),
    industryRow("智慧服务", "门诊服务", "导诊分诊", "智能导诊", "症状分诊、科室推荐与院内路径导航", { ss: SS_HIGH }),
    industryRow("智慧服务", "互联网医院", "互联网医院", "在线诊疗", "在线复诊、电子处方与药品配送", { ss: ["3", "4"] }),
    industryRow("智慧服务", "随访系统", "随访管理", "随访服务", "随访计划、任务执行与结果记录", { ss: SS_HIGH }),
    industryRow("智慧服务", "随访系统", "满意度", "满意度调查", "门诊/住院满意度调查与整改分析", { ss: SS_HIGH }),
    industryRow("智慧服务", "门诊服务", "排队叫号", "排队叫号", "分诊二次叫号与候诊屏显联动", { ss: SS_ALL }),
    industryRow("智慧服务", "支付平台", "移动支付", "移动支付", "扫码支付、医保移动支付与电子票据", { ss: SS_HIGH }),
    // ---------------- 智慧管理 ----------------
    industryRow("智慧管理", "HRP", "人事管理", "HR 管理", "组织、人事、考勤与薪酬管理", { sm: SM_ALL }),
    industryRow("智慧管理", "HRP", "物资管理", "物资管理", "采购、库存与高值耗材溯源管理", { sm: SM_ALL }),
    industryRow("智慧管理", "HRP", "资产管理", "资产管理", "资产台账、折旧与盘点管理", { sm: SM_ALL }),
    industryRow("智慧管理", "HRP", "预算成本", "预算成本管理", "全面预算、成本核算与控制分析", { sm: SM_HIGH }),
    industryRow("智慧管理", "BI 平台", "运营决策", "运营决策分析", "医院运营指标看板与 DRG 分析", { sm: SM_HIGH }),
    industryRow("智慧管理", "后勤平台", "后勤管理", "后勤管理", "报修、巡检、运送与被服任务管理", { sm: SM_ALL }),
    industryRow("智慧管理", "后勤平台", "能耗管理", "能耗管理", "水电气表计监测与能耗分析优化", { sm: SM_HIGH }),
    industryRow("智慧管理", "HRP", "绩效管理", "绩效考核管理", "科室与个人绩效方案、核算与反馈", { sm: SM_HIGH }),
  ]
}

function companyRow(
  category: string,
  productLine: string,
  productName: string,
  moduleName: string,
  moduleFunc: string,
  unitPrice: number,
  ratingTags: RatingTags,
  extra?: Partial<ProductDraft>,
): ProductDraft {
  return {
    is_builtin: false,
    in_company: true,
    category,
    product_line: productLine,
    product_name: productName,
    module_name: moduleName,
    module_func: moduleFunc,
    description: "",
    charge_mode: "系统授权",
    unit_price: unitPrice,
    status: "在售",
    rating_tags: ratingTags,
    ...extra,
  }
}

/** 示例我公司产品种子（用户可改可删） */
export function companySeedRows(): ProductDraft[] {
  return [
    companyRow("临床诊疗", "HIS", "HIS", "门诊管理", "门诊挂号、收费与门诊医生站", 450000, { emr: EMR_ALL, hpc: HPC_ALL }),
    companyRow("临床诊疗", "HIS", "HIS", "住院管理", "住院入出转、结算与住院医生站", 380000, { emr: EMR_ALL }),
    companyRow("临床诊疗", "EMR", "电子病历", "病历书写", "结构化病历编辑与模板管理", 300000, { emr: EMR_ALL }),
    companyRow("临床诊疗", "EMR", "电子病历", "病历质控", "环节/终末质控与首页质控", 180000, { emr: EMR_HIGH }),
    companyRow("临床诊疗", "护理系统", "移动护理", "移动护理执行", "床旁执行、签到与输液巡视", 260000, { emr: EMR_HIGH }),
    companyRow("临床诊疗", "LIS", "LIS", "标本采集运送", "条码采集、运送交接与签收", 200000, { emr: EMR_ALL }),
    companyRow("临床诊疗", "LIS", "LIS", "检验结果发布", "结果审核发布与危急值联动", 150000, { emr: EMR_HIGH }),
    companyRow("医学影像", "PACS", "PACS", "影像存储调阅", "DICOM 存储与临床调阅", 280000, { emr: EMR_ALL, hpc: HPC_ALL }),
    companyRow("医学影像", "RIS", "RIS", "检查预约报告", "检查排程与报告审核发布", 160000, { emr: EMR_HIGH }),
    companyRow("药事管理", "药房系统", "药师审核", "处方前置审核", "处方前置审核与干预留痕", 120000, { emr: EMR_HIGH }),
    companyRow("药事管理", "药房系统", "药事管理", "住院调剂管理", "摆药联动与调剂核对", 100000, { emr: EMR_HIGH }),
    companyRow("平台集成", "集成平台", "集成平台", "消息交换", "ESB 消息路由与接口管理", 600000, { hpc: HPC_ALL, emr: EMR_HIGH }),
    companyRow("平台集成", "集成平台", "集成平台", "服务注册", "服务注册发布与调用审计", 200000, { hpc: HPC_HIGH }),
    companyRow("数据平台", "数据中心", "数据中心", "CDR 临床数据中心", "临床数据建模与患者 360", 550000, { hpc: HPC_ALL }),
    companyRow("数据平台", "数据中心", "数据中心", "ODR 运营数据中心", "运营指标汇聚与分析服务", 300000, { hpc: HPC_HIGH, sm: SM_ALL }),
    companyRow("数据平台", "主数据", "注册服务", "患者主索引", "EMPI 与标准术语注册", 180000, { hpc: HPC_ALL }),
    companyRow("智慧服务", "互联网医院", "互联网医院", "在线诊疗", "在线复诊、电子处方与配送", 400000, { ss: ["3", "4"] }),
    companyRow("智慧服务", "预约平台", "预约诊疗", "预约服务", "多渠道预约与号源管理", 150000, { ss: SS_ALL }),
    companyRow("智慧服务", "自助服务", "自助机", "自助机服务", "建档挂号缴费与报告打印", 120000, { ss: SS_ALL }),
    companyRow("智慧服务", "门诊服务", "排队叫号", "排队叫号", "分诊叫号与候诊屏显", 90000, { ss: SS_ALL }),
    companyRow("智慧服务", "支付平台", "移动支付", "移动支付", "扫码与医保移动支付", 80000, { ss: SS_HIGH }),
    companyRow("智慧服务", "随访系统", "随访管理", "随访服务", "随访计划与任务执行", 100000, { ss: SS_HIGH }),
    companyRow("临床诊疗", "路径管理", "临床路径", "路径管理", "路径模板与入径变异分析", 150000, { emr: EMR_TOP }),
    companyRow("临床诊疗", "CDSS", "CDSS", "临床决策支持", "诊断辅助与医嘱审查", 200000, { emr: EMR_TOP }, { status: "研发中" }),
    companyRow("闭环管理", "闭环平台", "药品闭环", "闭环药品管理", "给药全过程闭环核对", 180000, { emr: EMR_TOP }),
    companyRow("闭环管理", "闭环平台", "输血闭环", "闭环输血管理", "用血闭环记录与不良反应", 150000, { emr: EMR_TOP }, { status: "研发中" }),
    companyRow("病案管理", "病案系统", "病案管理", "病案首页管理", "病案归档与首页质控", 120000, { emr: EMR_HIGH, hpc: HPC_HIGH }),
    companyRow("公共卫生", "院感系统", "院感管理", "院感监测", "感染监测与暴发预警", 130000, { emr: EMR_HIGH }),
    companyRow("互联应用", "门户平台", "统一门户", "医院统一门户", "统一认证与应用聚合", 160000, { hpc: HPC_ALL }),
    companyRow("安全运维", "运维体系", "运维监控", "统一运维监控", "设备接口监控与告警工单", 140000, { hpc: HPC_HIGH }),
  ]
}
