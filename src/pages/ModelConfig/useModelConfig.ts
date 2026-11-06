import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { decodeRhToken, type RhAccountInfo } from "@/lib/rhLogin"
import {
  buildAvailableModels,
  createGatewayConfig,
  deleteGatewayConfig,
  listGatewayConfigs,
  modelRefLabel,
  refreshGatewayModels,
  testGatewayModel,
  updateGatewayConfig,
  type GatewayConfig,
  type ModelRef,
  type TestModelResult,
} from "@/lib/modelGateway"
// R296（r294-default-model-hygiene）：模型通道「实测不可用」长期档案——本 hook 只做
// 只读订阅与处置后的清账，写入一律发生在真实调用 / 测试现场（见 modelGateway）。
import {
  clearConfigHealth,
  onHealthChange,
  readModelHealth,
  recordModelSuccess,
  type ModelHealthEntry,
} from "@/lib/modelHealth"
// R-038 模型元数据（擅长/额度）本地存储：不动后端，按用户分桶
import {
  clearUserMetaBucket,
  onModelMetaChange,
  readAllModelMeta,
  upsertModelMeta,
  type ModelMetaEntry,
  type ModelQuota,
} from "@/lib/modelMetaLocal"
import { isPlatformModelLocallyUnusable } from "@/lib/platformModelAvailability"

export interface FormValues {
  config_name: string
  base_url: string
  api_key: string
}

export function useModelConfig() {
  // ------------------------------ 登录态 ------------------------------
  const [userId, setUserId] = useState<string | null>(() => decodeRhToken()?.sub ?? null)
  const [, setAccountInfo] = useState<RhAccountInfo | null>(null)
  const [needsRhLogin, setNeedsRhLogin] = useState(() => !decodeRhToken()?.sub)

  // ------------------------------ R296 模型健康档案（配置卫生） ------------------------------
  // 挂账来源：404 已下线 / 上游停用 / Key 失效三类确定性失效（限流与超时归会话冷却，不进这里）。
  // 首帧由惰性初始化直接读档案；此后只在订阅回调里更新——effect 体内不同步 setState（防级联渲染）。
  const [modelHealth, setModelHealth] = useState<Record<string, ModelHealthEntry>>(
    () => readModelHealth(userId),
  )
  useEffect(() => onHealthChange(() => setModelHealth(readModelHealth(userId))), [userId])

  // R-038：模型元数据（擅长/额度）——同 modelHealth 模式：惰性读 + 订阅变更
  const [modelMeta, setModelMeta] = useState<Record<string, ModelMetaEntry>>(
    () => readAllModelMeta(userId),
  )
  useEffect(() => onModelMetaChange(() => setModelMeta(readAllModelMeta(userId))), [userId])

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setAccountInfo(account)
    const uid = account?.userId ?? decodeRhToken()?.sub ?? null
    // R-038 隐私收口（R119 同族）：登出时清空本用户的模型元数据桶（localStorage 里的擅长/额度）
    const prevUid = decodeRhToken()?.sub ?? null
    if (!uid && prevUid) clearUserMetaBucket(prevUid)
    setUserId(uid)
    setNeedsRhLogin(!uid)
    // R296：档案按用户分桶，换账号即换桶——在事件回调里就地重读，不留陈旧徽标
    setModelHealth(readModelHealth(uid))
    setModelMeta(readAllModelMeta(uid))
  }, [])

  // ------------------------------ 配置列表 ------------------------------
  const [configs, setConfigs] = useState<GatewayConfig[]>([])
  const [listLoading, setListLoading] = useState(true)

  const loadConfigs = useCallback(
    async (silent = false) => {
      if (!silent) setListLoading(true)
      const res = await listGatewayConfigs()
      setListLoading(false)
      if (!res.ok) {
        if (res.needLogin) {
          setNeedsRhLogin(true)
          return
        }
        toast.error(res.message || "读取模型配置失败")
        return
      }
      setNeedsRhLogin(false)
      setConfigs(res.items)
    },
    [],
  )

  useEffect(() => {
    if (userId) void loadConfigs()
    else setListLoading(false)
  }, [userId, loadConfigs])

  // ------------------------------ 派生数据 ------------------------------
  const available = useMemo(() => buildAvailableModels(configs), [configs])
  const platformConfig = useMemo(() => configs.find((c) => c.is_platform) ?? null, [configs])
  const personalConfigs = useMemo(() => configs.filter((c) => !c.is_platform), [configs])
  // R4（横切清理 · 清幽灵模型推荐）：原实现在**一个可用模型都没有**时也把默认标签写成
  // 「平台内置 gpt-5.5」——那是「推荐一个不存在的模型」的标准形态：用户以为有模型可用，
  // 点了才失败（本地域还会 412）。现在分三档如实说：
  //   ① 真有默认模型 → 正常显示它；
  //   ② 没有任何可用模型 → 「未配置可用模型」（与模型下拉的空态同一口径）；
  //   ③ 只剩平台内置且本地不可用 → 「平台内置（本地不可用）」，不假装可用。
  const noModelAvailable = available.models.length === 0
  const defaultLabel = available.defaultRef
    ? modelRefLabel(available.defaultRef)
    : noModelAvailable
      ? "未配置可用模型"
      : "平台内置"
  const defaultSource = available.defaultRef
    ? available.defaultRef.source === "platform"
      ? "平台内置"
      : available.defaultRef.configName
    : noModelAvailable
      ? "无"
      : "平台内置"

  // 是否真有配置显式声明了默认模型；false 意味着当前默认只是平台内置兜底，随时会漂
  const declaredDefault = useMemo(
    () =>
      configs.some(
        (c) => !!c.default_model && (c.models ?? []).some((m) => m.enabled && m.id === c.default_model),
      ),
    [configs],
  )
  // 有启用模型却没设默认的配置数：网关按「启用列表第一个」兜底 → 顺序一变默认就静默改变
  const missingDefaultCount = useMemo(
    () => personalConfigs.filter((c) => !c.default_model && (c.models ?? []).some((m) => m.enabled)).length,
    [personalConfigs],
  )
  // 仍处于启用态、却已被实测判定不可用的模型数（R294 实测 7 个里 3 个，此前全程静默）
  const unusableCount = useMemo(() => {
    let n = 0
    for (const c of personalConfigs) {
      for (const m of c.models ?? []) {
        if (m.enabled && modelHealth[`personal:${c.id}:${m.id}`]) n += 1
      }
    }
    return n
  }, [personalConfigs, modelHealth])

  // ------------------------------ 新建 / 编辑表单 ------------------------------
  const [formOpen, setFormOpen] = useState(false)
  const [editingConfig, setEditingConfig] = useState<GatewayConfig | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState("")

  const openCreateForm = useCallback(() => {
    setEditingConfig(null)
    setFormError("")
    setFormOpen(true)
  }, [])

  const openEditForm = useCallback((cfg: GatewayConfig) => {
    setEditingConfig(cfg)
    setFormError("")
    setFormOpen(true)
  }, [])

  const closeForm = useCallback(() => {
    setFormOpen(false)
    setEditingConfig(null)
    setFormError("")
  }, [])

  const submitForm = useCallback(
    async (values: FormValues) => {
      setFormBusy(true)
      setFormError("")
      const res = editingConfig
        ? await updateGatewayConfig(editingConfig.id, {
            config_name: values.config_name,
            base_url: values.base_url,
            // Key 留空 = 不修改
            ...(values.api_key ? { api_key: values.api_key } : {}),
          })
        : await createGatewayConfig(values)
      setFormBusy(false)
      if (!res.ok) {
        if (res.needLogin) {
          setNeedsRhLogin(true)
          setFormError("保存失败，请稍后重试")
          return
        }
        setFormError(res.message || "保存失败，请检查后重试")
        return
      }
      closeForm()
      toast.success(editingConfig ? "配置已更新" : "配置已保存，模型列表已拉取")
      // R296：改过配置（Key / 接口地址）就重新给一次机会，此前挂账一律作废
      if (editingConfig) clearConfigHealth(userId, editingConfig.id)
      void loadConfigs(true)
    },
    [editingConfig, closeForm, loadConfigs, userId],
  )

  // ------------------------------ 配置操作 ------------------------------
  const [busyConfigId, setBusyConfigId] = useState<string | null>(null)

  const applyPatch = useCallback(
    async (id: string, patch: Parameters<typeof updateGatewayConfig>[1], okText: string): Promise<boolean> => {
      setBusyConfigId(id)
      const res = await updateGatewayConfig(id, patch)
      setBusyConfigId(null)
      if (!res.ok) {
        if (res.needLogin) {
          setNeedsRhLogin(true)
          toast.error("当前无法执行该操作，请稍后重试")
          return false
        }
        toast.error(res.message || "操作失败，请重试")
        return false
      }
      if (okText) toast.success(okText)
      void loadConfigs(true)
      return true
    },
    [loadConfigs],
  )

  const toggleModel = useCallback(
    (cfg: GatewayConfig, modelId: string, enabled: boolean) => {
      const nextModels = (cfg.models ?? []).map((m) => (m.id === modelId ? { id: m.id, enabled } : { id: m.id, enabled: m.enabled }))
      const patch: Parameters<typeof updateGatewayConfig>[1] = { models: nextModels }
      // 停用的是默认模型时，同时清掉默认（前端回退平台内置）
      if (!enabled && cfg.default_model === modelId) patch.clear_default = true
      void applyPatch(cfg.id, patch, enabled ? "模型已启用" : "模型已停用").then((ok) => {
        // R296：用户主动重新启用 → 只清这一路的「实测不可用」挂账，交给下次实调 / 测试重新证明
        if (ok && enabled) recordModelSuccess(userId, `personal:${cfg.id}:${modelId}`)
      })
    },
    [applyPatch, userId],
  )

  const setDefaultModel = useCallback(
    (cfg: GatewayConfig, modelId: string) => {
      void applyPatch(cfg.id, { default_model: modelId }, `已将「${modelId}」设为系统默认模型`)
    },
    [applyPatch],
  )

  // R-038：保存模型元数据（擅长/额度）到 localStorage，不动后端
  const updateModelMeta = useCallback(
    (cfg: GatewayConfig, modelId: string, patch: { specialty: string; tags: string[]; quota: ModelQuota | null }) => {
      upsertModelMeta(userId, cfg.id, modelId, {
        specialty: patch.specialty || undefined,
        tags: patch.tags.length ? patch.tags : undefined,
        quota: patch.quota || undefined,
        quotaUpdatedAt: patch.quota ? new Date().toISOString() : undefined,
      })
      // 立即刷新本地状态（storage 事件只在跨 tab 触发）
      setModelMeta(readAllModelMeta(userId))
      toast.success("模型标注已保存（仅本机）")
    },
    [userId],
  )

  const refreshModels = useCallback(
    async (cfg: GatewayConfig) => {
      setBusyConfigId(cfg.id)
      const res = await refreshGatewayModels(cfg.id)
      setBusyConfigId(null)
      if (!res.ok) {
        toast.error(res.message || "刷新模型列表失败")
        void loadConfigs(true)
        return
      }
      toast.success("模型列表已刷新")
      // R296：模型列表已重拉，此前的「不可用」判定不再作数（模型可能已改名回来）
      clearConfigHealth(userId, cfg.id)
      void loadConfigs(true)
    },
    [loadConfigs, userId],
  )

  // ------------------------------ 删除（二次确认） ------------------------------
  const [deletingConfig, setDeletingConfig] = useState<GatewayConfig | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const askDelete = useCallback((cfg: GatewayConfig) => setDeletingConfig(cfg), [])
  const cancelDelete = useCallback(() => setDeletingConfig(null), [])

  const confirmDelete = useCallback(async () => {
    if (!deletingConfig) return
    setDeleteBusy(true)
    const res = await deleteGatewayConfig(deletingConfig.id)
    setDeleteBusy(false)
    setDeletingConfig(null)
    if (!res.ok) {
      toast.error(res.message || "删除失败，请重试")
      return
    }
    toast.success("配置已删除")
    // R296：配置已不存在，其下所有挂账都是孤儿，一并清掉
    clearConfigHealth(userId, deletingConfig.id)
    void loadConfigs(true)
  }, [deletingConfig, loadConfigs, userId])

  // ------------------------------ 测试面板 ------------------------------
  const [testTargetLabel, setTestTargetLabel] = useState("")
  const [testTargetRef, setTestTargetRef] = useState<ModelRef | null>(null)
  const [testRunning, setTestRunning] = useState(false)
  const [testResult, setTestResult] = useState<TestModelResult | null>(null)

  const runTest = useCallback(
    async (cfg: GatewayConfig, modelId: string) => {
      const ref: ModelRef = {
        source: cfg.is_platform ? "platform" : "personal",
        configId: cfg.id,
        configName: cfg.config_name,
        modelId,
      }
      setTestTargetRef(ref)
      setTestTargetLabel(modelRefLabel(ref))
      setTestRunning(true)
      setTestResult(null)
      const r = await testGatewayModel(ref)
      setTestRunning(false)
      setTestResult(r)
      if (r.ok) toast.success("测试成功，模型可用")
      else if (!r.needLogin) toast.error(r.message || "测试失败")
      else {
        setNeedsRhLogin(true)
        toast.error("当前无法执行测试，请稍后重试")
      }
    },
    [],
  )

  const rerunTest = useCallback(() => {
    if (!testTargetRef) return
    const ref = testTargetRef
    const cfgLike: GatewayConfig | undefined = configs.find((c) => c.id === ref.configId)
    if (cfgLike) void runTest(cfgLike, ref.modelId)
  }, [testTargetRef, configs, runTest])

  // R3 · D4「平台内置本地不可用需标明」：判定与下拉（ModelSelect）共用同一纯函数。
  // 口径：本机/内网域 且 已有可用个人通道 → 平台内置确定调不通（拿不到 RunningHub 登录态，
  // 恒 412）。只有个人通道存在时才收口，避免退化成「一个模型都没有可选」的死局。
  const platformLocallyUnusable = useMemo(
    () =>
      isPlatformModelLocallyUnusable({
        hostname: typeof window !== "undefined" ? window.location.hostname : "",
        hasPersonalModel: personalConfigs.some((c) => (c.models ?? []).some((m) => m.enabled)),
      }),
    [personalConfigs],
  )

  return {
    // 登录态
    userId,
    needsRhLogin,
    handleAccountChange,
    // 列表
    configs,
    listLoading,
    loadConfigs,
    platformConfig,
    personalConfigs,
    // R3：平台内置本地不可用标注（模型配置页 + 下拉共用）
    platformLocallyUnusable,
    defaultLabel,
    defaultSource,
    // R296 配置卫生
    modelHealth,
    declaredDefault,
    missingDefaultCount,
    unusableCount,
    // 表单
    formOpen,
    editingConfig,
    formBusy,
    formError,
    openCreateForm,
    openEditForm,
    closeForm,
    submitForm,
    // 配置操作
    busyConfigId,
    toggleModel,
    setDefaultModel,
    refreshModels,
    // 删除
    deletingConfig,
    deleteBusy,
    askDelete,
    cancelDelete,
    confirmDelete,
    // 测试
    testTargetLabel,
    testRunning,
    testResult,
    runTest,
    rerunTest,
    // R-038 模型元数据
    modelMeta,
    updateModelMeta,
  }
}
