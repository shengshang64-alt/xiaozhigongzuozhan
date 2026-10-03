# R110 全站文件下载单一入口收敛（blob-download-consolidate）

日期：2026-10-01 · 轮次：R110 · 优先级：P2 · 类型：实质性口径统一（巡检新角度，承接 R105 文案 / R106 CSV / R108 相对时间 / R109 PB JSON 单一真源主线）

## 选题依据
- 账本两大实质项均已收口：quote-history-01（R102 closed）、prompt-fabscan-03（R103 closed，编造未清零硬门禁维持 R89 裁定「只报不拦」）。
- 巡检扫描全站 `createObjectURL`：真实下载触发点共 9 处、散在 8 个文件，且漂移出 4 种口径：
  1. 点击后立即 revoke（CompanyTemplateHint / CompetitorCompare / bidFiles / exportCsv / aigc）
  2. 3000ms 延时 revoke（deckExports×2 / quoteExports）
  3. 4000ms 延时 revoke（ChatStream / useFormatTool）
  4. 不挂 DOM 直接 `a.click()`（ChatStream / CompetitorCompare / useFormatTool / exportCsv——部分内核对未插入文档的元素忽略 click）

## 方案
- 新建全站唯一入口 `src/lib/download.ts` → `triggerBlobDownload(blob, fileName)`：
  `createObjectURL → 临时 <a> → appendChild → click → remove → setTimeout revoke 3000ms`（取最稳健组合）。
- 9 处调用点改为委托（8 文件）：ChatStream（周报 docx）、CompanyTemplateHint（模版 fetch→blob）、
  CompetitorCompare（对比 CSV）、exportCsv（轻量 CSV）、bidFiles（标书 docx）、useFormatTool（格式刷新 docx）、
  deckExports（downloadBlob 助手 + saveDocx 讲稿，两处）、quoteExports（报价单 docx）。
- 有意绕开并记录：
  - `aigc.ts downloadAigcResult`：跨域 fetch 失败需 `window.open` 兜底，catch 语义与纯下载入口不同，强并会扩大 try 范围改变兜底行为，保留独立实现；
  - `appearance.ts` / bidFiles / deckExports 共 3 处 `createObjectURL` 为图片解码与 SVG→Image 渲染用途，非下载，不属于本入口。
- 行为等价性：下载内容与文件名 0 改动；「立即 revoke → 延时 3s」仅推迟内存释放（点击同步入队后延时不会打断下载，反向才有风险）；「补挂 DOM」修复的是被忽略 click 的内核兼容，用户无感。

## 四门验证
| 门禁 | 结果 |
| --- | --- |
| npx tsc -b | exit 0（首轮 download.test.ts 桩内未用参数 blob 报 TS6133，删除该参数后过） |
| npx vitest run | 686 passed / 2 skipped（基线 682 + 增量 4：download.test.ts 顺序/属性/同步不 revoke/延时精确 revoke 四条） |
| npx eslint 触及 10 文件 | 新增 0 error；唯一 error 为 useFormatTool.ts:95 set-state-in-effect，git diff -U0 证实本轮该文件仅 +L5 import 与 L128-134→129 两处 hunk，L94-96 属基线既有（HEAD 起）不在触及区 |
| npx vite build | exit 0（3.24s，chunk 体积警告为基线既有） |

## 实机验证（dev:8000 热加载 + PB:7000 在跑）
- /competitors 能力对标 → 点「导出对比」：先 hook `HTMLAnchorElement.prototype.click`，捕获到
  `{name: 竞品订单能力对比_2026-10-01.csv, href: blob:…, inBody: true}`——`inBody:true` 证明委托后的统一入口
  「先挂 DOM 再点击」新口径已生效（该点位 R110 前是不挂 DOM 的旧口径）；toast「对比矩阵已导出」正常；console 0 error / 0 warn。
- 截图：d:/KFDXCX/MedPreSales/test_results/r110_competitors_download_consolidated.png

## 边界与裁定维持
- 未动提示词（无 B 类流程、无 PROMPT_VERSION 变更）；未动 collection / pb_hooks；会话内零数据模型变更。
- 维持 R89 裁定：编造嫌疑未清零禁导出硬门禁不做；lint-debt-01 残余有意保留不重构。
- 禁止 commit：本轮全部改动留在工作区（含 R89 起累计未提交在途），补丁锚点区已逐一 git diff 核对，
  ChatStream/bidFiles 锚点不在在途 hunk 内；CompetitorCompare handleExport 区为 R107 本轮闭环自产在途，非用户新功，正常委托。
- 补丁脚本：d:/KFDXCX/MedPreSales/scripts/r110_download_consolidate.py（每处 str.replace 前 assert count==1，全部命中）。
