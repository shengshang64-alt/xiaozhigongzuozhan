# 10 · GitHub 开源项目选型与能力补强分析

> 视角：医疗信息化售前（方案 → 标书 → PPT/报价 全链路）
> 方法：先盘点本系统真实能力与架构约束 → 再逐个核实 GitHub 候选项目（star/许可证/活跃度）→ 最后用**真实知识库数据实测**关键判断
> 核查时间：2026-10-03　｜　核实项目：50 个（成功 49）　｜　npm 包：25 个　｜　实测数据：本机 + 真实 kb_docs
> **本文件只做选型分析，未改动任何一行生产代码。**

---

## 一、结论先行

你问"还能结合 GitHub 上什么项目进一步完善"。答案是：**能，但只有 4 件事值得做，其余要么已被你做掉，要么是坑。**

按"售前真实痛点 × 落地成本 × 合规风险"三维筛完，优先级如下：

| 批次 | 缺口 | 推荐项目 | 一句话理由 | 落地形态 | 合规 |
|---|---|---|---|---|---|
| **一** | **混合检索**（你 roadmap 已列） | `@huggingface/transformers` + `Xenova/bge-small-zh-v1.5` | 唯一能**零服务端**补上语义盲区的方案；实测文档级索引仅 12.2 MB / 11 ms | 浏览器内，懒加载 | Apache-2.0 ✓ |
| **一** | **扫描件进不来**（当前最大输入缺口） | `ocrmypdf/OCRmyPDF` | 一条命令给扫描 PDF 加文字层，现有 pdfjs 立刻能抽到字 | 离线命令行 | MPL-2.0 ✓ |
| **一** | **废标自查偏薄** | 对标 `guangshu100/BidMaster-Pro` 的 21 项合规清单 | **纯规则、零依赖、零成本**，直接补现有废标自查 | 写规则 | 不引用代码 ✓ |
| **一** | **中文分词/敏感词弱** | `fighting41love/funNLP` | 停用词/敏感词/机构名词表，改进 `tokenizeText` 与暗标脱敏词表 | 引入词表数据 | 未标 SPDX ⚠ |
| **二** | 招标文件表格/评分点抽不全 | `docling-project/docling`（MIT）或 `PaddlePaddle/PaddleOCR` | 中文版面+表格最强的两档；MIT/Apache 可放心 | Python 侧车 | MIT / Apache-2.0 ✓ |
| **二** | 情报采集"关页面就停" | `apify/crawlee` | Node 同栈，替换前端驻留触发；配件计划任务即服务化 | Node 侧车 | Apache-2.0 ✓ |
| **二** | 访谈录音 → 需求清单 | `modelscope/FunASR` | 中文 ASR 最强且本地、带标点 | Python 侧车 | MIT ✓ |
| **二** | 暗标脱敏不彻底 | `microsoft/presidio` + 自建中文词表 | PII 检测框架成熟；中文实体需自建词表补齐 | Python 侧车 | MIT ✓ |
| **三** | 方案架构图不可编辑 | `antvis/X6` | React 同栈，可编辑/可导出，补 mermaid 的短板 | 前端依赖 | MIT ✓ |
| **三** | 医院演示数据集 | `synthetichealth/synthea` | 生成**自洽的合成患者/就诊数据**，直接喂你 roadmap 的"演示模式" | 离线生成 | Apache-2.0 ✓ |
| **三** | AI 生成 PPT | `presenton/presenton`（参考/自托管） | 开源且自托管，可作"AI 生成 PPT"的架构参考 | 独立服务 | Apache-2.0 ✓ |
| **—** | 不做 | RAGFlow / LightRAG / KAG / NocoDB / Teable | 见第六节，对你是负收益 | — | — |

**最重要的一条判断（有实测支撑）**：混合检索要做，但**不能做全库块级向量化**——那样单次查询 268 ms、索引 292 MB，在你 16 GB 内存 + C 盘爆满的机器上不可接受。正确解法是**两阶段：文档级向量粗排（11 ms）→ 现有 BM25 在候选集内精排**。详见第四节。

---

## 二、你的现状与约束（决定了什么能接）

不讲清约束的选型建议都是耍流氓。以下都是从你代码里核出来的事实：

| 维度 | 实测现状 | 对选型的硬约束 |
|---|---|---|
| 架构 | **纯浏览器 SPA（Vite/React）+ PocketBase(SQLite)，无自有服务端** | Python 生态项目（MinerU/PaddleOCR/Presidio/FunASR）**必须做本地侧车**，不能直接 import |
| 检索 | `kbCore.ts` 纯词法：IDF + BM25(K1=1.4) + 短语邻接，入口是**单一函数** `searchKbDocs()` | 改造点收敛，**只改一处**即可接向量召回 |
| 模型模态 | `modelModality.ts` 已能识别 embedding/rerank 模型名，但**仅用于筛选"默认生成模型"**，未用于检索 | 说明"识别向量模型"已有基础，差的是调用链路 |
| 知识库 | **6,115 篇**（content>200 字）、**1.14 亿字**、切块后 **147,332 块** | 规模远超预期，直接决定向量方案要分阶段 |
| 重库纪律 | **R124 红线**：docx/xlsx/pptxgenjs 必须 `await import()` 懒加载，且有哨兵测试 `onDemandLibs.test.ts` 防回潮 | 任何新重依赖（transformers.js）**必须走懒加载**并把包名加进哨兵列表 |
| 已有能力 | 标书全链路（解析→大纲→偏离表→模拟评标→查重→废标自查→暗标脱敏→讲标）**几乎无短板**（docs/06 结论） | **不要重复建设标书生产段** |
| 自己的 roadmap | 已列：混合检索、台账框架、情报服务化、审计日志、演示模式 | 我的建议**必须落在这条线上**，否则是干扰 |
| 明确不做 | 多租户 SaaS、爬虫绕过反爬、即时通讯、全自动投标 | 别推荐这类 |

**结论**：你的短板不在"标书生产"，而在**输入端（扫描件/表格进不来）**和**检索端（找不到）**，以及**标书之外**（资质/业绩台账、调研、情报服务化）。GitHub 能补的主要是输入与检索两端。

---

## 三、可复用开源项目全景（已逐个核实）

以下数据均来自 GitHub API 实时拉取（2026-10-03），不是记忆。

### 3.1 文档解析 / OCR —— 补"扫描件进不来"

| 项目 | ★ | 语言 | 许可证 | 最近更新 | 适配判断 |
|---|---:|---|---|---|---|
| `microsoft/markitdown` | 188,080 | Python | MIT | 2026-10-03 | 多格式→Markdown 通用转换，MIT 最安全；轻量 |
| `PaddlePaddle/PaddleOCR` | 90,527 | Python | Apache-2.0 | 2026-09-16 | **中文 OCR + 版面 + 表格最强档**，Apache 友好 |
| `opendatalab/MinerU` | 81,020 | Python | ⚠未标 SPDX | 2026-09-30 | 中文 PDF/扫描件→结构化 Markdown 一流，但**许可需自行确认**（社区普遍认为 AGPL-3.0） |
| `docling-project/docling` | 68,325 | Python | **MIT** | 2026-10-03 | IBM 出品，PDF/DOCX/PPTX/XLSX 统一结构化；**许可最干净的一体化解析器** |
| `datalab-to/marker` | 40,179 | Python | ⚠标 Apache-2.0 待核 | 2026-10-02 | 转换质量高，但实际可能为 GPL+商业双授权，**商用前必须核 LICENSE** |
| `ocrmypdf/OCRmyPDF` | 34,921 | Python | MPL-2.0 | 2026-09-29 | **性价比之王**：给扫描 PDF 加文字层，改一处、收益全库 |
| `jsvine/pdfplumber` | 10,788 | Python | MIT | 2026-08-06 | 表格/坐标级抽取，做"评分点表格还原"很合适 |
| `opendatalab/PDF-Extract-Kit` | 10,037 | Python | AGPL-3.0 | 2025-01-03 | 能力好但 **AGPL + 一年未更新**，不建议 |
| `RapidAI/RapidOCR` | 8,029 | Python | Apache-2.0 | 2026-10-03 | 纯 ONNX 轻量，适合低配机器 |
| `Stirling-Tools/Stirling-PDF` | 93,472 | Java | ⚠未标 | 2026-10-02 | PDF 工具箱（合并/拆分/水印/OCR），功能全但重，需 Docker |
| `hiroi-sora/Umi-OCR` | 47,566 | Python | MIT | 2025-11-20 | 桌面级中文 OCR，**截图识字/图片招标页**救急好用 |
| `atlanhq/camelot` | 3,708 | Python | — | 2023-01-05 **归档** | ❌ 已归档，不选 |

### 3.2 检索 / RAG —— 补"找不到"

| 项目 | ★ | 许可证 | 最近更新 | 适配判断 |
|---|---:|---|---|---|
| `asg017/sqlite-vec` | 8,159 | Apache-2.0/MIT | 2026-05-18 | **本机实测可用**（Windows x64 + Node 22.22.2，见第四节）；纯向量检索扩展 |
| `huggingface/transformers.js` | 16,337 | Apache-2.0 | 2026-10-02 | **浏览器内跑 embedding，零服务端**；v4.3.0，npm 包 9.4 MB（旧包 `@xenova/transformers` 44.5 MB，别用错） |
| `FlagOpen/FlagEmbedding` | 12,210 | MIT | 2026-08-24 | bge-m3 / bge-reranker-v2-m3 官方实现，走侧车时的正解 |
| `lancedb/lancedb` | 11,585 | Apache-2.0 | 2026-10-03 | 嵌入式向量库（Rust），比 sqlite-vec 有 ANN 索引；需侧车 |
| `infiniflow/ragflow` | 91,615 | Apache-2.0 | 2026-10-02 | 强，但需 Docker + Elasticsearch + MySQL + Redis → **对你过重** |
| `HKUDS/LightRAG` | 39,949 | MIT | 2026-10-01 | 图谱增强检索；单团队本地场景**收益不抵复杂度** |
| `OpenSPG/KAG` | 9,081 | Apache-2.0 | 2026-01-28 | 专业领域知识增强，偏研究向 |
| `Cinnamon/kotaemon` | 25,799 | Apache-2.0 | 2026-07-14 | 文档 QA 应用，可参考其"多模态文档 QA"交互 |
| `chatchat-space/Langchain-Chatchat` | 38,670 | Apache-2.0 | 2025-11-10 | 中文本地知识库老牌项目，可参考其分块与检索策略 |

### 3.3 生成与评测 —— 看你已有能力后，多数**不必引入**

| 项目 | ★ | 许可证 | 判断 |
|---|---:|---|---|
| `stanfordnlp/dspy` | 38,474 | MIT | 提示词自动优化。你有 R44–R48 的教训，但**需要标注数据**；观望 |
| `confident-ai/deepeval` | 18,589 | Apache-2.0 | LLM 评测。你的验收指标（"混合检索命中率 ≥ 基线+15%"）用**自研 20 条评测集**就够，不必引框架 |
| `explodinggradients/ragas` | 15,911 | Apache-2.0 | 同上，可选项 |
| `outlines-dev/outlines` | 15,895 | Apache-2.0 | 约束解码，**但它是 Python 侧**；你前端调 HTTP 网关，用**已有 `zod` + `jsonTolerant.ts`** 更直接 |
| `jxnl/instructor` | 13,971 | MIT | 同上，Python 侧，**不建议** |
| `danielmiessler/fabric` | 44,152 | MIT | 提示词模式库，可摘其"内容审校"模式 |

> **诚实结论**：3.3 这一整类，**你现在都不需要引入**。你的痛点不是"LLM 不会写"，而是"素材进不来、找不到"。把钱和精力投在 3.1/3.2。

### 3.4 PPT / 图表

| 项目 | ★ | 许可证 | 适配判断 |
|---|---:|---|---|
| `presenton/presenton` | 10,927 | Apache-2.0 | 开源 AI PPT 生成 + 编辑器，TypeScript；**可自托管作参考实现** |
| `pipipi-pikachu/PPTist` | 9,367 | **AGPL-3.0** | 在线 PPT 编辑器很强，但**Vue + AGPL 双重不适配**：你是 React，且 AGPL 传染 |
| `icip-cas/PPTAgent` | 5,084 | MIT | 学术方案，**其"演示文稿质量评估框架"可借鉴**到你的 PPT 判定层 |
| `antvis/X6` | 6,716 | MIT | **React 同栈图编辑引擎**，可编辑/可导出 → 补 mermaid 不可编辑的短板 |
| `antvis/GPT-Vis` | 787 | MIT | 自然语言→图表；星少、偏实验，观望 |
| `terrastruct/d2` | 25,556 | MPL-2.0 | 图源文件生成（比 mermaid 更强表达力），可作 AI 出图目标格式 |
| `jgraph/drawio-desktop` | 63,375 | GPL-3.0 | 桌面应用；你已有 .drawio 流程，**用格式别用代码** |

### 3.5 情报采集 / 语音 / 脱敏 / 台账

| 项目 | ★ | 许可证 | 适配判断 |
|---|---:|---|---|
| `apify/crawlee` | 25,974 | Apache-2.0 | **Node 原生爬虫框架**，同栈首选，配计划任务即"情报服务化" |
| `unclecode/crawl4ai` | 84,664 | Apache-2.0 | Python，LLM 友好；若走 Python 侧车可选 |
| `firecrawl/firecrawl` | 188,037 | **AGPL-3.0** | 功能强但 AGPL，注意 |
| `modelscope/FunASR` | 20,571 | MIT | **中文 ASR 首选**（带标点/说话人），访谈录音→需求清单 |
| `SYSTRAN/faster-whisper` | 25,679 | MIT | Whisper 加速版，备选 |
| `ggml-org/whisper.cpp` | 54,102 | MIT | 纯 C++ 本地推理，低配可用 |
| `microsoft/presidio` | 11,139 | MIT | PII 检测/脱敏框架；**中文实体需自建词表补齐** |
| `fighting41love/funNLP` | 83,632 | ⚠未标 | 中文词表合集（停用词/敏感词/机构名）→ 直接改进 `tokenizeText` 与暗标脱敏 |
| `nocodb/nocodb` `teableio/teable` `twentyhq/twenty` | 65k/21k/57k | ⚠未标/自定 | **完整应用**，引进来=双系统双权限；你已有 PocketBase，**不建议** |
| `handsontable/hyperformula` | 2,799 | npm 包 **GPL-3.0-only** | 报价表公式引擎，但 GPL 打进前端 bundle 有传染风险，**建议自研简单测算** |

### 3.6 同域开源（拿"功能清单"，不是拿代码）

| 项目 | ★ | 许可证 | 拿什么 |
|---|---:|---|---|
| `FB208/OpenBidKit_Yibiao` | 3,085 | **AGPL-3.0** | 你已在移植它。其功能清单可对标：**18 个招标解析项**、全文一致性检查、错别字检查、逻辑谬误分析 |
| `guangshu100/BidMaster-Pro` | 351 | AGPL-3.0 | **21 项合规检查清单**（保证金/签字盖章/有效期/一致性/重复率/价格合理性）→ 直接补你的废标自查 |
| `mag05270/BidAgents` | 10 | 未标 | 架构参考（LightRAG + RAG-Anything），**星少不建议依赖** |

### 3.7 领域数据（医疗专有）

| 项目 | ★ | 许可证 | 用途 |
|---|---:|---|---|
| `synthetichealth/synthea` | 3,372 | Apache-2.0 | **合成患者数据生成器** → 你 roadmap 的"医院演示模式"有了真实来源，不用手编 |
| `hapifhir/hapi-fhir` | 2,408 | Apache-2.0 | FHIR 标准实现，用于**互联互通方案的术语准确性**核对 |
| `ehrbase/ehrbase` | 386 | Apache-2.0 | openEHR 服务实现，同上下载参考 |
| `medplum/medplum` | 2,717 | Apache-2.0 | TypeScript 医疗平台，可参考其数据模型 |
| `ZainZhao/HIS` | 1,635 | Apache-2.0 | 开源 HIS 参考（演示环境/功能对标） |
| `tianlian0/duplicate-check-sample` | 165 | BSD-3-Clause | 文本查重 SDK（**明确提及标书查重/防串标**），可对标你的查重实现 |
| `JSv4/Docxodus` | 92 | MIT | docx **保真渲染 + Word 级 redlines** → 对应你的"版本管理/修订留痕"缺口 |
| `openemr/openemr` | 5,491 | GPL-3.0 | 开源 EMR 参考 |

### 3.8 本机可行性核实（npm / 模型托管）

| 包 | 版本 | 许可证 | 体积 | 判断 |
|---|---|---|---|---|
| `@huggingface/transformers` | 4.3.0 | Apache-2.0 | 9.4 MB | ✅ 走懒加载可接受 |
| `sqlite-vec` | 0.1.9 | MIT/Apache-2.0 | 极小 | ✅ **本机实测通过**，含 `sqlite-vec-windows-x64` |
| `tesseract.js` | 7.0.0 | Apache-2.0 | 1.3 MB | ✅ 浏览器内 OCR（精度不如 PaddleOCR，可作兜底） |
| `flexsearch` / `minisearch` | 0.8/7.2 | Apache/MIT | 小 | ✅ 若想换掉自研 BM25（**没必要**，你的已够好） |
| `pdf-lib` / `docx-preview` / `jszip` | — | MIT/Apache | 中 | ✅ 标书合并/预览/打包可用 |
| `hyperformula` | 3.4.0 | **GPL-3.0-only** | 12.3 MB | ⚠ 谨慎 |

**HuggingFace 可达性（重要实测）**：
- `huggingface.co` → **不可达**（连接失败）
- `hf-mirror.com` → **可达**；已确认 `Xenova/bge-small-zh-v1.5`（下载 59,053，8 个 ONNX 文件）与 `onnx-community/Qwen3-Embedding-0.6B-ONNX`（下载 23,830，8 个 ONNX）均可拉取

→ 结论：transformers.js **必须把模型源指向 hf-mirror**，否则会在首次加载时卡死。同时**模型缓存必须改到 D 盘**（你 C 盘只剩 0 GB，见第七节）。

---

## 四、三个"已验证"的关键判断

### 4.1 混合检索：要做，但架构必须是"两阶段"，不是"全库向量化"

我没有停在纸上。用你**真实的 PocketBase 库**建了 sqlite-vec 向量表并实测（向量用确定性伪随机生成——只验证**管道/容量/延迟**，不验证语义效果，这点必须说清）：

**真实数据规模**

| 指标 | 实测值 |
|---|---|
| 入库文档（content>200 字） | **6,115 篇** |
| 正文字数 | **1.1364 亿字** |
| 切块（900 字/块，重叠 120） | **147,332 块** |
| 平均块长 | 771 字 |

**三档规模实测（512 维，sqlite-vec vec0）**

| 方案 | 向量数 | 建库耗时 | **查询均值** | P95 | 落盘体积 |
|---|---:|---:|---:|---:|---:|
| **文档级粗排** | 6,115 | 217 ms | **11.0 ms** | 12.0 ms | **12.2 MB** |
| 单赛道级 | 30,000 | 894 ms | 54.9 ms | 65.4 ms | 60.8 MB |
| 全库块级 | 147,332 | 4,567 ms | **267.6 ms** | 286.7 ms | **291.8 MB** |

**关键发现：单条扫描成本恒定在 1.80–1.83 µs**（三档几乎不变）→ 证明 sqlite-vec **是纯线性暴力扫描，没有 ANN 索引**。这解释了一切：

- 全库块级（147k 条）→ 268 ms/次，**不可用**
- 文档级（6k 条）→ 11 ms/次，**完全可用**
- 按 50 ms 预算外推：512 维上限约 **27,000 条**，1024 维约 **13,700 条**

**浏览器方案对比（内存索引）**

| 维度 | float32 | float16 量化 |
|---|---:|---:|
| 512 维 · 147k 块 | 287.8 MB | 143.9 MB |
| 512 维 · 6,115 篇（文档级） | **12.0 MB** | 6.0 MB |

Node 单线程点积吞吐实测 **209,800 条/秒/核**（512 维）→ 全库 147k 块浏览器暴力检索约 **702 ms**（比 sqlite-vec 更慢，因为纯 JS）。

**→ 结论（这就是为什么不能照抄 RAGFlow 的做法）**

```
❌ 错误做法：全库 147k 块全部向量化 → 索引 292 MB、查询 268 ms、还要吃掉你本就只剩 1.3 GB 的空闲内存
✅ 正确做法：
   ① 文档级向量粗排（6,115 条，12 MB，11 ms）→ 取 Top-50 文档
   ② 在 Top-50 文档内跑你现有的 BM25（块级）精排
   ③ RRF 融合两路排名
```
改造点收敛到**一个函数**：`src/lib/kbCore.ts` 的 `searchKbDocs()`（第 656 行）。
新增两个文件即可：`src/lib/embedding.ts`（懒加载 transformers.js）+ `src/lib/vectorIndex.ts`（索引与 RRF）。
**必须**把 `@huggingface/transformers` 加进 `onDemandHeavyLibs.test.ts` 的 `ALL_HEAVY` 列表，否则 R124 的哨兵测试会（正确地）拦住你。

### 4.2 扫描件是当前最大的输入缺口

你的解析链是：`mammoth`（docx）+ `pdfjs-dist`（PDF）+ `xlsx` + 自研 `extract-*.mjs`。
**pdfjs 只能抽"有文字层"的 PDF**。而医院/招标代理挂网的招标文件、老标书、扫描件**大量是图片型 PDF**——这类文件进库后 `content` 是空的或乱码，后面的检索、比对、参数抽取全部失真。

这是**根因级**问题：你之前实测发现"source_file_name 只有 33% 带路径""部分素材只有文件名"，以及入库桶混入政策通知（docs 里的"素材底噪"），本质上都是**入库质量**问题，而入库质量的第一道闸就是 OCR。

**最低成本解法**：`OCRmyPDF`（MPL-2.0）离线跑一次，给扫描 PDF 加文字层 →
现有 `pdfjs-dist` **不改一行代码**就能抽到正文。这是"改一处、全库受益"的最高性价比动作。

**进阶解法**：招标文件的**评分办法表格**用 pdfjs 抽出来会散架；`PaddleOCR`(Apache-2.0) 的 PP-Structure 或 `docling`(MIT) 做版面+表格还原，把"评分项/分值/▲★标记"结构化进库——这直接服务你的模拟评标与参数逐条响应。

### 4.3 许可证合规：AGPL 是真实风险，不是形式主义

你是**公司主体**在用（智业），工具会**拿给医院看**。必须分清两类：

| 类别 | 项目 | 风险 |
|---|---|---|
| **AGPL-3.0 传染** | OpenBidKit_Yibiao、BidMaster-Pro、PPTist、firecrawl、PDF-Extract-Kit | **内部自用无义务**；但一旦以**网络服务**形式对外提供（含客户/医院访问），须以 AGPL 开源整个衍生作品 |
| **GPL 传染** | drawio-desktop、hyperformula(npm) | 分发即触发；打进前端 bundle 风险更高 |
| **MPL 文件级** | OCRmyPDF、d2 | 作为**独立工具调用**安全（不修改其源码即可） |
| **可放心** | MIT / Apache-2.0 / BSD | docling、markitdown、PaddleOCR、sqlite-vec、transformers.js、crawlee、X6、FunASR、presidio、synthea、pdfplumber、Docxodus |

**特别提示**：你正在做 `OpenBidKit_Yibiao`（AGPL-3.0）的 Electron→Web 移植。**自用部署没问题**；如果这个 Web 版会被团队外的人访问（含医院客户演示），AGPL §13 的"网络交互"条款就会被触发，需要对外提供源码。**建议现在就明确它的使用边界**，别等做完了才发现。
（另注：`MinerU`、`Stirling-PDF`、`NocoDB`、`Teable`、`funNLP` 在 GitHub 上未标 SPDX，商用前必须去仓库核 `LICENSE` 文件，不能靠二手信息。）

---

## 五、分三批落地路线

### 第一批：本周可做，零服务端、零合规风险

| # | 动作 | 具体落点 | 验收 |
|---|---|---|---|
| 1 | **OCR 补全存量扫描件** | `scripts/ocr-ingest.mjs`：扫描 PDF → OCRmyPDF → 回写 `kb_docs.content` | 抽查 20 份原空白 content 的 PDF，正文可检索 |
| 2 | **混合检索（两阶段）** | 新增 `src/lib/embedding.ts`、`src/lib/vectorIndex.ts`；改 `kbCore.ts:searchKbDocs()` | 20 条真实问答，命中率 ≥ 词法基线 +15%（你 roadmap 原定验收标准） |
| 3 | **废标自查补 21 项** | 对标 BidMaster-Pro 清单，扩现有 `ComplianceMatrixPanel` 规则 | 用 1 个历史真实项目回放，人工确认漏项归零 |
| 4 | **中文词表接入** | 用 funNLP 词表改 `kbCore.ts:tokenizeText()`，并喂暗标脱敏 | 分词质量抽查 + 脱敏漏检率下降 |

> 环境前置：把模型缓存指向 `HF_HOME=D:\hf-cache`、`HF_ENDPOINT=https://hf-mirror.com`（**必须**，见 3.8）。

### 第二批：2–4 周，本地侧车（Python 或 Node 进程）

| # | 动作 | 落点 |
|---|---|---|
| 5 | 招标文件一体化解析（表格/评分点） | Python 侧车：docling 或 PaddleOCR；产物进 `kb_docs`，接现有解析链 |
| 6 | 情报采集服务化 | crawlee（Node 同栈）+ Windows 计划任务；替换前端驻留触发 |
| 7 | 访谈录音 → 结构化需求清单 | FunASR 转写 → 复用你现有 LLM 抽取链 → 生成"科室/痛点/需求/优先级/对应模块"（补 roadmap 第四部分第 7 项） |
| 8 | 暗标脱敏升级 | presidio 框架 + 自建中文实体词表（医院名/人名/证书号） |

### 第三批：评估后再定

| # | 动作 | 说明 |
|---|---|---|
| 9 | 可编辑架构图 | antvis/X6（React 同栈），补 mermaid 不可编辑 |
| 10 | AI 生成 PPT | 先读 presenton 架构，再决定自研 or 自托管 |
| 11 | 医院演示数据集 | synthea 生成合成患者/就诊数据，喂"演示模式" |
| 12 | 检索/生成质量评测集 | **自研 20–50 条评测集**（沿用 `eval-fixtures.mjs` 的确定性思路）；ragas/deepeval 可选 |

---

## 六、明确不做（防止发散）

| 不做 | 理由 |
|---|---|
| **RAGFlow / LightRAG / KAG** | 需 Docker+ES+MySQL+Redis 或引入图谱；你的场景是**单团队本地、6 千篇文档**，收益远不抵运维复杂度。你现有 BM25 已"够用"（docs/06 原话），只差语义召回 |
| **NocoDB / Teable / Twenty** | 完整应用，引入即"双系统双权限双数据源"。你 roadmap 的"通用台账框架"应该**自研**（PocketBase collections 天然支持），而非套一个 SaaS |
| **PPTist 直接集成** | Vue + AGPL 双重不适配你的 React + 商用边界 |
| **outlines / instructor / dspy** | 你前端调 HTTP 网关，**已有 `zod` + `jsonTolerant.ts`** 解决结构化输出；dspy 需要标注数据 |
| **camelot** | 已归档（2023-01） |
| **爬虫绕过反爬** | 你自己 roadmap 已列"明确不做"，合规风险 |
| **hyperformula 打进前端** | GPL-3.0-only；报价测算逻辑简单，自研更安全 |

---

## 七、开工前必须先处理的环境问题（阻塞级）

实测发现：**C 盘已 100% 占满（150.10 GB 用尽，可用 0.00 GB）**。这已经在本次核查中**真实阻塞过我一次**（sqlite-vec 写入直接报 `could not write vector blob`，Node 进程连启动都失败 `ENOSPC`）。实测证据：同代码写到 D 盘完全正常（147k 行写入 4.6 秒）。

**只读扫描的占用排行**（未删除任何文件）：

| 排名 | 位置 | 占用 | 可回收性 |
|---:|---|---:|---|
| 1 | `AppData\Roaming` | **15.8 GB** | Qoder 6.9 GB、VS Code 1.2 GB、secoresdk 0.7 GB 等 |
| 2 | `npm-cache\_cacache` | **3.8 GB** | ✅ 可安全清（`npm cache clean --force`） |
| 3 | `ProgramData` | 3.4 GB | Microsoft 2.99 GB，谨慎 |
| 4 | `AppData\Local\Temp` | **3.2 GB**（扫描仍超时截断，实际更多） | ✅ 可清 |
| 5 | `.lmstudio` 模型 | **3.0 GB** | ✅ **按你既有约束本就应该迁到 D 盘** |
| 6 | `ms-playwright` | **2.9 GB** | ✅ 可重装/按需保留 |
| 7 | `Downloads` | 2.1 GB | 视内容 |
| 8 | `$Recycle.Bin` | **0.98 GB** | ✅ 可清空 |
| 9 | `.cache` | 0.82 GB | ✅ 多半可清 |
| 10 | `.workbuddy` | 1.0 GB（截断） | 含日志/浏览器缓存 |

**保守估计可无损回收 12–14 GB**，足以让开发环境恢复正常。
**我没有删除任何文件**——按安全原则，清理个人目录必须先经你确认。你说一声，我可以逐项列出具体文件清单、做备份、分批执行。
另外：本次所有临时产物我都已挪到 **D 盘**（`D:\_poc`、`D:\重要文件\_diskreport-20261003.json`），不再占用 C 盘。

---

## 八、一句话总结

**你缺的不是"更多 AI 生成功能"，而是"素材进得来 + 找得到"。**
GitHub 能帮你的就是这两件事：`OCRmyPDF` 解决"进得来"，`transformers.js` 两阶段混合检索解决"找得到"。其余推荐（crawlee / FunASR / presidio / synthea / X6）都是你 roadmap 上已有方向的**成熟现成件**。
而 RAGFlow、LightRAG、NocoDB 这类"看起来很专业"的项目，对你**是负收益**——它们解决的是多租户、大规模、高并发的 SaaS 问题，而你是单团队本地部署。

*报告完 · 所有外部数据均为 2026-10-03 实时核实，所有本机数据均为真实测量*
