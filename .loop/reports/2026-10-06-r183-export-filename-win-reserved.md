# R183 · 导出/下载文件名 Windows 兼容性加固（fileName.ts 真缺陷修复）

- round：182 → 183  |  类别：A 类实施（清洁文件真健壮性缺陷修复 + 加固 + 单测）
- 提示词：无改动（不触发 B 类逐字对比流程）  |  数据模型：零 PocketBase collection / 零会话 state 改动
- 维持裁定：编造嫌疑硬门禁「只报告不拦截」、lint-debt-01 有意保留残余——本轮均未触及，无推翻

## 1. 选题依据（巡检新角度：健壮性 / 交互断链）
- 本轮开始时目标项目几乎整棵 src 树处于用户未提交在途状态（约 50 个 M + 多个 ??），
  标书主链路核心编排文件（useBidWorkspace.ts / bidSection.ts / bidChapter.ts）与 PPT 导出接线
  （deckExports.ts）均为在途 M，r177（并发/续跑）与 r169（切片二/三）落地都命中在途区，按红线绕开并记录。
- 复核 r177 并发前置：`bulkPool.ts`(R140) 已提供有限并发工作池、`latencyBudget.ts`(R180) 已提供自适应单次预算——
  并发原语已在，r177 剩余确为「费用确认交互 + 串行语义」的在途接线层，非缺原语，故不在本轮重复造轮。
- 转向清洁文件巡检，命中 `src/lib/fileName.ts`：全站导出/下载文件名的清洗单一来源（R116 由三处内联收敛）。
  其 `sanitizeFileBase` 只处理 `\/:*?"<>|` + 截断 60，存在真实 Windows 兼容缺陷（见下）。

## 2. 真实缺陷（影响最高频用户动作：导出 docx/pptx/csv）
1. **Windows 保留设备名未中和**：`CON/PRN/AUX/NUL/COM1-9/LPT1-9`（含带扩展名、大小写）。
   标书项目名或章节名恰为这些基底时（如名为「CON」的系统、或占位「COM1」），
   导出文件名 `CON.docx` 被 Windows 拒绝创建 → 下载静默失败，用户无从得知原因。
2. **裸控制字符**（0x00–0x1F、0x7F）：标题粘贴常带入制表/换行/NUL，进入 `Content-Disposition` 头致下载异常。
3. **结尾点/空格**：Windows 会静默剥离文件名结尾的 `.` 与空格，使清洗后基底与拼接的扩展名错位。

## 3. 修复（仅 `sanitizeFileBase` 内部，签名与调用点不变）
- `UNSAFE_CHARS_RE` 字符集并入 `\u0000-\u001f\u007f`（控制字符）。
- 追加 `.replace(/[.\s]+$/, "")` 去除结尾点/空格。
- 新增 `RESERVED_BASE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i`，命中则前缀 `_` 中和（保留可读性）。
- `buildSafeFileName` 委托 `sanitizeFileBase`，故标书/方案/PPT/竞品矩阵/情报等全部导出路径自动受益，无需改动在途接线文件。

## 4. 向后兼容（不推翻 R116 oracle 契约）
- fileName.test.ts 顶部是「与三处旧内联实现逐字节等价」的 oracle 用例（6 条 SAMPLES）。
  逐一核验：所有 SAMPLES 经新逻辑产出与旧实现完全一致（普通名路径为 no-op），oracle 全绿。
- 新增 6 用例专覆盖加固路径：保留名中和（CON/con/PrN/auX/NUL/COM1/com9/LPT1/lpt9）、
  不误伤近似名（console/com0/aux1/cool/nullish/printer 原样）、带扩展名保留基底、
  裸控制字符清洗、结尾点空格去除、普通名逐字节等价补充断言。
- `no-control-regex` 对清洗正则的报错以行级 eslint-disable + 豁免理由处理（该规则本意是防误匹配控制字符，
  此处是刻意剔除控制字符，属规则文档承认的合法豁免场景）。

## 5. 四门验证
| 门 | 结果 |
|---|---|
| npx tsc -b | exit 0，零错误 |
| npx vitest run | 1214 passed / 2 skipped（基线 1208 → **+6 新增，零回退**） |
| npx eslint（触及 2 文件） | 零 error / 零 warning |
| npx vite build | 成功，built in 3.32s |

## 6. 触及与合规
- 仅 `src/lib/fileName.ts`、`src/lib/fileName.test.ts`（git status 核对：二者均为清洁 tracked 文件，非在途 M/??，零冲突）。
- 跨工作区经 Python 补丁脚本 `scripts/r183_filename_hardening.py` + `scripts/r183_eslint_fix.py`（每处 replace 前 assert count==1）。
- 未 commit。

## 7. 记账的绕开项（避免误伤在途新功能）
- r177 并发/续跑、r169 PPT 切片二/三：其落地锚点均在用户未提交 M 文件内，本轮按红线绕开，留待在途改动稳定后接续。
