// R009（D-2）验证：脏 fact 过滤 + 提示词规则注入
import { filterMemories, isOneOffFact, MEMORY_FACT_RULES } from "../../src/lib/memoryGuard.ts"

const dirty = [
  "刚刚上传了一份招标文件",
  "正在生成第3章方案正文",
  "本次对话中用户问了大模型怎么选",
  "今天要交标书",
  "用户问了价格策略",
]
const clean = [
  "用户主营电子病历与互联互通方向的三甲医院项目",
  "用户偏好先看报价再谈技术",
  "用户习惯用微信沟通",
]

const kept = filterMemories(
  [...dirty.map((c) => ({ group: "fact", content: c })), ...clean.map((c) => ({ group: "fact", content: c })), { group: "preference", content: "正在生成的都算偏好？" }].map((m) => ({ ...m })),
)

const keptContents = kept.map((k) => k.content)
const checks = {
  脏fact全被过滤: dirty.every((d) => !keptContents.includes(d)),
  净fact全保留: clean.every((c) => keptContents.includes(c)),
  preference不受影响: kept.some((k) => k.group === "preference" && k.content === "正在生成的都算偏好？"),
  单条判定_刚: isOneOffFact("刚刚上传了一份招标文件") === true,
  单条判定_正例: isOneOffFact("用户主营电子病历方向项目") === false,
  规则文本非空: MEMORY_FACT_RULES.includes("时间无关测试") && MEMORY_FACT_RULES.includes("不得沉淀"),
}
console.log(JSON.stringify({ keptCount: kept.length, checks }, null, 2))
const failed = Object.entries(checks).filter(([, v]) => !v)
if (failed.length) {
  console.error("FAILED:", failed.map(([k]) => k).join(","))
  process.exit(1)
}
console.log("ALL PASS")
