// ---------------------------------------------------------------------------
// T15（2026-09-29）字数局部精调提示词（易标 buildWordAdjustmentMessages 语义移植）：
// 输入当前文本 + 目标字数带，输出「局部操作 JSON」（insert/replace/delete + 逐字唯一锚点），
// 禁止整段重写；净化/应用/校验在 wordAdjust.ts 纯函数侧完成，本文件只负责提示词契约。
// ---------------------------------------------------------------------------

import { BID_STYLE_RULES, clipText } from "../bidTypes"
import type { LlmMessage } from "@/lib/llm"
import type { WordAdjustDirection, WordAdjustGranularity } from "../wordAdjust"

export const PROMPT_VERSION = 1

const DIRECTION_RULES: Record<WordAdjustDirection, string[]> = {
  expand: [
    "扩写手段（按优先级）：在段落间补写承接句与过渡说明；对既有要点补充实施细节、执行方式、注意事项；补充与本章主题直接相关的展开说明。",
    "扩写红线：禁止编造新的具体数字、指标、承诺、案例与资质；新增内容必须与上下文既有口径一致，可以直接复用上下文已出现的事实行；禁止为凑字数堆砌空话。",
    // REQ-022（2026-10-17）：把段落形态约束用操作措辞写出来——
    // 本生成器只做局部 insert/replace，不能用段落形态话术；关键在于**禁止靠"补承接句"扩写**：
    // 承接句插在段内必然把两段粘成一段，正是段落膨胀的手法。故要求优先插独立新段落。
    // ⚠️ 2026-10-17 真跑修正：第一版写「每段 1-3 句、每句不超过 40 字」（只有上限），
    //    实测扩写后被写薄；改为区间，并明确「扩写是加内容，不是拆句子」。
    "扩写段落形态：新增文字按「每段 2-3 句、每句 35-60 字」写入；insert 优先插入独立的新段落（新段落以换行开头和结尾），禁止在现有段落内部追加承接句、过渡句或补充说明——那会把两段粘成一段，正是要避免的；确需在同一段内 replace 时，替换后的段落仍须 2-3 句、每句 35-60 字；扩写是**增加内容**不是把原句拆碎，总字数必须真的涨上去。",
  ],
  shrink: [
    "缩写手段（按优先级）：删除冗余修饰语与重复表述；合并意思相同的相邻句子；删除与本章主题无关的泛化铺陈。",
    "缩写红线：禁止删除或改写任何数字、指标、承诺、事实口径与【待填写】占位；禁止删除小节标题行；保持每段主旨完整，不做段落级整段删除。",
  ],
}

const GRANULARITY_RULES: Record<WordAdjustGranularity, string> = {
  paragraph: "本次为段落级精调：优先以完整段落为单位增删（insert 锚点取相邻段落的首句或末句），改动幅度可以较大。",
  sentence: "本次为句子级精调：以句子为单位微调（锚点取单句），每处改动控制在 1-2 句。",
}

/** 字数精调 prompt：system 编辑器规则 + user（元信息 + 正文），输出严格局部操作 JSON */
export function buildWordAdjustmentMessages(input: {
  title: string
  content: string
  direction: WordAdjustDirection
  granularity: WordAdjustGranularity
  targetWords: number
  maxChangeWords: number
}): LlmMessage[] {
  const { title, content, direction, granularity, targetWords, maxChangeWords } = input
  const system = [
    "你是投标文件的正文局部字数编辑器。用户给你一段已成稿的标书正文与字数目标，你只能通过「局部插入 / 局部替换 / 局部删除」微调篇幅，禁止重写全文、禁止输出修改后的全文。",
    "",
    "锚点铁律：",
    "1. target_text / anchor 必须逐字复制自正文原文（保留原有标点），且在全篇唯一出现；不唯一或不存在的锚点会被系统拒绝；",
    "2. 每处锚点 ≤80 字；insert 的 content 是要插入的新文字，replace 的 content 是替换后的完整新文字；",
    "3. 含全角空格（U+3000）的表格行、【待填写】占位、```代码围栏``` 内部属于保护内容，禁止作为锚点、禁止修改；",
    "4. 操作总数不超过 12 条；确无合适的局部操作时输出空数组，禁止硬凑。",
    "",
    DIRECTION_RULES[direction].join("\n").replace(/^/gm, ""),
    GRANULARITY_RULES[granularity],
    "",
    "行文底线（新增/替换文字同样适用）：",
    ...BID_STYLE_RULES.slice(0, 6).map((r, i) => `${i + 1}. ${r}`),
    "",
    "输出严格 JSON，禁止解释文字、禁止 markdown 代码围栏，格式：",
    '{"operations":[{"operation":"insert","anchor":"正文原句…","position":"after","content":"新增文字"},{"operation":"replace","target_text":"正文原句…","content":"替换后文字"},{"operation":"delete","target_text":"正文原句…"}]}',
  ].join("\n")
  const user = [
    `【调整对象】${title || "本章正文"}`,
    `【当前字数】${content.length}`,
    `【目标字数】${targetWords}（当前${direction === "expand" ? "偏短" : "偏长"}，需要${direction === "expand" ? "扩" : "缩"}）`,
    `【单轮允许变化】不超过 ${maxChangeWords} 字`,
    "",
    "【正文】",
    clipText(content, 12000),
  ].join("\n")
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}
