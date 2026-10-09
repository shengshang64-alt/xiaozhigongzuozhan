# R157 · 单发 PPT 生成路径按目标页数收敛（闭环 r149-deck-pagecount-unenforced）

- 轮次：157
- 日期：2026-10-05
- 模块：/ppt-quote（deck 主链路，非报价侧）
- 优先级：P2·实质性优化
- 类别：A 类（纯逻辑，零 schema / 零 pb_hooks / 零提示词文本改动，不涉 B 类 PROMPT_VERSION）

## 1. 选题依据

用户指定的两个优先项经账本核实均已收口：quote-history-01 二期（R102 落地、R131 增量精化，closed）、
prompt-fabscan-03 残余「按章聚合回注」（R103 落地，closed）。按权重（方案 > 标书 > PPT/deck，弱化报价）
在 open backlog 中择优，选中 r149-deck-pagecount-unenforced（P2）：deck 生成主链路上的真实防御缺口，
属「deck 生成接续/质检」实质项，而非零风险小改。

## 2. 问题取证

新建 PPT 向导明示「约 N 页」、进度提示「正在生成 N 页内容…」，prompt 也明确「共生成 N 页（含开场页与收尾致谢页）」。
但两条生成路径防守不对称：
- 批量路径（pageCount > SINGLE_CALL_MAX_PAGES=10）：经 normalizeSlidePlan(…, pageCount) 裁到 pageCount+4 再分批，有页数上限。
- 单发路径（pageCount ≤ 10）：normalizeSlides(parseJsonLoose(text), null) 的 plan 传 null，完全不做页数收敛——
  模型返回多少页就全收。R149 实测 v1：目标 3 页、模型返回 6 页照单全收，L2 判据「页数=目标页数」不成立。

## 3. 变更

### src/pages/PptQuote/pptQuoteTypes.ts
- 新增导出纯函数 trimSlidesToTarget<T extends { title: string }>(slides, target)：
  target 非正数/非有限值/slides.length<=target → 原样返回（同引用，不裁剪）；target===1 → 只留首页；
  其余超页 → 保留首页(开场)与末页(收尾致谢)、仅裁剪中间正文页取前 target-2 条，维持大纲次序；不足 target 不补。
- normalizeSlides(raw, plan, maxPages?) 增可选形参 maxPages：末尾 return maxPages === undefined ? out : trimSlidesToTarget(out, maxPages)。
  不传时行为与旧版逐字等价（批量 use:587、精修 use:748 不受影响）。

### src/pages/PptQuote/usePptQuote.ts
- 单发调用点改为 normalizeSlides(parseJsonLoose(text), null, pageCount)，把目标页数作上限传入。仅此一行改动。

### src/pages/PptQuote/pptQuoteTypes.test.ts（+7 用例）
- trimSlidesToTarget：不超页同引用 / 超页裁到 target 保首尾删中间 / target=1 只留首页 / target 非正数·NaN 不裁剪。
- normalizeSlides(maxPages)：传上限超页→收敛 / 不传→不限页数（向后兼容）/ 空返回仍抛错。

## 4. 四门验证
- npx tsc -b：exit 0，零错误。
- npx vitest run：1029 passed / 2 skipped（基线 1022 +7，全为本轮新增，95 文件全绿、零回退）。
- npx eslint（3 触及文件）：pptQuoteTypes.ts / .test.ts 零问题；usePptQuote.ts 4 error+1 warning 全为在途既有
  set-state-in-effect(L218/1393/1468/2183)/exhaustive-deps(L1806)，与本轮唯一改动（L568 加 pageCount）无因果关系，净新增 0。
- npx vite build：3.67s 成功（chunk >500kB 告警为既有基线）。

## 5. 边界与裁定
- 零 collection / 零 pb_hooks / 零会话外 state / 未动 AI 提示词文本（非 B 类，PROMPT_VERSION 不变）。未 git commit。
- 维持既有裁定：编造未清零导出只报不拦（R89）、lint-debt-01 有意保留不重构、r119/r130/r147/r152 等 defer 项继续在途绕开。
- 在途保护：触及三文件补丁前逐一 git status 复核，PptQuote 全域 CLEAN，用户 WIP 全在 SolutionStudio，零交集。
- 备份 pptQuoteTypes.ts.bak-r157、usePptQuote.ts.bak-r157（验证通过后删除）。
