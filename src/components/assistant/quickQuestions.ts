// UX-R2: 小智助手 已按 docs/ux-review-2026-11 修复 2026-11-07
// （快捷问题随当前路由变化 + 「我能帮你做」能力卡示例，均为纯数据便于单测）

export const DEFAULT_QUICK_QUESTIONS = [
  "我手上哪些商机最久没跟进？",
  "帮我总结最近的中标情报",
  "给我列一下进行中的项目和进度",
]

/** 路由 → 快捷问题映射：在哪个页面唤起小智，就问那个页面最顺手的问题 */
const ROUTE_QUESTIONS: { prefix: string; questions: string[] }[] = [
  {
    prefix: "/bid-workspace",
    questions: [
      "这份标书还差几章没写完？",
      "当前标书有哪些废标风险点需要处理？",
      "标书检查的规则都有哪些？",
    ],
  },
  {
    prefix: "/customer-management",
    questions: [
      "哪些客户超过 30 天没有跟进了？",
      "帮我看看最近新增的客户档案",
      "怎么把客户需求转成商机？",
    ],
  },
  {
    prefix: "/qual-certs",
    questions: [
      "资质台账里 30 天内到期的证书有哪些？",
      "哪些证书已经过期需要马上处理？",
      "导出标书时资质硬拦截是怎么判定的？",
    ],
  },
]

export function quickQuestionsForRoute(pathname: string | null | undefined): string[] {
  if (!pathname) return DEFAULT_QUICK_QUESTIONS
  const hit = ROUTE_QUESTIONS.find((r) => pathname.startsWith(r.prefix))
  return hit ? hit.questions : DEFAULT_QUICK_QUESTIONS
}

/** 「我能帮你做」能力卡：点击把示例问题填进输入框（不直接发送，让用户改完再发） */
export type CapabilityCard = {
  key: string
  title: string
  desc: string
  sample: string
}

export const CAPABILITY_CARDS: CapabilityCard[] = [
  {
    key: "data",
    title: "查数据",
    desc: "站内业务数据随口问",
    sample: "资质台账里 30 天内到期的证书有哪些？",
  },
  {
    key: "doc",
    title: "写文档",
    desc: "致辞 / 邮件 / 方案段落起草",
    sample: "帮我起草一段智慧病房方案的售前致辞",
  },
  {
    key: "check",
    title: "做检查",
    desc: "规则口径与风险点解读",
    sample: "废标项检查一般查哪些内容？",
  },
  {
    key: "flow",
    title: "跑流程",
    desc: "跨模块操作手把手教",
    sample: "怎么把情报中心的一条招标公告转成商机？",
  },
]
