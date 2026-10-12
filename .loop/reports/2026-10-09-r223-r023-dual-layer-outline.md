# R223 · R-023 双层目录（第 2 轮改造 · 标书链第四 slice）

## 选题依据与已有能力判断
第 2 轮 R-023 要求"第一层照抄招标目录 + 第二层评分项派生章 + 页面区分两类"。
代码侦查发现第十七轮 17A **已在 prompt 层强制遵循招标目录**（L119-128 buildBidOutlineMessages 当 outlineReqText 存在时
插入硬指令"章结构必须遵循其顺序与层级禁止另起炉灶"），R207 还追加了响应文件组成 1:1 映射约束。
因此 R-023 的**真实差量**不是改 prompt，而是做生成后的来源分类（可机读 origin）+ 三态比对差异 + 补入。
同时 17A 指令本身即满足 R-018 的核心要求，本 slice 一并视为 R-018 落地。

## 变更文件
- 新增 src/pages/BidWorkspace/bidOutlineOrigin.ts（纯本地零 AI：按招标目录逐行匹配打 origin=tender、
  按 tech 评分项名匹配打 origin=scoring、生成后三态差异 CatalogDiff{matched/missing/extra}）
- 新增 src/pages/BidWorkspace/bidOutlineOrigin.test.ts（5 例：无目录不标、tender 命中、scoring 派生、
  missing 列出未生成目录行、extra 列出非目录追加章）
- 改 src/pages/SolutionStudio/solutionTypes.ts（OutlineNode 新增 origin?: "tender" | "scoring"）
- 改 src/pages/BidWorkspace/useBidWorkspace.ts（import classifyOrigins + CatalogDiff；catalogDiff state；
  生成收尾 applyMustWrite 后调 classifyOrigins 持久化 origin + 设置 catalogDiff；
  addMissingCatalogToOutline 一键补入缺失目录条目为顶层章(带 origin:'tender')；return 暴露）
- 改 src/pages/BidWorkspace/BidWorkspacePage.tsx（步骤3 渲染「目录比对（R-023）」可折叠卡片：
  三态计数 + 缺失明细(红色) + 追加说明 + 补入按钮，零涟漪不改 ComposeStep props）

## 关键设计
- classifyOrigins 在 applyMustWrite 之后、cleanOutlineResidue 之前执行：mustWrite 不影响标题匹配，
  residue 可能改标题所以放在最后。
- missing 条目保留目录原文行(含编号)，补入时 trim 后作为章标题；同名已有则跳过(不重复)。
- hasCatalog=false 时卡片整体隐藏（无解析目录→无参照→比对无意义）。
- CatalogDiff 同时满足 R-018 "与招标目录比对三态差异视图" 的要求。

## 四门验证
- tsc --noEmit：0 error
- vitest run：1620 passed | 2 skipped（基线 1615，+5 全绿，0 回归）
- eslint（新文件 + 页面 + solutionTypes 4 文件）：0 issue，零新增
- npm run build：success 3.58s

## 遗留 / 后续
- 逐章 origin 徽标（大纲树内 inline 标签）留待 ComposeStep 重构时加入，本 slice 用统计面板替代。
- R-017 必备技术内容（可配置清单）与 mustWrite 判定互补——mustWrite 是动态信号(评分项/关键词/★▲)，
  静态可配置清单待 R-017 独立配置 YAML 后追加。
- 17A prompt 已覆盖 R-018 硬约束，本 slice 观测/补入闭环，r2-r017-018 backlog 中 R-018 部分视同已落。
