/* ============================================================================
   小智工作站 · 静态原型清单（唯一真源 manifest）
   ---------------------------------------------------------------------------
   任何页面 / 导航 / 屏内切换 / 前后翻页都从本文件推导，禁止在页面里硬编码导航。
   一条 screen = 一个独立的 HTML 文件 = 一张可交付评审的静态界面。
   ========================================================================== */
window.PROTO = {
  meta: {
    title: "小智工作站 · 全量界面重构静态原型",
    version: "v2.0",
    date: "2026-11-08",
    baseline: "本地 localhost:8000 线上 17 路由实测（DOM/滚动高度/控件数折算）",
    author: "产品 / UI / 前端三方联合重构稿",
  },

  /* ---- 侧栏分组：顺序即信息架构顺序 ---- */
  nav: [
    {
      group: "今日 · 工作台",
      items: [{ mod: "home", label: "工作台总览", icon: "grid", badge: "" }],
    },
    {
      group: "客户 · 线索",
      items: [
        { mod: "customer", label: "客户管理", icon: "users", badge: "12" },
        { mod: "intel", label: "情报中心", icon: "search", badge: "29" },
      ],
    },
    {
      group: "方案 · 标书 · 汇报",
      items: [
        { mod: "solution", label: "方案工作室", icon: "fileText", badge: "" },
        { mod: "mapping", label: "产品映射", icon: "arrowLR", badge: "" },
        { mod: "ppt", label: "PPT 与报价", icon: "monitor", badge: "" },
        { mod: "material", label: "素材库", icon: "images", badge: "" },
        { mod: "bid", label: "标书工作台", icon: "fileCheck", badge: "3" },
        { mod: "check", label: "标书检查", icon: "clipboard", badge: "" },
        { mod: "format", label: "格式刷新", icon: "type", badge: "" },
      ],
    },
    {
      group: "资产 · 沉淀",
      items: [
        { mod: "kb", label: "知识库", icon: "book", badge: "" },
        { mod: "qual", label: "资质台账", icon: "shield", badge: "4" },
        { mod: "competitor", label: "竞品分析", icon: "building", badge: "" },
        { mod: "assistant", label: "小智助手", icon: "bot", badge: "" },
      ],
    },
    {
      group: "系统 · 团队",
      items: [
        { mod: "model", label: "模型配置", icon: "settings", badge: "" },
        { mod: "team", label: "团队管理", icon: "userCog", badge: "" },
      ],
    },
  ],

  /* ---- 每个模块下的屏（顺序即屏内 Tab 顺序，也是「上一屏/下一屏」顺序） ---- */
  mods: {
    home: {
      label: "工作台总览",
      group: "今日 · 工作台",
      note: "原「首页」14 个区块 → 4 屏。总览只回答『今天该干什么』，其余按任务/时间/复盘各归其位。",
      screens: [
        { id: "home", file: "home/index.html", tab: "总览", desc: "预警 + 今日优先任务 + 进行中事项 + 快捷入口（一屏半内）" },
        { id: "home-tasks", file: "home/tasks.html", tab: "待办中心", desc: "全部待办：按来源/优先级/时间分组，支持批量改期与认领" },
        { id: "home-calendar", file: "home/calendar.html", tab: "投标节点", desc: "月度时间轴：开标/答疑/保证金/澄清 四类节点" },
        { id: "home-review", file: "home/review.html", tab: "投标复盘", desc: "中标率漏斗 + 废标原因聚类 + 单项目复盘" },
      ],
    },
    customer: {
      label: "客户管理",
      group: "客户 · 线索",
      note: "原「列表 + 详情 + 看板 + 表格 + 批量补全」全部堆在一页（12,513px / 15 屏）→ 拆成列表页与详情页两个路由，看板/跟进独立成屏。",
      screens: [
        { id: "customer-list", file: "customer/list.html", tab: "客户列表", desc: "全宽表格 + 健康度数据条 + 缺项可点（原右侧半屏空白已消除）" },
        { id: "customer-detail", file: "customer/detail.html", tab: "客户详情", desc: "独立路由：档案 / 联系人 / 商机 / 跟进时间线 四栏同屏" },
        { id: "customer-kanban", file: "customer/kanban.html", tab: "商机看板", desc: "线索→初访→需求→方案→投标 五列，可拖动改阶段" },
        { id: "customer-followup", file: "customer/followup.html", tab: "跟进队列", desc: "该唤醒谁：超 30/60/90 天未跟进分组 + 一键建跟进" },
        { id: "customer-import", file: "customer/import.html", tab: "导入与体检", desc: "批量导入向导 + 缺失字段补全（影响范围预算先行）" },
      ],
    },
    intel: {
      label: "情报中心",
      group: "客户 · 线索",
      note: "原「3,600px 单页 + 两级筛选并存 + 5 个同级操作」→ 审阅/浏览 双模式拆屏，数据源设置与 AI 动态并入本模块频道。",
      screens: [
        { id: "intel-review", file: "intel/review.html", tab: "审阅", desc: "待确认工作台：左列表右详情，键盘 J/K 逐条确认" },
        { id: "intel-browse", file: "intel/browse.html", tab: "浏览", desc: "全部情报紧凑表：主筛选一行 + 高级筛选抽屉" },
        { id: "intel-detail", file: "intel/detail.html", tab: "详情", desc: "正文清洗后阅读视图 + 转商机/转标书/标重点" },
        { id: "intel-industry", file: "intel/industry.html", tab: "行业前沿", desc: "原 /ai-hot 并入：按医疗信息化主题订阅的行业资讯" },
        { id: "intel-sources", file: "intel/sources.html", tab: "数据源", desc: "源健康度、抓取频率、失败原因（原首屏蓝色说明书改归档于此）" },
      ],
    },
    solution: {
      label: "方案工作室",
      group: "方案 · 标书 · 汇报",
      note: "原「列表 + 类型说明 + 行业系统库 + 模板下载 + 编辑器」挤一页（25 个页内标题 / 918 个按钮）→ 列表、编辑器、建设清单、交付检查 四屏分离。",
      screens: [
        { id: "solution-list", file: "solution/list.html", tab: "方案列表", desc: "数据条替代三卡 + 折叠教学信息 + 卡片操作分层" },
        { id: "solution-editor", file: "solution/editor.html", tab: "方案编辑器", desc: "三栏：大纲树 / 正文编辑 / 需求覆盖与自检（原编辑器贴在列表下方）" },
        { id: "solution-checklist", file: "solution/checklist.html", tab: "建设清单", desc: "立项清单：系统清单→章节映射→金额，独立成屏" },
        { id: "solution-delivery", file: "solution/delivery.html", tab: "交付检查", desc: "需求覆盖率 / 事实接地 / 导出门禁 三栏体检" },
      ],
    },
    mapping: {
      label: "产品映射",
      group: "方案 · 标书 · 汇报",
      note: "原「两层 Tab 叠加 + 结果区一行小字」→ 明确三步向导：选清单 → 对照 → 结果，产品库/记忆库从 Tab 提到工具区。",
      screens: [
        { id: "mapping-upload", file: "mapping/upload.html", tab: "① 选择清单", desc: "三来源卡片（上传/粘贴/关联需求）+ 示例占位样式" },
        { id: "mapping-compare", file: "mapping/compare.html", tab: "② 对照", desc: "左右分栏：左原文行，右候选产品，中间置信度" },
        { id: "mapping-result", file: "mapping/result.html", tab: "③ 结果", desc: "对照结果表 + 评分覆盖 + 导出（结果区成为视觉主角）" },
        { id: "mapping-library", file: "mapping/library.html", tab: "产品库", desc: "公司库 / 记忆库 / 导入 ONE-LINK 合并为一个资产页" },
      ],
    },
    ppt: {
      label: "PPT 与报价",
      group: "方案 · 标书 · 汇报",
      note: "原「PPT 与报价挤同一页两个 Tab，标题不随 Tab 变」→ 拆成 PPT 线（列表/编辑器）与报价线（列表/编辑/预览）两条独立路径。",
      screens: [
        { id: "ppt-list", file: "ppt/list.html", tab: "汇报 PPT", desc: "PPT 列表：模板、页数、最近编辑、生成状态" },
        { id: "ppt-editor", file: "ppt/editor.html", tab: "PPT 编辑器", desc: "左页序 / 中画布 / 右属性与素材，底部一致性检查" },
        { id: "quote-list", file: "ppt/quote-list.html", tab: "报价清单", desc: "报价列表：金额、折扣、有效期、毛利" },
        { id: "quote-editor", file: "ppt/quote-editor.html", tab: "报价编辑", desc: "明细表：数量/单价/折扣/税，右侧实时合计与建议价" },
        { id: "quote-preview", file: "ppt/quote-preview.html", tab: "报价单预览", desc: "对外报价单版式预览 + 用印信息 + 导出" },
      ],
    },
    material: {
      label: "素材库",
      group: "方案 · 标书 · 汇报",
      note: "原「四个 Tab（含回收站/联网抓取）」→ 单视图 + 两个动作按钮；抓取与导入变流程屏，设置与回收站归设置屏。",
      screens: [
        { id: "material-list", file: "material/list.html", tab: "素材总览", desc: "默认视图：使用排行 + 分类 + 列表（回收站为 0 时隐藏）" },
        { id: "material-import", file: "material/import.html", tab: "导入", desc: "本地导入：拖拽区 + 自动分类 + 重复检测" },
        { id: "material-web", file: "material/web.html", tab: "联网抓取", desc: "关键词抓取：来源、版权提示、批量入库" },
        { id: "material-settings", file: "material/settings.html", tab: "库设置", desc: "分类体系 / 存储占用 / 回收站（危险操作二次确认）" },
      ],
    },
    bid: {
      label: "标书工作台",
      group: "方案 · 标书 · 汇报",
      note: "核心生产链：原「列表 + 七步流水线全部内联在一个页面」→ 列表页 + 七步各自独立屏（每屏承载一类决策，不跨步混排）。",
      screens: [
        { id: "bid-list", file: "bid/list.html", tab: "项目列表", desc: "项目卡带七步微缩进度，一眼看出卡在哪步" },
        { id: "bid-import", file: "bid/import.html", tab: "① 导入招标", desc: "招标文件上传/多包件/编号校验，重复项目拦截" },
        { id: "bid-parse", file: "bid/parse.html", tab: "② 解析确认", desc: "评分办法、废标条款、技术参数、时间节点四类结果分栏确认" },
        { id: "bid-outline", file: "bid/outline.html", tab: "③ 大纲编制", desc: "大纲树 + 评分点覆盖热力 + 层级校验" },
        { id: "bid-draft", file: "bid/draft.html", tab: "④ 正文编写", desc: "章节树 / 编辑器 / 右侧合规与去AI味检查三栏" },
        { id: "bid-deviation", file: "bid/deviation.html", tab: "⑤ 偏离表", desc: "技术偏离表：逐条应答、正负偏离、分页与组头" },
        { id: "bid-check", file: "bid/check.html", tab: "⑥ 交卷自查", desc: "废标项/一致性/暗标/格式 四类闸门，未过不许导出" },
        { id: "bid-export", file: "bid/export.html", tab: "⑦ 组卷导出", desc: "组卷顺序、页眉页脚、封面盖章位、导出清单" },
        { id: "bid-rehearse", file: "bid/rehearse.html", tab: "模拟答辩", desc: "评委问题预测 + 应答要点 + 讲标稿" },
        { id: "bid-archive", file: "bid/archive.html", tab: "归档复盘", desc: "开标结果回填、中标/落标归因、进入复盘" },
      ],
    },
    check: {
      label: "标书检查",
      group: "方案 · 标书 · 汇报",
      note: "工具型页面：原「两个等宽入口 + 哑巴禁用按钮 + 下方 60% 空白」→ 单入口上传 + 运行态 + 报告 + 历史四屏。",
      screens: [
        { id: "check-upload", file: "check/upload.html", tab: "新建检查", desc: "单一上传区 + 模式单选卡（带说明）+ 最近报告" },
        { id: "check-running", file: "check/running.html", tab: "检查中", desc: "进度：规则包逐项执行，可取消，已发现问题实时冒出" },
        { id: "check-report", file: "check/report.html", tab: "检查报告", desc: "问题清单分级 + 原文定位 + 一键生成批注 docx" },
        { id: "check-history", file: "check/history.html", tab: "历史报告", desc: "历史检查可复访、可对比两次差异" },
      ],
    },
    format: {
      label: "格式刷新",
      group: "方案 · 标书 · 汇报",
      note: "原页面步骤条是好的，问题在「安全长文堆在右侧」与「按钮先后无暗示」→ 拆成上传选模板 / 预览套用 两屏。",
      screens: [
        { id: "format-upload", file: "format/upload.html", tab: "① 上传与模板", desc: "上传 + 模板选择 + 刷新范围，长说明改为角标提示" },
        { id: "format-preview", file: "format/preview.html", tab: "② 预览套用", desc: "左右对比预览 + 带序号的套用与导出，覆盖前二次确认" },
      ],
    },
    kb: {
      label: "知识库",
      group: "资产 · 沉淀",
      note: "原「两个搜索框 + AnyTXT 长警告 + 数字 Tab」→ 单搜索入口 + 六个专门视图（文档/检索/原子/审核/问答/上传）。",
      screens: [
        { id: "kb-browse", file: "kb/browse.html", tab: "文档库", desc: "目录树可调宽 + 文档卡带『被引用 N 次』" },
        { id: "kb-search", file: "kb/search.html", tab: "全文检索", desc: "单入口搜索：标题命中/正文命中两组结果" },
        { id: "kb-atoms", file: "kb/atoms.html", tab: "知识原子", desc: "可复用事实单元：适用场景、冲突提示、引用次数" },
        { id: "kb-review", file: "kb/review.html", tab: "原子审核", desc: "抽取结果逐条采纳/改写/丢弃（原独立页面保留）" },
        { id: "kb-qa", file: "kb/qa.html", tab: "问知识库", desc: "问答：命中来源可溯源，未命中与真无资料区分" },
        { id: "kb-upload", file: "kb/upload.html", tab: "上传文档", desc: "上传 + 分类 + 解析状态 + 历史记录" },
      ],
    },
    qual: {
      label: "资质台账",
      group: "资产 · 沉淀",
      note: "业务价值最实的页面（防废标）：原「五卡同权重 + 预警不能定位行」→ 风险分档 + 预警直达行 + 批量登记。",
      screens: [
        { id: "qual-list", file: "qual/list.html", tab: "台账", desc: "风险四档着色 + 未登记有效期（25 张）升为红色警报" },
        { id: "qual-alerts", file: "qual/alerts.html", tab: "预警处理", desc: "到期预警逐条处理：定位行、续期、标记不适用" },
        { id: "qual-bulk", file: "qual/bulk.html", tab: "批量登记", desc: "批量登记有效期：选择行 → 统一日期 → 预览影响" },
      ],
    },
    competitor: {
      label: "竞品分析",
      group: "资产 · 沉淀",
      note: "原「市场总览为默认 Tab」→ 默认应标视角（售前真正要的），市场/对标/档案为支撑视图。",
      screens: [
        { id: "competitor-bidview", file: "competitor/bidview.html", tab: "应标视角", desc: "输入医院/项目 → 历史中标厂商 Top3 + 价格区间 + 参数倾向" },
        { id: "competitor-market", file: "competitor/market.html", tab: "市场总览", desc: "市场规模与份额（行业研究视角，降级为第二 Tab）" },
        { id: "competitor-benchmark", file: "competitor/benchmark.html", tab: "能力对标", desc: "产品能力矩阵 + 评分项对标 + 差异说明" },
        { id: "competitor-profile", file: "competitor/profile.html", tab: "厂商档案", desc: "单厂商档案：中标记录、常用参数、报价区间、话术" },
      ],
    },
    assistant: {
      label: "小智助手",
      group: "资产 · 沉淀",
      note: "对话形态没问题，问题在「价值证明不足 + 会话不可检索」→ 三屏：会话 / 记忆 / 技能，并把能力边界前置。",
      screens: [
        { id: "assistant-chat", file: "assistant/chat.html", tab: "会话", desc: "上下文感知快捷问 + 自动会话命名 + 能力卡片区" },
        { id: "assistant-memory", file: "assistant/memory.html", tab: "记忆", desc: "长期记忆条目：可编辑、可失效、可看来源" },
        { id: "assistant-skills", file: "assistant/skills.html", tab: "技能", desc: "技能库：输入输出示例、可挂到流程节点" },
      ],
    },
    model: {
      label: "模型配置",
      group: "系统 · 团队",
      note: "管理员低频页：原「常驻红色不可用警告 + 设为默认无确认」→ 折叠灰卡 + 改默认二次确认 + 健康看板。",
      screens: [
        { id: "model-channels", file: "model/channels.html", tab: "通道与默认", desc: "通道分组（线上可用/本地不可用折叠）+ 默认模型链" },
        { id: "model-health", file: "model/health.html", tab: "健康看板", desc: "24h 调用量/成功率/P95 耗时/费用，按功能维度" },
        { id: "model-test", file: "model/test.html", tab: "连通测试", desc: "测试面板：prompt、首字延迟、流式回显、错误人话化" },
      ],
    },
    team: {
      label: "团队管理",
      group: "系统 · 团队",
      note: "原「成员列表 + 角色下拉 + 停用无确认 + 乱码成员」→ 三屏：成员 / 角色权限 / 设置与审计。",
      screens: [
        { id: "team-members", file: "team/members.html", tab: "成员", desc: "成员表：最近登录、角色、状态；停用走确认；测试账号分组" },
        { id: "team-roles", file: "team/roles.html", tab: "角色权限", desc: "三个角色各能做什么，用权限矩阵说清" },
        { id: "team-settings", file: "team/settings.html", tab: "设置与审计", desc: "团队信息、登录策略、操作审计日志" },
      ],
    },
  },

  /* ---- 顶栏标签栏：静态模拟已经打开的标签 ---- */
  openTabs: ["home", "bid-list", "customer-list", "intel-review"],

  /* ---- 交付说明（给评审人看的改动账） ---- */
  changes: [
    { from: "工作台总览（14 区块 / 2,958px）", to: "4 屏：总览 / 待办中心 / 投标节点 / 投标复盘", why: "首页只回答『今天干什么』，其余按任务、时间、复盘各归其位" },
    { from: "客户管理（单页 12,513px / 15 屏）", to: "5 屏：列表 / 详情(独立路由) / 商机看板 / 跟进队列 / 导入体检", why: "列表与详情必须可分屏、可分享链接；右侧半屏空白消除" },
    { from: "情报中心（3,600px，两级筛选）", to: "5 屏：审阅 / 浏览 / 详情 / 行业前沿(原 AI 动态) / 数据源", why: "『处理』与『浏览』是互斥心智，不能同屏；说明书归设置" },
    { from: "方案工作室（918 按钮 / 25 标题）", to: "4 屏：列表 / 编辑器 / 建设清单 / 交付检查", why: "生产线与教学信息、清单、体检不该同屏" },
    { from: "产品映射（两层 Tab + 结果一行小字）", to: "4 屏：选清单 / 对照 / 结果 / 产品库", why: "向导型任务要显式三步，结果区必须是主角" },
    { from: "PPT 与报价（两业务挤两个 Tab）", to: "5 屏：PPT 列表 / PPT 编辑 / 报价列表 / 报价编辑 / 报价预览", why: "两条业务线互不干扰，标题与统计随视图联动" },
    { from: "素材库（4 Tab，含回收站）", to: "4 屏：总览 / 导入 / 联网抓取 / 库设置", why: "抓取是动作不是视图；危险项归设置" },
    { from: "标书工作台（列表 + 七步内联）", to: "10 屏：列表 + ①~⑦ + 模拟答辩 + 归档复盘", why: "每一步是一类决策，独立成屏才能给出足够工作区" },
    { from: "标书检查（头重脚轻单页）", to: "4 屏：新建 / 检查中 / 报告 / 历史", why: "工具页应三步完成，报告要可复访可对比" },
    { from: "格式刷新（两侧长文）", to: "2 屏：上传选模板 / 预览套用", why: "安全说明在『点套用』时以确认弹窗呈现，而非常驻长文" },
    { from: "知识库（两个搜索框 + 数字 Tab）", to: "6 屏：文档库 / 检索 / 原子 / 审核 / 问答 / 上传", why: "检索单入口；知识原子是资产，应有一等公民视图" },
    { from: "资质台账（五卡同权重）", to: "3 屏：台账 / 预警处理 / 批量登记", why: "风险分档 + 预警直达行 + 25 张未登记批量补救" },
    { from: "竞品分析（默认市场总览）", to: "4 屏：应标视角 / 市场 / 能力对标 / 厂商档案", why: "售前要的是『这标谁可能来、报多少』，不是行业研报" },
    { from: "小智助手（会话/记忆/技能 Tab 同屏）", to: "3 屏：会话 / 记忆 / 技能", why: "记忆与技能是差异化资产，值得独立空间" },
    { from: "模型配置（2,791px 单页）", to: "3 屏：通道与默认 / 健康看板 / 连通测试", why: "低频配置页要让人安心：折叠不可用项、默认变更需确认" },
    { from: "团队管理（单表 + 角色下拉）", to: "3 屏：成员 / 角色权限 / 设置与审计", why: "权限差异用矩阵说清；停用等危险操作二次确认" },
  ],
}
