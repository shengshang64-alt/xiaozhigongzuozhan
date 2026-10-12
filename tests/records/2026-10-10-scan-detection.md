# 场景自测 — 扫描件/图片型文档检测（R255 / 易标 R-029 Slice3）

日期：2026-10-10 ｜ 轮次：R255 ｜ 记录人：自动迭代（检测 + 导入守卫 + 报告横幅）

## 场景口径（AGENTS 强制）
模拟一所三甲医院信息化招标项目「导入扫描件 PDF → 质量分级阻断 → 正常 docx 导入通过 → 偏少文本警告 →
解析落库持久 parse_quality → 刷新后横幅恢复 → 老报告兼容」全流程，验证 R-029 检测的真实行为，不破坏正常导入与既有项目。

## 操作步骤
1. 建医院 → 建项目 → 招标文件步「导入文件」。
2. 上传一份扫描版 PDF（图片型，pdfjs 仅抽出零星页码/页眉文字，file.size 数 MB）：
   `assessTenderParseQuality(text,{bytes})` → suspect_scanned → 红字 toast「疑似扫描版/图片型…请先用 OCR…或粘贴文本」并阻断，
   不进草稿、不浪费解析费用。
3. 上传正常文字版 .docx（抽出上万字）：→ ok → 正常写入草稿 + 成功 toast + 既有符号丢失提示不受影响。
4. 上传内容偏少的文件（几十~一百多字）：→ low → 琥珀警告「文字偏少可能解析不全」但仍继续导入。
5. 外部投标文件步上传扫描件：同款 suspect_scanned 阻断。
6. 批量解析完成后 finalReport 落 `parse_quality`（文本口径），ParseReportPanel 顶部显示对应横幅；刷新后横幅仍在
   （normalizeParseReport 保留 parse_quality）。
7. 老项目兼容：本轮之前落库、无 parse_quality 的报告 → 横幅不显示、行为与升级前一致。

## 自动化验证（零模型，纯函数）
`src/pages/BidWorkspace/parseQuality.test.ts`（6 例）：空/全空白→suspect_scanned（hint 含 OCR）；<30 字→suspect_scanned；
大文件+极少字（100 字 / 3MB，密度判据优先于偏少）→suspect_scanned（reason 含 KB）；120 字无 bytes→low；300 字→ok；
250 字 + 小 bytes(2KB，密度不触判据)→ok（防小文件误判）。

## 预期 / 实际结果
- 预期：扫描件在导入即被识别并给出可操作指引；正常文件零变化；偏少文件警告不阻断；质量分级持久并刷新可恢复。
- 实际：四门全绿（tsc0 / eslint 新 2 文件 0 problem + 触及 3 文件前后 8 errors·13 warnings 计数一致 /
  vitest 158/1850+2skip（+1 文件 +6 用例）/ build exit0 3.16s）。

## 发现问题
- 真实扫描版 PDF 的字节/字符密度分布需以实际样例校准阈值（当前 0.02 为保守值，宁可漏判不误伤正常文件）；
  建阳区样例真实扫描件端到端回归留 Slice5 与 needs_reparse UI 同批复核。
