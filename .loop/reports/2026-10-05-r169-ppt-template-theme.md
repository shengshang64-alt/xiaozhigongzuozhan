# R169 — PPT 公司模板主题提取套用（r167-ppt-template-driven-export 第一步）

## 背景
backlog 候选两项：
- `r167-ppt-skill-driven-generation`（P2）
- `r167-ppt-template-driven-export`（P1）

## r167-ppt-skill-driven-generation：勘察确认已满足基线，不重复实现
- `usePptQuote.ts` 已有 `deckSkills = useScopeSkills("ppt-deck", userId)`
- `llmGenerate` 已调用 `injectSkillBlock(messages, skillBlockFor(scope))`
- `PptQuotePage.tsx` 已渲染 `<SkillPickerFor scope="ppt-deck" source={p.deckSkills} />`，作为 `deckPickerSlot`/`refinePickerSlot` 传入 `NewDeckWizard`/`DeckEditorWorkspace`
- `NewDeckWizard.tsx` L312 已消费 `{deckPickerSlot && <div className="mt-3">{deckPickerSlot}</div>}`

结论：标记 `closed-verified`，不重复实现（避免"缩小目标范围"陷阱，明确区分本轮验证 vs 已有基线）。

## r167-ppt-template-driven-export：本轮完成第一步（主题令牌提取套用）

### 范围界定（诚实拆分，不谎报完整闭环）
完整目标（母版/版式级保真）超出当前前端技术栈（`fflate` + `pptxgenjs`，无 `python-pptx` 或成熟模板引擎）能力边界，按 backlog 原 plan"触引擎/二进制解析须先立项评估"拆两步走：
- **第一步（本轮 R169 完成）**：上传 `.pptx`/`.potx` → 解包提取 OOXML `ppt/theme/theme1.xml` 的 `accent1-6` 色 + `majorFont`/`minorFont` latin 字体 → 导出 PPT 时替换硬编码调色板 + 设置 `pptx.theme` 字体。
- **第二步（拆分为新 backlog 项 `r169-ppt-template-master-fidelity`，P2，open）**：真正的母版（slideMaster）/版式（slideLayout）/占位符位置保真，需先立项评估成熟方案，不在本轮范围内。

### 实施细节
- 新建 `src/pages/PptQuote/deckTheme.ts`：
  - `extractDeckTheme(buf: Uint8Array): DeckThemeTokens | null` — `fflate.unzipSync` 解包，定位 `ppt/theme/theme1.xml`，正则提取 `<a:clrScheme>` 内 `<a:accentN><a:srgbClr val="..."/>`（6 色）+ `<a:majorFont>/<a:minorFont>` 内 `<a:latin typeface="..."/>`（丢弃 `+mj-lt`/`+mn-lt` 主题跟随占位符）。
  - `shade(hex, ratio)` — 逐通道明度缩放（`Math.round(c * ratio)`，clamp 0-255）。
  - `saveDeckTemplate`/`loadDeckTemplate`/`clearDeckTemplate` — 持久化到 `localStorage`（key `zx_ppt_deck_template_v1`），支持注入假 `ThemeStorage` 便于 node 单测；损坏 JSON / 非法 hex 一律视为无模板回落 `null`。
- `deckExports.ts`：`NAVY`/`ACCENT`/`ACCENT_SOFT`/`BODY`/`SUBTLE`/`MUTED`/`LIGHT_BG`/`CHART_PALETTE` 由 `const` 改为 `let`（运行时可变）；新增 `applyDeckTheme(pptx, theme?)`（无 theme 时重置为默认值，有 theme 时按 `accent1` 派生 navy/soft/light-bg，`accent2` 参与 `CHART_PALETTE`，设置 `pptx.theme = { headFontFace, bodyFontFace }`）；`ExportDeckOptions` 新增 `theme?: DeckThemeTokens`；`exportDeckPptx` 内在 `pptx.title` 赋值后调用 `applyDeckTheme(pptx, opts.theme)`。
- `usePptQuote.ts`：新增 `deckTemplate` state（`useState(() => loadDeckTemplate())`）、`uploadDeckTemplate(file)`（提取失败/读取失败分别 toast 报错，成功 toast 明确说明"仍不含母版级版式保真"）、`clearDeckTemplateChoice()`；`exportPptx` 调用改为 `exportDeckPptx(deck, { transition: deckTransition, theme: deckTemplate?.theme })`，deps 加 `deckTemplate`；return 新增 `deckTemplateName`/`uploadDeckTemplate`/`clearDeckTemplateChoice`。
- `DeckEditorWorkspace.tsx`：props 加 `deckTemplateName?`/`onUploadDeckTemplate`/`onClearDeckTemplate`；"导出讲稿 Word"按钮后新增「上传公司模板/更换模板」`<label>` + `<input type="file" accept=".pptx,.potx,..." className="sr-only">`（**不能用 `hidden`**，`display:none` 会让 input 从可访问性树消失导致无法命中）+ 已套用时「模板：{name}」badge 按钮（点击 `onClearDeckTemplate`）。
- `PptQuotePage.tsx`：`<DeckEditorWorkspace>` 调用处接线三个新 prop。

### 行尾差异处理
`usePptQuote.ts` 是 CRLF（2370 行全 CRLF），`deckExports.ts`/`DeckEditorWorkspace.tsx`/`PptQuotePage.tsx` 是 LF。统一 `patch()` 函数先检测 `\r\n`、归一化为 `\n` 做 `replace`、再按原行尾写回（`newline=''` 避免二次转换）。

## 四门验证
- `npx tsc -b`：exit 0，零错误
- `npx vitest run`：1127 passed | 2 skipped（较 R168 基线 +9，即本轮新增 `deckTheme.test.ts` 9 用例，无回归）
- `npx eslint` 触及文件：4 error / 1 warning，与 `git show HEAD:` 版本逐字等量（临时文件 `__r169_head__*` 对比法验证，用后已删除清理），**本轮净新增 0**
- `npx vite build`：exit 0，成功

## 单测修正记录
`shade('2E74B5', 0.6)` 期望值最初手算为 `1B466C`，实际逐通道计算 `2E=46→round(27.6)=28=0x1C, 74=116→round(69.6)=70=0x46, B5=181→round(108.6)=109=0x6D` → 正确期望 `1C466D`，已修正测试文件（实现本身合理，仅测试期望值手算错误）。

## 浏览器实机验证（A 类零 AI 零新 collection，无需 B 类逐字对比流程）
1. `/__pb/api/ppt_decks` POST 造测试 deck（需同时带 `X-Rh-User-Id: local-user` + `Authorization: Bearer <token>`，本地部署身份约定，缺失会 401），id=`kkhmu59xfr42ckw`，2 页。
2. 进入编辑台，确认新按钮挂载（`上传公司模板`）。
3. `upload_file` 上传手工构造的最小 `.pptx`（`r169_test_template.pptx`，含 `ppt/theme/theme1.xml`，accent1=`0E9F8A` accent2=`16324F` 等 6 色 + `Source Han Sans CN`）→ 页面出现「更换模板」按钮 + 「模板：r169_test_template.pptx」badge。
4. `evaluate_script` 读 `localStorage.getItem('zx_ppt_deck_template_v1')`，内容正确解析出 6 色 accents + `headFont`/`bodyFont`。
5. 截图存证 `.qoder/r169_template_applied.png`。
6. 点击「导出 PPT 文件」→ toast「PPT 文件已导出（含「淡出」切换动画）；文本框与图片均可在 Office/WPS 直接修改」，`list_console_messages` 无新增 error。截图存证（本轮）。

## 结论
`r167-ppt-template-driven-export` 标 `closed-step1`（第一步完成，母版保真拆新项）；`r167-ppt-skill-driven-generation` 标 `closed-verified`（已满足基线，不重复实现）；新增 backlog 项 `r169-ppt-template-master-fidelity`（P2, open）跟踪母版/版式级保真的立项评估。
