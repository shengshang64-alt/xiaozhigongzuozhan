# R182 · PPT 母版/版式级保真引擎（r169 三切片计划·切片一）

- round：181 → 182  |  类别：A 类实施（新增纯函数引擎 + 单测，零 UI 接线）
- 提示词：无改动（不触发 B 类逐字对比流程）  |  数据模型：零 PocketBase collection / 零会话 state 改动
- 维持裁定：编造嫌疑硬门禁「只报告不拦截」、lint-debt-01 有意保留残余——本轮均未触及，无推翻

## 1. 选题依据
- 两个 backlog 优先项已收口：quote-history-01（done，R102/R131/R176）、prompt-fabscan-03（closed，R101/R103）。
- 唯一 open 的 P2 主链路实质项 = r169-ppt-template-master-fidelity。R181 已完成其立项强制前置
  （可复用方案检索 + 双 PoC 实测，结论=复用+本地叠加），并把实施细化为三切片。本轮按序落地**切片一**。

## 2. 交付内容
新增 `src/pages/PptQuote/templateFidelity.ts`（约 250 行）：
- `buildFidelityDeck(template, specs): FidelityOutcome`——克隆模板版式样张页 → 改写占位符文本 → 重打包；
  母版(slideMaster)/版式(slideLayout)/主题(theme)/媒体(byte-identical)原样携带，产物只含生成页。
- `inspectFidelityTemplate(template)`——逐样张页可保真性目录（供切片三交互与失败归因）。
- 文本注入：TITLE_PH/BODY_PH/SKIP_PH 正则；`rewriteShapeTxBody` 保留 bodyPr/lstStyle/首段 pPr/首 run rPr
  样式模板，每行一个 `<a:p>`；用 `block.slice` 拼接避开 `String.replace` 的 `$` 模式陷阱。
- 重打包：presentation rels 只摘 `/slide` 关系从 maxRid 续排新 rId；重建 sldIdLst（兼容自闭空标签）；
  重建 [Content_Types] slide Override；清理 notesSlides/_rels 指向旧 slide 的关系。
- 依赖：仅 `import { strFromU8, strToU8, unzipSync, zipSync } from "fflate"`，零新增第三方引擎。
- 诚实降级：任何不满足前提返回 `{ok:false, reason}`，调用方按契约回退 pptxgenjs 现通道。

新增 `src/pages/PptQuote/templateFidelity.test.ts`（16 用例，node 环境，合成最小 OOXML 模板）：
happy path（母版/版式/主题逐字节保留、产物只含生成页、rels 沿用版式引用、sldIdLst 与 rels 一一对应无悬空、
Content_Types Override 恰 K 条不重复）、样式模板复用、XML 转义、$ 文本安全、无占位符形状顺序回退、
notes 样张整页跳过 + notes rels 清理、chart 全拒降级、image 关系保留、空 specs / 非法 zip 降级、
**K≠模板页数(3 页)重建清单真正写入产物的回归用例**、inspectFidelityTemplate 目录 / 非法输入 null。

## 3. 实施中修出的真缺陷（非纯 lint）
`repackage` 计算出新 `pres` / `presRels` 后，复制部件的循环仍以 `ctx.entries` 的原始
`ppt/presentation.xml(.rels)` 落盘并覆盖它们——重建清单从未真正进入产物。
- 现象：K=2 的模板恰好因原始 sldIdLst 就是 2 页而"侥幸通过"断言；K≠2 会导致 sldIdLst 与 slide 关系悬空/错指。
- 命中：`npx eslint` 的 `no-useless-assignment` 精准报了 3 处（presRels/pres 赋值未被使用）。
- 修正：复制循环 `continue` 跳过这两件，循环后显式 `out["ppt/presentation.xml"]=strToU8(pres)`、
  `out["ppt/_rels/presentation.xml.rels"]=strToU8(presRels)`；并补 K=3 回归用例锁死（旧实现下该断言必失败）。

## 4. 四门验证
| 门 | 结果 |
|---|---|
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 1208 passed / 2 skipped（基线 1192 → **+16 新增，零回退**） |
| npx eslint（触及 2 文件） | 零 error / 零 warning |
| npx vite build | 成功，built in 3.82s |

## 5. 补丁脚本（跨工作区，均在 d:/KFDXCX/MedPreSales/scripts）
r182_template_fidelity_engine.py（新建引擎+测试）；r182_fix_patch.py（repackage 包裹标签 + 三处单测设计）；
r182_fix2_patch.py（正文样式模板用例样张选择、$ 转义期望、chart/chartBoth 旗标解耦）；
r182_fix3_patch.py（真缺陷：重建清单写入产物）；r182_fix4_patch.py（K=3 回归用例）。
所有触及均在 git status 核对：templateFidelity.ts/.test.ts 为**新建**，与用户在途 M/?? 文件零冲突；未 commit。

## 6. 剩余挂账
r169 仍 open：切片二（deckExports 导出接线，含无模板逐字不变回退）、切片三（样张选择交互）留待后续轮。
