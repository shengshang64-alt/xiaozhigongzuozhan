# R128 技能勾选异步竞态修复：刷新页面不再静默丢失「带入的技能」

日期：2026-10-02 ｜ 类别：A 类功能缺陷实修（非提示词，不走 B 类流程）｜ 数据模型：零 collection / 零 pb_hooks ｜ 提示词：未改

## 选题与授权
账本 round=127 续轮。用户点名的两个实质项经核实**均已闭环**：
- `quote-history-01` 报价历史二期（结项沉淀 + 按医院等级/床位数/模块组合智能推荐区间）→ R102 已交付
  （见 `.loop/reports/2026-10-01-r102-quote-history-phase2.md`，纯函数 `quoteRecommend.ts` + QuoteEditor「成交参考区间」面板 + 11 用例）；
- `prompt-fabscan-03` 残余「按章聚合回注改进建议」→ R103 已交付（`2026-10-01-r103-chapter-audit-reflow.md`）。

改为巡检新角度命中一处**真实功能性缺陷**（非零风险小改）：全站 AI 生成「技能带入」链路在页面刷新后静默失效。

## 缺陷定位（根因）
`src/hooks/useScopeSkills.ts` 的裁剪 effect 只以 `scopeSkills` 为条件，而可选池 = 预置技能（同步常量）+
自定义技能（`/api/assistant_skills` 异步拉取）。挂载时序：

1. 首屏 render：`customSkills=[]` → 池内只有预置项；
2. 裁剪 effect 立即执行 → `selectedIds` 里来自 localStorage 的**自定义技能 id 被当作失效项裁掉**
   （老护栏 `if (!scopeSkills.length) return` 只在全池为空时才挡，含预置项的功能点挡不住）；
3. 紧随其后的持久化 effect 把裁剪后的空选**回写 localStorage** → 勾选不是「本次没生效」而是**永久丢失**；
4. 自定义技能随后到达，但勾选已空，`skillPromptBlock` 组不出块 → 该轮 AI 生成实际少带用户指定的技能，
   且界面无任何提示（计费文案也不再显示「带入 n 个技能」）。

影响面：所有含预置技能的功能点——小智对话、方案大纲、标书解析、客户画像、客户跟进、PPT 生成、讲标答辩
（`PRESET_SKILLS.scopes` 覆盖到的 7 个 scope；`useScopeSkills` 全站 11 处调用）。

## 修复口径
把「有没有资格校验某个勾选 id」显式建模，而不是靠池子大小猜：

- `skillCore.ts` 新增纯函数 `pruneSkillSelection(ids, availableIds, customLoaded)`：
  预置项（`preset:` 前缀）同步可得，**任何时候都可校验**；自定义项仅在 `customLoaded===true` 时校验，
  否则保留（顺序不变，返回新数组；无变化时长度与入参一致，调用方据此决定是否换 state 引用）。
- `useScopeSkills.ts` 增加 `customLoaded` 状态：
  - effect 入口先复位为 `false`（换功能点 / 换账号后旧列表不再具备校验资格）；
  - **只有拉取成功**才置 `true`——接口失败、未登录都不置真，即「不拿不可信的池子裁人」，
    避免一次网络抖动就把用户带惯的技能永久清掉；
  - 裁剪 effect 改用 `pruneSkillSelection`，依赖 `[scopeSkills, customLoaded]`。
- 跨账号安全：未登录/加载期间保留的他人 id 不会污染提示词——`orderedSkills` 只按池内 `find` 结果组块，
  池外的 id 贡献为空。

真失效（技能被删除、适用功能点被改走）在拉取成功后照旧被清理，行为不回退。

## 变更文件
- `src/lib/skillCore.ts`：+`pruneSkillSelection` 纯函数与口径注释
- `src/hooks/useScopeSkills.ts`：+`customLoaded` 校验资格门 + 改用纯函数裁剪（切换 scope/账号复位）
- `src/lib/skillCore.test.ts`：**新建** 26 用例（此前该模块 0 独立单测、被 11 处共用）
- `src/pages/BidWorkspace/scoreItemsScan.test.ts`：把 R61 已修复却仍写着「待后续单独评估」的陈旧软断言
  钉成 `toBe("系统响应速度")`（防 r47-scan-name-trunc-06 截尾问题回归）

## 新增单测锁死点（skillCore.test.ts 26 用例）
- `pruneSkillSelection` R128 回归钉：拉取未完成 + 池内只有预置项时自定义勾选**必须保留**；
  预置项失效即使未拉取也照裁；拉取成功后按全量池清理；保序 / 空输入返回 `[]`
- `normalizeScopes`：非数组/空/非法值回退「仅小智对话」、trim 与去重、`all` 通配保留原值不展开
- `SCOPE_CATALOG`/`scopeLabel`：15 个功能点唯一且都有中文标签，未知 scope 原样回显
- `presetSkillsForScope`：`preset:` 前缀隔离、`rh_user_id="preset"`、无预置的功能点返回空池
- `skillPromptBlock`/`parseSkillPlaceholders`：空选返回空串、按勾选顺序编号、空位已填用填值/未填回退空位名且不留 `{{}}` 残渣
- `injectSkillBlock`：空块返回同引用、无 system 时补一条并去掉块首空行、只追加首条 system 且不改写入参（不可变）、多模态数组 content 不做字符串拼接
- scope 注册表与计费文案：缺省 scope 安全返回空/0、注册后按 scope 取块计数、「带入 n 个技能」文案、
  反注册仅在来源匹配时生效（旧卸载不得摘掉新注册者）
- 持久化：按 scope 分 key 往返、未写过返回空选、脏 JSON/非字符串项只挑合法部分、
  存储不可用（隐私模式/配额）静默降级不崩

## 四门验证
- `npx tsc -b`：0 错误（首轮 3 处报错为测试里 `injectSkillBlock<T[]>` 泛型误传数组类型，已改为类型推断）
- `npx vitest run`：**863 passed / 2 skipped**（基线 837，**+26 增量**），82 个测试文件全绿
- `npx eslint` 触及文件：`skillCore.ts`/`skillCore.test.ts`/`scoreItemsScan.test.ts` **0 error**；
  `useScopeSkills.ts` 4 error 与 `git show HEAD:` 同文件基线 **4 error 完全同规则同数量**
  （set-state-in-effect ×2、react-hooks/refs ×2，均为既有模式，本轮零新增）
- `npx vite build`：成功（~3.6s）

## 维持的既有裁定（未触碰）
- 编造嫌疑未清零禁止导出：维持「只报告不拦截」
- `lint-debt-01`：有意保留残余，不重构
- `quote-history-3-mining`（4085 份本地 docx 报价数据挖掘）：P3 需独立立项，本轮不触

## 在途绕开记录（git 状态逐一核对）
本轮只改 `skillCore.ts` / `useScopeSkills.ts` / `scoreItemsScan.test.ts`（均 git CLEAN）。
以下 defer 锚点仍在途，继续绕开：
- `money-count-defer-composestep-01`：`ComposeStep.tsx` git diff 仍有 450 行未提交插入
- `r119-dead-export-mwip-defer`：`src/lib/aigc.ts` 仍为 M
- `r124-solutionstudio-docx-defer`：`useSolutionStudio.ts` 仍为 M
- `r112-datestamp-qualcerts-defer`：`src/pages/QualCerts/` 整目录仍未跟踪（用户新增功能）
- `assistantCore.ts` 为用户在途 M，本轮只读其类型/常量，未作任何修改

未 git commit。


## 实机验证（R128 收口补验：dev:8000 + PocketBase:7000，账号「测试」已登录）

方法：对 `assistant_skills` 列表请求做「只延后、不改内容」的 fetch 打桩（+3s 返回真实响应），再用侧边栏
「小智助手 → PPT 与报价」的 SPA 重挂载触发 hook 重新挂载（不能 reload，会丢打桩），每 100ms 采样
`localStorage.xz_skill_sel_ppt-deck` 的勾选，比较修复版与 `git show HEAD` 旧版。

| 版本 | 请求发出 | 请求返回 | 自定义项 custom-abtest-1 被抹掉时刻 | 判定 |
|---|---|---|---|---|
| HEAD 旧版 | t=67~83ms | t=3155~3481ms | **t=147ms**（早于返回 ~3s） | 缺陷真机复现：列表未到达就裁剪并回写 |
| R128 修复版 | t=37~52ms | t=3103~3116ms | **t=3379ms**（返回之后） | 拉取窗口内零误裁，确认不存在后才清理 |

- 修复版采样轨迹：`[{t:108, hasCustom:true}, {t:3379, hasCustom:false}]`——唯一一次状态变化发生在请求返回之后，
  说明该 id 是被「真实校验」判为失效（本地库里确实没有这条技能），不是竞态误裁；旧版则在 t=147ms 直接归零。
- UI 正向证据：/ppt-quote →「新建 PPT」向导 → 技能 picker 显示「技能·1」，弹层标题「带入『PPT 生成』技能」，
  列表首项「医院售前汇报 PPT 专家」为勾选态；持久化选择在整页 reload 后仍生效。
- `list_console_messages`：0 error / 0 warn（仅 vite 连接与 React DevTools 提示）。
- 截图：`test_results/r128_skill_picker_fixed.png`。
- 测试痕迹复原：`xz_skill_sel_ppt-deck`、`xz_skill_sel_assistant` 写回原值 `{"ids":[],"vars":{}}`，
  删除探针标记 `__r128_probe_marker`，fetch 打桩已还原；A/B 期间临时回退的 `useScopeSkills.ts`
  由备份逐字节校验复原（`git diff --stat` = 13 insertions / 4 deletions）。

## 收口复核（A/B 临时替换过源文件，故四门重跑一遍）
- `npx tsc -b` rc=0（0 错误）
- `npx vitest run` rc=0：82 test files，**863 passed | 2 skipped**（基线 837，+26）
- `npx eslint`（skillCore.ts + useScopeSkills.ts 合并口径）= **4 errors**，与 `git show HEAD` 基线
  useScopeSkills.ts 的 4 errors **同规则同数量**（react-hooks/set-state-in-effect ×2、react-hooks/refs ×2）；
  skillCore.ts HEAD 基线 0 errors ⇒ 本轮改动与新增文件**零新增 error**
- `npx vite build` rc=0：5935 modules transformed，built in 4.14s
- 证据：`d:/KFDXCX/MedPreSales/.qoder/tmp/r128_final_gates.txt`、`r128_eslint_cmp2.txt`；
  补丁与取证脚本 `d:/KFDXCX/MedPreSales/scripts/r128*_*.py`
