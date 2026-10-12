# R231 验收报告 · G3 ★/▲ 实质性条款逐字响应承诺函

## 背景与依据
《医疗信息化投标全流程规范（整合版）V1.0》要求：招标文件中带 ★/▲ 标注的为实质性条款，
投标文件须逐字响应、不得改述，负偏离即判定无效投标。G3 面向第 3 步「投标文件编制」，
一键把已解析的 ★/▲ 重点条款生成《实质性条款响应承诺函》并直接并入投标正文。

## 交付物
1. 纯模块 `src/pages/BidWorkspace/commitmentLetter.ts`（本地零 AI）：
   - `splitStarClauses`：把 star_clauses 分区正文按 ★/☆/▲/△ 标记切分为独立条款，续行并入、尾注（…另有 N 条未列出）丢弃；
   - `buildCommitmentLetter`：逐字引用「」+ 固定模板承诺语 + 落款（盖章/签字/日期留空），口径稳定；
   - `commitmentChapter`/`commitmentOutlineNode`/`upsertCommitment`/`upsertCommitmentOutline`：以 part=biz、gen_status=done 幂等并入章节与大纲。
   - 单测 `commitmentLetter.test.ts` 9 例全绿（切分/尾注/空输入/逐字引用/编号/落款/biz 归属/幂等）。
2. 接线 `useBidWorkspace.ts`：新增 `generateCommitmentLetter` useCallback——读 sectionText(parse_report, star_clauses) → splitStarClauses → buildCommitmentLetter → upsert 进 bid_chapters/bid_outline（并同步 outlineDraft，抗重确认大纲）→ updateProject；已在 hook return 暴露。
3. UI `ComposeStep.tsx`：投标编制工具栏新增「生成承诺函」按钮（PenLine 图标，locked 只读禁用）；`BidWorkspacePage.tsx` 调用点透传；Pick 补 "generateCommitmentLetter"。
4. UX `ChapterEditor.tsx`：商务章「已有正文」时可编辑展示（承诺函可校阅/微调），空骨架章保持原「线下填写」占位——仅影响 biz+content 非空这一新分支，存量零变化。

## 导出正确性
`bidFiles.ts` 对 biz 章仅在 content 为空时输出占位行；承诺函 content 非空 → 走正常正文导出，随全套 Word/PDF 一并输出，符合「直接进投标正文」诉求。

## 门禁
- tsc --noEmit：0 错误
- vitest run：1681 passed | 2 skipped（新增 9 例，无回归）
- eslint：commitmentLetter.ts 0 问题；改动文件零新增（移除多余 eslint-disable）
- npm run build：成功

## 实机回归（建阳区三甲医院项目，localhost:8000/bid-workspace 第3步）
- 点「生成承诺函」→ toast「已逐条引用 9 项实质性条款生成承诺函，并新增『实质性条款响应承诺函』商务章节」；
- 章节清单出现「实质性条款响应承诺函」（商务文书标签），编辑器展示可编辑正文：含引言、9 条「逐字引用」+ 承诺语、盖章/签字/日期落款（textarea 3849 字）；
- 再次点击为幂等更新（同 node_id 替换内容），不重复建章。

## 已知点
- 承诺函以 part=biz 归入商务部分，不参与 AI 逐章正文生成与字数/页数预算（符合线下签章属性）；
- 落款留空，投标人名称/日期线下补填并加盖公章；
- 条款来源为第 2 步解析的 star_clauses 分区，若该分区为空需先回到解析环节补扫。
