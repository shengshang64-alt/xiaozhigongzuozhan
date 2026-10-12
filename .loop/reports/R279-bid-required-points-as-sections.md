# R279 — 问题2 响应度不足：必答要点强制独立成节

## 背景（用户拍板）
建阳等项目专家评审反馈：技术方案『响应度不足』——评分办法里的必答要点
（如『实施方案须包括但不限于①项目实施计划及进度管理②项目人员组成及职责安排
③项目管理④项目质量保障措施』）被模型概括带过，正文看不到与要点一一对应的小节。
用户明确『要体现单独的小节』。

## 方案
- `extractRequiredPoints(scoring)`：把每个评分项的 `item。criteria` 按带圈序号
  （\u2460-\u2473 / \u3251-\u325f）切段，每段取首句、剥离首尾标点/顿号/空白，
  限长 4–24 字，跨评分项去重，得到简洁必答要点标题列表。
- `mergeRequiredSections(sections, points, maxAdd=8)`：将要点并入本章小节标题列表；
  与既有小节互相包含（且≥4字）视为已覆盖不重复补；新补要点间同样去重；
  无新增时原样返回入参引用，便于上层用 length 变化判断是否落库。
- 接入点 `generateChapterContent`：`sections` 由 `ch.sections ?? []` 改为
  `mergeRequiredSections(ch.sections ?? [], extractRequiredPoints(scoring))`；
  仅当 length 变化才 `updateChapter(nodeId, { sections })`，幂等、重复生成不叠加。

## 边界与裁定遵守
- 零 PocketBase collection / pb_hooks 改动，仅会话内 `ch.sections` 状态。
- 非提示词（prompt YAML）口径变更，故不走 B 类流程、不动 PROMPT_VERSION。
- 未触及编造嫌疑导出硬门禁、lint-debt-01 维持裁定项。

## 回归
`scoringPointsSections.test.ts` 7 例：①②③④ 四要点抽取、顿号/句末标点清洗、
无序号返回空、跨项去重、语义覆盖不重复补、无要点原样返回、并入幂等。

## 四门
- npx tsc -b：0 error
- npx vitest run：2116 passed | 2 skipped（较基线 +7，均本轮新增）
- npx eslint（bidTypes/useBidWorkspace/test）：触及区域 0 新增 error
  （既有 control-regex 3793/3795、set-state-in-effect 1182/1246/1332 为在途既有项，不算）
- npx vite build：成功 4.31s
