# R163 · 标书主链路：实质性条款覆盖矩阵接入「疑符号丢失」徽标（闭环 R160 展示层挂账）

- **仓**：小智工作站 `D:\重要文件\工作的小程序\xiaozhigongzuozhan`
- **轮次**：round 162 → **163**
- **类别**：P2 实质优化 · A 类（零 schema / 零 collection / 零 pb_hooks / 零提示词，非 B 类）
- **一句话**：把 R159/R160 建好的「★/▲ 标注符号丢失」检测徽标从**解析报告面板**扩展到**实质性条款覆盖矩阵**——同一真源判定，两处一致暴露；并顺手清掉 R161 点名的 aigc.ts 两处 `no-useless-assignment` 存量。

## 一、选题依据（用户授权 + 明确挂账）
1. R160 报告《后续挂账》原文：**「r159-marker-badge-ui 仅覆盖 ParseReport 展示层；ComplianceMatrixPanel 的命中行徽标可另轮按同一 lineHasMarkerLoss 复用补齐（数据源已单一真源，接线成本低）」**——标书主链路（选题权重第一）上白纸黑字的未完接线。
2. 账本 `r159-marker-badge-ui` 已 closed（仅解析报告侧），矩阵侧展示层残余无独立 backlog（按 `compliance/marker/badge/矩阵` 全量扫描账本确认 0 条），本轮补登并即时闭环。
3. 附带清偿 R161 点名 `aigc.ts L379/L719` 两处 no-useless-assignment（同类 lint 存量，留待顺手清）。
4. 其余 open backlog 均维持裁定项（lint-debt-01 不重构 / r130 pb_hooks 红线 / quote-history-3-mining 待立项 / ui-redesign-phase3 长期），不推翻。

## 二、问题与缺口
符号丢失签名（空引号对「""」/私用区 U+F000–U+F2FF）源自原招标文件转换损坏，非本页漏列。R159 建真源、R160 在 ParseReportPanel 挂徽标；但实质性条款覆盖矩阵（交卷前清零「未覆盖」的主界面）仍看不到「此条疑符号丢失、扫描可能不全」——两条展示通道口径不一致，缺口更贴近决策点。

## 三、本轮交付
### 1）同源计数纯函数（新增）
`src/pages/BidWorkspace/complianceMatrix.ts` · `countMarkerLossRows(rows)`：逐行走 `materialIntegrity.lineHasMarkerLoss`（同一真源），**先去重再判定**，返回命中去重条款数。零 AI、零副作用。
### 2）矩阵面板两级徽标（改动）
`src/components/bid-workspace/ComplianceMatrixPanel.tsx`：表头汇总「疑符号丢失 N 条」橙色 Badge + 命中行行内徽标（同款样式措辞），随筛选收敛（useMemo 依赖 visibleRows）。
### 3）单测（+4）
`src/pages/BidWorkspace/complianceMatrix.test.ts`：空引号对+私用区命中/正常★不误伤（[true,false,true]→2）、空集 0、去重 1、真实矩阵行按原文命中。
### 4）顺手清 lint（改动，行为等价）
`src/lib/aigc.ts`：L379 `serverMsg`、L719 `data` 去死存储初值，2 处 eslint error 清零，运行时语义不变。

## 四、四门验证
| 门禁 | 结果 |
| --- | --- |
| `npx tsc -b` | exit 0 |
| `npx vitest run` | 98 文件 / **1071 passed + 2 skipped**（基线 1067 → 增量 +4）|
| `npx eslint`（触及 4 文件）| 净新增 0 error；aigc.ts 原 2 error 清除（净 -2）；ComplianceMatrixPanel L101 set-state-in-effect 为 R016 既有存量（HEAD L98 已在），非本轮引入 |
| `npx vite build` | exit 0，5950 modules，3.56s |

## 五、浏览器实机验证（dev :8000）
进入 【演练】R01-bid-20261004（真实三明招标，含 R152 定位的 F05 符号丢失素材）第 2 步：
- **阳性（兄弟面板）**：项目概述分区自然渲染 R160「疑符号丢失 1 行」徽标 + 行内徽标，判定链在本视图存活。
- **阴性对照（本轮矩阵）**：矩阵对 4 条 ★/▲ 条款正确静默（均带完整 ▲、无空引号对，countMarkerLossRows=0，无误报），面板渲染正常，console 0 error/0 warn。
- **阳性（函数级 · 判别性 A/B）**：运行时 `import('/src/.../complianceMatrix.ts')` 直调产物：`countMarkerLossRows([空引号,正常★,私用区])`=2、`lineHasMarkerLoss`=[true,false,true]、去重 1、空集 0。
- 截图：`.qoder/r163_bidworkspace.png`、`r163_matrix_negctl.png`。
> 真实 4 条矩阵行恰为干净条款，故矩阵徽标在真数据上阴性（期望行为）；阳性由运行时函数直调 + 兄弟面板徽标共同给出，构成完整 A/B。

## 六、约束与回滚
零 B 类（SOL/bid PROMPT_VERSION 不变）；零 collection/pb_hooks/AI 调用/数据模型；维持裁定不推翻（编造只报不拦 R89、lint-debt-01 不重构、r130 pb_hooks 红线）。补丁前 git 核对 4 文件锚点区无在途新功能；落地脚本 `scripts/r163_compliance_marker_badge.py`（+ `r163b_panel_import_fix.py`；pathlib/utf-8，每 replace 前 assert count==1；备份落 `.loop/trash_r163_bak/`，避免被 vitest `**/*.test.ts` 误采集）。未 commit。

## 七、遗留
- 若素材侧提供含 ★/▲ 完整版原件，符号丢失根因消除后徽标自然清零（属数据治理，不在代码范围，沿 r152-full-tender-needed blocked）。
