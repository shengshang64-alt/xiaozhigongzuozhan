# R40 · 2026-10-14 · 修 B8：折扣「几折 vs 百分之几」的歧义不再静默钳位

- 轮次：R40（账本 round 39 → 40；_loop_state round → 41）
- 类别：A（修 + 接线）。**未改任何提示词**（无 B 类新旧口径逐字对比、无 PROMPT_VERSION 变更）；**未动数据模型**（0 新 collection、0 pb_hooks）
- 严重性：S1 —— 金额悄悄错 10~100 倍且零报警，账本原本就记为「最高危」
- 结论：pass（四门 + 实机 23 项断言全过）

## 一、选题依据

1. `docs/evolution/_loop_state.json` 的 `docs/evolution/_loop_state.json` 里 focus 明确钉为「主题首选 **B8 折扣语义歧义入口**（唯一剩余 high）」，本轮照做，未另起炉灶。
2. 用户指令要求优先实质性优化而非零风险小改：B8 是「用户填一个数字就把整单金额改错两个数量级」的缺陷，属实质性。
3. 未选 quote 历史二期（用户提到的 quote-history-01 在本账本里不存在，且报价域按既有偏好不是重点）；未选 prompt-fabscan-03（同样不在本账本，本轮无提示词改动）。

## 二、缺陷是什么（改前行为可复现）

| 位置 | 改前代码 | 后果 |
|---|---|---|
| `src/components/ppt-quote/QuoteEditor.tsx` 折扣列 | `<NumCell min={1} max={100} fallback={100}>`，`NumCell.clamp = Math.max(min, ...)`，onChange 与 onBlur 各钳一次 | 用户填 **0.9**（想表达 9 折）被静默改成 **1** → 该行按原价的 **1%** 计入合计；界面上只在输入瞬间闪一句「应在 1–100 之间，失焦后自动修正」 |
| `src/pages/PptQuote/pptQuoteTypes.ts` `normalizeDiscount` | `0 < d ≤ 100` 原样返回 | 填 **3**（想表达 3 折）按 **3%** 落库，无任何提示；导入/AI 初稿同样带病通过 |
| `src/lib/deliverability.ts` 报价交付体检 | 完全不看 discount | 已落库的脏折扣值在「能不能发给客户」判定里隐身 |

本域口径是「折扣(%) = 按原价的百分之多少计价」（90 = 打 9 折），而业务同事手写习惯是「折」：9 折写 9、甚至写 0.9。**同一个数字两套量纲，相差 10~100 倍，且直接乘进每一行金额**。实机取证用例：单价 990,000 元 × 1 套 —— 按 0.9% 计价 = ¥8,910.00，按 90% 计价 = ¥891,000.00。

## 三、改了什么

| 文件 | 变更 |
|---|---|
| `src/lib/discountIntent.ts`（新增 77 行） | 歧义判定**单一真源**：`DISCOUNT_AMBIGUOUS_BELOW = 5`、`discountAmbiguity(raw)` 返回两种读法（`percent` / `habit`）+ 倍数、`isAmbiguousDiscount`。纯函数零依赖；`0.9 * 100` 之类二进制尾差在此定点化（90 而不是 90.00000000000001） |
| `src/components/ppt-quote/DiscountIntentDialog.tsx`（新增 116 行） | 确认弹窗：两种读法各换算成**真实金额**（本行/本组小计 + 原价对照），点一下才落值；「都不是，返回改数字」一字不改 |
| `src/pages/PptQuote/pptQuoteTypes.ts` | 转出判定（组件层不许各写阈值）；新增只读工具 `itemSubtotalAtDiscount` / `groupSubtotalAtDiscount`（与 `itemSubtotal` 同一 R34「精确到分」口径）与 `scanAmbiguousDiscounts`（存量盘点，不改写）；`QuoteItem.discount` 字段注释补歧义口径 |
| `src/components/ppt-quote/QuoteEditor.tsx` | 行内折扣格改走新的 `DiscountCell`（**只在 blur/Enter 落值**，逐键提交会把「输入 90 途中经过 9」误判成歧义；歧义不写值 → 交回弹窗；≤0/空按 R285 落 100 并行内说明；>100 归一 100）；整组批量折扣**先判歧义再落值**；顶部「有 N 行的折扣小于 5%」横幅 + 逐行确认队列；列头 tooltip 补「想表达 9 折填 90，不要填 9 或 0.9」 |
| `src/lib/deliverability.ts` | 报价交付体检补一条 `verbatim_fidelity` **warn**（只报不拦，级别钉死不影响 `sendable`） |
| `src/pages/PptQuote/quoteDiscountAmbiguity.test.ts`（新增 18 例） | 歧义判定 6 + R285 不变量 2 + 金额换算 3 + 存量盘点 2 + 入口接线源码哨兵 5 |
| `src/lib/deliverability.test.ts`（+2 例） | 行为级：歧义行出 warn 不出 blocker 且 `sendable` 仍 true；正常折扣与缺省 discount 零新增条目 |

维持不变的裁定：
- `normalizeDiscount` 的 R285 语义（≤0 视为原价、>100 封顶）**一字未动**，并由 2 例回归守卫钉住；本轮只做「把静默钳位换成弹确认」。
- 已落库数据**只盘点不改写**：横幅「逐行确认」逐笔交回用户，不做「一键按折换算」（一键换算等于替用户猜意图，正是本轮要消除的行为）。
- 编造嫌疑只报不拦、lint-debt 有意保留残余不重构：本轮未触碰。

## 四、四门验证（目标项目目录实测）

| 门 | 结果 |
|---|---|
| `npx tsc -b` | exit 2 —— 5 error 全在**在途未提交文件**（ModelMetaDialog / PersonalConfigList / useModelConfig / bidDocxFormatExtract×2），与 R38/R39 收轮时同一集合；**本轮 7 文件 0 error** |
| `npx vitest run` | pass —— **219 files / 2617 passed / 2 skipped**（基线 R39 为 218 / 2597 / 2，**+1 文件 +20 用例**）；既有 quoteDiscount.test.ts 5 例（R285 录入链路哨兵）零回归 |
| `npx eslint <本轮 7 文件>` | exit 0 —— **0 error 0 warning**；全仓 `src` 152 error / 19 warning 全为存量（低于账本 160 基线，系在途批次改动所致，非本轮清理） |
| `npx vite build` | exit 0，4.28s；`dist/assets/PptQuote-*.js` 命中「折扣写法有歧义 / 逐行确认 / 几折 / 不是有效数字，已回到原值」各 1 处，主包 0 处 |

## 五、实机验证（真实场景，零写库）

`docs/evolution/_r40_S1_dialog_row.png`、`_r40_S4_dialog_group.png`、`_r40_S6_banner.png`（脚本 `scripts/r40_ui_proof2.py`，Playwright chromium 1440×1000，:8000 Vite dev 动态 import **真实 QuoteEditor** 注入渲染，`updateItem`/`setGroupDiscount` 换成 spy 回调并本地重渲染 —— 与线上 `usePptQuote` 的函数式 mutateQuote 同构）。

**为什么不在真实报价单上点**：报价编辑器改动即自动保存，在用户记录上敲键盘会真的改掉他的金额。

**ASSERTS 23 / PASS 23 / FAIL 0 / PAGEERRORS 0**

| 步 | 操作 → 观测 |
|---|---|
| S1 | 行内填 `0.9` 失焦 → **不写值**（calls=0），弹窗给出「按 0.9% 计价 本行小计 ¥8,910.00」与「按 90% 计价（9 折）¥891,000.00（原价 ¥990,000.00）」；点后者 → 仅一条 `{ discount: 90 }`，弹窗关闭，行小计 891,000.00（90%计价） |
| S2 | 行内填 `0` → **不弹窗**，落 100（R285 原价），行内出现「不填或 ≤0 按原价 100% 计（不会当成 0 折）」 |
| S3 | 行内填 `120` → 不弹窗，归一 100 |
| S4 | 整组折扣% 填 `3` → 组级确认「本组 2 行」¥36,900.00（按 3%）vs ¥369,000.00（按 30%＝3 折）；点 30% → `setGroupDiscount(g1, 30)`，组内两行同时落 30、组小计 369,000.00 |
| S5 | 整组填 `0.9` → 弹窗；点「都不是，返回改数字」 → 调用记录 0 增长、弹窗关闭 |
| S6 | 喂入存量 `discount=1 / 0.9` 的行 → 顶部横幅「有 2 行的折扣小于 5%（例：「电子病历评级咨询」填了 1）…金额会悄悄错」；点「逐行确认」→ 第一笔弹「你填的 1 …相差 10 倍」选 1 折读法落 10，**自动接第二笔**（0.9 → 90），队列清空后横幅消失 |

真实语料只读盘点（`scripts/r40_audit_discounts.py`）：`GET /api/quotes`（X-Rh-User-Id=local-user）200 OK 但 **0 条报价记录** → 现场无法举证存量脏值；缺陷属「入口必现 + 存量潜伏」型，已落库分支以注入实机取证 + 单测为证。

## 六、新发现与挂账

- **F40-1（P1）**：「同一数字两种量纲」的字段只要用 min/max 静默钳位，就必然把金额悄悄错两个数量级且零报警。此类字段一律：判定纯函数单一真源 + 入口弹确认 + 存量只盘点不改写。
- **F40-2（P2）**：取证 harness 陷阱 —— 对 React 受控 input 同时派发合成 `focusout` 与调用 `el.blur()` 会触发两次 onBlur（v1 因此把一条歧义记成两条确认，整组路径没采到证据）。模拟失焦只调 `el.blur()`。
- **F40-3（info）**：本地自用域数据身份固定 `local-user`，`/api/quotes` 按其过滤；现库该身份下 0 条报价记录 —— 报价域真实语料审计必须以用户实际登录身份为准，别把「查不到」读成「没问题」。
- **F40-4 → 新开 B16（low）**：其余百分比型字段（价格分下浮率、评分办法费率、清单数量倍数）的同类歧义待复查，再决定是否复用本范式。
- 挂账未动：B15（R39 网关补丁仍需用户重启 :7000 才能生效复测）、F37-1/F38-1（两批在途未提交改动，全仓 tsc 门禁持续假阳性，需用户拍板）。

## 七、环境与副作用

- 为取证按 `start-local.cmd` 同参启动了 **:8000 Vite dev server**（清空 `NODE_OPTIONS` + `vibex-local/vite.local.config.ts --host 0.0.0.0 --port 8000`）。项目 hook 禁止智能体结束进程（`taskkill` 在 deny 列表），故验证后**仍在监听**，请用户自行关闭；`stop-local.cmd` 会连 :7000 PocketBase 一起停，勿轻易调用。
- 全程未执行任何 git 写操作（无 commit / 无 push / 无 stash）。
- 补丁与取证脚本：`d:/KFDXCX/MedPreSales/scripts/r40_install.py`（3 新增 + 17 定点补丁，锚点全部唯一命中断言，`R40_DRY=1` 先验后落盘）、`r40_ui_proof.py`/`r40_ui_proof2.py`、`r40_fix1.py`、`r40_audit_discounts.py`、`r40_ledger.py`；原始门禁输出 `d:/KFDXCX/MedPreSales/.qoder/tmp/r40_*.txt|json`。

## 八、下一轮建议

按 `_loop_state.json` 的 focus：首选 **B1（R031 遗留 A1-A6 编制层，择一闭环）**；次选 B15（前提是用户已重启 :7000，且「健康徽标改真跑一次 chat」落在 model-config 在途批次内，动前必须再比对 git status 防误伤）。


## 九、补充证据：用户实际浏览器会话（browser-use 连本机 Chrome）

前文第五节是 Playwright 独立视口的注入取证；本节是在**用户真实浏览器会话**（:8000 Vite dev、线上壳、真实主题与 sonner Toaster、登录态=系统管理员）里对同一套代码的独立复验。

| 项 | 观测 |
|---|---|
| 真实模块直调 | `discountAmbiguity(0.9)` → 0.9% vs **90%（9 折）** 倍数 100；`(3)` → 3% vs 30%（3 折）倍数 10；`(90)`/`(0)` 判 null；`normalizeDiscount(0/-5/120)=100` 而 `(0.9)=0.9` 不钳位；990,000 行按 0.9% = 8,910 / 按 90% = 891,000；`scanAmbiguousDiscounts` 命中 0.9 与 1；交付体检只出 `verbatim_fidelity:warn` 且 `buildVerdict.sendable` 仍 true |
| 真实组件交互 | 页面内挂载线上 `QuoteEditor`（spy 回调零写库）：行内填 0.9 失焦 → **写入次数 0**、行 discount 仍 100、弹窗给出两种读法的真实金额 |
| 选读法 | 点「按 90% 计价（9 折）」→ 仅一次 `updateItem({discount:90})`，行小计 891,000.00 + 「90%计价」标注，**线上 toast 实际弹出「本行已按 90% 计价」**（Playwright 壳无 Toaster，这一条只有本通道能证） |
| 整组路径 | 整组折扣% 填 3 → 组级弹窗「本组 2 行 ¥36,900.00 vs ¥369,000.00（原价 ¥1,230,000.00）」，写入次数不变；点「都不是」→ 无新增写入 |
| 现场还原 | 验证后卸载注入节点并移除容器（injectedRemoved=true），会话回到 /ppt-quote 原状，未写入任何业务数据 |

环境事实（写死以免再犯）：
- 该 Chrome 窗口最小化 → `document.visibilityState=hidden`、`hasFocus()=false`，**`el.blur()` 不产生 focusout，React onBlur 不触发**（首次尝试即卡在此处，而 onChange 行内提示已生效）；须显式派发一次 `FocusEvent('focusout', {bubbles:true})`。
- 隐藏页 CSS 动画被节流 → Radix 关闭后节点短暂滞留 DOM，但 `data-state` 已为 `closed`：判「弹窗已关」要看 `data-state`，不能只查节点是否存在。
- `browser-use take_screenshot` 本机仍 15s 超时无产物（视口 0x0 取不到合成帧，与 R38/R39 一致），图像证据沿用第五节三张 Playwright 截图。

## 十、收轮复验

`npx tsc -b` 仍为同样 5 条在途 error（本轮文件 0 error）；`npx vitest run` 219 files / 2617 passed / 2 skipped；`npx eslint <触及 7 文件>` exit 0；`npx vite build` exit 0（3.99s）。
