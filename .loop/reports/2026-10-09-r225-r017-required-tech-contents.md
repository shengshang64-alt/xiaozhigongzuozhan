# R225 · R-017 必备技术内容可配置清单（第 2 轮改造 · 标书链第六 slice）

## 选题依据与已有能力判断
第 2 轮 R-017/R-018 要求「目录以招标节点为骨架（提示词口径）+ 必备技术内容为可配置清单」。
R-018 已在 R220/R223 落地（17A prompt 目录硬约束 + CatalogDiff 三态视图）。
R-017 剩余差量 = 把「凡技术/交付/服务即必写」做成**售前可编辑、零改代码**的清单（AGENTS §6 反硬编码），
同时喂给 mustWrite 判定与大纲 prompt 两个口径。本 slice 落地。

## 变更文件
- 新增 src/pages/BidWorkspace/mustWriteConfig.ts（可配置必备清单单一真源：DEFAULT_REQUIRED_TECH_KEYWORDS
  技术/交付/服务下限词、parseRequiredKeywords 多分隔符解析、mergeRequiredKeywords 用户追加∪默认、
  readRequiredTechKeywords 从 localStorage 键 bid_mustwrite_required_keywords 读用户项并回退默认，SSR/异常安全）
- 新增 src/pages/BidWorkspace/mustWriteConfig.test.ts（3 例：解析去重保序、merge 用户在前+默认全并、默认非空）
- 改 src/pages/BidWorkspace/bidMustWrite.ts（MustWriteCtx 增可选 requiredKeywords；judgeMustWrite 增②级：
  命中必备清单且非商务专属 → mustWrite tech，reason「必备技术内容清单「kw」」；bizHit 优先不误伤商务章）
- 改 src/pages/BidWorkspace/bidMustWrite.test.ts（+2 例：清单命中必写、命中但商务专属仍判 biz）
- 改 src/pages/BidWorkspace/prompts/bidOutline.ts（opts.requiredTechContents 缺省=现状字节不变；
  非空时：numbered 增「必备清单每项须独立成章禁止并入通用章」硬约束 + stableParts 增【必备技术内容清单】项目级稳定块；
  PROMPT_VERSION 3→4，默认路径不触发新分支故快照 31 例仍全绿）
- 改 src/pages/BidWorkspace/useBidWorkspace.ts（import readRequiredTechKeywords；mwCtx.requiredKeywords=清单；
  buildBidOutlineMessages opts.requiredTechContents=清单）

## 关键设计
- 单一真源双口径：mustWrite 判定（保留误标商务的必写技术章）与大纲 prompt（引导独立成章）读同一 readRequiredTechKeywords，
  改 localStorage 一处即两口径同步，无需改代码。
- 商务优先不被清单误伤：②级分支带 `&& !bizHit` 守卫，「商务条款」即便被加入清单仍判 biz 不必写正文。
- 快照零破坏：新分支全部 `requiredList.length` 守卫，promptsSnapshot 代表样本不传该 opt → 输出字节与基线一致。
- readRequiredTechKeywords 生成期调用两次（mwCtx 与 prompt opts 各一），localStorage 读取成本可忽略，换取锚点最小改动。

## 四门验证
- tsc --noEmit：0 error
- vitest run：1632 passed | 2 skipped（基线 1627，+5 全绿；promptsSnapshot 31 例未破，0 回归）
- eslint：新文件+bidMustWrite+bidOutline 0 issue；useBidWorkspace 改动行 0 新告警（18 项均既有基线）
- npm run build：success 3.22s

## 遗留 / 后续
- 清单编辑 UI（设置面板 textarea 写 localStorage）留待前端设置页排期；当前可经 DevTools/脚本设置键值。
- perItemPenalty（R-022）与必备清单（R-017）均可后续接入「按招标解析结果自动派生」，减少人工配置。
