# R260 报告 — 长文档解析分层段数上限（全局优化汇总·最高优先 R-038 Slice B）

日期：2026-10-10 ｜ 轮次：R260 ｜ 模块：标书工作台/BidWorkspace ｜ 优先级：P0

## 背景与缺口
《小智工作站-全局优化汇总》把 **R-038 长文档解析分片**列为最高优先（「不是丢分问题，是废标风险」）。
R258（Slice A）已落地「覆盖率可见 + <30% 生成阻断」安全网；本轮 Slice B 承接其遗留的第二半——**真正拉高覆盖率**（用户已就额外 AI 成本授权）。

根因定位（侦查 wholeParse.ts / tenderSplit.ts / useBidWorkspace 三通道路由）：
- 覆盖率被**双重硬限**：①模型 max_tokens；②`parseSectionViaSegments` 里 `segments.length > PARSE_MAX_SEGMENTS(6)` **回落检索通道**。
- 检索通道只喂 **1 个 14k 关键词窗口** → 长文档实测覆盖 **4%~10%**（天坛 41.7 万字 = ceil(417000/45000)=10 段 > 6 → 回落 → 仅解析约 1.8 万字）。
- 而漏掉的恰恰是**散落在第四章的评分表、第五章的技术参数、以及各章的否决/废标条款**——文档②明确要求「评分项/废标项必须跨块汇总」。

## 落地内容（分层段数上限，成本定向到废标/评分关键项）
1. **wholeParse.ts 新增**：
   - `PARSE_MAX_SEGMENTS_CRITICAL = 24`（24×45000≈108 万字，覆盖已知超长标书；仍超限才回落检索兜底，**绝不无界放大**）。
   - `FULL_COVERAGE_PARSE_KEYS = {tech_score, biz_score, void_items, qualification, compliance}`（废标/评分关键项）。
   - `isFullCoverageParseItem(key)` / `parseSegmentCap(key)`（纯函数，返回该项段数上限：关键项 CRITICAL，其余通用 6）。
2. **useBidWorkspace.ts `parseSectionViaSegments`**：`segments.length > PARSE_MAX_SEGMENTS` → `> parseSegmentCap(key)`。
   - 关键项：≤24 段全部走「切段 → 每段同任务并发 → AI 跨段合并」→ **整文全量覆盖 + 评分项/废标项跨块汇总**（合并步 `buildSegmentMergeMessages` 去重取并集，天然跨块）。
   - 其余叙述/信息项：沿用通用上限 6、超限回落检索（控成本，行为不变）。

## 成本增量（用户授权，透明披露）
- 以 41.7 万字（10 段）标书为例：**关键 5 项**从「各 1 次检索调用」变为「各 10 段 + 1 合并 = 11 次」→ 该项目解析新增约 **50 次调用**（5 项 ×10 段）。
- 缓解：①**跨项同段吃提示词缓存**（每段文件 message 对所有项逐字节一致 → 首项全价、其余项缓存价）；②**限流闸门 waitCallSlot 错峰**（Q28 切片F，段间并发不炸 429）；③非关键项**零增量**；④24 段为硬顶，超限回落，杜绝费用爆炸。
- 权衡：多花这点 token 换「长标书不再静默漏评分/废标条款（=废标风险）」，方向正确、代价有界。

## 兼容与边界
- 短文档（≤WHOLE_FILE_LIMIT 6 万字）本就整文直读，不受影响；分层仅作用于「已超长、原本要回落检索」的文档。
- 检索回落路径完全保留（关键项 >24 段、其余项 >6 段时），无行为破坏；`reparseCostDesc`「按段解析后合并」文案对新路径仍准确。
- R258 覆盖率门禁口径（产出/原文非空白字符）不变：关键项整文覆盖后产出上升 → 覆盖率自然抬升，门禁更少误拦长标书。

## 四门禁（WIP 基线对照，全绿）
- `npx tsc -b` exit 0。
- `npx eslint`：新文件 wholeParseTier.test.ts + wholeParse.ts + parseCoverage.ts 0 problem；useBidWorkspace.ts .bak-r260 **前后均 18 problems(5 err/13 warn)**（零新增，报错行均在 8000+ 区，与 616/820 改动无关）。
- `npx vitest run`：**163 files / 1872 passed / 2 skipped**（基线 162/1868，+1 文件 wholeParseTier.test.ts +4 用例）。
- `npx vite build` exit 0（3.46s）。

## 补丁
`scripts/r260_segment_tier.py`（wholeParse.ts 1 锚 + useBidWorkspace.ts 2 锚 + parseCoverage.ts 1 注释锚，全部 count==1；改前 .bak-r260）
+ `scripts/r260_add_test.py`（新建 wholeParseTier.test.ts）。
**注**：首跑误用系统默认 GBK 落盘致 useBidWorkspace .bak 写坏、wholeParse.ts 被 GBK 覆盖；已在脚本内加 utf-8 强制读写 + 恢复段（从 GBK .bak 无损还原 wholeParse.ts 并清理坏 .bak），重跑全绿。未 commit。

## 伞项进度（bidkit-global-opt-p0）
R-038③ Slice A（覆盖率门禁，R258）✓ ｜ R-039②④（自愈+必写标识，R259）✓ ｜ **R-038 Slice B（分层段数上限、废标/评分关键项整文全量覆盖+跨块汇总，R260）✓**。
待续（零 AI 成本优先）：R-033 cleanup-irrelevant 数据安全 / R-027 补 5 解析项（qualification/compliance/margin/agent/signing）/ R-028 废标三轮 / R-010 资质口径。
