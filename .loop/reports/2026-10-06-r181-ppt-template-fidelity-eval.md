# R181 PPT 模板母版/版式级保真：可复用方案检索与实测评估（r169 立项前置步骤交付）

日期：2026-10-06 | 类别：A 类评估轮（零源码改动 / 零 schema / 零 pb_hooks / 零提示词 / 零 AI 费用）| 未 commit

## 选题依据
- 用户点名优先项复核：quote-history-01 二期已收口（R102/R131/R176 沉淀+按等级/床位/模块+每床单价投影），prompt-fabscan-03 全部切片已收口（R101 四态/R103 按章聚合回注）。
- 现役 open 实质项中唯一 P2 主链路项为 r169-ppt-template-master-fidelity（PPT 制作链路），其账本 plan 明确要求：实施前先做可复用方案检索与实测评估（触引擎/二进制解析不得裸写 OOXML）。本轮即交付该评估与三选一结论。

## 检索范围与证据
1. npm/GitHub：
   - pptx-automizer 0.9.4（singerla）：模板合并/克隆型 .pptx 生成器，母版保真能力业界最成熟。
   - pptxtemplater（anglebraket）：模板填充型，浏览器可用，但保真复制（partial duplication）要求模板预置 {{tag}}。
   - pptxgenjs 4.0.1（现役依赖升版核查）：dist 全文 grep `readTemplates|importTemplates` 0 命中——官方仍无模板导入能力，`defineSlideMaster` 只是自定义母版而非读取用户 .pptx 母版。
2. 本机 CLI/独立安装路径：python-pptx 已在本机 venv 实测可用——但只能做离线校验（本轮即用它复核 PoC 产物），项目部署形态为 React SPA + PocketBase（无 Node/Python 后端进程），不能作为运行时组件。
3. 项目内已有模块：R169 deckTheme.ts 已建立 fflate 解包 + OOXML 主题解析通道；deckExports.ts 全部版式为 pptxgenjs 代码手写布局。

## 实测 PoC（工作目录 d:/KFDXCX/MedPreSales/.qoder/tmp/r181_poc，产物 poc_out.pptx / poc2_out.pptx）
### PoC-1：pptx-automizer 新 API（loadRoot/load(buffer)/addSlide/getJSZip）
- 用 pptxgenjs 构造含自定义母版 CORP_MASTER（背景+页脚+页码）与两页样张的模板，克隆第 1 页并改写文本。
- 结果：slideLayouts 2/2 逐字节一致、theme 1/1 逐字节一致；slideMaster1.xml diff 仅 1 个空白字符（ratio=0.9999）；生成页 slide3 引用模板 slideLayout2；占位文本改写命中。
- 浏览器可打包性：esbuild --platform=browser 失败（17 errors）——dist 硬依赖 fs/path/crypto/async_hooks/stream-promises，Node-only。随前端引入需新起 Node sidecar，违反既定『禁边车』架构裁定（kb-semantic-01 先例）。
### PoC-2：浏览器等价的最小保真算法（纯 JSZip + 字符串/XML 级操作，零 Node 专有 API；JSZip 与项目已有 fflate 同能力）
- 流程：解包模板 → 克隆版式样张页为 slide3.xml（含 rels 原样复用=同版式引用）→ DOM/文本级改写占位符 → 注册 [Content_Types].xml + presentation.xml(sldIdLst) + presentation.xml.rels → 重打包。
- 结果：theme/slideLayouts/slideMasters 全部 byte-identical=true；slide3 layout -> slideLayout2.xml；presentation sldIdLst=3 页。
- python-pptx 独立复核 poc2_out.pptx：3 页全部解析成功，slide3 版式名 CORP_MASTER、标题『医院信息化建设整体方案』、正文『一、现状分析 二、建设目标 三、总体架构』——OOXML 合法且母版链路完整。

## 结论（复用 / 复用+本地叠加 / 不复用 三选一）
**复用+本地叠加**：不直接引入任何第三方模板引擎——
- pptx-automizer 不复用为运行时（Node-only，引入=造边车，否）；其「克隆版式样张页+改写占位符+原样携带母版/版式/主题」的最小算法路径经双 PoC 实证成立，作为实现蓝本。
- pptxgenjs 维持导出引擎不动（4.0.1 无模板导入，升级不解决本问题）。
- pptxtemplater 不复用（要求用户模板预置 tag，改变输入形态，产品代价大于收益）。
- 本地叠加：在项目内以既有 fflate（已随 deckTheme 引入）实现 PoC-2 算法子集，不新增任何依赖、不新增进程。

## 后续实施切片（挂 r169，R182+ 按此推进）
1. 切片一（引擎）：新建 src/pages/PptQuote/templateFidelity.ts 纯函数模块——模板解包/样张页目录（slide→layout→master 链）/页克隆/占位符文本改写（DOMParser，含 XML 转义与 a:p 段落重建）/[Content_Types]+两级 rels 注册；单测用 fixture 模板跑 node 环境（fflate 同步 API）。
2. 切片二（接线）：导出链路对『标题+正文文字页』走模板保真通道，图表/图片/表格页维持 pptxgenjs 现版式注入模板主题令牌（R169 能力）；无模板时行为逐字不变。
3. 切片三（交互）：模板上传后增加『样张页选择』（哪页做标题版式/哪页做内容版式），默认自动探测（ph type=title/body 计数）。
4. 风险预案：用户模板样张页自带 media/图表关系时克隆需剔除或重挂 rels——切片一先支持纯文字样张，其余诚实降级并提示。

## 四门（本轮零源码改动，验证基线健康）
- npx tsc -b：exit 0。
- npx vitest run：见账本 summary 回填数字（基线应保持 R180 后 1192 passed | 2 skipped）。
- eslint/vite build：本轮未触任何 src 文件，不适用（无触及文件即无新增 error 之可能）。

## 维持裁定
- 编造嫌疑未清零禁导出：维持只报不拦，未触碰。
- lint-debt-01：bidTypes.ts 残余保留，未重构。
- 零 collection/零 pb_hooks/零提示词（B 类流程不触发，PROMPT_VERSION 不变）；禁止 commit 已遵守。
- PoC 产物与脚本留存 d:/KFDXCX/MedPreSales/.qoder/tmp/r181_poc/（poc.js/poc2.js/poc_report.txt/poc2_report.txt/master_diff.txt/poc_out.pptx/poc2_out.pptx），账本与本报告引用其数据。
