# R189 PPT 模板母版/版式保真导出接线（r169 切片②）

日期：2026-10-06 ｜ 优先级：P2 ｜ 类型：A 类（功能接线，无提示词改动）

## 选题依据

- 用户点名候选经账本核实均已闭环：quote-history-01（done）、prompt-fabscan-03（closed）；r177 残余核实并发2/断点续跑已在（R140/R180）。
- 按授权巡检 backlog，选中 **r169-ppt-template-master-fidelity 切片②**：唯一「内核已交付、只差接线」的实质项——R182 已交付 templateFidelity.ts 引擎（16 单测全绿）但无任何调用方，用户上传公司模板后导出仍是仅换色/字体的主题级保真。接线后母版级保真真正对用户生效。
- 在途核对：7 个目标文件 git M 均为 R169/R149/R182 历轮积累（R188 裁定红线前提解除），锚点区逐 hunk 确认后施工；备份 .loop/backup_r189/。

## 变更内容

### 1. 引擎扩展 notes（templateFidelity.ts）
- `FidelitySlideSpec` 增 `notes?: string`；`FidelityOutcome.ok` 分支增 `notesCount`。
- 新增 `notesDoc`（逐行成段 + XML 转义的标准 notesSlide 部件）与 `notesRelsXml`（rId1→对应生成页 slide、rId2→notesMaster）。
- `repackage` 对模板既有 notesSlide 孤部件**顺延编号**（从模板最大号起），新部件写文件+rels+[Content_Types] Override，不覆盖。
- 前置守卫：specs 有备注但模板无 notesMaster → `ok:false`（reason 含 notesMaster），调用方回退现通道——**讲稿绝不静默丢失**。

### 2. 纯计划层（新文件 deckFidelityPlan.ts）
- `effectiveLayout` 自 deckExports 迁入，口径逐字不变（单一来源）。
- `isFidelityEligibleSlide`：含真实配图/figures/chart（categories 非空）/kpi 的页不合格；显式图文/图表/KPI 版式但缺数据时按现口径降为要点、仍合格。
- `planFidelityExport(deck, today)`：任一页不合格或无页 → null（整册走现通道）；全合格 → specs：封面（deck_name 兜底「汇报 PPT」+ 类型|受众|时长 + 日期）、目录（`01   标题`）、逐页（section 页要点以 \u3000·\u3000 合并一行、空 bullets 用「—」占位、**notes 逐字透传**）、末页「谢谢聆听/欢迎交流指正」——与 pptxgenjs 现通道文案逐字一致。

### 3. 导出双通道分流（deckExports.ts）
- `ExportDeckOptions` 增 `templateBytes?: Uint8Array`；返回类型改 `DeckExportPath = "fidelity" | "legacy"`。
- 分流点在任何 `new PptxGenJS()` 之前：`opts.templateBytes?.length` 且计划命中且 `buildFidelityDeck` ok → 保真字节（非 none 切换动画时经 injectTransitions 注入）直接下载并返回 "fidelity"；**其余一切情形现通道行为逐字不变**返回 "legacy"。
- `injectTransitions` 参数放宽为 `ArrayBuffer | Uint8Array`。

### 4. 模板字节持久化（deckTheme.ts，零新增 collection）
- `StoredDeckTemplate.bytesB64?: string`；`MAX_TEMPLATE_BYTES = 3MB`。
- 手写 base64 `encodeTemplateBytes`/`decodeTemplateBytes`（node/浏览器通用；空/超限/非法字符/长度不整除4/中段填充 → null），与模板 JSON 同键 localStorage 往返。

### 5. 调用接线（usePptQuote.ts / DeckEditorWorkspace.tsx）
- 上传：读字节一次 → 提取主题 + 编码保存；QuotaExceeded 自动降级只存主题，toast 如实区分「已启用母版/版式保真」vs「模板过大或本地空间不足，未启用母版级保真」。
- 导出：`templateBytes: decodeTemplateBytes(deckTemplate) ?? undefined`，按返回通道回报（保真成功给专属 toast）。
- 上传按钮 tooltip 口径同步「整册纯文字页时按模板母版/版式保真导出」。

## 测试增量（+22，全新增零回退）

| 文件 | 新增 | 钉死内容 |
| --- | --- | --- |
| templateFidelity.test.ts | 4 | notes 挂回生成页+Override 唯一、孤部件顺延不覆盖、无 notesMaster ok:false、无备注不新增部件 |
| deckFidelityPlan.test.ts | 9 | 合格判定/版式降级口径、封面目录致谢文案逐字、notes 透传、section 合并行、任一不合格整册 null |
| deckTheme.test.ts | 4 | 全字节值 encode→decode 还原、超限/空 null、脏数据 null、同键 save→load→clear 往返 |
| deckFidelityWiring.test.ts | 5 | 源码扫描哨兵：分流先于 pptxgenjs、plan 三件套、codec 存在、上传/导出接线与 toast 口径（风格同 deckLintPanel.test.ts） |

## 四门验证

| 门 | 结果 |
| --- | --- |
| npx tsc -b | exit=0（首跑 3 错，r189_fix_tsc.py 修复：generated 本地类型补 notes、bytesB64 null 收窄、decode ?? undefined） |
| npx vitest run | 111 files / **1295 passed \| 2 skipped**（基线 1273 → +22，零失败） |
| npx eslint（10 触及文件） | **零新增 error**。usePptQuote.ts 在途既有 4×set-state-in-effect error + 1×exhaustive-deps warning，行位（227/1451/1526/2241）均不在本轮补丁区域，属 lint-debt-01 维持裁定不重构 |
| npx vite build | 成功 3.06s（仅历轮既有 chunk>500kB 提示） |

## 裁定与边界声明

- **B 类流程不适用**：本轮零提示词改动、零 PROMPT_VERSION 变更、零快照更新。
- **数据模型**：零新增 PocketBase collection / pb_hooks；模板字节仅存浏览器 localStorage（同键扩展字段），清空模板即释放。
- **维持裁定不推翻**：编造嫌疑硬门禁仍「只报告不拦截」；lint-debt-01 残余不重构。
- **v1 边界（诚实降级）**：混合媒体 deck（含图表/KPI/图文页）整册回退现通道——母版保真 × pptxgenjs 图表的 zip 级合并留待切片③后评估；模板无 notesMaster 且页带讲稿时整册回退，保证备注不丢。
- 禁止 commit 遵守中：全部改动留在工作区。

## 账本回写

- round 188 → **189**；closed +1（r189-ppt-template-fidelity-export-wiring，P2）；
- backlog r169-ppt-template-master-fidelity：plan 标注「切片②已交付」，剩切片③（样张页选择交互），维持 open；
- lastRoundSummary 已更新。
