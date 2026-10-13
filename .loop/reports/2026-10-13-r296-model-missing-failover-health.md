# R296 模型通道：404「模型不存在」回退盲区修复 + 「实测不可用」持久健康档案（配置卫生可见化）

- 轮次：**R296**（账本 round 294 → 296。轮次号 295 让位并发工作流：其「条款碎片识别」尚未入账，但 `OutlineCoverage.tsx` / `bidTypes.ts` / `clauseOutlineAlignment.test.ts` 三个在途文件已在工作区，沿用 R293 因 292 被占而顺延的先例直接登记 296 以避免入账冲突）
- 日期：2026-10-13
- 模块：`/model-config` + `src/lib`（模型网关 / 回退 / 偏好）——售前的「AI 弹药供给链」
- 类型：**实质性缺陷修复 + 新能力**（非零风险小改）· 零 AI 调用 · 零 collection · 零 pb_hooks · **零提示词改动**（不需走 B 类流程）
- 起点：backlog `r294-default-model-hygiene`（P1）第①项「在配置页显式标注不可用」，顺带把第②③项从「靠用户手动核对」变成「页面自己说出来」

---

## 1. 缺陷：三条独立断链叠在一起，坏模型全程静默

R294 实测（closed: `r294-model-json-matrix`）给出硬事实：7 个启用模型里 **3 个实际不可用**——`大模型/sensenova-u1-fast` 返回 404（模型不存在），`xiaomi/mimo-v2.6-pro` 与 `Intern/deepseek-v4-flash-vision` 返回 429。同期 21 个标书项目里 12 个已有 106.5 万字正文，也就是说用户长期在「有模型名字但根本没有这条路」的通道上点生成。

代码侧三条断链：

| # | 断链 | 真源证据 |
|---|---|---|
| A | **404 不在回退分类里**：`classifyCallFailure` 的类别集合只有 `rate_limit / auth / model_disabled / unavailable / config_broken / timeout / empty_reply / cancelled / login_required / other`。网关 404 透出的文案「接口返回异常（HTTP 404）：The model 「xxx」 does not exist」既不匹配 `MODEL_DISABLED_RE`（要求「已停用/已下线/model_disabled/not enabled」），也不匹配其余任何类 → 落 `other` → **不在 `FAILOVER_ELIGIBLE`**，既不自动回退、也不冷却，用户只看到一次失败 | `src/lib/modelFailover.ts`（修复前） |
| B | **确定性失效没有持久落点**：会话冷却（`xz_model_cooling`，分钟级、重开即清）只承载瞬时失败。404 / 上游停用 / Key 失效这类「这条路就是坏的」跨会话查无实据，配置页毫无标注，`ModelSelect` 下拉里也看不出来 | 冷却实现只覆盖会话内；R294 的三个坏模型在 UI 上与好模型完全同形 |
| C | **默认模型静默漂移**：5 个个人配置中 4 个 `default_model` 为空串，网关靠「enabled 列表第一个」兜底；配置内模型顺序一变，默认模型就换人，页面与横幅都不说 | `r294-default-model-hygiene` 实测 + `modelPrefs` 兜底口径 |

### 为什么不复用会话冷却来记 404

冷却的语义是「别急着再选这条」（分钟级自动恢复、会话内、按配置整条冷却），404 的语义是「这条已经**被证实**坏了」（天级、只该冷却那一个模型、需要在配置页留下可处置的标注）。把 404 塞进冷却会同时丢掉两个正确性质：过期即消失（下次仍然静默），以及把整个配置判死（同账号其它模型明明可用）。所以新增一层与冷却平行、口径不同的**持久健康档案**。

---

## 2. 方案与口径

### S1 `modelFailover.ts`：新增 `model_missing` 类

- `CallFailureClass` 增 `model_missing`；`MODEL_MISSING_RE` 逐字对齐 `model_gateway.pb.js` 的真实透出文案（`chatOnce` 非 200 带 detail → 「接口返回异常（HTTP 404）：… does not exist …」；PATCH 设默认路径 → `code: model_not_found` / 「不存在这个模型」），并覆盖 `no such model / invalid model / unknown model / model_not_found`。
  - `\b404\b` 加词边界，避免把正文里的四位数字（价格、床位数、年份）误判成状态码；
  - 分类顺序上把 `model_missing` 放在 `model_disabled` 之后、`auth` 之前：**停用类文案优先**，404 只在停用词未命中时接管；
  - 明确**不**匹配「配置不存在」——那是 `config_broken`（配置级）语义，与模型级 404 不同层。
- 入 `FAILOVER_ELIGIBLE`：404 必然零产出，换一路才有结果，回退无重复计费风险。
- `coolingKeysForFailure`：`model_missing` 与 `model_disabled` 同口径**只冷却那一条模型 key，不冷却整个配置**。
- 顶部口径注释同步补「模型不存在（404）」。

### S2 新建 `src/lib/modelHealth.ts`：持久健康档案（215 行，纯前端）

| 口径 | 取值 / 理由 |
|---|---|
| 只挂 **确定性失效**三类 | `model_missing` / `model_disabled` / `auth`。限流、超时、5xx 一律 `recordCallFailure` 直接忽略——否则被限流一次就把模型永久标红，属于误伤（这正是 R294 探针「把基础设施拥闪误读为模型缺陷」的教训反向落地） |
| 清账闭环 | 任一通道实调成功即清；配置页「测试」通过即清；用户主动重新启用该模型即清；编辑配置（改 Key / 地址）、刷新模型列表、删除配置 → 按配置级清账 |
| 生命周期 | 7 天 TTL 自然过期 + `MAX_ENTRIES=60` 丢最旧，坏模型长期不碰也不会永远挂着 |
| 存储 | 与 `modelPrefs` 同口径：`localStorage` **按用户分桶**（`xz_model_health:<userId>` / `anonymous`），SSR / 隐私模式 / 配额满一律降级为「无档案」，绝不阻断 AI 主流程 |
| 键 | 复用 `modelRefKey`（`personal:配置id:模型id`），与冷却、默认模型记忆同构，不新造坐标系 |
| 订阅 | `onHealthChange` 极简监听集合，回调节不住吞异常（徽标刷新失败不得影响主流程） |
| 文案 | `healthShortLabel`（已下线 / 已停用 / Key 失效）+ `healthNotice`（带处置动作：刷新模型 / 重新启用 / 更新 Key） |

### S3 `modelGateway.ts`：在真实调用与「测试」现场挂接

- `chatViaGatewayUncached`：拿到上游原始错误串即 `recordCallFailure`（归类由 S1 决定挂不挂）；成功分支在既有 `rememberUsedModel` 旁加 `recordModelSuccess`。
- `testGatewayModel`：失败按类挂账、成功清账——这是用户对坏通道的**处置闭环**入口（点「测试」复核后徽标才会消失）。
- 只在前端服务层挂接，**未动 `pb_hooks`**：网关 hook 已如实透出上游状态码与 detail，分类所需的证据本就到达前端，无需服务端加字段（理由与残余见 §6）。

### S4 UI：三处标注 + 一处汇总（延续「只提示不禁用」裁定）

- `ModelSelect`：新增 `useModelHealth()`（惰性初始化 + 只订阅，setState 只在回调里）；下拉项后缀改为 `statusSuffix()`——**冷却与实测不可用是两回事，命中哪个说哪个**（`· 冷却中 · 已下线` 可并存）；所选通道挂 `badge-danger` + `role="status" aria-live="polite"` + tooltip。**不禁用 option**：用户仍可选它、仍会先如实尝试（上游随时可能修好），与冷却徽标同裁定。
- `PersonalConfigList`：模型行加「已下线 / 已停用 / Key 失效」danger 徽标（tooltip 给处置动作）；配置头加「未设默认模型」warning 徽标，直击 C 类漂移。
- `DefaultModelBanner`：新增 `declaredDefault` / `missingDefaultCount` / `unusableCount` 三个可选入参（默认值保证零改动调用方不受影响），分别输出「当前默认只是兜底」「N 个配置未设默认模型：顺序一变默认就静默改变」「N 个已启用模型实测不可用：请点『测试』复核后停用或修正」。
- `useModelConfig`：订阅档案并按用户分桶读取；**换账号在 `handleAccountChange` 事件回调里就地重读**（不留陈旧徽标）；派生 `declaredDefault` / `missingDefaultCount` / `unusableCount`；四类处置动作（保存编辑 / 重新启用 / 刷新模型 / 删除配置）接清账。`applyPatch` 返回 `Promise<boolean>` 以便「启用成功才清账」，两个失败出口从 `return` 改为 `return false`，成功出口补 `return true`。
- `ModelConfigPage`：透传三个新入参与 `modelHealth`。

---

## 3. 变更清单

| 文件 | 状态 | 说明 |
|---|---|---|
| `src/lib/modelFailover.ts` | 改 | +`model_missing` 类、正则、回退资格、仅模型级冷却、口径注释 |
| `src/lib/modelHealth.ts` | **新建** | 215 行持久健康档案（读写 / 清账 / TTL / 分桶 / 订阅 / 文案） |
| `src/lib/modelGateway.ts` | 改 | 实调失败/成功挂接 + 测试失败/成功挂接 |
| `src/components/model-config/ModelSelect.tsx` | 改 | 档案 hook、`statusSuffix`、所选通道 danger 徽标 |
| `src/components/model-config/PersonalConfigList.tsx` | 改 | 模型行 danger 徽标 + 配置头「未设默认模型」warning |
| `src/components/model-config/DefaultModelBanner.tsx` | 改 | 三类卫生提示（新增 3 个可选入参） |
| `src/pages/ModelConfig/useModelConfig.ts` | 改 | 订阅 + 派生统计 + 四处处置后清账 |
| `src/pages/ModelConfig/ModelConfigPage.tsx` | 改 | 透传入参 |
| `src/lib/modelFailover.test.ts` | 改 | +6 例（净 +5） |
| `src/lib/modelHealth.test.ts` | **新建** | 15 例 |

`git diff --stat`（仅本轮触及文件）：**8 files changed, 243 insertions(+), 19 deletions(-)**，另新增 2 个文件。补丁脚本共 **18 个** `scripts/r296_*.py`（每个 `str.replace` 前 `assert s.count(old)==1`）：实质实现层 `failover_missing` / `model_health` / `gateway_record` / `test_failover` / `test_health` / `ui_select` / `ui_config` / `ui_hook` / `ui_hook_fix`；支撑层 `util`（读写与行尾保持）、`eol_check`（行尾审计）、`proof_page` / `proof_cleanup` / `playwright_proof`（取证）、`finalize` / `report_fix` / `report_quote_fix` / `evidence_patch`（报告与账本回写）。

**在途代码避让**：`git status` 确认并发工作流的 `OutlineCoverage.tsx` / `bidTypes.ts` / `clauseOutlineAlignment.test.ts` 三个未提交文件与本轮锚点区域零交集，全程未触碰，收轮后仍原样保留。

---

## 4. 测试（新增 20 例，全部围绕负边界）

`modelFailover.test.ts` 新增 describe「R296 模型不存在（404）盲区修复」6 例：

- 网关 404 真实文案落 `model_missing`（断言修复前口径的 `other` 不再出现）；
- **互不吞**：停用文案仍归 `model_disabled`，限流文案仍归 `rate_limit`；
- **回归守卫（误伤防线）**：HTTP 400 参数错误、「配置不存在」都**不得**判成模型不存在；
- `model_missing` 参与自动回退；
- 冷却口径：只冷却那一路模型，不冷却整个配置；
- 原「仅账号级不可用四类」改为五类（404 纳入可回退）。

`modelHealth.test.ts` 15 例（内存 storage 桩，沿用 `modelPrefs.test.ts` 写法）：三类入档、瞬时类不入档、成功清账、按配置清账、TTL 过期剔除、`MAX_ENTRIES` 修剪、脏值（非对象 / 缺 `at` / 非法 `cls`）读取时剔除、按用户分桶互不污染、匿名桶、`storageKey` 前缀、订阅退订与回调吞异常、`normalizeModelKey` 空键拒绝、`healthShortLabel` / `healthNotice` 全覆盖、localStorage 不可用时静默降级。

---

## 5. 四门验证（目标项目目录，收轮复跑）

**基线纠正**（按纪律以实测为准）：本轮开工前实测基线为 **198 文件 / 2333 passed / 2 skipped**，与任务提示词给的「630 passed」不符（该数字对应更早时期），故增量按实测口径申报。

| 门 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc -b` | **exit 0**，零错误 |
| 单测 | `npx vitest run` | **exit 0**，`Test Files 199 passed (199)` / `Tests 2353 passed \| 2 skipped (2355)`，**+1 文件 / +20 例** |
| Lint | `npx eslint <本轮触及 10 文件>` | **1 error, 0 warnings**，且为在途既有项：`useModelConfig.ts` `react-hooks/set-state-in-effect`（HEAD 原文同规则同位置 70:22，本轮插入代码后位移至 80:22；已用 HEAD 导出的 `r296_baseline_probe.ts` 跑 eslint 取证）。本轮自己新增的那处（effect 体内同步 `setModelHealth`）已由 `r296_ui_hook_fix.py` 重构消除；`lint-debt-01` 裁定既有残余不重构 |
| 构建 | `npx vite build` | **exit 0**（仅 500 kB chunk 体积提示，与本轮无关） |

行尾一致性：`git ls-files --eol` 发现 `modelFailover.ts` / `modelFailover.test.ts` / `ModelSelect.tsx` 三个文件被补丁脚本写成 CRLF（索引为 `i/lf`），已 `r296_eol_check.py --fix` 还原 LF 后**复跑四门全绿**（即上表数字）。

### 浏览器实机验证（真渲染 + 真交互）

本机无 PocketBase 可执行文件、8090/8080/8081 均未监听，`/model-config` 拿不到真实配置列表，故用临时验证页（`r296-proof.html` + `src/r296Proof.tsx`，最小 mock props + **真实** `modelHealth` / 真实三个被改组件）起 `vite --port 5199` 在浏览器里跑，验证完即删（不留死代码）：

1. **挂账态**（点「模拟实测：404 下线 + 429 限流」）a11y 快照：
   - 下拉项 `大模型 · sensenova-u1-fast · 已下线`（selected），另两项无后缀；
   - 所选通道 `badge-danger` 「已下线」；配置行 `sensenova-u1-fast` 后「已下线」；
   - 横幅出现「1 个已启用模型实测不可用（接口已下线 / 被停用 / Key 失效）：下方已逐个标注…」；
   - **429 那路（`xiaomi/mimo-v2.6-pro`）未被标注**——瞬时类不入长期档的口径在真浏览器里生效；
   - `localStorage` 实测：`xz_model_health:local-user = {"personal:cfgBig:sensenova-u1-fast":{"cls":"model_missing","reason":"接口返回异常（HTTP 404）：The model \"sensenova-u1-fast\" does not exist","at":1791868123168}}`（**只有 404 一条**）。
2. **清账态**（点「清空档案」）：徽标全部消失、下拉后缀消失、横幅只剩「1 个配置未设默认模型」（与档案无关的独立卫生提示）、`localStorage` 该桶为 `{}`。
3. **截图取证**：`browser-use` 的 `take_screenshot` 本轮连续 9 次 15s 超时（既往轮次可正常出图；已排除动画因素——`document.getAnimations()` 为 0、30 KB DOM 正常渲染，判为工具侧通道故障）。改用 Python Playwright 直连同一页面出图，两态各一张：
   - `d:/KFDXCX/MedPreSales/.qoder/r296_proof_annotated.png`（挂账态）：横幅两条卫生提示同屏（琥珀「1 个配置未设默认模型…」+ 红色「1 个已启用模型实测不可用…」）、顶栏选择器右侧红色「已下线」徽标、`sensenova-u1-fast` 行「已下线」徽标、`xiaomi` 配置头「未设默认模型」琥珀徽标，而 `mimo-v2.6-pro`（429）**无任何标注**；
   - `d:/KFDXCX/MedPreSales/.qoder/r296_proof_cleared.png`（测试通过清账态）：danger 徽标全消、下拉后缀消失，仅剩与档案无关的「未设默认模型」提示。
   机器可读证据同步落盘 `d:/KFDXCX/MedPreSales/.qoder/r296_playwright_proof.json`（`options_annotated` / `badges_annotated` / `storage_annotated` / `storage_after_success_clear`）。

---

## 6. 残余与后续（写入 backlog，不掩盖）

1. **余额不足型 429 仍不入长期档案**（本轮刻意保守）：`insufficient_balance` 语义上更接近「长期坏」，但正则与 `rate_limit` 同源，误判代价是把临时限流标红 7 天。需要「连续 N 次 / 带 balance 关键字」才入档的更细口径 → `r296-health-balance-429`（P3）。
2. **平台内置模型（非 `personal:` 前缀）不在档案坐标系内**：`modelHealth` 键沿用 `modelRefKey`，平台通道无 configId，当前只对个人配置标注 → `r296-health-platform-channel`（P3）。
3. **服务端未加「可用性」字段**（维持零 collection / 零 pb_hooks）：挂账证据来自前端实调与「测试」，因此**只在用户真正调用过/测过的通道上出现**，未被碰过的坏模型仍需一次实调才会显形。若要在配置页一次性体检全部模型，需要「批量测试」入口（前端即可，但涉及重复计费与限流风险，留给用户拍板）。
4. `r294-default-model-hygiene` 的②（把默认显式设为实测最快的 `deepseek-v4-flash`）与③（补全各配置 `default_model`）仍是**写生产数据**动作，维持「需用户确认」不自动执行——本轮已把这两件事变成页面上会自己说话的两条提示（横幅 + 「未设默认模型」徽标），用户点「设为默认」即可完成，不需要再回头读报告。
