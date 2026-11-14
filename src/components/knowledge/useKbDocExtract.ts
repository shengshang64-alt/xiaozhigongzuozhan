// 「抽为原子」动作 Hook（文档库屏 / 检索屏的文档卡共用）。
//
// ## 为什么单独一个 Hook
//
// 抽原子是一条**长链路**（取全文 → 分段 → 逐段调模型 → 质量校验 → 回填 anchor → 落库），
// 每一步都可能失败，而且会花钱。把它塞进页面组件会让页面文件超 400 行，
// 也会让「进行中 / 成功 / 失败」三态散落在 JSX 的三元表达式里。
//
// ## 纪律
//
// ① 花钱的动作一律走 useCostConfirm.runWithCostConfirm（审计依赖这个固定写法）。
// ② 长任务必须有阶段名与进度（契约 4.4：异步 > 30s 要进度条 + 阶段名 + 已用时 + 取消）。
// ③ 失败要说人话（哪一步失败、为什么），不许把失败说成「没抽出内容」。
//
// ## 与既有数据层的关系
//
// - `kbExtract.ts`（既有）负责切段 / 调模型 / 校验 / 回填 anchor —— 逻辑不动。
// - `POST /api/kb/atoms`（既有）负责落库，服务端会顺带回填 kb_docs.atom_count。

import { useCallback, useRef, useState } from "react"
import { callLlmWithFallback } from "@/lib/llm"
import { getKbDoc } from "@/lib/kbCore"
import { getPocketBaseUrl } from "@/lib/pb"
import { vibexAuthHeaders } from "@/lib/rhLogin"
import { extractAtomsFromDoc, extractSummary, prepareAtomsForInsert } from "@/pages/Knowledge/kbExtract"
import type { KbDocMeta } from "@/components/knowledge/kbDocMeta"

export type ExtractStage = "取全文" | "调用模型抽取" | "质量校验" | "落库"

export type ExtractState = {
  /** 正在抽取的文档 id（null = 没在跑） */
  runningDocId: string | null
  stage: ExtractStage
  /** 已完成段数 / 总段数 */
  done: number
  total: number
  error: string | null
  /** 最近一次成功的结果摘要（如「12 段 · 8 段抽出内容 · 共 5 条原子」） */
  lastSummary: string | null
  /** 最近一次抽取产出的原子条数 */
  lastAtomCount: number
}

const IDLE: ExtractState = {
  runningDocId: null,
  stage: "取全文",
  done: 0,
  total: 0,
  error: null,
  lastSummary: null,
  lastAtomCount: 0,
}

export type CostConfirmRunner = (action: () => void, priceText: string) => void

export type KbDocExtractApi = {
  state: ExtractState
  /**
   * 开始抽取。
   * @param runWithCostConfirm 计费确认入口（useCostConfirm.runWithCostConfirm）——
   *   审计依赖「用户显式点击后才发生付费调用」这个固定写法，所以必须由调用方注入。
   */
  extract: (doc: KbDocMeta, modelName: string, priceText: string, runWithCostConfirm: CostConfirmRunner) => void
  /** 清掉错误提示 */
  dismissError: () => void
  /** 中断当前抽取 */
  cancel: () => void
}

export function useKbDocExtract(): KbDocExtractApi {
  const [state, setState] = useState<ExtractState>(IDLE)
  const abortRef = useRef(false)

  const cancel = useCallback(() => {
    abortRef.current = true
    setState((s) => ({ ...s, runningDocId: null }))
  }, [])

  const dismissError = useCallback(() => setState((s) => ({ ...s, error: null })), [])

  const run = useCallback(async (doc: KbDocMeta, modelName: string) => {
    abortRef.current = false
    setState({ ...IDLE, runningDocId: doc.id, stage: "取全文" })
    try {
      const full = await getKbDoc(doc.id)
      const content = full.content ?? ""
      if (!content.trim()) {
        setState((s) => ({ ...s, runningDocId: null, error: "这篇文档还没有解析出正文（可能是扫描件或纯图片 PPT），抽不出原子。" }))
        return
      }
      if (abortRef.current) return
      setState((s) => ({ ...s, stage: "调用模型抽取" }))
      const result = await extractAtomsFromDoc(content, {
        docTitle: doc.title,
        callLlm: async (messages) => {
          const r = await callLlmWithFallback(modelName, { messages })
          if (!r.ok) throw new Error(r.error || "模型调用失败")
          return r.text
        },
        onProgress: (done, total) => {
          if (abortRef.current) return
          setState((s) => ({ ...s, stage: "调用模型抽取", done, total }))
        },
      })
      if (abortRef.current) return
      setState((s) => ({ ...s, stage: "质量校验" }))
      const ready = prepareAtomsForInsert(result.atoms, content, doc.id)
      if (!ready.length) {
        setState((s) => ({
          ...s,
          runningDocId: null,
          error: `抽取完成，但没有一条通过质量校验（${extractSummary(result)}）。原文已保留，可在「原子审核」里调提示词后重抽。`,
        }))
        return
      }
      setState((s) => ({ ...s, stage: "落库" }))
      const res = await fetch(`${getPocketBaseUrl()}/api/kb/atoms`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...vibexAuthHeaders() },
        body: JSON.stringify({ atoms: ready, source_doc_id: doc.id }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; created?: number; message?: string }
      if (!res.ok || j.ok === false) {
        setState((s) => ({ ...s, runningDocId: null, error: j.message ?? `落库失败（HTTP ${res.status}）` }))
        return
      }
      setState({
        ...IDLE,
        lastSummary: extractSummary(result),
        lastAtomCount: Number(j.created ?? ready.length),
      })
    } catch (e) {
      setState((s) => ({
        ...s,
        runningDocId: null,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }, [])

  const extract = useCallback(
    (doc: KbDocMeta, modelName: string, priceText: string, runWithCostConfirm: CostConfirmRunner) => {
      if (!modelName) {
        setState((s) => ({ ...s, error: "还没有配置 AI 模型，无法抽取原子。请先到「模型配置」里配一个可用通道。" }))
        return
      }
      // 计费确认：访客自己付费的形态下必须弹窗确认（审计依赖这一固定写法）
      runWithCostConfirm(() => void run(doc, modelName), priceText)
    },
    [run],
  )

  return { state, extract, dismissError, cancel }
}
