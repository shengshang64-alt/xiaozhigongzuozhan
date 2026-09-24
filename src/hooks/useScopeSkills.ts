// ---------------------------------------------------------------------------
// useScopeSkills — 页面 hook 用的「单功能点技能选择」Logic
// 负责：拉技能、勾选/填空位、localStorage 持久化、注册进 skillCore 模块注册表
// View 只消费返回的 props（SkillPicker 受控），生成函数经 skillBlockFor(scope) 取块。
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SkillRow } from "@/lib/assistantCore"
import {
  loadSkillSelection,
  loadSkillsForScope,
  presetSkillsForScope,
  registerScopeSkills,
  saveSkillSelection,
  skillPromptBlock,
  unregisterScopeSkills,
  type SkillScope,
} from "@/lib/skillCore"

export interface UseScopeSkills {
  scopeSkills: SkillRow[]
  skillsLoading: boolean
  selectedIds: string[]
  filledVars: Record<string, Record<string, string>>
  toggleSkill: (id: string) => void
  setSkillVar: (id: string, slot: string, value: string) => void
  getSkillBlock: () => string
  getSkillCount: () => number
}

export function useScopeSkills(scope: SkillScope, userId?: string): UseScopeSkills {
  // 预置技能（系统内置）始终可用；与用户自定义技能合并后进 picker 可选池
  const presetSkills = useMemo(() => presetSkillsForScope(scope), [scope])
  const [customSkills, setCustomSkills] = useState<SkillRow[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => loadSkillSelection(scope).ids)
  const [filledVars, setFilledVars] = useState<Record<string, Record<string, string>>>(
    () => loadSkillSelection(scope).vars,
  )

  // 拉取该功能点用户自定义技能（用户隔离）；预置技能不依赖 userId，未登录也展示
  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setCustomSkills([])
      return
    }
    setSkillsLoading(true)
    loadSkillsForScope(scope, userId)
      .then((rows) => {
        if (!cancelled) setCustomSkills(rows)
      })
      .catch(() => {
        if (!cancelled) setCustomSkills([])
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scope, userId])

  // 可选池：预置在前、自定义在后，按 id 去重（preset: 前缀与 PB 行天然不冲突）
  const scopeSkills = useMemo(() => {
    const map = new Map<string, SkillRow>()
    for (const s of presetSkills) map.set(s.id, s)
    for (const s of customSkills) map.set(s.id, s)
    return [...map.values()]
  }, [presetSkills, customSkills])

  // 技能列表变化后裁剪已失效的勾选（被删除 / scope 被改走的技能）
  useEffect(() => {
    if (!scopeSkills.length) return
    setSelectedIds((prev) => {
      const valid = prev.filter((id) => scopeSkills.some((s) => s.id === id))
      return valid.length === prev.length ? prev : valid
    })
  }, [scopeSkills])

  // 持久化勾选与空位值
  useEffect(() => {
    saveSkillSelection(scope, { ids: selectedIds, vars: filledVars })
  }, [scope, selectedIds, filledVars])

  // 按勾选顺序组装技能块
  const orderedSkills = useMemo(
    () =>
      selectedIds
        .map((id) => scopeSkills.find((s) => s.id === id))
        .filter((s): s is SkillRow => !!s),
    [selectedIds, scopeSkills],
  )
  const skillBlock = useMemo(() => skillPromptBlock(orderedSkills, filledVars), [orderedSkills, filledVars])

  const blockRef = useRef(skillBlock)
  blockRef.current = skillBlock
  const countRef = useRef(orderedSkills.length)
  countRef.current = orderedSkills.length

  const getSkillBlock = useCallback(() => blockRef.current, [])
  const getSkillCount = useCallback(() => countRef.current, [])

  // 注册进模块注册表，供 llmGenerate(scope) / 计费文案按 scope 取用
  useEffect(() => {
    const source = { getBlock: getSkillBlock, getCount: getSkillCount }
    registerScopeSkills(scope, source)
    return () => unregisterScopeSkills(scope, source)
  }, [scope, getSkillBlock, getSkillCount])

  const toggleSkill = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }, [])

  const setSkillVar = useCallback((id: string, slot: string, value: string) => {
    setFilledVars((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [slot]: value } }))
  }, [])

  return {
    scopeSkills,
    skillsLoading,
    selectedIds,
    filledVars,
    toggleSkill,
    setSkillVar,
    getSkillBlock,
    getSkillCount,
  }
}
