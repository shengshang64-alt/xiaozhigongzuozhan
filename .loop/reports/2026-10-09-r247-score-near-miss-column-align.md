# R247 · 评分表「列数恰差 1 的近形行」按内容对齐（收 r195-score-table-n1-merged-col）

- 日期：2026-10-09
- 轮次：R246 → R247
- 优先级：P3（标书主链路 · R195 显式挂账的真实漏配缺口）
- 模块：/bid-workspace（评分项本地交叉核对扫描器 scoreItemsScan，零 AI）

## 一、选题依据

用户建议优先做 quote-history-01、prompt-fabscan-03，复核账本发现二者均已关闭
（quote-history-01 一期 R40 / 沉淀 R79 / 二期区间推荐 R102；prompt-fabscan-03 P7.1 R101 /
按章聚合回注 R103）。同时巡检确认标书与方案侧的「章间并发」在 R162 已落地
（BULK_CONCURRENCY=2 + bulkPool）、需求覆盖四态落位核验已完备，不是缺口。

按长期裁定「标书 > 方案 > PPT、弱化报价、优先实质缺口」，选定 R195 报告里**显式挂着不做**的
`r195-score-table-n1-merged-col`（P3）：当年以「支持它需要引入更多误报面，宁可漏报不虚报」为由
故意留空，但它位于标书评分核对主链路，是真实招标上**整表级漏配**（一份信息化招标评分表只拿到 6 项），
属于实质性优化而非零碎小改。收它的正确方式不是放宽判据，而是把误报面用可判定的硬护栏封死。

## 二、根因取证（不是算法能力不足，是列错位）

真实语料 `_qa/parse-audit/batch_信息化智能化采购项目招标文件_发售稿_docx.txt` 评分表：

```
L504 cellsRaw=3 | 评标项目 | 评标分值 | 评标方法描述      ← 表头，模板锚定成立（scoreIdx=1）
L505 cellsRaw=3 | T1、技术服务响应程度 | 39 | 根据…得39分。  ← 精确三列行，旧实现能取
L508 cellsRaw=2 | 3 | 投标人或所投品牌厂家提供的结构化电子病历，…全部满足得3分…  ← 退化两列
L509 cellsRaw=2 | 1 | 投标人具有信息安全保障能力的得1分，…                        ← 退化两列
L516 cellsRaw=2 | 3 | 根据投标人培训方案的完整、切实可行…得3分…                    ← 退化两列
```

提取端 `src/lib/bidFiles.ts` 遍历 docx 表格单元时做 `map(cellText).filter(Boolean)`（并做相邻空列去重）
再 `join(" | ")`：**空单元连同它的分隔符一起被丢掉**。这类行的「评标项目」格本来就没有编号（编号长在
名称格里，或名称格为空），于是三列表被压成两列。旧实现遵循 R195 红线「列数不符即模板失效」，
`tpl = null` 不仅判死当前行，还**连带其后所有正常三列行不再按列提取**——整表级漏配。

改 `bidFiles.ts`（保留空列占位）会波及全部文档解析与 AI 素材口径，风险远大于收益；因此把容错
收在扫描器侧，提取端不动。

## 三、实现（精确取列抽出 + 近形行按内容对齐）

`src/pages/BidWorkspace/scoreItemsScan.ts`

1. **`resolveTemplateRow(cells, scoreIdx)`**（新增，纯抽出）：把原来内联在主循环里的「列数一致时
   精确取分值列」逻辑原样搬出，判据一字未改（分值列数值域 + 右邻描述格评分语汇 + `tableItemName`）。
   抽出是为了让精确路径与近形路径共用同一套「拿到才算数」的判定，避免两条分支口径漂移。
2. **`alignNearTemplateRow(cells, tpl)`**（新增）：列数恰差 1 的近形行按**内容**对齐，五项硬护栏
   逐条收紧，任一不成立即返回 null（调用方仍按旧口径判死模板）：
   - ① 列数只允许差 1（`Math.abs(cells.length - tpl.cells) !== 1` 直接拒）；
   - ② **整行只允许出现一个分值形状单元**——两个及以上就分不清哪列才是分值列（真实采购清单行首格
     常是 1/2/3 序号，会与分值列构成歧义，此条自动把它们拒掉）；
   - ③ 该单元须落在表头授权分值列的 **±1** 内（只是少一列，不是换了一张表）；
   - ④ 其右描述格带评分语汇（沿用 R195 `RE_TABLE_VOCAB`）；
   - ⑤ 项名仍走 R195 `tableItemName`（名称格优先，没有名称格取描述格主题）。
3. **项名剥尾**：名称格被吞掉时项名落在描述格主题上，尾巴挂着「…的得1分」这类评分从句；
   按 `/[得扣]\s*\d+(?:\.\d+)?\s*分/` 切首段并清尾部悬挂助词，剥完不足 2 字则回退原名——
   面板里呈现的是可核对的名称而不是半句话。
4. **主循环**：`const hit = cells.length === tpl.cells ? resolveTemplateRow(...) : alignNearTemplateRow(...)`；
   命中则入项并 `continue`；**未命中且列数不符才 `tpl = null`**（保守判死口径保持原样，R195
   「列数不符即模板失效，其后的同形表不被继续按列吞」护栏用例语义未变、仍为绿）。

## 四、变更文件

- `src/pages/BidWorkspace/scoreItemsScan.ts` —— 文件头 R247 口径说明 + resolveTemplateRow /
  alignNearTemplateRow + 主循环分支（+72 / -14 行，纯本地判定，无 IO、无 AI）
- `src/pages/BidWorkspace/scoreItemsScan.test.ts` —— 新增 describe「列数恰差 1 的近形行按内容对齐（R247）」
  共 7 用例（+64 行）：退化两列行入项且模板不死 / 真实形态整表逐条产出且项名不带「每项得1分」尾巴 /
  四条负控护栏（行内两个分值单元、分值列 ±1 之外、描述格无评分语汇即采购清单数量单价列、列数差 2）/
  一条回归护栏（列数一致的既有精确取列口径不变）

零 collection / 零 pb_hooks / 零会话 state 结构变更 / 零提示词改动（未触发 B 类流程）/ 零迁移；
效果全落在既有 `scanScoreItems` → `ScoreCrossCheckPanel` 的「本地扫描 N 项」展示链路上，面板不改。

## 五、四门验证（目标项目目录）

- `npx tsc -b`：**0 error**
- `npx vitest run`：**150 files / 1776 passed / 2 skipped**（基线 1769 passed / 2 skipped，**+7 用例**）
- `npx eslint`（触及 2 文件）：**0 error**
- `npx vite build`：**✓ built in 3.13s**

## 六、真实语料差分（patch 前 = git HEAD 实现，patch 后 = 工作区实现）

临时探针 `__r247_probe.test.ts` + 基线模块 `__r247_baseline.ts`（由 `git show HEAD:` 重建，
并断言基线不含 `alignNearTemplateRow`），对 5 份真实招标全文跑 items / total / categorySums
的 added/removed 差分，**收轮前已删除，不进入仓库**：

| 语料 | items | total | 类目小计 | REMOVED |
| --- | --- | --- | --- | --- |
| 海沧互联互通（四级甲等） | 30 → 30 | null → null | 不变 | 0 |
| 信息化智能化采购（本轮目标） | **6 → 21** | null → null | tech 42→71、biz 6→19、price 30.78 不变 | **0** |
| 池州 | 3 → 3 | null → null | 不变 | 0 |
| R142 负控 | 0 → 0 | null → null | 不变 | 0 |
| r48b 负控 | 14 → 14 | 100 → 100 | 不变 | 0 |

15 条新增**逐条人工判真**（对照语料原文 L508-L517 与后续表格块）：结构化电子病历 3、信息安全保障能力 1、
预约挂号 3、结构化电子病历系统 3、门诊病历系统 3、体检系统 3、电子申请单 3、T4 项目实施及培训方案 3、
培训方案 3、T5 应急响应 3、守合同重信用 3、企业资信等级 3、B2 服务能力 3、B3 响应时间 3、
B4 响应文件制作情况 2 —— 均为评分表真实评分项，分值与原文一致、类目归位合理、项名干净无从句尾巴。
两份负控（含 R142「无表头不提取」与 r48b 总分 100 口径）**零回归**，符合「宁可漏报不虚报」红线。

场景自测留档：	ests/records/2026-10-09-r247-score-near-miss-columns.md（五份真实招标全文差分 + 四条负控自测 + patch 前后面板读数）。

## 七、维持的裁定（未触碰）

- 编造嫌疑未清零禁导出：维持「只报告不拦截」；
- `lint-debt-01` 有意保留残余：不重构；
- 已关闭项（quote-history-01 / prompt-fabscan-03 等）：不重开；
- 提取端 `bidFiles.ts` 的空列丢弃行为：本轮不改（波及面过大），容错收在扫描器侧。

## 八、backlog 状态

- `r195-score-table-n1-merged-col` → **closed**（近形行按内容对齐 + 五重护栏交付，真实语料差分实证）。

## 九、补丁与取证脚本

- `scripts/r247_score_scan_near_miss.py`（实现 + 测试落地，CRLF 安全的 read_bytes/decode/replace/write_bytes）
- `scripts/r247_fix_tests.py`（三条 fixture 列形态补正：编号长在名称格，退化行才真是「列数恰差 1」）
- `scripts/r247_probe_setup.py` / `r247_probe_run.py`（真实语料差分探针，基线取 git HEAD）
- `scripts/r247_fix_header_claim.py`（文件头口径改为差分实测数字）
- 差分输出：`.qoder/tmp/r247_probe_after.txt`；四门输出：`.qoder/tmp/r247_{tsc,eslint}_final.txt`、
  `r247_vitest_full.txt`、`r247_vitest_final.txt`
