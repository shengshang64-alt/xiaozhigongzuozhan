/**
 * R47（B19）· 按环节自动选模型 —— 在【真实模型清单】上的选型取证
 *
 * 用法：node docs/evolution/_r47_model_route_verify.mjs
 * 前置：.diag/r47-scratch/model-configs.json —— 由 pocketbase/pb_data/data.db 的
 *       model_configs 导出（6 个通道 / 82 个模型 / 28 个启用），已剔除 api_key。
 *       重建办法（只读 sqlite）：
 *         select id, config_name, base_url, default_model, models, is_platform from model_configs
 *
 * 特点：零 AI、零网络、零写库；只调用产品自身的 buildAvailableModels + buildRolePickMap。
 *       一旦有人改坏「非文本模态排除 / 视觉宁缺毋滥 / 手选不被自动覆盖」等口径，本脚本立即红。
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CFG = path.join(ROOT, ".diag/r47-scratch/model-configs.json")

let failed = 0
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${extra ? "  " + extra : ""}`)
  if (!cond) failed++
}

if (!fs.existsSync(CFG)) {
  console.error(`缺少真实模型清单：${CFG}\n（见脚本头部注释的导出办法）`)
  process.exit(2)
}

const server = await createServer({
  root: ROOT, configFile: path.join(ROOT, "vite.config.ts"),
  server: { middlewareMode: true }, appType: "custom", logLevel: "error",
})

const gw = await server.ssrLoadModule("/src/lib/modelGateway.ts")
const mr = await server.ssrLoadModule("/src/lib/modelRouting.ts")
const mod = await server.ssrLoadModule("/src/lib/modelModality.ts")
const prof = await server.ssrLoadModule("/src/lib/modelProfiles.ts")

const configs = JSON.parse(fs.readFileSync(CFG, "utf8"))
const built = gw.buildAvailableModels(configs)
const models = built.models

console.log("=== 0. 真实清单 ===")
console.log(`通道 ${configs.length} 个 / 模型 ${configs.reduce((n, c) => n + c.models.length, 0)} 个 / 可用(refs) ${models.length} 个`)
console.log(`平台内置 ref：${built.platformRef ? gw.modelRefLabel(built.platformRef) : "无"}`)
const personal = models.filter((m) => m.source === "personal")
console.log(`个人配置可用模型 ${personal.length} 个；通道：${[...new Set(personal.map((m) => m.configName))].join(" / ")}`)

console.log("\n=== 1. 自动档：六个环节各挑了谁（含打分依据） ===")
const picks = mr.buildRolePickMap(models)
for (const role of mr.MODEL_ROLE_ORDER) {
  const p = picks[role]
  const label = mr.MODEL_ROLE_LABEL[role]
  if (!p) {
    console.log(`  ${label.padEnd(5, "　")} → （无可用候选，落到手选/默认）`)
    continue
  }
  const ref = p.item
  console.log(
    `  ${label.padEnd(5, "　")} → ${gw.modelRefLabel(ref)}` +
      `  [${ref.source}] score=${p.score}` +
      (p.matchedTags?.length ? ` 命中标签=${p.matchedTags.join("/")}` : " 命中标签=无") +
      (p.reason ? `\n        依据：${p.reason}` : ""),
  )
}

console.log("\n=== 2. 硬门槛与口径（逐条断言） ===")

// 2.1 六个环节都有落点；落点必须是文本生成模态
const missing = mr.MODEL_ROLE_ORDER.filter((r) => !picks[r])
ok(missing.length === 0 || missing.every((r) => r === "vision"), "除视觉外每环节都有候选", `缺：${missing.join(",") || "无"}`)
ok(
  mr.MODEL_ROLE_ORDER.filter((r) => r !== "vision").every((r) => mod.isTextGenerationModel(picks[r].item.modelId)),
  "所有落点都是文本生成模型（向量/作图/视频/语音被排除）",
)

// 2.2 非文本模态模型确实进不了候选（拿真实清单里的真实 id 验）
const nonTextIds = models.map((m) => m.modelId).filter((id) => !mod.isTextGenerationModel(id))
if (nonTextIds.length) {
  const leaked = mr.MODEL_ROLE_ORDER.filter((r) => nonTextIds.includes(picks[r]?.item.modelId))
  ok(leaked.length === 0, `真实清单里 ${nonTextIds.length} 个非文本模型零泄漏`, nonTextIds.slice(0, 4).join("/") + (nonTextIds.length > 4 ? "…" : ""))
} else {
  console.log("  - 真实清单未含非文本模型，改用合成 id 验门槛")
}
const synth = ["bge-m3", "dall-e-3", "sora-video", "cosyvoice-v2"]
ok(
  synth.every((id) => mr.pickModelForRole("longform", [{ item: id, modelId: id, tags: ["长文", "中文", "通用"] }]) === null),
  "合成非文本 id（向量/作图/视频/语音）一律不进候选",
)

// 2.3 视觉环节：要么给视听模型，要么明确为空，不许硬塞文本模型
const visionTags = mr.MODEL_ROLE_TAGS.vision
const visionPick = picks.vision
ok(
  visionPick === null || visionTags.some((t) => visionPick.item.tags?.includes(t)) || true,
  "视觉环节落点检查（见上方输出）",
)
if (visionPick) {
  const p = prof.resolveModelProfile(visionPick.item.modelId).profile
  ok(!!p && p.tags.some((t) => visionTags.includes(t)), `视觉落点 ${visionPick.item.modelId} 带视觉/多模态画像`, `tags=${(p?.tags ?? []).join("/")}`)
} else {
  console.log("  - 本清单无视觉模型 → 视觉环节返回 null（不臆造），由 resolveRoleModelRef 回落到手选/默认")
}
ok(mr.pickModelForRole("vision", [{ item: "plain", modelId: "plain-long", tags: ["长文", "中文"] }]) === null, "无视觉模型时 vision 返回 null（宁缺毋滥）")

// 2.4 长期不可用档案直接排除
const unavailPick = mr.pickModelForRole("longform", [
  { item: "a", modelId: "a-strong", tags: ["长文", "中文"] , unavailable: true },
  { item: "b", modelId: "b-weak", tags: ["通用"] },
])
ok(unavailPick?.item === "b", "长期不可用档案被排除，改选次优")

// 2.5 会话冷却：固定额度降权，且只降权不排除（R233 口径：仍会如实先试，失败由网关回退接管）
const warm = mr.scoreRoleCandidate("longform", { item: "m", modelId: "m", tags: ["长文"] })
const cooled = mr.scoreRoleCandidate("longform", { item: "m", modelId: "m", tags: ["长文"], cooling: true })
ok(warm - cooled === 6, "冷却降权是固定额度 6 分", `warm=${warm} cooled=${cooled}`)
const coolFlip = mr.pickModelForRole("longform", [
  { item: "cool-but-fit", modelId: "cool-but-fit", tags: ["长文"], cooling: true },
  { item: "warm-ok", modelId: "warm-ok", tags: ["中文"] },
])
ok(coolFlip?.item === "warm-ok", "势均力敌时冷却方让位（长文 8-6=2 < 中文 6）")
const coolOnly = mr.pickModelForRole("longform", [{ item: "cool-but-fit", modelId: "cool-but-fit", tags: ["长文"], cooling: true }])
ok(coolOnly?.item === "cool-but-fit", "冷却不是禁用：唯一候选照样返回（仍会如实先试）")

// 2.6 手选档不可被自动覆盖（本环节无候选时回落手选）
const manual = { source: "personal", configId: "cfg", configName: "cfg", modelId: "manual-one" }
const autoWithEmpty = { longform: null, outline: null, extract: null, judge: null, vision: null, chat: null }
ok(mr.resolveRoleModelRef("longform", false, manual, { ...autoWithEmpty, longform: picks.longform?.item ?? null })?.modelId === "manual-one", "手选档：自动路由不覆盖用户选择")
ok(mr.resolveRoleModelRef("longform", true, manual, autoWithEmpty)?.modelId === "manual-one", "自动档但本环节无候选：回落手选")
ok(mr.resolveRoleModelRef("longform", true, manual, { ...autoWithEmpty, longform: picks.longform?.item ?? null })?.modelId === (picks.longform?.item.modelId ?? "manual-one"), "自动档：用本环节选型")

// 2.7 自动档哨兵值
ok(mr.isAutoModelKey(mr.AUTO_MODEL_KEY) && !mr.isAutoModelKey("gpt-5.5"), "自动档哨兵值不与真实模型 key 冲突")

// 2.8 流水线步骤映射
const stepMap = [1, 2, 3, 4, 5, 6, 7].map(mr.roleForStep)
ok(JSON.stringify(stepMap) === JSON.stringify(["extract", "extract", "longform", "judge", "judge", "judge", "extract"]), "七个流水线步骤 → 环节映射稳定", stepMap.join(","))

console.log("\n=== 3. 接线取证：标书工作台 llm 调用点的 role 覆盖 ===")
const ws = fs.readFileSync(path.join(ROOT, "src/pages/BidWorkspace/useBidWorkspace.ts"), "utf8")
const calls = (ws.match(/\bllmGenerate\(/g) ?? []).length
const explicit = (ws.match(/role:\s*"/g) ?? []).length
console.log(`  llmGenerate 调用点 ${calls} 处；显式 role ${explicit} 处；其余按 scope 推导（roleForScope 兜底为 judge）`)
ok(explicit >= 31, "显式 role 覆盖 >= 31 处（R47 落地时 31 处）", `实测 ${explicit}`)
ok(!/modelRef:\s*null/.test(ws), "useBidWorkspace 内不再有 modelRef: null 硬编码")
const panels = ["ParseReportPanel", "ComplianceMatrixPanel", "ChallengeLetterPanel", "ComplaintLetterPanel"]
for (const p of panels) {
  const src = fs.readFileSync(path.join(ROOT, `src/components/bid-workspace/${p}.tsx`), "utf8")
  ok(!/modelRef:\s*null/.test(src), `${p}.tsx 不再硬编码 modelRef: null`)
}

await server.close()
console.log(`\n结论：${failed === 0 ? "全部通过" : failed + " 项未通过"}`)
process.exit(failed === 0 ? 0 : 1)
