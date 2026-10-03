# R148 方案编制批量生成中断恢复对齐标书 D1

**日期**：2026-10-03　**轮次**：round 148（接续 147）　**域**：/solution-studio（方案编制主链路）

## 一、选题依据
- 用户点名候选 quote-history-01（报价二期，R102 已 closed）、prompt-fabscan-03（R89 已 closed）经账本核实均已完成；
  报价非当前优先级（用户既有偏好）。open backlog 多为「在途 WIP 绕开 / pb_hooks 红线」阻塞项或全站视觉自然迭代项。
- 巡检优先级域（标书 > 方案 > PPT）发现真实能力缺口：方案侧批量生成缺标书 D1 的中断恢复。

## 二、问题（数据正确性 + 可用性）
`useSolutionStudio.runBulkGenerate` 起跑即 `updateSolution({ doc_status: "generating" })` 落库，收口才改写
done/partial/outline 终态。若中途**刷新页面 / 崩溃 / 切走**：
1. 该方案持久化的 `doc_status` 停留在 `"generating"`；`docStatusLabel`（`DOC_STATUS_LABEL[activeSolution.doc_status]`）
   直读此字段，方案刷新后**永久显示「生成中」徽标**，误导用户以为仍在生成。
2. 没有标书侧 ComposeStep D1 的「上次批量未完成→从断点继续」提示，用户不易发现已生成的章可直接续跑。

## 三、方案
新建单一真源纯函数模块 `bulkResume.ts`（口径与 runBulkGenerate 收口 nextStatus 一致）：
- `deriveSolutionDocStatus(chapters)`：全 done→`done`，有 done 未全→`partial`，无 done→`outline`。
- `shouldRecoverStaleGenerating(docStatus, bulkGenerating)`：仅 `generating` 且当前无进行中批量时判需复位。
- `bulkResumeNotice(done, total)`：0<done<total 时给出「点『继续生成正文』可从断点继续（已生成的章节不会重复付费）」。

`openSolution` 打开方案时（此刻必然处于列表视图、无进行中批量）：
若记录 `doc_status==="generating"` → 按各章真实进度推导并**复位落库**（`persistSolution` 静默），
存在已完成但未全的章时 `toast.info` 续跑提示。`runBulkGenerate` 本身天然 skip `done`/`generating` 章，续跑幂等不重复付费。

## 四、变更文件
| 文件 | 变更 |
|---|---|
| src/pages/SolutionStudio/bulkResume.ts | 新增·3 个纯函数（单一真源） |
| src/pages/SolutionStudio/bulkResume.test.ts | 新增·3 组 11 例单测 |
| src/pages/SolutionStudio/useSolutionStudio.ts | openSolution 复位+续跑提示；新增 import |

零 collection / 零 pb_hooks / 零新提示词 / 未 git commit。

## 五、四门验证
| 门禁 | 结果 |
|---|---|
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 94 files / **985 passed \| 2 skipped**（基线 974 +11，恰为新增例，零回退） |
| npx eslint（触及文件） | **零新增 error**：回退对比脚本证实改动前后同为 12 error + 1 warn（全为 useSolutionStudio 既有 react-hooks React Compiler 告警）；bulkResume.ts / .test.ts 0 告警 |
| npx vite build | 5947 modules transformed，built in 3.44s，exit 0；SolutionStudio chunk 170.43 kB(gz 44.84) |

eslint delta 证据：`scripts/r148_eslint_delta.py` 输出 baseline==after = (13, 12, 1)，restored==patched True。

## 六、维持裁定
- 编造嫌疑未清零禁止导出硬门禁：维持「只报告不拦截」，本轮未触碰。
- lint-debt-01 有意保留残余：不重构。
- 新挂账：`r148-solution-resume-banner-defer`（P3）——EditorWorkspace 侧对标 ComposeStep 的内联恢复横幅。
