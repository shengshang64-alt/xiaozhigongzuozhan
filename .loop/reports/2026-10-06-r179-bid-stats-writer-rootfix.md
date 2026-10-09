# R179 标书生产端脏数据源根治：blob 路径回写 section_stats + 小节洞纳入「待补」判据

- 日期：2026-10-06　轮次：R179（round 178 → 179）
- 优先级：P2（backlog r175-followup-bid-blob-writer-stats 关闭）

## 选题依据
标书主链路（用户第一优先级）R170-R175 家族的最后半环：R170 修中断误标、R171 修继续生成路由、
R172 修一键补齐跳过、R174 修消费端种子裁剪、R175 修展示端完成数——但**生产端**仍在持续产出
「done + section_stats 陈旧」脏记录：runContinueChapter（整章续写）与 runSupplementLoop（自动补足）
只更新 content 与 gen_status=done，从不回写 section_stats（账本实测例：content 17548 而 stats=[3131]）。
另巡检发现同类漏网形态：小节串行生成对空产出小节记 chars:0 占位，章 stats 数==小节数时旧
hasPendingSections 判「完整」，洞永远不会被任何路径补上——总览谎称完成、继续生成只往末尾糊 blob。

## 变更内容
### 1. src/pages/BidWorkspace/chapterCompletion.ts
- `hasPendingSections` 判据收紧：`secs > stats.length || stats.some(s => !(s.chars > 0))`。
  单次生成章（stats 空）不受影响；健康小节章（全覆盖且每节有产出）不误伤。
  收紧后「带洞章」自动接入既有四套机制：总览「待补小节」chip 与完成数纠偏（R175）、
  「继续生成」小节断点续跑路由（R171）、「一键补齐」跳过（R172）、批量重跑自愈（R170）。
- 新增纯函数 `reflowStatsAfterAppend(stats, merged)`：blob 追加后按 sliceSectionPieces
  「末片吸收到正文末尾」的既有口径，把增量并入最后一个非空小节 chars，恢复不变式
  `Σ(chars) + 2×(非空小节数-1) == merged.length`；空 stats/无产出小节/正文短于结构时返回
  null（不回写，避免写入错误结构）。chars:0 洞不消费分隔符、保持为洞，交断点续跑补齐。

### 2. src/pages/BidWorkspace/useBidWorkspace.ts
- `runSupplementLoop`：循环头加残缺章守卫 `if (hasPendingSections(ch)) break`（残缺章不做整章
  blob 补足）；补足落库处回写 `section_stats`（reflow 非 null 时）。
- `runContinueChapter`：续写落库处同样回写 `section_stats`。
- 导入行加 reflowStatsAfterAppend。

### 3. src/pages/BidWorkspace/chapterCompletion.test.ts
- 旧断言更新（语义收紧的正当变更）：R170 时期「stats==secs 含 chars:0 → 不误伤 false」改为判
  true 并保留全产出健康章 false 用例。
- 新增 8 条用例：洞判据 4 条（中间洞/健康章/isTrulyDoneChapter/stats 空）+ reflow 4 条
  （末片吸收并用 sliceSectionPieces/rebuildSectionContent 断言正文无损往返、中间洞不消费分隔符、
  三类 null 回退、治理裁剪后短正文 null）。

## 行为影响与代价说明
- 带洞「done」章此后在批量重跑中会被纳入续补（从首个洞小节起重生成其后小节，需再次付费），
  与 R170 自愈口径一致，由入口费用确认覆盖；不做后台静默自动重跑。
- blob 回写仅影响统计一致性，正文零改动；单次生成章（无 stats）路径行为完全不变。

## 四门验证
| 门禁 | 结果 |
| --- | --- |
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 103 files，1181 passed / 2 skipped（基线 1172 → +9） |
| chapterCompletion.test.ts 单跑 | 38/38 passed |
| npx eslint 触及文件 | chapterCompletion.ts/.test.ts 0 问题；useBidWorkspace.ts 5 err/13 warn 与既有基线一致（1012/1076/1162/2688 setState-in-effect + 7392 no-useless-assignment，均不在本轮触及区域），净新增 0 |
| npx vite build | exit 0，3.26s（chunk >500kB 告警为既有） |

## 红线与裁定合规
- 零 PocketBase collection/pb_hooks 改动、零提示词改动（B 类流程不触发）。
- 未 git commit；跨工作区仅经 scripts/r179_apply.py（锚点 assert 唯一命中）落地。
- 编造扫描「只报告不拦截」、lint-debt-01 残余不重构：均维持。

## 账本回写
- round 178 → 179；closed 追加 r179-bid-stats-writer-rootfix；
  backlog r175-followup-bid-blob-writer-stats → closed（带 resolution 指向）。
