# 场景自测 — 标书检查中枢（BidCheck）一期（R261 / 新独立页面 /bid-check）

日期：2026-10-11 ｜ 轮次：R261 ｜ 记录人：自动迭代（零 AI 规则引擎 + 三件套 + 端到端实机）

## 场景口径（AGENTS 强制）
模拟一所三甲医院信息化项目投标：同一份标书，先在**普通模式**跑格式体检，再切**暗标严格模式**追加身份泄露/元数据痕迹检查；
验证「一个开关切换、只标不改、未配置不瞎判、必改 🔴 触发导出门禁」四项核心契约，不破坏任何原文件、不写库。

## 操作步骤（实机 localhost:8000/bid-check）
1. 打开 /bid-check → 默认普通模式；「开始检查」在未选检查对象时 disabled（提示「尚未选择检查对象」）。
2. 点「配置」→ 弹窗含暗标身份词库（公司/品牌/人名/反向排除 4 textarea）+ 格式标准（字体/字号/行距/页数/四边距/页码·颜色·成册三态）+ 禁则开关（sealedViolationIsFatal + L1 本地禁则 14 项）；Escape 关闭、不保存。
3. 切「暗标严格模式」→ 顶部提示「L1~L5 全开，加严阈值，检出身份泄露/元数据痕迹触发导出门禁」。
4. 选真实项目「贵港项目」（正文模式，无文件包）→「开始检查」：
   - 汇总 34 项 / 3 必改 / 3 建议 / 13 未配置·无法检测；分布 🔴2 🟠1 🟡3 🔵0；toast「检查完成：3 项命中必改、3 项建议整改」。
   - 真实命中：L5-A8 案例/项目名泄露 🔴（「贵港市人民医院…合作项目」）、L5-F1 第一人称「我公司…」🔴、L5-F3 荣誉自述 🟠、L5-A1G 疑似公司名 🟡、L1-T1 措辞/T6 水印词 🟡——每条五要素齐。
   - **降级诚实**：B 类（批注作者/隐藏文字/修订/页眉页脚）+ L1 字体/字号/行距/边距 因无 docx 文件包标「当前输入无法检测」；C1/C9/E2 未配置标「标准未配置」——不瞎判。
5. 点「整改清单 Excel」→ 因存在必改 🔴 且严格模式 → 弹**二次确认**「暗标存在必改项…确认仍要导出/返回整改」；点「返回整改」取消（未硬阻断，符合 R-009/Q-016 口径）。
6. 控制台全程零 error/warn，无 React 崩溃、无模块加载失败。

## 自动化验证（零模型，纯函数）
co-located vitest 4 文件 23 例：
- `engine/docxInspect.test.ts`：喂手写 OOXML 验证 creator/company/comments/vanish/bookmark/margins/fonts 解包；关键负控 `<w:del\b` 不误配 `<w:delText`、twips 1440/567≈2.54cm。
- `rules/anbid.test.ts`：非 sealed 返回 []；A 类手机/邮箱/信用代码/案例/第一人称命中且附依据；B 类 docx 包 fail、非包 skipped；C/E 未配置 unconfigured；页数超限 fail；文件名泄露 fail。
- `rules/format.test.ts`：装饰残留 warn、identity_leak 不产出（交 L5）、无包 skipped、字体不一致 warn、页数未配置 unconfigured、sealed 超限 critical、边距偏差 fail。
- `report/toExcel.test.ts`：`blob.arrayBuffer()`→XLSX.read→sheet_to_json 往返验证表头/行数/置信度「—」/pass 不入表。

## 发现问题
- 一期只接入 L1+L5（分期计划），L2/L3/L4 面板留后续；暗标格式/页数/公司检查项以可配置占位落地，待真实招标暗标条款回填后判定精度才拉满——当前不编造。
- 结果快照持久化（localStorage 按 project+file_hash 复检判是否已改）与 PB 集合 `anbid_checks` 为二期项，v1 从简未强依赖。
