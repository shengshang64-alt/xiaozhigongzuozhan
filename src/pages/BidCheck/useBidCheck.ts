// ---------------------------------------------------------------------------
// useBidCheck —— 标书检查中枢状态编排（数据 + 配置 + 运行），UI 局部态留在 Page。
//
// 输入两态：上传文件（docx/pdf → inspectFile）或选择标书项目（→ buildDocContextFromProject）。
// ⚠️ 全程只读：不改正文、不写库、不回写原文件；配置仅落 localStorage。
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { pbJsonRequest } from "@/lib/pbJson"
import { decodeRhToken } from "@/lib/rhLogin"
import { chatViaGateway } from "@/lib/modelGateway"
import { useCostConfirm } from "@/hooks/useCostConfirm"
import {
  applyConfidence,
  buildReviewInputs,
  buildReviewPrompt,
  parseReviewResponse,
  pickReviewCandidates,
  REVIEW_BATCH_MAX,
} from "./semanticReview"
import type { BidProjectRecord } from "@/pages/BidWorkspace/bidTypes"
import type { BidCheckMode, BidCheckResult, DocContext } from "./bidCheckTypes"
import { inspectFile } from "./engine/docxInspect"
import {
  buildDocContextFromProject,
  projectIdentityWords,
  projectSealed,
  runCheck,
} from "./runCheck"
import { readCheckConfig, writeCheckConfig, type CheckConfig } from "./config/checkConfig"
import { readAnbidCheckConfig, writeAnbidCheckConfig, type AnbidCheckConfig } from "./config/anbidCheckConfig"

type ListResponse<T> = { items: T[]; page: number; perPage: number; totalItems: number }

export type CheckSource =
  | { kind: "none" }
  | { kind: "file"; file: File }
  | { kind: "project"; record: BidProjectRecord }

export function useBidCheck() {
  const [mode, setMode] = useState<BidCheckMode>("normal")
  const [source, setSource] = useState<CheckSource>({ kind: "none" })
  const [running, setRunning] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [result, setResult] = useState<BidCheckResult | null>(null)
  // R273：AI 语义复核（置信度）复用全站计费契约 hook，用户点击「AI 复核」时才走付费确认
  const costConfirm = useCostConfirm()

  const [projects, setProjects] = useState<BidProjectRecord[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)

  const [checkCfg, setCheckCfg] = useState<CheckConfig>(() => readCheckConfig())
  const [anbidCfg, setAnbidCfg] = useState<AnbidCheckConfig>(() => readAnbidCheckConfig())

  // ---- 项目列表（复用与标书工作台一致的自定义路由）----
  const loadProjects = useCallback(async () => {
    const uid = decodeRhToken()?.sub
    if (!uid) return
    setProjectsLoading(true)
    try {
      const data = await pbJsonRequest<ListResponse<BidProjectRecord>>(
        `/api/bid_projects?rh_user_id=${encodeURIComponent(uid)}&page=1&perPage=200`,
      )
      setProjects(data.items ?? [])
    } catch {
      toast.error("标书项目列表加载失败，可改用「上传文件」方式检查")
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  useEffect(() => {
    // 微任务启动首拉：所有 setState 落在 fetch 完成后的异步回调，规避 set-state-in-effect 保守告警（同 useAiHot）
    void Promise.resolve().then(() => loadProjects())
  }, [loadProjects])

  // ---- 配置读写（落 localStorage + 同步内存态）----
  const patchCheckCfg = useCallback((patch: Partial<CheckConfig>) => setCheckCfg(writeCheckConfig(patch)), [])
  const patchAnbidCfg = useCallback((patch: Partial<AnbidCheckConfig>) => setAnbidCfg(writeAnbidCheckConfig(patch)), [])

  // ---- 选择来源 ----
  const pickFile = useCallback((file: File) => {
    const lower = file.name.toLowerCase()
    if (!lower.endsWith(".docx") && !lower.endsWith(".pdf")) {
      toast.error("仅支持 .docx 或 .pdf 文件")
      return
    }
    setSource({ kind: "file", file })
    setResult(null)
  }, [])

  const pickProject = useCallback(
    (id: string) => {
      const rec = projects.find((p) => p.id === id)
      if (!rec) return
      setSource({ kind: "project", record: rec })
      setResult(null)
      // 项目声明暗标 → 建议切到暗标严格模式（用户仍可手动切回）
      if (projectSealed(rec)) setMode("sealed")
    },
    [projects],
  )

  const clearSource = useCallback(() => {
    setSource({ kind: "none" })
    setResult(null)
  }, [])

  const sourceLabel = useMemo(() => {
    if (source.kind === "file") return source.file.name
    if (source.kind === "project") return source.record.project_name || "未命名项目"
    return ""
  }, [source])

  // ---- 执行检查 ----
  const run = useCallback(async () => {
    if (source.kind === "none") {
      toast.error("请先上传文件或选择标书项目")
      return
    }
    setRunning(true)
    try {
      let ctx: DocContext
      let extraIdentityWords: string[] = []
      let project: BidProjectRecord | null = null
      if (source.kind === "file") {
        ctx = await inspectFile(source.file)
      } else {
        ctx = buildDocContextFromProject(source.record)
        extraIdentityWords = projectIdentityWords(source.record)
        project = source.record
      }
      const res = runCheck(ctx, mode, checkCfg, anbidCfg, extraIdentityWords, project)
      setResult(res)
      const s = res.summary
      if (s.fail > 0) toast.warning(`检查完成：${s.fail} 项命中必改、${s.warn} 项建议整改`)
      else if (s.warn > 0) toast.success(`检查完成：${s.warn} 项建议整改，无必改项`)
      else toast.success("检查完成：未发现需整改问题")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "检查失败，请稍后重试")
    } finally {
      setRunning(false)
    }
  }, [source, mode, checkCfg, anbidCfg])

  // ---- R273：AI 语义复核（置信度标注） ----
  // 用户点击「AI 复核」按钮触发：从当前 result 挑 fail/warn 项（按严重度排序，取前 REVIEW_BATCH_MAX 条）
  // 组 prompt 调 chatViaGateway（默认平台模型，cacheable 复用同 prompt 会话结果），
  // 拿到 confidence 后通过 applyConfidence 生成新 result（不改 status/pass/fail，只填 confidence 字段）。
  const runSemanticReview = useCallback(() => {
    if (!result || reviewing) return
    const candidates = pickReviewCandidates(result.items)
    if (candidates.length === 0) {
      toast.info("当前没有需要复核的疑似问题（fail/warn 为 0）")
      return
    }
    costConfirm.runWithCostConfirm(() => {
      void (async () => {
        setReviewing(true)
        try {
          const inputs = buildReviewInputs(candidates)
          const { system, user } = buildReviewPrompt(inputs)
          const res = await chatViaGateway({
            modelRef: null,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            page: "bid-check",
            max_tokens: 1024,
            temperature: 0.1,
            cacheable: true,
          })
          if (!res.ok || !res.text) {
            throw new Error(res.error || "AI 复核失败，请稍后重试")
          }
          const parsed = parseReviewResponse(res.text)
          if (parsed.length === 0) {
            throw new Error("AI 复核响应解析失败，请稍后重试")
          }
          const nextItems = applyConfidence(result.items, parsed)
          setResult({ ...result, items: nextItems })
          toast.success(`AI 复核完成，已为 ${parsed.length} 条疑似问题标注置信度`)
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "AI 复核失败，请稍后重试")
        } finally {
          setReviewing(false)
        }
      })()
    }, `AI 将读取本次检查前 ${Math.min(candidates.length, REVIEW_BATCH_MAX)} 条疑似问题的原文片段用于误报识别，按 token 计费`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, reviewing, costConfirm.runWithCostConfirm])

  return {
    mode,
    setMode,
    source,
    sourceLabel,
    pickFile,
    pickProject,
    clearSource,
    running,
    result,
    run,
    reviewing,
    runSemanticReview,
    costConfirm,
    projects,
    projectsLoading,
    checkCfg,
    patchCheckCfg,
    anbidCfg,
    patchAnbidCfg,
  }
}

export type BidCheckVm = ReturnType<typeof useBidCheck>
