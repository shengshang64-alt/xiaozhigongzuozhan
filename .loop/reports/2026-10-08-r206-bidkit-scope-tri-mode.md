# R206 · 投标文件编制·生成内容范围三模式 + 分册导出（切片 1 / R-002）

日期：2026-10-08　轮次：R206　优先级：P0（用户四条 P0 之一，切片计划第 1 片）
类型：**A 类小改 + B 类提示词流程**（gen_options 复用 json 列零 schema；提示词 PROMPT_VERSION 1→2，走备份+对比+快照锁字）

## 一、选题与依据

来源：需求记录 R-002——生成内容范围三模式（仅商务 / 仅技术 / 商务+技术）+ 分册导出。
现状仅 `includeBiz` 布尔（含/不含），系统从不生成商务正文（『商务·线下填写』占位），无『仅商务』路径。

## 二、方案与口径

**三态向后兼容**：`GenOptions.scope?: 'biz'|'tech'|'both'`；缺省由 `include_biz` 派生
（`===false -> tech`，否则 `both`），存量项目零迁移、零行为变化。

- **数据层** `bidTypes.ts`：`BidScope` 类型 + `GenOptions.scope` 字段 + `normalizeBidScope()` +
  `isGenTargetChapter(item, scope)`（`biz` 下取 biz 章、否则取非 biz 章；null/缺省 part 视为技术目标，
  与旧 `!isBizPart` 口径一致）。
- **提示词层** `prompts/bidOutline.ts` / `prompts/outlineLevel1.ts`：PROMPT_VERSION 1→2，numbered 二分支→
  三分支（both/tech/biz），tech-rules 块按 `includeTech` 条件；**both/tech 路径逐字不变**（快照锁字不破），
  仅新增 biz 分支。
- **运行时层** `useBidWorkspace.ts`（U1-U13）：`setScope`（同步写 scope+include_biz，存量章 toast 提示重生成）；
  大纲 derive/filter/staged-guard；成本确认 scope-aware；单章硬拦截 scope-aware；techIdx/startBulkGenerate/
  进度计数按 `isGenTargetChapter` 分流；return 暴露 `scope`/`setScope`。
- **导出层** `bidFiles.ts`（F0-F3）：`bidExportChapters`（按 scope 过滤分册）+ `bidVolumeTitle`
  （投标文件（商务标）/（技术标）/投标文件）；biz 有正文走正常导出。
- **UI 层** `GenerationSettingsBar.tsx`：常驻「生成设置」条 row2 首格新增「生成内容范围」三模式分段控件
  （SCOPE_OPTIONS + SCOPE_HINT）；`ComposeStep.tsx` aside 原临时落点移除、换指向提示。

## 三、改动清单

| 文件 | 改动 |
|---|---|
| `src/pages/BidWorkspace/bidTypes.ts` | BidScope 类型 + scope 字段 + normalizeBidScope + isGenTargetChapter |
| `src/pages/BidWorkspace/prompts/bidOutline.ts` | PROMPT_VERSION 1→2 + 三分支 + tech 条件块 |
| `src/pages/BidWorkspace/prompts/outlineLevel1.ts` | 同上 |
| `src/pages/BidWorkspace/useBidWorkspace.ts` | setScope / derive / filter / staged-guard / 成本 / 硬拦截 / techIdx / startBulkGenerate / 进度 / return |
| `src/pages/BidWorkspace/bidFiles.ts` | bidExportChapters 分册过滤 + bidVolumeTitle + biz 正文导出 |
| `src/pages/BidWorkspace/BidWorkspacePage.tsx` | 调用点透传 scope/setScope |
| `src/components/bid-workspace/GenerationSettingsBar.tsx` | 常驻分段控件（SCOPE_OPTIONS/SCOPE_HINT） |
| `src/components/bid-workspace/ComposeStep.tsx` | aside 临时落点移除 + Pick 透传 |
| `src/pages/BidWorkspace/prompts/scopeTriMode.test.ts` | 新增 7 用例（派生兼容 + 目标判定 + 三分支提示词） |

（各源文件改前留 `.r206bak` 备份。）

## 四、四门验证

- **tsc** `npx tsc --noEmit` EXIT=0
- **vitest** `npx vitest run` **131 files / 1551 passed / 2 skipped / 0 fail**（基线 130/1544 → +1 文件/+7 用例）
- **eslint** 新增/改动文件零新增 error/warning（`set-state-in-effect` 为仓库长期 baseline，git show HEAD 佐证；新测试文件 EXIT=0）
- **build** `npm run build` EXIT=0 3.35s
- **快照** `promptsSnapshot.test.ts` 无 -u 通过（both/tech 路径字节保留成功，仅 biz 为新增分支）

## 五、浏览器实摆（http://localhost:8000/bid-workspace）

真实项目「安庆市第二人民医院智慧医院信息化系统项目」（14 章，include_biz:true → scope=both），
第 3 步「投标文件编制」常驻「生成设置」条：

1. 控件渲染：标签「生成内容范围（越界最小最安全的为「仅技术」）」+ 三段 [商务+技术 / 仅技术 / 仅商务] ✓
2. 缺省 active：`商务+技术` 高亮（bg-primary），hint=「商务骨架章…+ 技术部分详细大纲（默认）」✓
3. 点「仅商务」：active 移到 `仅商务`，hint 更新为「仅商务章，正文按招标商务要求逐条生成…」，
   并弹 toast「内容范围已更新，重新生成大纲后按新范围组织章节（存量章节暂不受影响）」✓
4. **持久化**：PATCH 后 `GET /api/bid_projects/{id}` → `gen_options.scope="biz"`、`include_biz=true` ✓
5. 复现回切「商务+技术」，active 复位，测试数据还原 ✓
6. 截图 `.qoder/r206_scope_both.png`、`.qoder/r206_scope_biz.png`（含 toast + 分段高亮）

## 六、最终结果与挂账

- 三模式全链路打通（大纲→正文生成→进度→导出分册），存量项目零变化；
- 单一真值源：scope 为真值，setScope 同步写 include_biz；setIncludeBiz 已无 live UI 调用者（保留定义/暴露）；
- 引擎隔离/AI 入口/配置化约束均维持（AGENTS.md §2/§3/§6）。
- 下一片：切片 2（R207 / R-003 无底稿兜底强化）。
