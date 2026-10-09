# R159 招标文本标注符号丢失检测与诚实上报（闭环 r152-star-symbol-loss）

- 轮次：R159 ｜ 模块：/bid-workspace ｜ 类别：A 类（零 schema / 零 pb_hooks / 零提示词 / 零 AI 费用）
- 选题依据：用户点名两优先项 quote-history-01（R102）/ prompt-fabscan-03（R103 系）均已 closed；open 项中按标书>方案>PPT 权重选 r152-star-symbol-loss（P3 但属废标级 ★/▲ 通道的素材保真问题）。

## 根因反转取证（本轮最大价值：纠正 r152 的错误猜测）

r152 挂账原猜测「疑检索选块或引号转义环节」。实查三步推翻：

1. **检索链路无罪**：`tenderRetrieval.ts` 选块注入的是 `chunk.text` 原文（归一化只用于打分，不改素材），不经任何字符清洗。
2. **清洗链无罪**：`cleanParseSectionContent`/`clampParseSectionContent` 无剥 ★ 逻辑；存档解析报告（Temp r151-parse-report.json）中同段 ▲ 引文完整存活、仅 ★ 处为空引号对。
3. **源文件即损坏**：`_eval/R142_tender_sanming.docx` 全包 zip 扫描——★ 0 处、▲ 17 处；document.xml 无 `w:sym` 符号元素、无私用区字符，「标注“”的条款为实质性要求」的**空引号对在 docx 源 XML 里已存在**。丢失发生在上游文档制作/转换环节（素材侧 D 类），模型忠实复述了残缺原文。

## 系统缺陷与修复口径

真正的产品缺口：符号丢失签名（空引号对）会静默流过 ★/▲ 重点条款扫描、解析报告引文、合规矩阵——用户无从知道扫描可能不全。系统不能猜补符号（★/▲/●皆可能，猜=编造，违反反编造红线），但必须**检测签名并诚实上报**（与「只报告不拦截」「素材缺失处诚实标注」口径一致）。

保守判据（宁漏勿误）两类强签名：
- ① 「标注/标记/注明 + 空引号对」前缀式，或「空引号对 + 的条款/要求/指标/项目/内容」后缀式；
- ② 私用区字符 U+F000-U+F2FF 残留（符号字体原样混入文本的另一形态）。

## 变更文件

| 文件 | 变更 |
| --- | --- |
| src/pages/BidWorkspace/materialIntegrity.ts | 新增：detectMarkerSymbolLoss 纯函数（计数+≤5条采样+≤60字截断）与 markerLossNotice 文案单一真源 |
| src/pages/BidWorkspace/materialIntegrity.test.ts | 新增 8 条单测：F05 真实损坏形态命中/正常 ▲ 条款零误报/后缀式兜底/普通引用与数值不误报/PUA 残留/多处损坏封顶/空输入静默/notice 文案 |
| src/pages/BidWorkspace/useBidWorkspace.ts | 三处接线（只提示不拦截）：导入招标文件成功后、解析完成成功 toast 后、重点条款「重新扫描」执行前，均 toast.warning |

补丁脚本：d:\KFDXCX\MedPreSales\scripts\r159_marker_integrity.py（+ r159_fix_module.py 修正转义）。
实施插曲留证：首版 Python 模板把半角引号/`\s` 转义渗漏进 TS（EMPTY_PAIR 字符串形态），整文件重写为 JS 正则字面量后由 tsc/vitest 双重确认修正——登记为补丁脚本转义教训。

## 四门验证

- tsc -b：exit 0，零错误
- vitest run：1041 passed | 2 skipped（96 文件；基线 1033 + 本轮新增 8，全为本轮新测试）
- eslint：触及文件 5 error / 13 warning——与 HEAD 版逐条同型同位（942/1006/1092/2618/7160 → +2/+6/+3 行号平移即本轮插入行数），净新增 error 0；两个新建文件零输出
- vite build：exit 0，3.79s

## 验证证据（真实损坏样本）

- 对 `_eval/_f05_text.txt`（88,681 字真实提取件）逻辑复核：全文恰好 1 处空引号对签名（封面标注约定第 1 条），与实现判据一致；
- 正常条款行「标注“▲”的条款为重要技术指标…」不命中（单测钉住）。

## 维持裁定与未动项

- 未动提示词（非 B 类）、未动数据模型/collection/pb_hooks、未 commit；
- 编造扫描/禁导出裁定不变；lint-debt-01 残余不动；
- r152 的「整文通道是否同样丢失」复查计划已由根因证伪覆盖（与通道无关），关闭说明写入账本。

## 后续挂账

## 实施险情记录（零损失）

账本回写后追加 backlog 条目的一次补丁尝试中，open(p,'w',newline='w') 传参非法——但 'w' 模式已先把 ledger.json 截断为 0 字节才抛异常。因回写前已做 .bak-r159 备份，从备份恢复后幂等重放 r159_ledger.py 完整还原（round=159/closed=137/新增挂账条目），终检 JSON 可读、r152 closed 状态在位。教训：改数据文件必须先写临时文件再 os.replace 原子替换，禁止直接向目标 'w' 打开后依赖后续步骤不失败。

## 后续挂账

新观察（P3，入池不本轮做）：解析报告/合规矩阵面板展示层可把命中行高亮「疑符号丢失」徽标（现仅 toast 一次性提示）；素材侧治理（要求资料负责人提供含 ★ 的完整版原件）属数据不在代码范围。

## 完成审计：浏览器实机验证（2026-10-05 补充）

- 环境：8000 端口为 vite dev server（vibex-local 配置，源码实时生效，PocketBase 经 /__pb 代理 127.0.0.1:7000）；只读扫描 pb 数据副本确认【演练】R01-bid-20261004（id 7vco3jzj6abz8p0）tender_text（62,596 字）含 1 处「标注“”」签名。
- 操作路径：标书工作台 → 打开该项目 → 第2步 AI 解析报告 → ★/▲ 重点条款分区 → 「重新扫描」。
- 结果：toast.warning 实机触发（连续 4 次点击均可复现），文案逐字为「招标文件文本发现 1 处疑似标注符号丢失（如“1.本文件中标注“”的条款为实质性要求条款，投标人必须完全满足且不允许负偏离，任”），★/▲ 重点条款扫描可能不全，请对照招标原件核实」，与 markerLossNotice 单测钉住的口径一致；截图存证 d:\KFDXCX\MedPreSales\.qoder\tmp_r159_toast_proof6.png。
- 验证副作用说明：「重新扫描」本身即以本地扫描结果覆盖该分区（产品设计行为），该项目 ★/▲ 分区由 6 条（AI 解析版）变为 4 条（本地扫描版）；覆盖前内容在 bid_stage_snapshots 有历史快照可查。
