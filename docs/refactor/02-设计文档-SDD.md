# 小智工作台 · 系统设计文档（SDD）

> **文档编号**：XZ-SDD
> **版本**：v1.0 / 2026-09-23
> **文档状态**：基线版（重构基准）
> **读者**：重构执行者（AI / 工程师）
> **上位文档**：`00-小智工作台-重构系统提示词.md`；**平行文档**：`01-需求文档-PRD.md`、`03-开发文档-EDD.md`

---

## 1. 架构总览

### 1.1 C4 Level 1 · 系统上下文

```
                    ┌──────────────────────────────────────┐
                    │           售前团队成员                │
                    │  （售前工程师 / 标书专员 / 负责人）    │
                    └───────────────┬──────────────────────┘
                                    │ 浏览器访问
                                    ▼
        ┌───────────────────────────────────────────────────────────┐
        │                    小智工作台（本系统）                     │
        │  12 个业务模块 · AI 能力层 · 数据持久层 · 导出子系统        │
        └───┬──────────────────┬──────────────────┬────────────────┘
            │                  │                  │
            │ 情报抓取（HTTP）   │ LLM 出站          │ 用户自带模型
            ▼                  ▼                  ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
    │ 各级政府采购网 │   │ 平台内置模型  │   │ 用户配置的第三方   │
    │ 政策/媒体网站  │   │ （服务端代理）│   │ OpenAI 兼容端点   │
    └──────────────┘   └──────────────┘   └──────────────────┘
```

**关键边界**：
- **前端绝不直连第三方大模型**——个人模型的请求也必须经后端代理出站（防密钥外泄、统一计量）。
- **招标文件 / 知识库文档的解析在浏览器本地完成**，原文件不上传服务端。
- 情报抓取由服务端定时任务发起（前端仅触发与展示）。

### 1.2 C4 Level 2 · 容器图

```
┌──────────────────────────── 浏览器（客户端） ────────────────────────────┐
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  React 19 SPA（Vite dev / 构建产物）                              │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐   │    │
│  │  │ pages/     │ │ components/│ │ hooks/     │ │ lib/         │   │    │
│  │  │ 12 模块    │ │ UI + 面板  │ │ 跨模块复用  │ │ 纯逻辑内核    │   │    │
│  │  └────────────┘ └────────────┘ └────────────┘ └──────────────┘   │    │
│  │  ┌──────────────────────────────────────────────────────────┐    │    │
│  │  │ 本地能力：docx/pdf/pptx/xlsx 解析 · Word/Excel/PPT 生成   │    │    │
│  │  │ IndexedDB 响应缓存 · localStorage 轻状态 · sessionStorage │    │    │
│  │  └──────────────────────────────────────────────────────────┘    │    │
│  └───────────────────────────┬──────────────────────────────────────┘    │
│                              │ /__pb/* → 127.0.0.1:7000（Vite 代理 rewrite）│
└──────────────────────────────┼────────────────────────────────────────────┘
                               ▼
┌──────────────────── PocketBase v0.40.4（服务端） ─────────────────────┐
│  ┌────────────────────────┐      ┌──────────────────────────────┐    │
│  │ 内置 REST（集合 CRUD）  │      │ pb_hooks（36 个 .pb.js）      │    │
│  │  /api/collections/*    │      │  自定义业务路由 + 集合自举     │    │
│  └────────────────────────┘      └──────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 中间件：team_auth（Bearer 角色判定）· zx_guard（身份门）        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────┐      ┌──────────────────────────────┐    │
│  │ SQLite（data.db）       │      │ 定时任务（情报抓取 / 30 分钟） │    │
│  └────────────────────────┘      └──────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────┘
```

**为什么选 PocketBase**：单 Go 二进制约 33MB，零依赖启动；SQLite 单文件便于备份与迁移；JSVM hooks 让"加一个业务接口"只需写一个 `.pb.js` 文件，无需独立后端工程。代价是**约定能力弱**——这正是 CRUD 重复代码与并发丢字段问题的根源（见 9.3）。

---

## 2. 前端架构

### 2.1 分层模型

| 层 | 目录 | 职责 | 约束 |
|---|---|---|---|
| **路由层** | `App.tsx` | 12 路由，全部 `lazy` + `Suspense` | 首屏只加载首页 + 共享依赖 |
| **页面容器层** | `pages/<模块>/index.tsx` | 默认导出薄壳，做 vm 拼装 | 不放业务逻辑 |
| **视图层** | `pages/<模块>/<X>Page.tsx` | 纯展示，接收 vm | 不直接调接口 |
| **逻辑层（vm）** | `pages/<模块>/use<模块>.ts` | 状态 + 副作用 + 业务编排 | 单文件超 1000 行必须拆分（现状多数 30 万字符级，是重构重点） |
| **纯逻辑内核层** | `src/lib/*.ts` | 无 UI、无 React 依赖的纯函数 | **必须可 100% 单测** |
| **组件层** | `components/ui/`（基座）、`components/<模块>/`（业务面板）、`components/shell/`（外壳）、`components/common/`（跨模块） | 展示与交互 | 业务面板不得跨模块互相引用 |
| **类型层** | `<模块>Types.ts` | 类型定义 | 与提示词构造器分离存放 |

### 2.2 状态管理策略（无全局状态库，这是刻意选择）

| 状态类型 | 载体 | 适用 |
|---|---|---|
| 服务端数据 | 各 `use*` hook 内部 state + 接口拉取 | 所有业务数据 |
| 轻量持久偏好 | `localStorage`（带命名空间前缀） | 外观、技能选择、确认状态 |
| 会话态 | `sessionStorage` | 视图 tab、知识库 QA 会话 |
| 响应缓存 | IndexedDB | LLM 响应缓存（仅 `cacheable` 任务） |
| 跨模块传递 | URL 深链参数（`?customer=` / `?opp=` / `?new_opp=1` / `?competitor=` / `?q=`）+ `sessionStorage.xz_last_biz_path` | 模块间跳转与助手上下文 |

**命名空间前缀约定**（重构必须沿用，不得另起）：

| 前缀 | 用途 |
|---|---|
| `zx_` | 应用级偏好（`zx_appearance_v1`、`zx_recent_pages`、`zx_skill_sel_*`、`zx_comp_scores_v1`） |
| `xz_` | 用户态数据（`xz_failed_msgs_{uid}`、`xz_last_biz_path`） |
| `vibex_cost_confirmed_today:{appId}` | 当日成本确认 |
| `todos_done_{uid}` | 待办完成态防闪烁 |
| `ss_tpl_*` | 方案模板 |
| `xiaozhi-team-token` / `xiaozhi-team-profile` | 团队身份 |

**禁止**：引入 Redux / Zustand / MobX 等状态库（R6 红线：不引入新依赖）。跨模块状态通过 props、context 或深链解决。

### 2.3 路由与代码分割

```
WorkbenchShell（父布局：侧边栏 + 顶栏 + Outlet + 浮动助手 + Toaster）
├─ /                    Home
├─ /solution-studio     SolutionStudio
├─ /bid-workspace       BidWorkspace
├─ /ppt-quote           PptQuote
├─ /format-tool         FormatTool
├─ /intel-center        IntelCenter
├─ /competitors         Competitors
├─ /customer-management CustomerManagement
├─ /knowledge           Knowledge
├─ /model-config        ModelConfig
├─ /assistant           Assistant
├─ /team                Team
└─ *                    NotFound
```

### 2.4 应用外壳（Shell）

| 组件 | 职责 |
|---|---|
| `WorkbenchShell` | 布局骨架；`accountKey` 变更时强制整棵子树重挂载（切号用） |
| `SidebarNav` | 四组导航：概览 / 核心工作 / 资源与知识 / 系统。折叠宽度 72px ↔ 236px |
| `TopBarShell` | 面包屑、团队身份徽标、外观按钮、命令面板入口、账号菜单 |
| `GlobalCommandPalette` | Cmd/Ctrl+K；最近访问 + 导航别名 + 5 个快捷操作 + 8 组全局搜索（每组上限 5 条，300ms 防抖） |
| `FloatingAssistant` | 380×520 可拖拽浮窗，可收起为圆球、可进全屏 |
| `TeamAuthGate` | 登录门禁状态机 `checking → setup → login → granted`，**仅本地域生效** |

---

## 3. 后端架构

### 3.1 PocketBase 的角色

| 能力 | 使用方式 |
|---|---|
| 数据持久化 | SQLite 单文件（`pocketbase/pb_data/data.db`） |
| 集合 CRUD | **不用**内置 `/api/collections/*` 接口，而是每个集合手写自定义路由（便于加业务规则与字段裁剪） |
| 自定义 API | `pb_hooks/*.pb.js` 中 `routerAdd(method, path, handler)` |
| 集合自举 | 每个 `.pb.js` 在加载时检查集合是否存在，不存在则创建（`findCollectionByNameOrId` + `new Collection`） |
| 定时任务 | `cronAdd`（情报抓取，每 30 分钟） |
| 中间件 | `onRecordCreateRequest` 等生命周期钩子 + `routerUse` |

### 3.2 pb_hooks 文件规范

```
pocketbase/pb_hooks/
├─ _lib/            ← 共享库（以 _ 开头的文件 PocketBase 不注册路由）【目标状态，待建】
│  ├─ crud.js          CRUD 工厂（身份校验 / 归属校验 / 字段白名单 / 乐观锁）
│  ├─ identity.js      身份解析（业务身份 + 团队身份）
│  └─ respond.js       统一响应与错误码
├─ team_auth.pb.js   鉴权与成员管理（含中间件）
├─ zx_guard.pb.js    身份门
├─ <domain>.pb.js    各业务域路由 + 集合自举
└─ _rh_admin_sso.pb.js  管理员 SSO（平台集成，勿动）
```

**每个 `.pb.js` 的标准结构**（重构后模板）：

```js
/// <reference path="../pb_data/types.d.ts" />

// ── 集合自举（保持现状，禁止改字段） ────────────────────────
function ensureCollection() { /* findCollectionByNameOrId + 创建 */ }
ensureCollection()

// ── 路由声明（只声明差异部分） ──────────────────────────────
$app.router.post('/api/xxx', $apis.requireRecordAuth?.() ?? null, (e) => {
  const actor = requireIdentity(e)          // 身份校验（含归属）
  const body  = pickAllowed(e.body, FIELDS) // 字段白名单
  return crudCreate('xxx', actor, body)     // 工厂：乐观锁 + 审计
})
```

### 3.3 数据模型（集合清单与职责）

> ⚠️ **R1 红线**：重构期间集合 schema 一个字段都不能变。下表用于理解现状，不作为变更依据。

#### 3.3.1 工作台域

| 集合 | 职责 | 关键字段（已知） |
|---|---|---|
| `projects` | 通用项目 | 名称、进度、截止日、负责人 |
| `todos` | 待办 | 标题、到期日、完成态、来源（`source_type` / `source_id` / `link`） |

#### 3.3.2 方案域

| 集合 | 职责 |
|---|---|
| `solutions` | 方案（大纲 + 章节 + 医院信息 + 关联商机 `opportunity_id`） |
| `checklists` | 建设清单实例（含评级清单 / 客户清单两条路径的快照） |
| `check_products` | 公司产品库（含技术参数） |
| `check_mappings` | 清单行 ↔ 产品映射库（沉淀口径） |
| `product_library` | 产品资料库（方案 / PPT 素材复用） |
| `doc_templates` | 文档模板（含 `/{id}/download`） |

#### 3.3.3 标书域

| 集合 | 职责 | 关键点 |
|---|---|---|
| `bid_projects` | 标书项目（**主实体**） | 承载 7 步流程的全部状态；`bid_result` / `bid_amount` / `lost_reason` |
| `bid_stage_snapshots` | 阶段快照 | 六类：解析 / 大纲 / 章节 / 检查 / 评标 / 全量 |

> **已知数据设计问题**：`bid_projects` 内部把章节数据塞在单 JSON 列里。**拆列 = 数据模型变更 = R1 红线，需用户拍板**，重构期间保持原样。

#### 3.3.4 PPT 与报价域

| 集合 | 职责 |
|---|---|
| `ppt_decks` | 演示文稿（页面数组 + 图表 + KPI + 切换动效） |
| `quotes` | 报价单（分组 + 行项 + 税说明 + 关联商机） |

#### 3.3.5 格式域

| 集合 | 职责 |
|---|---|
| `format_templates` | 格式模板（字体 / 标题 / 行距 / 页边距 + 默认标记） |

#### 3.3.6 情报域

| 集合 | 职责 |
|---|---|
| `intel_sources` | 情报源（四类：policy / competitor / bid / media；内置全员可见、个人私有） |
| `intel_items` | 情报条目（正文、AI 摘要、标签、地区、处理状态） |
| `intel_prefs` | 用户偏好（关注区域 / 重点网站 / 内容词） |
| `intel_stars` | 收藏（每人独立） |
| `intel_views` | 浏览状态（每人独立，`/api/intel/items/{id}/view` 只改本人状态） |

#### 3.3.7 竞品域

| 集合 | 职责 |
|---|---|
| `competitors` | 竞品档案（软著布局 / 市场业绩 / 产品定位 / 竞争研判；可见性 team / personal） |

#### 3.3.8 客户域

| 集合 | 职责 |
|---|---|
| `customers` | 医院客户档案（信息化评级 / 系统厂家 / 关键人 / 联系人） |
| `opportunities` | 商机（七阶段 / 金额 / 下一步动作 / `next_follow_date`） |
| `follow_records` | 跟进记录 |
| `customer_enrich` | 客户档案补全相关（服务端 `/api/customers/fetch-site`、`/fetch-image`） |

#### 3.3.9 知识库域

| 集合 | 职责 |
|---|---|
| `kb_docs` | 文档（标题、正文、目录归属、七档分类、`visibility`、敏感标记、AI 访问策略、索引字段） |
| `kb_qa_pairs` | 弹药库问答对（已审核，命中可零成本直答） |

#### 3.3.10 系统域

| 集合 | 职责 |
|---|---|
| `model_configs` | 个人模型配置（`enabled` / `last_check_status` / `last_check_error` / `last_checked_at` / 默认标记） |
| `llm_jobs` | LLM 异步任务（平台模型 poll-first 模式的作业表） |
| `assistant_sessions` / `assistant_messages` / `assistant_skills` / `assistant_memory` | 助手会话 / 消息 / 技能 / 记忆 |
| `team_members` | 团队成员与角色（admin / editor / viewer） |
| `users` / `_superusers` | PocketBase 内置认证集合 |

### 3.4 接口契约

#### 3.4.1 标准 CRUD 模式（27 个集合）

```
GET    /api/<collection>           列表（支持 page / perPage / filter / sort / fields）
GET    /api/<collection>/{id}      单条
POST   /api/<collection>           创建
PATCH  /api/<collection>/{id}      更新
DELETE /api/<collection>/{id}      删除
```

适用于：`customers`、`opportunities`、`follow_records`、`solutions`、`checklists`、`check_products`、`check_mappings`、`product_library`、`doc_templates`、`bid_projects`、`bid_stage_snapshots`、`ppt_decks`、`quotes`、`format_templates`、`competitors`、`intel_items`、`intel_stars`、`intel_views`、`intel_prefs`、`kb_docs`、`kb_qa_pairs`、`projects`、`todos`、`assistant_sessions`、`assistant_messages`、`assistant_skills`、`assistant_memory`

**附加路由**：
- `GET /api/doc_templates/{id}/download` — 模板下载
- `GET /api/intel_sources` — 情报源列表（只读）

#### 3.4.2 领域专用路由

| 域 | 方法与路径 | 职责 |
|---|---|---|
| **情报** | `POST /api/intel/tick` | 触发一轮抓取 |
| | `GET/POST /api/intel/sources`、`PATCH/DELETE /api/intel/sources/{id}` | 源管理 |
| | `POST /api/intel/fetch-now` | 立即抓取 |
| | `POST /api/intel/fetch-url` | 抓取指定 URL 正文（手动录入用） |
| | `GET /api/intel/items` | 条目列表（带筛选） |
| | `POST /api/intel/items/{id}/view` | 标记已读（仅本人） |
| | `GET/POST /api/intel/prefs` | 偏好读写 |
| | `POST /api/intel/enrich` | 情报增强 |
| | `POST /api/intel/extract-bid` | 招标/中标要素规则抽取（**零 AI**） |
| | `POST /api/intel/cleanup-irrelevant` | 无效内容清理 |
| **客户** | `POST /api/customers/fetch-site` | 抓取医院官网/公众号正文（`direct=true` 视为文章直链） |
| | `POST /api/customers/fetch-image` | 抓取并代理图片 |
| **模型网关** | `GET/POST /api/model-gw/configs`、`PATCH/DELETE /api/model-gw/configs/{id}` | 个人配置管理（**响应必脱敏**） |
| | `POST /api/model-gw/configs/{id}/refresh-models` | 重拉模型列表 |
| | `POST /api/model-gw/test` | 连通性测试 |
| | `POST /api/model-gw/chat` | **个人模型对话出站代理（核心）** |
| **平台模型** | `GET /api/llm/models` | 平台可用模型 |
| | `POST /api/llm/chat` | 平台模型对话（poll-first） |
| | `POST /api/llm/poll` | 轮询取结果 |
| **团队** | `GET /api/team/status` | 初始化状态 |
| | `POST /api/team/setup` | 首次创建管理员 |
| | `GET /api/team/me` | 当前身份与角色 |
| | `GET/POST /api/team/members`、`PATCH /api/team/members/{id}` | 成员管理 |
| **运维** | `GET /api/zx/backup` | 备份 |
| | `POST /__rh_admin_sso` | 管理员 SSO（平台集成，**勿动**） |
| **遗留** | `GET /api/model_configs` | ⚠️ **无身份门 + 明文 api_key，必须下线或加门** |

#### 3.4.3 统一请求约定

| 项 | 约定 |
|---|---|
| 前端代理前缀 | `/__pb` → 服务端 `/`（Vite rewrite） |
| 业务身份 | `X-Rh-User-Id: <uid>`（本地域固定 `local-user`） |
| 团队身份 | `Authorization: Bearer <teamToken>` |
| 分页 | `page` / `perPage`（**服务端必须返回真实 `totalItems`**） |
| 字段裁剪 | `fields`（列表必须裁剪，禁止带全文） |
| 错误码 | `401 login_required` / `403 forbidden` / `400 invalid` / `5xx` |
| 幂等 | 出站 LLM 请求需带幂等键 |

### 3.5 鉴权设计

```
┌─ 请求进入 ─────────────────────────────────────────────────┐
│ 1. zx_guard / team_auth 中间件                              │
│    ├─ 解析 Authorization: Bearer → 团队令牌 → 角色           │
│    ├─ 解析 X-Rh-User-Id → 业务身份                           │
│    └─ 缺业务身份 → 401 login_required                        │
│ 2. 角色判定                                                 │
│    ├─ viewer + 写方法 → 403 forbidden                        │
│    └─ 高危路由 + 非 admin → 403 forbidden                    │
│ 3. 归属校验（防 IDOR）                                      │
│    └─ PATCH/DELETE 前校验 rec.uid === actor.uid 或 admin      │
│ 4. 可见性过滤（服务端）                                      │
│    └─ personal 资源在 list 中按 actor.uid 过滤                │
└─────────────────────────────────────────────────────────────┘
```

**门禁生效范围**：`TeamAuthGate` 仅在 `localhost` / `127.0.0.1` / `::1` 生效；线上域直接 `granted`（平台网关已做鉴权）。

### 3.6 并发与一致性（当前最大技术债）

**现状问题**：36 个 hook 普遍采用"读整行 → 改字段 → 存整行"。两个并发请求交叉执行时，后写的会覆盖先写的字段（**丢更新**）。

**目标方案**：
1. 抽出 `_lib/crud.js`，统一走：
   ```
   读取记录（含版本号）
   → 比对客户端提交的版本号（乐观锁）
   → 不匹配 → 409 conflict
   → 匹配 → 只更新白名单字段 → 版本号 +1 → 保存
   ```
2. 需要原子累加的场景（如计数）改用数据库级操作，而非"读-改-写"。
3. 跨集合的写操作使用事务。

---

## 4. AI 能力层设计

### 4.1 模型网关架构

```
业务代码
  │
  ▼
@/lib/modelGateway.ts :: chatViaGateway({ modelRef, messages, page, max_tokens, temperature, signal, cacheable })
  │
  ├─ 1. 解析 ModelRef ────────────────────────────────┐
  │     source = platform | personal                   │
  │     key    = `source:configId:modelId`             │
  │     优先级：用户选择的个人模型 → 平台内置模型        │
  │                                                    │
  ├─ 2. 成本确认（costConfirm）◄───────────────────────┤
  │     runWithCostConfirm：非访客付费 或 当日已确认 → 放行
  │     key: vibex_cost_confirmed_today:{appId}，当日 23:59:59 过期
  │     文案由 costTextForModel 生成（个人=你的账户承担 / 平台=按 token 扣费）
  │
  ├─ 3. 缓存查询（仅 cacheable=true）◄─────────────────┤
  │     IndexedDB `llm-resp-cache:{userId}`
  │     identity = source + configId + modelId + messages + max_tokens + temperature + page
  │     SHA-256 主键 + 原文比对防碰撞；TTL 默认 24h；未登录不缓存
  │
  ├─ 4. 技能注入 injectSkillBlock(messages, skillBlockFor(scope))
  │
  ├─ 5. 出站
  │     personal → POST /api/model-gw/chat（前端绝不直连第三方）
  │     platform → callLlmWithFallback（POST /api/llm/chat + poll 轮询）
  │
  ├─ 6. 回退链 ───────────────────────────────────────┤
  │     个人请求超时 150s（服务端 120s + 30s）
  │     服务端 code=fallback_to_platform → 自动回退平台模型
  │     401 → rh_login_required
  │     用户取消 → user_cancelled（不视为错误）
  │
  └─ 7. 写缓存 + 可观测（耗时 / token / 模型 / 成败）
```

**page 标签**（服务端计费与日志维度，共 9 个）：
`bid-workspace` / `solution-studio` / `ppt-quote` / `customer-management` / `competitors` / `intel-center` / `knowledge` / `assistant` / `model-config`

**scope 标签**（技能注入维度）：
`bid-parse` / `bid-defense` / `ppt-deck` / `quote-draft` / `customer-profile` / `kb-qa` / `checklist-match` / `solution-outline` …

### 4.2 提示词工程体系（62 条构造器）

#### 分类总览

| 模块 | 条数 | 代表构造器 |
|---|---|---|
| 公共底座 | 11 | `truthPreamble` / `BID_STYLE_RULES` / `FULLTEXT_GUARD_RULES` / `PARAM_RESPONSE_BOUNDARY_RULES` / `PRE_OUTPUT_SELFCHECK_RULES` / `complianceModeRule` / `complianceOutlineRule` / `SOL_STYLE_RULES` |
| 标书工作台 | 27 | `buildTenderParseMessages` / `buildBidOutlineMessages` / `buildBidChapterMessages` / `buildDeviationMapMessages` / `buildVoidCheckMessages` / `buildEvalMessages`（三路）/ `buildSubmissionCheckMessages` / `buildFactCheckMessages` / `buildJsonRepairMessages` / `buildOrchestrationMessages` / `buildCoverageAuditMessages` |
| 方案工作室 | 4 | `buildOutlineMessages` / `buildChapterMessages` / `buildRefineMessages` / `buildChapterReviewMessages` |
| PPT 与报价 | 7 | `deckSystem` / `VISUAL_RULES` / `buildDeckSingleMessages` / `buildDeckOutlineMessages` / `buildDeckBatchMessages` / `buildSlideRefineMessages` / `buildQuoteDraftMessages` |
| 客户管理 | 2 | `buildProfileMessages` / `buildExtractMessages` / `buildSuggestionMessages` |
| 竞品分析 | 2 | `ANALYSIS_SYSTEM_PROMPT` / `TALK_SYSTEM_PROMPT` |
| 情报中心 | 2 | `buildTagMessages` / 周报内联 |
| 知识库 | 1 | `KB_QA_SYSTEM_PROMPT` |
| 站内助手 | 3 | `buildSystemPrompt` / `MEMORY_FACT_RULES` / `skillPromptBlock` |
| 内联工具 | 3 | 合规矩阵补扫 / 清单语义匹配 / `TEST_PROMPT` |

#### 六个设计模式（重构必须保持）

| # | 模式 | 说明 | 代表 |
|---|---|---|---|
| 1 | **多消息缓存序** | 稳定大块上下文（同项目/同方案跨章 identical）作首条 user 前置，任务差异内容置后，以命中服务端前缀缓存 | 章节生成类 |
| 2 | **公共底座复用** | 标书全链固定前置 `truthPreamble`；正文类统一拼四块（风格 / 防翻车 / 参数边界 / 输出前自检） | 1.1–1.7 |
| 3 | **三档合规模式** | strict / moderate / full 控制篇幅取向、素材强度、特有禁止项；**参数边界在所有模式下均不放宽** | `complianceModeRule` |
| 4 | **宁缺毋滥防幻觉** | 判定/审计类必须带"拿不准不输出、无问题给空数组、必须附 evidence" | 查重 / 废标 / 格式 / 商务 / 覆盖审计 |
| 5 | **结构化输出约束** | 要求严格 JSON、禁解释文字、禁 markdown 围栏；配一次语法修复重试 | `extractJsonLoose` → `withJsonRepair` → `parseJsonTolerant` |
| 6 | **全量版本标记** | 标书侧统一携 `BID_PROMPT_VERSION`，便于回溯提示词变更 | — |

#### 目标重构形态

```
src/features/<模块>/prompts/
├─ base/                         公共底座（跨模块复用）
│  ├─ truthPreamble.ts
│  ├─ styleRules.ts
│  ├─ fulltextGuardRules.ts
│  ├─ paramBoundaryRules.ts
│  ├─ preOutputSelfcheckRules.ts
│  └─ complianceMode.ts
├─ parse.ts                      ← 每个构造器一个文件
├─ outline.ts
├─ chapter.ts
├─ deviation.ts
├─ voidCheck.ts
├─ eval.ts
└─ index.ts                      模块提示词统一出口
```

**硬性要求**：抽离是**纯搬家、逐字符等价**；禁止"顺便优化措辞"（R2）；每个构造器携带版本号；过程有 fixture 回归兜底。

### 4.3 结构化输出容错链

```
LLM 原始返回
  ↓ ① extractJsonLoose        —— 宽松提取（剥 markdown 围栏、截取首个 { 到末个 }）
  ↓ 失败
  ↓ ② withJsonRepair          —— 调 LLM 做一次语法修复（temperature=0），再解析
  ↓ 失败
  ↓ ③ parseJsonTolerant       —— jsonTolerant.ts，逐级放宽（去尾逗号、补引号、去注释）
  ↓ 失败
  ↓ ④ 业务降级                 —— 如实报错 + 保留原始文本供人工核对，禁止把裸 JSON 写入正文
```

**已知缺陷（必须修）**：章节正文路径在"配图 JSON 解析失败"时会把含 `{"content":` 的外壳写进标书正文。

### 4.4 RAG 检索设计（知识库问答）

```
用户提问
  │
  ├─ ① 弹药库精确匹配 matchQaPair
  │     命中高置信 → 零成本直答（KB_QA_DIRECT_PREFIX，跳过 LLM）
  │                 用户可点"仍要问 AI"强制走 LLM
  │
  ├─ ② 本地 BM25 检索 searchKbDocs(scopeDocs, q, topN=5)
  │     分块体系：中文标题三级（markdown # / 章节条款 / 序号行）
  │     打分：tokenizeText → 词频 + 标题权重
  │
  ├─ ③ 0 命中 → 拒答 + 写入待补答队列（qaGapDedupeKey 同用户同问题去重）
  │
  └─ ④ 命中 → 拼上下文（【资料N】+ 标题 + 可见范围 + 标题路径）
              经 contextSnippetOf 脱敏（blocked 类文档绝不给原文）
              → chatViaGateway(system=KB_QA_SYSTEM_PROMPT, cacheable=true)
              → CitedAnswer 把 [资料N] 渲染为上标 chip
                 悬浮出摘录卡 / 点击经 citationFocus 跳原文定位
```

**分类与 AI 策略（`kbPolicy.ts`）**：

| 策略 | 含义 | 默认适用分类 |
|---|---|---|
| `original` | 允许把原文喂给 AI | 方案、技术、产品资料 |
| `sanitized_summary` | 只给脱敏摘要 | 合同商务、资质证书 |
| `blocked` | 完全禁止给 AI | 敏感文档 |

七档分类：方案 / 标书 / 技术 / 产品 / 政策 / 合同商务 / 资质证书（含敏感标记与检索权重）。

**性能硬要求**：列表只取轻量字段（`fields` 裁剪），正文单篇按需取；**首屏 ≤3 秒**；超出加载上限必须显式提示而非静默截断。

### 4.5 成本与缓存

| 机制 | 规则 |
|---|---|
| 成本确认 | 覆盖**全部**出站调用（含竞品、助手、情报打标）；文案说明费用归属；**目标状态：应显示预估金额区间** |
| 响应缓存 | 仅 `cacheable=true`（当前只有知识库问答）；口径 = 同模型 + 同完整 messages + 同参数；TTL 24h |
| 缓存失效 | 配置变更（模型/参数）后必须清缓存 |
| 缓存事务 | 单事务不得跨 `await`（当前缺陷：写缓存静默失效） |
| 幂等 | 出站重试必须带幂等键（当前缺陷：5xx 重试 3 次不带幂等键，可能重复计费） |
| 中断 | 所有可中断操作持 `AbortController`；`user_cancelled` 不报错 |

---

## 5. 关键数据流

### 5.1 招标文件解析（最重链路）

```
用户上传 PDF/DOCX
  → 浏览器本地解析（pdfjs-dist / mammoth）→ 纯文本
  → 分段（实测 845 页 → 63 段）
  → 逐段 chatViaGateway(page=bid-workspace, temperature=0, scope=bid-parse, max=8192)
      ├─ 成本确认（首次）
      ├─ 个人模型优先 → 平台兜底
      └─ 结构化输出容错链
  → 本地 validator 校验（clampParseSectionContent）
  → 合并 7 大分区 → 解析报告
  → 本地交叉核对（评分项扫描 / ★▲ 条款扫描）
  → 合规矩阵初始化
```

**耗时特征**：实测 63 段约 25 分钟。必须分批可见进度、可中断、失败段可单独重跑。

### 5.2 标书章节生成

```
事实表（全局一致性基准）
  + 大纲节点（含 [响应:Rx] 承接）
  + 知识库素材（经分类策略脱敏）
  + 风格规则 + 防翻车块 + 参数边界块 + 输出前自检块
  + 合规模式（strict / moderate / full）
        │
        ▼
  chatViaGateway(page=bid-workspace, max=8192)
        │
        ▼
  章节正文 → 字数预算校验（未达 90% 自动续写，最多 6 轮）
        │
        ▼
  配图编排（可选）
```

**多消息缓存序**：稳定大块（事实表 + 大纲上下文）置于首条 user，任务差异内容（本章目标）置后，以命中服务端前缀缓存。

### 5.3 情报到商机

```
定时任务（30 分钟）
  → 抓取各源 → 清洗（cleanIntelBody，剥离噪声行/HTML 实体）
  → 服务端去重 → 入库 intel_items
  → 用户浏览 → AI 打标（≤120 字摘要 + 类型/地区/标签）
  → 确认/忽略/收藏（每人独立）
  → 转商机：extractAmountYuan（万元/亿元换算，区间取下限）+ extractHospitalName
  → 生成深链 ?new_opp=1 → 客户管理预填
```

---

## 6. 导出子系统

**原则**：全部在浏览器端生成，不依赖服务端渲染；版式由格式设置驱动（R5 红线：不得改版式）。

| 产出 | 库 | 关键实现 |
|---|---|---|
| 投标文件 Word | `docx` | 字体 / 字号 / 行距 / 缩进 / 标题编号 / 目录 / 页眉页码 / 暗标不输出页码；正文全角空格分列自动转真表格；SVG 配图 → PNG（失败降级文字） |
| 解析报告 / 查重与废标报告 / 模拟评标报告 | `docx` | `exportReportDocx(kind=parse|dup_void|eval)` |
| 技术偏离表 Word | `docx` | 按来源章节分组表格 |
| 方案 Word | `docx` | 封面 + 目录 + 页眉 + 正文（排版由 `ssFmt` 生效） |
| 报价单 | `xlsx` + `docx` | Excel 含 SUM / 小计公式；Word 为表格报价单 |
| 建设清单 / 产品库 / 技术参数 | `xlsx` | 模板导出 / 导入 |
| 演示文稿 | `pptxgenjs` | 宽屏版式；封面 + 目录 + 内容 + 致谢；原生图表与 KPI；`injectTransitions` 注入 OOXML 切换动画 |
| 讲稿 | `docx` | — |
| 情报清单 | `xlsx` | — |
| 竞品对比矩阵 | CSV | 带 BOM 防乱码 |
| 一键全套 | — | `exportAllDocs` |

**parsing 侧**（导入）：`mammoth`（docx）/ `pdfjs-dist`（pdf，扫描版无效）/ `fflate`（pptx 只取 `<a:t>` 节点防 OOM）/ SheetJS（xlsx 逐表转 CSV）/ 原生文本。

---

## 7. 设计系统与主题

### 7.1 令牌体系

所有颜色通过 CSS 变量注入 `:root`（`src/index.css`），shadcn 组件自动换肤。

| 令牌组 | 变量 |
|---|---|
| 基础 | `--background` `--foreground` `--card` `--popover` `--border` `--input` `--ring` |
| 主色 | `--primary` `--primary-foreground` `--accent` `--accent-foreground` |
| 语义 | `--muted` `--muted-foreground` `--secondary` `--destructive` `--warning` |
| 图表 | `--chart-1` … `--chart-5` |
| 侧边栏 | `--sidebar-background` `--sidebar-foreground` `--sidebar-primary` `--sidebar-accent` `--sidebar-border` `--sidebar-ring` |
| 形状 | `--radius`（0–18px，默认 12） |

### 7.2 配色基线（当前「青蓝 cyan-blue」体系 v2）

| 语义 | 色值 | 用途 |
|---|---|---|
| 主色 | `#0E7C99` | 主按钮、选中态、图表主色 |
| 深主色 | `#0A5D76` | 强调文字 |
| 侧栏底色 | `#0B2830` | 深青蓝侧栏 |
| 暖橙强调 | `#E8973C` | warning、图表第 4 色 |
| 蓝 / 紫 | `#2E6FB0` / `#7B4FB0` | 图表第 2/3 色 |
| 风险红 | `#D64545` | destructive |
| 页面底 / 卡片 | `#EEF3F5` / `#FFFFFF` | — |
| 墨色 / 次级墨 | `#122A31` / `#4A6169` | 正文 / 辅助文字 |

### 7.3 外观设置项（`zx_appearance_v1`）

| 项 | 取值 |
|---|---|
| 模式 | 浅色 / 深色 |
| 调色板 | 7 预设（默认青蓝 / 海蓝 / 紫罗兰 / 暖橙 / 玫瑰 / 苔绿 / 石墨）+ 自定义取色 |
| 圆角 | 0–18px |
| 背景图 | 最多 6 张（压缩至 1600/1280，总预算 3.6M 字符）+ 当前选中 + 暗化 0–80 |

**注入时机**：`main.tsx` 在挂载前执行 `applyAppearance(loadAppearance())`，防首帧闪变。

### 7.4 硬性 UI 约束

| # | 约束 |
|---|---|
| 1 | 禁止硬编码颜色 / 圆角 / 字体，一律走令牌 |
| 2 | 弹窗 `max-height: 94vh + overflow-y: auto`，底部操作区 `sticky` |
| 3 | 长表单提交按钮必须可见 |
| 4 | 列表区分"本页数"与"真实总数"，超限标 `N+` |
| 5 | 空态必须有引导，失败必须可重试 |
| 6 | 主指标需在首屏可见（超过 1 次点击 = 设计缺陷） |
| 7 | 可中断的长操作必须有进度与取消入口 |
| 8 | 中文排版用 `system-ui` 族；中英混排用 `.cjk-latin` 类对齐 |

---

## 8. 已知技术债与架构决策记录（ADR）

### 8.1 ADR-001 · 不引入状态管理库

**决策**：保持 hook 内部 state + 深链 + 存储前缀的轻量方案。
**理由**：R6（不引入新依赖）+ 当前数据流以"页面级拉取-渲染"为主，无跨页面共享状态刚需。
**代价**：跨模块状态同步靠深链与存储，一致性靠约定。
**重建条件**：出现 ≥3 处"跨模块实时共享同一可变状态"的需求时，重新评估。

### 8.2 ADR-002 · 提示词内嵌于 TS 而非配置文件

**决策（现状）**：提示词以 TS 函数构造，与类型系统共享。
**问题**：导致 `bidTypes.ts` 膨胀至 370KB，改动成本高、无法版本对比。
**目标**：抽离到 `prompts/` 独立目录，保持 TS 函数形态（不走 JSON/YAML 配置，避免丢失类型与动态拼接能力）。

### 8.3 ADR-003 · Persistence 用 PocketBase 而非独立后端

**决策（现状）**：单机自用场景下，PocketBase 的零运维优势远大于其约定缺失的代价。
**代价**：36 份重复 CRUD 代码、无 schema 版本化、并发丢字段。
**缓解**：CRUD 工厂 + 乐观锁（第 5 批）。

### 8.4 ADR-004 · 导出在浏览器端完成

**决策（现状）**：所有 Word/Excel/PPT 生成在客户端。
**理由**：零服务端渲染负载；文档不上传，隐私友好。
**代价**：大文档生成占用浏览器内存；格式细节受客户端库能力限制。
**约束**：**版式是客户交付物，重构不得改动**（R5）。

### 8.5 ADR-005 · 知识库检索用本地 BM25 而非向量检索

**决策（现状）**：本地关键词检索，不引入 embedding 与向量库。
**理由**：零额外成本、零依赖、中文法律/技术文本的关键词匹配效果可接受；弹药库可覆盖高频问题。
**代价**：语义召回弱于向量检索。
**重建条件**：语义召回缺口被反复投诉，且用户明确授权引入向量方案。

### 8.6 技术债清单（按修复批次归档）

| 债务 | 位置 | 批次 |
|---|---|---|
| 遗留路由明文密钥 | `model_configs.pb.js` | 1 |
| 身份头可伪造 / IDOR / 前端隔离 | 各 `.pb.js`、`kbCore.ts` | 1 |
| 判定类任务未传 `temperature=0` | 6 处调用点 | 1 |
| 批量停止不可中断 | `useBidWorkspace.ts` | 1 |
| 成本确认未下沉 | `useCompetitorAnalysis.ts` / `useCompetitorTalks.ts` | 2 |
| 数据口径不一致（`totalItems`） | 多个 hook + 后端 | 2 |
| 合规模式未透传下游四判定器 | `bidTypes.ts` 四处 builder | 2 |
| 缓存事务跨 await | `llmCache.ts` | 2 |
| 零回归测试网 | 全项目 | 3 |
| 双账本断裂 + 台账漂移 | `.loop` / `.nightrun` | 3 |
| `bidTypes.ts` 370KB 单体 | `pages/BidWorkspace` | 4 |
| CRUD 重复 + 并发丢字段 | 36 个 `.pb.js` | 5 |
| schema 无版本化 | `pb_migrations/` 为空 | 5 |
| 知识库全量拉取 | `useKnowledge.ts` | 5 |

---

## 9. 安全设计现状与目标

### 9.1 现状（本机自用可控，联网即高危）

| 维度 | 现状 | 风险等级 |
|---|---|---|
| 密钥管理 | 遗留路由返回明文 `api_key`；配置页仅显示后四位（正确） | **高** |
| 身份认证 | 仅凭 `X-Rh-User-Id` 非空判定，可伪造 | **高** |
| 授权 | 业务接口不区分 admin/editor；高危路由无角色门 | **中高** |
| 归属校验 | 知识库 PATCH/DELETE 不校验归属（IDOR） | **中高** |
| 数据隔离 | 个人文档仅前端隔离 | **中高** |
| 入站限流 | 无 | 中 |
| 传输 | 仅 127.0.0.1，无 TLS | 低（本机） |

### 9.2 目标状态

```
① 密钥：任何响应体不含完整密钥；配置页仅后四位；前端不持有第三方 Key
② 认证：非本机形态校验 Bearer 解 uid；本机确认仅绑 127.0.0.1
③ 授权：高危路由集合加 role === "admin" 判定
④ 归属：所有 PATCH/DELETE 前置 zxIsOwner(rec, uid) 或 admin
⑤ 隔离：personal 资源在服务端 list 过滤
⑥ 幂等：LLM 出站带 Idempotency-Key
⑦ 限流：入站按 uid 限流（联网形态必需）
```

### 9.3 部署形态硬约束

- 本机形态：PocketBase **必须**只绑 `127.0.0.1`（不得绑 `0.0.0.0`）。
- 联网形态：上述 ①–⑦ 全部完成后才可暴露；且必须前置反向代理 + TLS。
- **重构期间不得改变当前单机部署契约**（R1 邻近约束）。

---

## 10. 可观测性

**现状**：几乎为零（依赖 `console.log` 与人工走查）。

**目标状态**：

| 维度 | 采集点 | 用途 |
|---|---|---|
| LLM 调用 | 模型 / page / scope / 耗时 / token / 成败 / 缓存命中 | 成本归因、性能优化 |
| 接口调用 | 路由 / 耗时 / 状态码 / uid | 定位慢接口与错误热点 |
| 业务事件 | 项目创建 / 解析完成 / 导出触发 / 结果登记 | 使用分析 |
| 前端错误 | 未捕获异常 + 组件边界 | 白屏预警 |
| 长任务 | 分段进度 / 中断点 / 失败段 | 大文件解析可恢复 |

**日志规范**：
- 统一出口，禁止散落 `console.log`。
- **禁止打印**：密钥、令牌、个人隐私、文档正文。
- 敏感字段统一脱敏（仅保留后四位 / 哈希前缀）。

---

**本文档为系统设计基线。任何架构级变更必须先更新本文档，并新增 ADR。**
