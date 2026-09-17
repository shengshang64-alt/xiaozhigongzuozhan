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

  const handleAccountChange = useCallback((account: RhAccountInfo | null) => {
    setAccountInfo(account)
    const uid = account?.userId ?? decodeRhToken()?.sub ?? null
    setUserId(uid)
    setNeedsRhLogin(!uid)
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
  const defaultLabel = available.defaultRef ? modelRefLabel(available.defaultRef) : "平台内置 gpt-5.5"
  const defaultSource = available.defaultRef
    ? available.defaultRef.source === "platform"
      ? "平台内置"
      : available.defaultRef.configName
    : "平台内置"

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
      void loadConfigs(true)
    },
    [editingConfig, closeForm, loadConfigs],
  )

  // ------------------------------ 配置操作 ------------------------------
  const [busyConfigId, setBusyConfigId] = useState<string | null>(null)

  const applyPatch = useCallback(
    async (id: string, patch: Parameters<typeof updateGatewayConfig>[1], okText: string) => {
      setBusyConfigId(id)
      const res = await updateGatewayConfig(id, patch)
      setBusyConfigId(null)
      if (!res.ok) {
        if (res.needLogin) {
          setNeedsRhLogin(true)
          toast.error("当前无法执行该操作，请稍后重试")
          return
        }
        toast.error(res.message || "操作失败，请重试")
        return
      }
      if (okText) toast.success(okText)
      void loadConfigs(true)
    },
    [loadConfigs],
  )

  const toggleModel = useCallback(
    (cfg: GatewayConfig, modelId: string, enabled: boolean) => {
      const nextModels = (cfg.models ?? []).map((m) => (m.id === modelId ? { id: m.id, enabled } : { id: m.id, enabled: m.enabled }))
      const patch: Parameters<typeof updateGatewayConfig>[1] = { models: nextModels }
      // 停用的是默认模型时，同时清掉默认（前端回退平台内置）
      if (!enabled && cfg.default_model === modelId) patch.clear_default = true
      void applyPatch(cfg.id, patch, enabled ? "模型已启用" : "模型已停用")
    },
    [applyPatch],
  )

  const setDefaultModel = useCallback(
    (cfg: GatewayConfig, modelId: string) => {
      void applyPatch(cfg.id, { default_model: modelId }, `已将「${modelId}」设为系统默认模型`)
    },
    [applyPatch],
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
      void loadConfigs(true)
    },
    [loadConfigs],
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
    void loadConfigs(true)
  }, [deletingConfig, loadConfigs])

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
    defaultLabel,
    defaultSource,
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
  }
}
