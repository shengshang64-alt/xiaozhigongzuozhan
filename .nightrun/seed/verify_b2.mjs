// R008（B-2 阶段一）验证：评分项本地扫描与解析报告交叉比对
import { crossCheckScores } from "../../src/pages/BidWorkspace/scoreItemsScan.ts"

// 模拟 pdfjs 抽取后的评分办法文本（表格打散成行、含全角/半角括号、行内杂讯）
const tenderText = `三、评分标准
本项目采用综合评分法，满分100分，其中技术部分60分，商务部分25分，价格部分15分。
（一）技术部分（60分）
1、技术方案（20分)：技术方案先进、合理可行，满足招标文件要求得15-20分
2、项目实施计划10分 实施计划周密、进度安排合理
3、培训方案（5分）
4、售后服务方案（5分）售后响应及时
（二）商务部分（25分）
1、同类项目业绩（15分）：近三年类似合同每个5分
2、企业认证（10分）
（三）价格部分（15分）
满足招标文件要求且投标价格最低的投标报价为评标基准价，其价格分为满分。
序号 评分因素 分值
合计 100 分`

// 解析报告（故意造 1 个漏抽「培训方案」+ 1 个分值错误「企业认证 15≠10」+ 缺业绩项）
const report = {
  scope: "full",
  sections: [
    {
      key: "tech_score",
      title: "技术评分要求",
      status: "ok",
      content:
        "技术方案（20 分）：技术方案先进、合理可行\n项目实施计划（10 分）：实施计划周密\n售后服务方案（5 分）：售后响应及时",
    },
    {
      key: "biz_score",
      title: "商务评分要求",
      status: "ok",
      content: "同类项目业绩（15 分）：近三年类似合同每个5分\n企业认证（15 分）：ISO27001 等",
    },
  ],
}

const cc = crossCheckScores(tenderText, report)
const result = {
  scannedCount: cc.scanned.length,
  scanned: cc.scanned.map((s) => `${s.cat}:${s.name}=${s.score}`),
  total: cc.total,
  categorySums: cc.categorySums,
  parsedCount: cc.parsed.length,
  missingInReport: cc.missingInReport.map((m) => `${m.cat}:${m.name}=${m.score}`),
  scoreMismatch: cc.scoreMismatch.map((m) => `${m.parsed.name} 解析${m.parsed.score}/原文${m.scanned.score}`),
  totalSumWarn: cc.totalSumWarn,
  sumOfParsed: cc.sumOfParsed,
}
console.log(JSON.stringify(result, null, 2))

// 断言
const ok =
  cc.scanned.length >= 6 &&
  cc.missingInReport.some((m) => m.name.includes("培训")) &&
  cc.scoreMismatch.length === 1 &&
  cc.scoreMismatch[0].parsed.score === 15 &&
  cc.scoreMismatch[0].scanned.score === 10 &&
  cc.categorySums.tech === 40 &&
  cc.categorySums.biz === 25 &&
  cc.total.value === 100 &&
  cc.totalSumWarn !== null
console.log(ok ? "ALL PASS" : "ASSERT FAILED")
if (!ok) process.exit(1)
