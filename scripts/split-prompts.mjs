// 按模块拆分 docs/系统提示词分类手册.md -> docs/提示词手册/，并为每条提示词注入「调用链」。
// 逐字原文来自母文档（按标题切分，不重打正文），本脚本只追加链信息并生成 README 索引。
// 运行：node scripts/split-prompts.mjs
import fs from "node:fs"
import path from "node:path"

const NL = String.fromCharCode(10)
const CR = String.fromCharCode(13)

const ROOT = process.cwd()
const SRC = path.join(ROOT, "docs", "系统提示词分类手册.md")
const OUT_DIR = path.join(ROOT, "docs", "提示词手册")

const MODEL_DEF = "个人优先→平台兜底"
const MODEL_PLATFORM = "强制平台 gpt-5.5"
const MODEL_BLOCK = "—（共享文本块）"

// sec = 归属模块文件前缀；name = 构造器/常量；trig = 用户触发；entry = 入口函数；gw = 网关(page+参数+scope)
const E = {
  "1.1": { sec: "00", name: "TRUTH_IRON_RULES", block: true, used: "被 truthPreamble() 拼进标书全链(2.1–2.27) system 固定前置" },
  "1.2": { sec: "00", name: "COMMON_OUTPUT_RULES", block: true, used: "被 truthPreamble() 拼进标书全链 system" },
  "1.3": { sec: "00", name: "truthPreamble()", block: true, used: "组装 1.1+1.2 为文本块，注入 2.1/2.2–2.13/2.22–2.24 等 system" },
  "1.4": { sec: "00", name: "BID_STYLE_RULES", block: true, used: "末尾拼接进 2.6/2.7/2.8/2.9/2.10 等正文生成器 system" },
  "1.5": { sec: "00", name: "FULLTEXT_GUARD_RULES", block: true, used: "同 1.4，正文生成器 system" },
  "1.6": { sec: "00", name: "PARAM_RESPONSE_BOUNDARY_RULES", block: true, used: "同 1.4，正文生成器 system（防废标不放宽）" },
  "1.7": { sec: "00", name: "PRE_OUTPUT_SELFCHECK_RULES", block: true, used: "同 1.4，正文生成器 system" },
  "1.8": { sec: "00", name: "complianceModeRule(mode)", block: true, used: "按 mode 注入 2.6/2.7/2.8/2.9 正文生成器；不注入下游校验器" },
  "1.9": { sec: "00", name: "complianceOutlineRule(mode)", block: true, used: "按 mode 注入 2.2/2.3/2.4 大纲生成器" },
  "1.10": { sec: "00", name: "SOL_STYLE_RULES", block: true, used: "注入 3.2/3.3 方案正文/改写器 system" },
  "1.11": { sec: "00", name: "solComplianceModeRule / solRefineModeRule", block: true, used: "注入 3.2 正文 / 3.3 扩写器 system" },

  "2.1": { sec: "01", name: "buildTenderParseMessages", trig: "上传招标文件点「解析」/ 单项「重解析」(分块逐段)", entry: "runParseWith() / runReparseSection()", gw: "chatViaGateway(page=bid-workspace · temperature=0 · scope=bid-parse · max=8192)" },
  "2.2": { sec: "01", name: "buildBidOutlineMessages", trig: "解析后点「生成大纲」(leafGoal≤40 单次)", entry: "runGenerateOutline()", gw: "chatViaGateway(page=bid-workspace · max=4096)" },
  "2.3": { sec: "01", name: "buildOutlineLevel1Messages", trig: "分步大纲 Call1(leafGoal>40 自动)", entry: "runGenerateOutline()", gw: "chatViaGateway(page=bid-workspace · max=4096)" },
  "2.4": { sec: "01", name: "buildOutlineChildrenMessages", trig: "分步大纲 Call2 逐技术章展开", entry: "runGenerateOutline()", gw: "chatViaGateway(page=bid-workspace · max=4096)" },
  "2.5": { sec: "01", name: "buildOutlineFixMessages", trig: "大纲本地校验不通过后一次结构修复", entry: "runGenerateOutline()", gw: "chatViaGateway(page=bid-workspace · max=4096)" },
  "2.6": { sec: "01", name: "buildBidChapterMessages", trig: "逐章「生成正文」(章模式)", entry: "generateChapterContent() / runGenerateChapter()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.7": { sec: "01", name: "buildBidSectionMessages", trig: "小节级「生成 / 重生成」正文", entry: "generateChapterContent() / runRegenerateSection()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.8": { sec: "01", name: "buildBidContinueMessages", trig: "章正文未达预算自动补足 / 手动「续写」", entry: "runSupplementLoop() / runContinueChapter()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.9": { sec: "01", name: "buildBidRefineMessages", trig: "章「改写 / 扩写 / 精简」", entry: "runRefineChapter()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.10": { sec: "01", name: "buildSectionResizeMessages", trig: "小节切片局部「扩写 / 缩写」", entry: "runResizeSection()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.11": { sec: "01", name: "buildDeviationMapMessages", trig: "点「生成技术偏离表」", entry: "runDeviationTable()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.12": { sec: "01", name: "buildDupJudgeMessages", trig: "标书查重相似段对 AI 复判", entry: "runDupJudge()（工具版共用）", gw: "chatViaGateway(page=bid-workspace · max=4096)" },
  "2.13": { sec: "01", name: "buildVoidCheckMessages", trig: "投标前「废标风险自查」", entry: "runVoidCheck()（工具版共用）", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.14": { sec: "01", name: "buildEvalMessages", trig: "「模拟评标」·技术路", entry: "runEvalAll() / runEvalSinglePath()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.15": { sec: "01", name: "buildEvalFormatMessages", trig: "「模拟评标」·格式路", entry: "runEvalAll() / startEvalPathRerun()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.16": { sec: "01", name: "buildEvalCommercialMessages", trig: "「模拟评标」·商务路", entry: "runEvalAll() / startEvalPathRerun()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.17": { sec: "01", name: "buildSubmissionCheckMessages", trig: "「交卷体检」覆盖审计", entry: "runSubmissionCheck()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.18": { sec: "01", name: "buildDefenseQuestionsMessages", trig: "答辩「生成问题池」", entry: "runGenerateDefenseQuestions()", gw: "chatViaGateway(page=bid-workspace · scope=bid-defense · max=8192)" },
  "2.19": { sec: "01", name: "buildDefenseAnswerMessages", trig: "单个专家问题「生成完整答案」", entry: "runGenerateFullAnswer()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.20": { sec: "01", name: "buildDefenseOutlineMessages", trig: "「讲标 PPT 大纲」生成", entry: "runGenerateDefenseOutline()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.21": { sec: "01", name: "buildSpeechNotesMessages", trig: "「讲标稿要点」生成", entry: "runGenerateSpeechNotes()", gw: "chatViaGateway(page=bid-workspace · scope=bid-defense · max=8192)" },
  "2.22": { sec: "01", name: "buildFactSettingsMessages", trig: "「生成全局事实设定」", entry: "runGenerateFactSettings()", gw: "chatViaGateway(page=bid-workspace · temperature=0 · max=8192)" },
  "2.23": { sec: "01", name: "buildFactCheckMessages", trig: "「事实一致性核对」", entry: "runFactCheck()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.24": { sec: "01", name: "buildFactPatchMessages", trig: "矛盾项「一键修复」生成补丁", entry: "runFactPatch()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.25": { sec: "01", name: "buildJsonRepairMessages", trig: "模型 JSON 解析失败后自动语法修复重试", entry: "withJsonRepair()（被各解析入口共用）", gw: "chatViaGateway(page=bid-workspace · temperature=0 · max=8192)" },
  "2.26": { sec: "01", name: "buildOrchestrationMessages", trig: "动笔前「预编排」(表格/配图/定向事实/焦点) 分批", entry: "runOrchestration()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },
  "2.27": { sec: "01", name: "buildCoverageAuditMessages", trig: "写作方案「落地覆盖审计」", entry: "runCoverageAudit()", gw: "chatViaGateway(page=bid-workspace · max=8192)" },

  "3.1": { sec: "02", name: "buildOutlineMessages", trig: "新建方案点「生成大纲」", entry: "generateOutlineDraft()", gw: "llmGenerate→chatViaGateway(page=solution-studio)" },
  "3.2": { sec: "02", name: "buildChapterMessages", trig: "逐章「生成正文」/「批量生成」", entry: "runGenerateChapter() / runBulkGenerate()", gw: "llmGenerate→chatViaGateway(page=solution-studio)" },
  "3.3": { sec: "02", name: "buildRefineMessages", trig: "章「改写 / 扩写 / 精简」", entry: "runRefineChapter()", gw: "llmGenerate→chatViaGateway(page=solution-studio)" },
  "3.4": { sec: "02", name: "buildChapterReviewMessages", trig: "章「五维自检评分」", entry: "runChapterReview()", gw: "llmGenerate→chatViaGateway(page=solution-studio · max=MAX_TOKENS_REVIEW)" },

  "4.0": { sec: "03", name: "deckSystem(ctx)", block: true, used: "公共人设块，拼进 4.1/4.2/4.3 PPT 生成器 system" },
  "4.0b": { sec: "03", name: "VISUAL_RULES", block: true, used: "图文并茂规则块，拼进 4.1/4.3 system" },
  "4.1": { sec: "03", name: "buildDeckSingleMessages", trig: "≤10 页「一次生成整套 PPT」", entry: "generateDeck()@536", gw: "llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck · max=8192)" },
  "4.2": { sec: "03", name: "buildDeckOutlineMessages", trig: "分批第一步「生成页大纲」", entry: "generateDeck()@540", gw: "llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck · max=4096)" },
  "4.3": { sec: "03", name: "buildDeckBatchMessages", trig: "分批第二步「逐批生成正文」", entry: "generateDeck()@548", gw: "llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck)" },
  "4.4": { sec: "03", name: "buildSlideRefineMessages", trig: "单页「改写 / 扩写 / 精简」", entry: "refineSlide()@683", gw: "llmGenerate→chatViaGateway(page=ppt-quote · scope=ppt-deck · max=4096)" },
  "4.5": { sec: "03", name: "buildQuoteDraftMessages", trig: "「报价清单初稿」生成", entry: "genQuoteDraft()@1454", gw: "llmGenerate→chatViaGateway(page=ppt-quote · scope=quote-draft · max=8192)" },

  "5.1": { sec: "04", name: "PROFILE_SYSTEM_PROMPT / buildProfileMessages / buildExtractMessages", trig: "医院详情「AI 补全档案」(输入医院名) / 粘贴文字「从文本提取」", entry: "doAiMatch()@887 / extractFromText()@1016", gw: "chatViaGateway(page=customer-management · scope=customer-profile · max=2000)" },
  "5.2": { sec: "04", name: "buildSuggestionMessages", trig: "商机详情「AI 跟进建议」", entry: "useCustomerManagement@1546", gw: "chatViaGateway(page=customer-management)" },

  "6.1": { sec: "05", name: "ANALYSIS_SYSTEM_PROMPT", trig: "竞品详情「AI 分析」", entry: "useCompetitorAnalysis@201", gw: "chatViaGateway(page=competitors · temperature=0.3 · max=4096)" },
  "6.2": { sec: "05", name: "TALK_SYSTEM_PROMPT", trig: "「生成差异化竞争话术」", entry: "useCompetitorTalks@105", gw: "chatViaGateway(page=competitors · temperature=0.4 · max=3072)" },

  "7.1": { sec: "06", name: "buildTagMessages", trig: "情报条目「AI 摘要打标」/ 批量增强", entry: "runAiTag()@1155", gw: "chatViaGateway(page=intel-center · max=1024)" },
  "7.2": { sec: "06", name: "doWeeklyReport 内联 prompt", trig: "「生成售前情报周报」(近 7 天)", entry: "doWeeklyReport()@1494", gw: "chatViaGateway(page=intel-center · max=2048)" },

  "8.1": { sec: "07", name: "KB_QA_SYSTEM_PROMPT", trig: "知识库问答输入问题", entry: "ask()@1333", gw: "chatViaGateway(page=knowledge · scope=kb-qa · cacheable=true · max=4096)", note: "唯一开启精确响应缓存：同模型+同完整 messages 命中直接返回、不再出站计费" },

  "9.1": { sec: "08", name: "buildSystemPrompt", trig: "小智对话发送", entry: "useAssistant send()@642", gw: "chatViaGateway(page=assistant · signal 可中断 · max=4096)", note: "for(;;) 每轮重拼 system，支持 [[FETCH:]] 取数回填后继续作答" },
  "9.2": { sec: "08", name: "MEMORY_FACT_RULES", block: true, used: "拼进 9.1 记忆抽取协议（同 isOneOffFact 口径）；与助手 send() 的 [[MEMORY]] 解析同约束" },
  "9.3": { sec: "08", name: "skillPromptBlock", block: true, used: "经 injectSkillBlock() 注入标书/方案/PPT/客户/知识库调用（按 scope 取技能）" },

  "10.1": { sec: "09", name: "合规矩阵 AI 补扫(内联)", trig: "合规矩阵「AI 补扫」(四类条款)", entry: "runAiScan()@98", gw: "chatViaGateway(page=bid-workspace · max=4096)", model: MODEL_PLATFORM },
  "10.2": { sec: "09", name: "建设清单语义匹配(内联)", trig: "建设清单导入后「语义匹配」", entry: "checklistLogic@642", gw: "llmGenerate→chatViaGateway(page=solution-studio · scope=checklist-match · temperature=0)" },
  "10.3": { sec: "09", name: "TEST_PROMPT", trig: "模型配置页「测试」", entry: "testGatewayModel()@306", gw: "平台→callLlmWithFallback(page=model-config) · 个人→POST /api/model-gw/test" },
}

const FILES = {
  "00": { file: "00-公共底座.md", title: "第一部分 公共底座（跨模块复用）" },
  "01": { file: "01-标书工作台.md", title: "第二部分 标书工作台 BidWorkspace" },
  "02": { file: "02-方案工作室.md", title: "第三部分 方案工作室 SolutionStudio" },
  "03": { file: "03-PPT与报价.md", title: "第四部分 PPT 与报价 PptQuote" },
  "04": { file: "04-客户管理.md", title: "第五部分 客户管理 CustomerManagement" },
  "05": { file: "05-竞品分析.md", title: "第六部分 竞品分析 Competitors" },
  "06": { file: "06-情报中心.md", title: "第七部分 情报中心 IntelCenter" },
  "07": { file: "07-知识库问答.md", title: "第八部分 知识库问答" },
  "08": { file: "08-站内助手.md", title: "第九部分 站内助手「小智」" },
  "09": { file: "09-其他内联工具.md", title: "第十部分 其他内联 / 工具 Prompt" },
}

function chainLine(id) {
  const e = E[id]
  if (!e) return null
  if (e.block) return `**调用链：** 共享文本块，非独立 LLM 调用 —— ${e.used}`
  const model = e.model || MODEL_DEF
  const extra = e.note ? ` ｜ ${e.note}` : ""
  return `**调用链：** 触发=${e.trig} ｜ 入口=\`${e.entry}\` ｜ 网关=\`${e.gw}\` ｜ 模型=${model}${extra}`
}

const raw = fs.readFileSync(SRC, "utf8").split(CR).join("")
const lines = raw.split(NL)

const partRe = /^# (第[一二三四五六七八九十]+部分.*)$/
const partTitleToSec = { 一: "00", 二: "01", 三: "02", 四: "03", 五: "04", 六: "05", 七: "06", 八: "07", 九: "08", 十: "09" }
const sections = {}
let appendix = []
let curSec = null
let inAppendix = false
for (const ln of lines) {
  const m = ln.match(partRe)
  if (m) {
    const cn = m[1].match(/第([一二三四五六七八九十]+)部分/)[1]
    curSec = partTitleToSec[cn] || null
    inAppendix = false
    if (curSec && !sections[curSec]) sections[curSec] = []
    continue
  }
  if (/^# 附录/.test(ln)) {
    inAppendix = true
    curSec = null
    appendix.push(ln)
    continue
  }
  if (/^# /.test(ln)) {
    curSec = null
    inAppendix = false
    continue
  }
  if (inAppendix) appendix.push(ln)
  else if (curSec) sections[curSec].push(ln)
}

function injectChains(secLines) {
  const out = []
  let pending = null
  for (let i = 0; i < secLines.length; i++) {
    const ln = secLines[i]
    const hm = ln.match(/^## ([0-9]+\.[0-9]+[a-zA-Z]*)/)
    if (hm) {
      pending = hm[1]
      out.push(ln)
      continue
    }
    if (pending && /^> /.test(ln)) {
      out.push(ln)
      while (i + 1 < secLines.length && /^> /.test(secLines[i + 1])) {
        i++
        out.push(secLines[i])
      }
      const cl = chainLine(pending)
      if (cl) {
        out.push("")
        out.push(cl)
      }
      pending = null
      continue
    }
    out.push(ln)
  }
  return out
}

fs.mkdirSync(OUT_DIR, { recursive: true })
const idOrder = Object.keys(E)
for (const [sec, meta] of Object.entries(FILES)) {
  const body = injectChains(sections[sec] || [])
  while (body.length && body[0].trim() === "") body.shift()
  const idsHere = idOrder.filter((id) => E[id].sec === sec)
  const head = [
    `# ${meta.title}`,
    "",
    "> 本文件由母文档 `docs/系统提示词分类手册.md` 按模块拆分生成，逐字原文与源码一致；每条提示词下方新增「**调用链**」。",
    "> 索引 / 网关与模型路由 / 调用链速查总表 见 [`README.md`](./README.md)。",
    "",
    `**本模块条目：** ${idsHere.map((id) => `${id} ${E[id].name.split(" ")[0]}`).join("　·　")}`,
    "",
    "---",
    "",
  ]
  fs.writeFileSync(path.join(OUT_DIR, meta.file), head.concat(body).join(NL).trimEnd() + NL, "utf8")
}

function tableFor(sec) {
  const ids = idOrder.filter((id) => E[id].sec === sec)
  const rows = ids.map((id) => {
    const e = E[id]
    const model = e.block ? MODEL_BLOCK : e.model || MODEL_DEF
    const trigger = e.block ? `共享块：${e.used}` : e.trig
    const entry = e.block ? "—" : e.entry
    const gw = e.block ? "—" : e.gw
    return `| ${id} | ${e.name} | ${trigger} | ${entry} | ${gw} | ${model} |`
  })
  return [`### ${FILES[sec].title}`, "", "| 编号 | 构造器 / 常量 | 用户触发 | 入口函数 | 网关(page·参数·scope) | 模型路由 |", "|---|---|---|---|---|---|", ...rows].join(NL)
}

const readmeParts = [
  "# 小智工作站 AI 提示词手册（分模块 · 含调用链）",
  "",
  "> 版本：merged-v1.0/R32-2026-09-23　｜　母文档（单文件逐字原文全集）：[`../系统提示词分类手册.md`](../系统提示词分类手册.md)",
  "> 本目录按场景把全部提示词拆成独立文件，并为每条补齐「触发 → 入口函数 → 网关 → 模型路由」调用链。逐字原文取自母文档，未改动。",
  "",
  "## 模块文件索引",
  "",
  "| 文件 | 覆盖 | 条数 |",
  "|---|---|---|",
]
for (const [sec, meta] of Object.entries(FILES)) {
  const ids = idOrder.filter((id) => E[id].sec === sec)
  readmeParts.push(`| [\`${meta.file}\`](./${meta.file}) | ${meta.title} | ${ids.length} |`)
}
readmeParts.push(
  "",
  "## 网关与模型路由（全局）",
  "",
  "- 所有生成调用统一走前端 `@/lib/modelGateway.ts` 的 `chatViaGateway({ modelRef, messages, page, max_tokens, temperature, signal?, cacheable? })`。",
  "- **个人模型优先**：选了用户配置的模型时，经 PocketBase 代理 `POST /api/model-gw/chat` 出站（前端绝不直连第三方）；`fallback_to_platform` 或无个人配置 → **自动回退平台内置 `gpt-5.5`**（走 `callLlmWithFallback`，poll-first）。",
  "- **page 标签**（网关侧计费/日志维度）：`bid-workspace` / `solution-studio` / `ppt-quote` / `customer-management` / `competitors` / `intel-center` / `knowledge` / `assistant` / `model-config`。",
  "- **技能注入**：`injectSkillBlock(messages, skillBlockFor(scope))` 在 bid/solution/ppt/customer/kb 侧把「用户指定工作技能」(9.3) 拼进 system；scope 如 `bid-parse`/`bid-defense`/`ppt-deck`/`quote-draft`/`customer-profile`/`kb-qa`/`checklist-match`。",
  "- **确定性任务 temperature=0**：解析(2.1)、事实设定(2.22)、JSON 修复(2.25)、清单匹配(10.2)。",
  "- **精确响应缓存 cacheable=true**：仅知识库问答(8.1)，命中口径=同模型+同完整 messages+同参数。",
  "- **强制平台模型**：合规矩阵 AI 补扫(10.1) `modelRef:null`，不依赖页面选择。",
  "",
  `## 调用链速查总表（全 ${idOrder.length} 条）`,
  "",
)
for (const sec of Object.keys(FILES)) {
  readmeParts.push(tableFor(sec), "")
}
readmeParts.push("---", "", ...appendix)

let readme = readmeParts.join(NL).replace(new RegExp(NL + "{3,}", "g"), NL + NL)
fs.writeFileSync(path.join(OUT_DIR, "README.md"), readme.trimEnd() + NL, "utf8")

// 在母文档顶部加拆分指引（幂等：已存在标记则跳过）
if (!raw.includes("docs/提示词手册/README.md")) {
  const marker = "> 📁 本文件已按模块拆分并补充「调用链」，分模块版本见 [`docs/提示词手册/README.md`](./提示词手册/README.md)。本单文件仍是逐字原文全集母版。"
  const nl = raw.indexOf(NL)
  const updated = raw.slice(0, nl + 1) + marker + NL + raw.slice(nl + 1)
  fs.writeFileSync(SRC, updated, "utf8")
}

console.log(`[split-prompts] OK -> ${OUT_DIR}`)
console.log(`  模块文件：${Object.keys(sections).length} 个 + README.md（共 ${idOrder.length} 条已注入调用链）`)
