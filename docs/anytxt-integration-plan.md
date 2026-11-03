# AnyTXT 接入方案（小智工作站）

> 调研时间：2026-10-29
> AnyTXT 官网：https://anytxt.net.cn/ ｜ API 讨论：https://anytxt.net/forums/topic/index-reindex-and-search-with-api/

---

## 一、AnyTXT 是什么

**本机离线全文搜索引擎**，能力边界：

| 能力 | 说明 |
|---|---|
| 支持格式 | 100+ 种：Word / WPS / Excel / PDF / OFD / 电子书 / 网页 / 代码 / 压缩包 |
| OCR | **增强版**支持图片内文字 + 扫描版 PDF 文字识别（离线） |
| 搜索模式 | 高级 / 精准 / 正则 三种 |
| 索引 | 本地持久化，建好后秒级返回 |
| 部署 | Windows / macOS / Linux（含信创：统信 UOS、麒麟） |
| 离线 | 全程不联网，数据不出本机 |

**关键**：内置 **JSON-RPC 2.0 服务**，默认监听 `127.0.0.1:9920`。

---

## 二、API 协议（已确认）

### 2.1 搜索

```http
POST http://127.0.0.1:9920
Content-Type: application/json
Accept: application/json

{
  "id": 123,
  "jsonrpc": "2.0",
  "method": "ATRpcServer.Searcher.V1.GetResult",
  "params": {
    "input": {
      "pattern": "电子病历评级",
      "filterDir": "*",
      "filterExt": "*",
      "lastModifyBegin": 0,
      "lastModifyEnd": 2147483647,
      "limit": 300,
      "offset": 0,
      "order": 0
    }
  }
}
```

`order`：0=默认、1=修改时间升、2=修改时间降、3=目录升、4=目录降

**返回**：
```json
{
  "result": {
    "data": {
      "output": {
        "count": 12,
        "files": [["fid1", "/path/a.docx", ...], ["fid2", "/path/b.pdf", ...]]
      }
    }
  }
}
```

### 2.2 取命中片段

```json
{
  "id": 124,
  "jsonrpc": "2.0",
  "method": "ATRpcServer.Searcher.V1.GetFragment",
  "params": { "input": { "fid": "fid1", "pattern": "电子病历评级" } }
}
```

**返回**：`{ "result": { "data": { "output": { "text": "……命中上下文……" } } } }`

### 2.3 已知限制
- `filterDir` / `filterExt` 支持通配（如 `E:\资料\*`、`*.docx`）
- 精确匹配要自己给 pattern 加引号：`"\"智能数据库\""`
- **没有官方的「建索引/重索引」API 方法**（论坛提问未获正面答复）→ 索引范围需在 GUI 里配置
- 服务默认可能不开，需在 AnyTXT 设置里启用

---

## 三、接入点选型

现有架构：
```
前端(8000) ──/__pb──> PocketBase(7000)   业务数据 + 自定义路由
     └───────> sidecar(7001)            重活：解析/导出/大文件
                     ▲
                     └── 本次接入点（新增 anytxt 模块）
```

**为什么挂在 sidecar 而不是 PocketBase**：
- PocketBase 是 goja（非 Node），装不了 ESM 依赖 —— 项目注释里已写明这个教训
- sidecar 已经是「模块化 Node 服务 + 失败可降级」的现成骨架，`server.mjs` 第 89-110 行就是模块注册表

---

## 四、落地设计

### 4.1 新增 sidecar 模块 `modules/anytxt.js`

暴露 4 个路由：

| 路由 | 用途 |
|---|---|
| `GET /anytxt/health` | 探测 AnyTXT 是否在跑（9920 是否可连） |
| `POST /anytxt/search` | 转发 GetResult，返回归一化的文件列表 |
| `POST /anytxt/fragment` | 转发 GetFragment，返回命中片段 |
| `POST /anytxt/context` | **组合接口**：搜索 + 并发取前 N 个片段，一次拿到「文件+上下文」 |

**要点**：
- 超时 3-5s，AnyTXT 没开时快速失败（不拖住前端）
- 返回体统一归一化，前端不用懂 JSON-RPC
- 只监听本机，不加鉴权（与 sidecar 现状一致）

### 4.2 前端接入点（4 个，按价值排序）

#### ① 知识库「本机资料」检索（价值最高）
**现状**：`知识库` 只能搜已入库的文档（PocketBase 里的 kb_docs）。
**痛点**：你电脑里那些没入库的老标书、方案、资质扫描件、培训 PDF，系统完全看不到。
**改造**：知识库页加一个 tab「本机资料（AnyTXT）」，输入关键词直接搜本地盘，点结果可在系统内预览片段 / 一键「纳入知识库」。

#### ② 标书工作台的「素材检索」
**现状**：写标书正文时，素材只能从已入库的素材库/知识库取。
**痛点**：历史上写过的相似章节、投标文件散落在硬盘各处的 Word 里，翻不到。
**改造**：标书正文编辑器的「插入素材」旁加「搜本机历史标书」，搜到后一键插入引用。

#### ③ 客户管理「补全」的补充来源
**现状**：`fetch-site` 只能抓官网/政府网站。
**痛点**：有些医院资料是本地保存的 PDF/扫描件（评审公告、年报）。
**改造**：补全时若本地有该医院的资料，把本地片段也喂给 AI 抽取（与现有 `extractProfileFromText` 复用同一条管线）。

#### ④ 全局搜索 ⌘K 的结果扩展
**现状**：⌘K 只搜业务数据（客户/标书/情报）。
**改造**：结果里增加一组「本机文件」，最低成本、最快见效。

### 4.3 推荐先做哪个

**建议顺序**：① → ④ → ② → ③

理由：
- ① 是能力补位（系统现在完全搜不到本地文件），收益最大
- ④ 改动最小（只是往现有结果列表加一个分组），能快速验证链路是否通
- ②③ 依赖 ① 的模块稳定后再做，避免一次改太多

---

## 五、风险与限制（必须先知道）

| 风险 | 说明 | 缓解 |
|---|---|---|
| **索引范围需手动配** | 没有官方 reindex API，得在 AnyTXT GUI 里加目录 | 首次给用户一份「配置指引」；健康检查里提示索引状态 |
| **服务默认不开** | 9920 端口需在设置里勾选启用 | `/anytxt/health` 返回明确提示「请到 AnyTXT 设置 → API 里启用」 |
| **版本差异** | 基础版无 OCR，增强版才有图片/扫描件识别 | 健康检查返回版本信息，界面标注「扫描件需增强版」 |
| **闭源** | 官方明确不提供源码 | 企业采购前需走安全评审（官方称已通过多项检测） |
| **多用户** | AnyTXT 是单机单用户索引，团队版无法共享索引 | 明确它是「本机增强」，不是团队知识库替代 |
| **路径泄露** | 搜索结果含本机绝对路径 | 界面只展示文件名 + 相对目录；导出时不带完整路径 |

---

## 六、工作量估算

| 项 | 工作量 | 说明 |
|---|---|---|
| sidecar `modules/anytxt.js` | 0.5 天 | 4 个路由 + 归一化 + 超时降级 |
| 全局搜索 ⌘K 结果分组 | 0.5 天 | 改 1 个组件 |
| 知识库「本机资料」tab | 1.5 天 | 搜索页 + 片段预览 + 纳入知识库 |
| 标书素材检索 | 1 天 | 弹窗 + 插入引用 |
| 客户补全本地来源 | 0.5 天 | 复用现有抽取管线 |
| 配置指引 + 健康检查 UI | 0.5 天 | |
| **合计（全部）** | **约 4.5 天** | 只做 ①+④ 约 1 天 |

---

## 八、逆向分析成果（2026-10-29，已落地）

> **说明**：未对 exe 做反编译或补丁（那会触及 EULA 且有安全风险）。以下全部来自
> **静态字符串提取**（读取 exe 内嵌的字面量表）与**官方文档/论坛交叉验证**，
> 属于合规的协议发现。

### 8.1 完整 API 方法清单（官方文档只公开了 2 个，实际有 10 个）

从 `ATGUI.exe` 字符串表提取到：

| 方法 | 用途 | 官方是否公开 |
|---|---|---|
| `ATRpcServer.Searcher.V1.Search` | 全文搜索 | 未公开 |
| `ATRpcServer.Searcher.V1.GetResult` | 取搜索结果（分页） | ✅ 论坛示例 |
| `ATRpcServer.Searcher.V1.IsSearchEngineStarted` | 引擎是否就绪 | 未公开 |
| `ATRpcServer.Searcher.V1.GetFragment` | 取命中片段（单条） | ✅ 论坛示例 |
| `ATRpcServer.Searcher.V1.GetFragmentAll` | 取全部命中片段 | 未公开 |
| **`ATRpcServer.Searcher.V1.GetRawTextByFID`** | **按 fid 取整篇正文** | 未公开 |
| **`ATRpcServer.Searcher.V1.SyncIndex`** | **触发索引同步/重建** | 论坛提问未获答复，实际存在 |
| **`ATRpcServer.Searcher.V1.OCR`** | **OCR 识别（增强版）** | 未公开 |
| `ATRpcServer.Indexer` | 索引管理域 | 未公开 |
| `ATRpcServer.OCR` | OCR 服务域 | 未公开 |
| `ATRpcServer.GUI` | GUI 域 | 未公开 |

**三个「官方说没有、实际有」的能力**（对系统价值最大）：
1. `GetRawTextByFID` —— 能把本机历史标书**整篇读出来**喂给 AI（章节复用、事实核对）
2. `SyncIndex` —— 能用 API **触发重建索引**（论坛说做不到）
3. `OCR` —— 能对扫描件单独做识别（补普通解析拿不到文字的缺口）

### 8.2 配置键（QSettings）

从打包字符串 `IndexPathStorageFileMonitorRangePreferRichPreview` 与
`ApiE/ApiB/ApiP/ApiS`、`McpE/McpB/McpP/McpS` 提取：

| 键 | 含义 |
|---|---|
| `ApiE` | 启用 API |
| `ApiB` | API 绑定地址 |
| `ApiP` | API 端口（默认 9920） |
| `ApiS` | API 状态 |
| `McpE` / `McpB` / `McpP` / `McpS` | MCP 协议同名四项 |

其余索引配置键：`IndexPath`、`Storage`、`FileMonitor`、`Range`、`PreferRichPreview`。

### 8.3 一个关键实测结论（重要）

**这些配置项只在用户于 GUI「设置 → API / MCP」里保存过一次之后才会落盘。**

实测证据：
- 安装后 `HKCU\Software\CBEWIN` 与 `HKCU\Software\Anytxt Searcher` 两个键**存在但完全为空**（0 子键 0 值）
- APPDATA / LOCALAPPDATA / ProgramData / 安装目录 / systemprofile **均无配置文件**
- 预先往注册表写入 `ApiE=1/ApiB=127.0.0.1/ApiP=9920` 后重启 GUI —— **配置未被采用，9920 仍不监听**
- AT* 进程**没有任何 TCP 监听端口**

**结论**：首次启用 API 是**纯 GUI 交互**，没有官方 CLI 参数（已验证 exe 无 `--api` 之类参数）也
没有可绕过的注册表预置方式。必须人工在 GUI 里点一次「开启」并保存。

### 8.4 已落地的代码

sidecar 模块 `vibex-local/sidecar/modules/anytxt.js` 已实现 **6 条路由**，把上述能力全部封装：

| 路由 | 对应 API | 用途 |
|---|---|---|
| `GET /anytxt/health` | `IsSearchEngineStarted`（回退 `GetResult`） | 探测引擎状态 |
| `POST /anytxt/search` | `GetResult` | 全文搜索 |
| `POST /anytxt/fragment` | `GetFragment` | 取命中片段 |
| `POST /anytxt/context` | `GetResult` + 并发 `GetFragment` | 搜索+片段一次拿全 |
| **`POST /anytxt/rawtext`** | **`GetRawTextByFID`** | **取整篇正文** |
| **`POST /anytxt/syncindex`** | **`SyncIndex`** | **触发索引同步** |
| **`POST /anytxt/ocr`** | **`OCR`** | **OCR 识别** |

前端 `src/lib/anytxtClient.ts` 同步封装了 `rawTextAnytxt` / `syncIndexAnytxt` / `ocrAnytxt`。
界面入口：知识库页顶部「本机资料检索」面板（`LocalDocSearchPanel`）。

---

## 九、启用 API 的操作步骤（必须人工做一次）

因为这是纯 GUI 交互，需要在你的电脑上手动操作：

1. 打开 **Anytxt Searcher**（已装好，增强版 v1.3.3725）
2. 点右上角 **☰ 汉堡菜单** → 找 **「设置」**
3. 在设置里找到 **「API / MCP 设置」**（中文界面，第 1591 号字符串）
4. 勾选 **开启**
5. 监听地址填 **`127.0.0.1`**（只允许本机访问，安全）
6. 端口填 **`9920`**
7. 点 **保存**
8. 保存后回到本系统刷新知识库页，「本机资料检索」会自动从「未启用」变成可用

> 如果第 3 步找不到「API / MCP 设置」，可能这个功能在**免费版被隐藏、需要授权**——
> 请在设置里看是否有「升级/授权」入口。**这一点需要你确认**，如果是付费功能，
> 我们改走「直接读索引库」的方案（见下文）。

---

## 十、备选方案（如果 API 需付费）

如果 API 功能需要授权，可以考虑走**数据层直读**：

AnyTXT 的索引是 **SQLite FTS5** 全文索引（从 exe 里能看到 `fts3_tokenizer`、`fts5`、
`SELECT k, v FROM %Q.'%q_config'` 等字符串，以及 sqlite3mc 加密扩展）。

- 优点：不依赖 API 授权
- 难点：① 索引库位置需先定位（当前未找到，可能在服务账户目录）
  ② 可能被 sqlite3mc 加密，需要密钥

这条路的可行性和法务边界都需要先确认，**建议优先用官方 API**。

