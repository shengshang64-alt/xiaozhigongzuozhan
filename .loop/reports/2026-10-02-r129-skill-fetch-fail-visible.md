# R129 · 自定义技能拉取失败从静默吞没改为可见+可重试（r128-skill-fetch-fail-silent-01）

## 背景与选题
- R128 修复了「异步候选池裁剪持久化勾选」的数据丢失竞态，但暴露残余：拉取失败时 catch 只置空列表，
  界面零提示，picker 只显示预置项——用户以为「技能带上了」，实际已勾选的自定义技能被 orderedSkills
  过滤链路静默丢弃（少带/未带），也没有重试入口。
- 用户点名的 quote-history-01 / prompt-fabscan-03 已于 R102/R103 闭环（维持既定裁定不重开）；
  5 个 defer 锚点（ComposeStep/aigc/useSolutionStudio/QualCerts/assistantCore）对应在途改动仍未提交
  （git log 停在 R88，313 个工作区文件 M/未跟踪），全部绕开。
- 本轮为纯代码+UI 修改，不改提示词（无需 B 类流程/PROMPT_VERSION），零 collection、零 pb_hooks，
  会话内 state + localStorage 口径不变。

## 方案
1. `src/lib/skillCore.ts`：新增纯函数 `missingSelectedIds(ids, availableIds)` —— 按原顺序统计
   「已勾选但当前不在可选池」的技能 id。与 pruneSkillSelection 口径互补：未拉到自定义时勾选不被裁剪
   （R128 护栏）但被计为缺口显式提示；拉齐后缺口自然清零。预置项恒在池内不会误计。
2. `src/hooks/useScopeSkills.ts`：
   - 新增 `customLoadFailed` 状态：catch 不再只置空列表，同时置失败态；
   - 新增 `reloadTick` + `retrySkills()`：手动重试重新走同一 effect（deps 加 tick）；
   - 接口/返回新增 `skillsLoadFailed`、`retrySkills`；换功能点/换账号复位失败态。
3. `src/components/common/SkillPicker.tsx`：
   - props 新增 `loading/loadFailed/onRetry`，`SkillPickerFor` 自动从 hook 透传——13 个调用页零改动全量生效；
   - 面板顶部失败横幅：「自定义技能加载失败，预置技能不受影响」+「已勾选的 N 个自定义技能本次未带入」
     + 「重试」按钮（重试进行中显示「正在重试加载自定义技能…」）；
   - 触发按钮：失败且落定后仍缺时显示 AlertTriangle(amber) + 「缺N」，面板未打开也能看见；
   - 缺口数在请求落定(!loading)后才统计，避免重试进行中「缺N」闪现误导。
4. `src/lib/skillCore.test.ts`：新增 describe「missingSelectedIds · R129 拉取失败缺口统计」6 用例
   （全在池→空 / 按原顺序捞缺口 / 空勾选 / 空池全缺 / 不修改入参 / 与 pruneSkillSelection 互补口径）。

## 验收边界说明
- 「失败态透出到生成前确认」按最小侵入达成：picker 恒常驻生成入口旁，按钮级警示（缺N+三角图标）
  即是生成前可见确认；未在每个生成函数内加拦截弹窗——符合项目「只报告不拦截」精神且不动 11 处调用链路。
- 实机 UI 已验证（见下节「实机验证」），截图 `d:\KFDXCX\MedPreSales\.qoder\tmp\r129_fail_banner.png`。

## 实机验证（dev:8000 源码直读 + 账号「测试」已登录）

方法：注入 `window.fetch` 打桩——对 `/api/assistant_skills` 请求直接 reject（模拟网络失败），
预写 `localStorage.xz_skill_sel_ppt-deck` 勾选一个池中不存在的自定义 id，再 SPA 导航到
「PPT 与报价 → 新建 PPT」（不 reload，保住打桩）触发 hook 重挂载。

| 检查点 | 预期 | 实际 | 判定 |
|---|---|---|---|
| 触发按钮 | 失败且请求落定后显示 AlertTriangle +「缺1」 | `技能·1 缺1` | ✅ |
| 面板横幅 | 「自定义技能加载失败，预置技能不受影响」 | 文案逐字命中，`.bg-amber-50` 可见 | ✅ |
| 缺口明细 | 「已勾选的 1 个自定义技能本次未带入」 | 命中（N=1 动态插值正确） | ✅ |
| 重试按钮 | 存在且可点 | 点击后走同一 effect 重新拉取 | ✅ |
| 预置项 | 失败时仍可选 | 「医院售前汇报 PPT 专家」预置项正常渲染 | ✅ |
| 撤桩后重试 | 横幅消失；真失效 id 被 prune 并回写；按钮回「带入技能」 | bannerGone=true / selIds=[] / triggerLabel=带入技能 | ✅ |
| console | 0 error（reject 被 catch 转为可见状态，不再静默） | 无任何 console 消息 | ✅ |

维持裁定复核：本轮未触碰「只报不拦」导出门禁（横幅为提示非拦截）、lint-debt-01 残余未重构、
5 个 defer 锚点文件全程未碰（补丁锚点均在 skillCore/useScopeSkills/SkillPicker/skillCore.test）。

## 四门验证
| 门 | 结果 |
|---|---|
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 869 passed / 2 skipped（基线 863+2 → 增量 +6，全部为本轮新用例） |
| npx eslint 触及文件 | skillCore.ts / SkillPicker.tsx / skillCore.test.ts 0 error；useScopeSkills.ts 4 error = R128 记录的基线 4（set-state-in-effect×2 + refs×2），新增 0 |
| npx vite build | 成功 |

## 补丁脚本
- scripts/r129_probe.py（探针：调用点 14 处、测试结构、git 在途核对）
- scripts/r129_skill_fetch_fail_ui.py（主补丁，16 处锚点全部 assert==1 命中；逐文件保 CRLF/LF——
  SkillPicker.tsx 为 LF、其余 CRLF）
- scripts/r129b_picker_banner_loading.py（横幅文案与 loading 解耦修正 + props 补链）

未 git commit（维持禁令）。
