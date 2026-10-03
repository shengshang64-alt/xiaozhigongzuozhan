# R127 · FormatTool 对比/识别模块补测试盲区（formatDiff + specToFormatSettings）

日期：2026-10-02　方式：纯新增测试文件，零源码改动、零提示词、零 collection、零 pb_hooks、未 commit。

## 选题依据
- 用户点名的两个候选均已完成，不再重复：quote-history-01 二期于 R102 closed
  （r102-quote-history-phase2，结单沉淀 + 相似成交参考区间推荐均已交付，
  quoteRecommend.test.ts 在库）；prompt-fabscan-03 于 R89 边界裁决 closed
  （编造扫描以 consistencyGuard 交付，禁导出硬门禁维持「只报不拦」裁定）。
- 4 个 defer 项（r112-datestamp/money-count-composestep/r119-dead-export/
  r124-solutionstudio-docx）锚点文件（QualCertsPage/ComposeStep/bidTypes 等）
  本轮 git status 复核仍全部命中未提交在途（M/??），继续绕开、维持 defer。
- 巡检探针（scripts 侧 r127_probe：git-clean × import-graph × 测试文件存在性）
  命中 FormatTool 两处真实盲区：formatDiff.ts（136 行纯逻辑，4 处引用，0 直接
  单测，refreshDocx.test.ts 仅借用其 FormatScope 类型）；formatSpec.ts（414 行，
  其中 specToFormatSettings/SIZE_PT 桥接层为纯查表逻辑、被格式刷新与对比两侧
  共用，同样 0 直接单测；DOMParser 识别部分 node 环境不可测，遗留）。

## 交付
1. src/pages/FormatTool/formatDiff.test.ts（14 条）
   - null spec / 空 scopes / SCOPE_OPTIONS 与 FormatScope 对齐
   - 全 scope 平铺恰好 10 项（font3+spacing2+page5）且一致原稿全 same
   - 字体「未设置」占位与 same=false；原稿 sizePt=0 → 未设置且判不一致
   - 字号容差 0.6pt 边界（14.4 same / 13 diff）；首行缩进精确比对
   - heading 跳级不虚构、>3 级不参与比对
   - 行距/对齐字符串精确比对；纸张 + 四边距、边距容差 0.1cm 边界（3.23 vs 3.18 same）
2. src/pages/FormatTool/formatSpec.test.ts（17 条）
   - SIZE_PT 12 档齐全与标准磅值
   - mapFont 命中链优先级钉死：SimSun 不含「宋」字根 → 兜底+note；微软雅黑含
     「黑」→ 命中黑体且无 note（设计使然）；songti/serif → 宋体
   - 标题完全未识别 → 六级默认黑体三号左对齐；仅识别一级 → 全六级同源回填
   - nearestSize 严格最近与平局行为（13pt 取先枚举的四号；12.9→小四；13.1→四号）
   - 正文 note 触发边界（13pt 产就近映射 note / 14.3pt 容差内不产）
   - lineSpacing 合法归一值不误报、越界值（1.2倍/3倍）产 note
   - 纸张/边距直传、返回值形状（settings 完整 + notes 字符串数组）

首次跑测 4 个失败均为测试预期写错（平铺计数口算、字号档位、字体命中链两处），
逐行核对源码后修正预期（r127b 脚本），源码语义零改动、零迁就错误实现。

## 四门验证
- npx tsc -b → exit 0
- npx vitest run → 837 passed + 2 skipped（基线 806 → +31 = 本轮新增，全绿）
- npx eslint 两个新测试文件 → exit 0（0 error 0 warning）
- npx vite build → exit 0（3.79s）

## 维持裁定
- 编造嫌疑未清零禁导出硬门禁：维持只报不拦（R89 裁定），未触碰。
- lint-debt-01：有意保留残余，未重构。
- 未 git commit；无 collection/pb_hooks/提示词改动。

## 遗留（不新开优先级的观察）
- formatSpec.ts 的 extractFormatSpecFromFile（DOMParser 路径）在 node 测试环境
  不可测，识别口径回归仍依赖 refreshDocx.test.ts 的真实 docx 往返间接覆盖。
- 4 个 defer 项继续在账本挂 open，待用户提交在途改动后按各自 plan 解锁。
