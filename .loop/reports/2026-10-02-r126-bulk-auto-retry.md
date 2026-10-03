# 标书生成「从未完整生成/静默失败」诊断与自动重试修复 · 场景自测记录

日期：2026-10-02 · 轮次：R126

## 背景（用户报障）
用户反馈最初 4 个标书生成问题依旧：①页数不足 ②不贴招标文件 ③内容展示不全·界面差 ④从未完整生成。
此前 A/B/C/D/E 各批优化"看着没生效"。

## 诊断过程（真实运行现场，非静态推断）
1. 确认 :8000 是 xiaozhigongzuozhan 的 vite dev（HMR），alias @→src，dev server HTTP 吐出的 bidTypes.ts
   已含 formatCharsPerPage → **代码确实已生效到运行服务**（排除改错目录/未构建/服务用旧码）。
2. PocketBase :7000 healthy，model-gw 需登录(401) → 后端地基正常。
3. 浏览器实登（测试/管理员），打开真实在编项目「贵港项目 · 农行贵港分行」(id=20ahne54mpozls6)：
   - 界面显示「正文实际 ≈ 43 页 · 目标 100 页」，「生成总览（完成 6/10，失败 4）」。
   - 只读查库 bid_chapters：4 章 gen_status=failed / content 0 字（EMR、AI算力、项目实施组织、培训方案），
     另有 2 章 done 但严重偏短（项目理解 1187/预算7045、临床协同 1097）。
   - gen_options={"compliance_mode":"strict","clause_response":false,"material_boost":false}
   - failed 章节点未存任何 error 字段；llm_jobs 表被轮询后清空 → 失败原因既不落库也不上屏。
4. **复现验证**：对最省的「培训方案」单节章点「重试」→ 从 failed 转 done(1749 字)，总览变「完成 7/10，失败 3，偏短 1」，
   页数 43→46。证明：失败非章节本身确定性 bug，而是**偶发空产出/瞬时异常**；批量用**裸 catch{}** 静默吞掉、
   既不自动重试也不报因 → 这就是「从未完整生成」且"看着没修"的直接主因。

## 根因
- 根因 A（④/①/③）：批量 runBulkGenerate 每章 try 用 `} catch {` 吞异常，空产出仅标 failed；无重试、无原因上屏。
- 根因 B（①/②/③）：默认 compliance_mode=strict(严格响应,篇幅从简)+素材/逐条注入关闭 → 成稿章也偏短；
  且 E1/E3 仅把折算系数做成"可配置、默认仍 500"，对默认严格路径不产生变化。

## 本次修复（F1，零付费重生成即可验证代码正确性）
useBidWorkspace.ts runBulkGenerate：
- 新增 failedNodes 登记表（node_id/索引/标题/真实原因）；
- 空产出分支与 `catch(e)` 均留存真实原因（消灭静默）；
- worker 池跑完后、收口治理前，对失败技术章**串行自动补重试一次**：成功即转 done 并扣减失败计数，
  仍失败则 toast 明示「N 章自动重试后仍失败：<标题>（<原因>）」引导逐章重试。

## 四门验证
| 门 | 结果 |
|---|---|
| tsc -b | EXIT 0 |
| vitest run | 806 passed / 0 fail |
| eslint --quiet（本文件） | 5 处均为既存基线(943/1007/1093/2619 set-state-in-effect、7161 no-useless-assignment)，净新增 0 |
| vite build | built in 4.02s，EXIT 0 |

## 遗留与后续（需用户决策，未擅自改动）
- 根因 B 属"设置预期"：默认严格响应+关掉素材/逐条注入天生篇幅短。建议把生成模式调「场景扩展/大量充实」、
  打开「素材优先注入」「逐条应答强化」以显著增厚页数与贴合度；若要代码层面加强补足收敛(如放宽续写熔断)，
  因涉及成稿风格与费用，待确认再做。
- 未 commit。备份 useBidWorkspace.ts.bak-r126 验证后已清理。
