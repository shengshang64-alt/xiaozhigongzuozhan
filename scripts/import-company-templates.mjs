// scripts/import-company-templates.mjs — 公司标准化模版库（R-203）一次性导入
// 作用：
//   1) 把《03公司标准化模版》原件拷贝到 pocketbase/pb_data/template-library/（ASCII 存储名，pb_data 不入 git）
//   2) 模版元数据（场景标签/章节骨架/格式要点/使用说明）POST 到 /api/doc_templates
//   3) 规范/范本类文本内容 POST 到 /api/kb_docs（团队可见，小智助手与知识库问答自动可检索）
// 幂等：按 name / title 去重，重复执行只会更新拷贝文件与跳过已存在记录。
// 用法：先启动 PocketBase（127.0.0.1:7000），再 node scripts/import-company-templates.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SRC_DIR = "D:\\重要文件\\A重要客户情况\\08-公司标准库\\03公司标准化模版"
const LIB_DIR = path.join(ROOT, "pocketbase", "pb_data", "template-library")
const KB_JSON = path.join(ROOT, ".diag", "templates-kb-source.json")
const BASE = process.env.PB_BASE || "http://127.0.0.1:7000"

const COMPANY_FORMAT_SPEC = [
  "【公司文档格式规范要点（智业软件文档编辑使用规范 V2.1）】",
  "纸张：A4；页边距左2.8cm、右2.6cm、上下2.5cm；页眉页脚均1.6cm；页眉左Logo右文档标题（宋体小五）；页码页面底端居中（宋体小五），封面首页不同。",
  "正文：宋体小四、1.5倍行距、段前段后0、首行缩进2字符；不得用空格实现缩进/居中，不得用空段分页（用分页/分节功能）。",
  "标题：必须使用模板内置样式「标题1-9」「标准正文」「表注」「图注」，不得修改样式定义；导航窗格可快速定位。",
  "目录：正文超10页必须有目录，一般显示到三级；完稿后右击「更新域→更新整个目录」。",
  "编号体系：1. → 1) → a)（自动编号）；项目符号（⚫→➢→◼）仅用于简洁并列内容，其余默认编号。",
  "表格：页面内居中、不超页边距（技术偏离表可略微超）；标题行灰底宋体五号加粗居中、1.15倍行距；表内正文宋体五号垂直居中；须设「重复标题行」；首列序号用自动编号；序号/编号/单位/数量居中，名称/内容/备注左对齐，单价/金额右对齐；表格编号「表格 章-序」置表格上方居中并应用表注样式。",
  "图片：截图粘贴插入（勿直接插图片致文件过大）；嵌入型环绕、页面居中、大图调至页宽不超页边距；长文档图注「图 章-序」置于图片下方居中应用图注样式。",
  "Excel：超一屏冻结首行首列；打印用分页预览、设顶端标题行与页码总页数；单元格垂直居中。",
  "PPT：以智业名义的PPT必须用「附件5：智业PPT模板」，严格按模板版式制作、不新增版式；建议配 NordriTools/iSlide 插件。",
  "命名：文件名=日期-标题-版本号（例 2022.05.05-智业投标文件（***项目）V1.0.docx），日期月日单数补0。",
  "交付：给客户的商务/技术方案、PPT 原则上转 PDF 提交（给Word需部门经理同意）；总部投标文件完稿后发销售审核存档须PDF；代客户编写或双方合作文档可不转。",
].join("\n")

const BID_SKELETON = {
  说明: "附件1：word范本 —— 智业标准投标文件全文范本的章节骨架（编写技术标时按此结构组织）",
  结构: [
    { title: "投标函", children: [] },
    { title: "开标一览表", children: [] },
    { title: "投标分项报价表", children: [] },
    { title: "资质证明文件", children: [
      { title: "著作权证书", children: [] },
      { title: "信用查询", children: [] },
    ] },
    { title: "技术规格偏离表", children: [] },
    { title: "技术方案", children: [
      { title: "技术性能的详细描述", children: [
        { title: "医院信息集成平台", children: [{ title: "业务应用", children: [{ title: "病人信息集成视图360", children: [] }] }] },
        { title: "妇幼卫生检测", children: [] },
      ] },
      { title: "售后服务方案", children: [
        { title: "售后服务承诺", children: [] },
        { title: "售后服务原则", children: [] },
        { title: "服务方式", children: [] },
        { title: "重大技术问题处理", children: [
          { title: "处理原则", children: [] },
          { title: "应急响应预案", children: [
            { title: "响应策略", children: [] },
            { title: "应急响应管理", children: [] },
            { title: "应急服务流程", children: [] },
            { title: "角色分工与职责", children: [] },
            { title: "故障的响应时间", children: [] },
            { title: "各类规章制度保障", children: [] },
          ] },
        ] },
      ] },
    ] },
  ],
}

const TEMPLATES = [
  {
    name: "智业项目方案Word模板", scenario: "solution", kind: "word_template",
    file_name: "附件4：智业项目方案word模板.dotx", stored_name: "att4-solution-template.dotx",
    version: "2022.04.25", sort: 1,
    tags: ["方案", "建设规划方案", "模板", "dotx"],
    skeleton: {
      封面: { 行: ["******项目", "建设规划方案", "智业软件股份有限公司", "{年月日}"] },
      目录: true, 标题样式: "标题1-9（模板内置，编号自动生成）",
    },
    format_notes: "新建方案文档必须以此模板为基础（定义页眉页脚/封面/页边距/标题1-9与正文样式）。" + COMPANY_FORMAT_SPEC,
    usage_notes: "场景：方案编制（solution-studio）。导出 Word 前套用本模板样式；封面项目名替换为医院项目全称。系统内 AI 生成大纲/正文的编号与标题层级遵循本模板「标题只写名称、编号由系统生成」的约定。",
  },
  {
    name: "智业投标文件Word模板", scenario: "bid", kind: "word_template",
    file_name: "附件3：智业投标文件word模板.dotx", stored_name: "att3-bid-template.dotx",
    version: "2022.04.25", sort: 2,
    tags: ["投标文件", "模板", "封面", "dotx"],
    skeleton: {
      封面: { 行: ["正本（页眉右上角，黑体28号加字符底纹）", "****项目", "投标文件", "招标编号：", "货物名称：", "投标人名称：智业软件股份有限公司", "投标人地址：厦门软件园二期观日路24号404单元", "日 期： 年 月 日"] },
      目录: true, 标题样式: "标题1-9（模板内置）",
    },
    format_notes: "投标文件封面按招标要求调整，其余沿用公司规范。" + COMPANY_FORMAT_SPEC,
    usage_notes: "场景：标书工作（bid-workspace）。技术标大纲与正文导出以此模板为样式壳；封面「正本/副本」「招标编号」「货物名称」按招标公告填写。",
  },
  {
    name: "投标文件全文范本（投标函→技术方案）", scenario: "bid", kind: "sample",
    file_name: "附件1：word范本.dotx", stored_name: "att1-bid-sample.dotx",
    version: "2022", sort: 3,
    tags: ["投标函", "开标一览表", "分项报价", "资质证明", "技术偏离表", "技术方案", "售后服务"],
    skeleton: BID_SKELETON,
    format_notes: "含标题1-9样式应用示范（医院信息集成平台/售后服务方案实例文本可直接复用到售后章节）。",
    usage_notes: "场景：标书工作 + 报价。标书编写体例参照：投标函→开标一览表→投标分项报价表→资质证明文件（著作权证书/信用查询）→技术规格偏离表→技术方案（技术性能详细描述+售后服务方案）。报价部分的标准表式即「开标一览表」「投标分项报价表」，与系统产品报价库（product_library）字段可对应。",
  },
  {
    name: "报价表式（开标一览表+分项报价表）", scenario: "quote", kind: "sample",
    file_name: "附件1：word范本.dotx", stored_name: "att1-bid-sample.dotx",
    version: "2022", sort: 3,
    tags: ["报价", "开标一览表", "分项报价表", "表式"],
    skeleton: {
      表式: [
        "开标一览表（总价口径）",
        "投标分项报价表（明细行：序号/货物名称/规格型号/单位/数量/单价/金额/备注）",
      ],
    },
    format_notes: "报价表式规范：首列序号自动编号；序号/单位/数量居中，名称/备注左对齐，单价/金额右对齐；标题行灰底宋体五号加粗；表格编号「表格 章-序」置上方居中应用表注样式。价格数据取系统产品报价库（ONE-LINK 2025 第4.1版）。",
    usage_notes: "场景：PPT与报价（ppt-quote）。对外报价单采用范本内「开标一览表/投标分项报价表」结构；报价文件命名 日期-标题-版本号，提交客户须转 PDF。",
  },
  {
    name: "智业PPT模板", scenario: "ppt", kind: "ppt_template",
    file_name: "附件5：智业PPT模板.potx", stored_name: "att5-ppt-template.potx",
    version: "2022.04.24", sort: 4,
    tags: ["PPT", "模板", "汇报", "potx", "版式"],
    skeleton: { 母版: 1, 版式数: 29, 品牌语: ["智慧医疗 · 健康天下", "合智创新、诚信仁业", "知有合，则智无界，术有界，则业无疆"], 封面示例: ["{标题}分享", "{部门职务}", "{日期}"] },
    format_notes: "以智业名义的PPT必须以此模板制作，严格按模板内29个版式，不新增版式（保证跨PPT复制幻灯片格式统一）。",
    usage_notes: "场景：PPT与报价（ppt-quote）。AI 生成 PPT 大纲/逐页内容时按模板版式类型组织（封面页/目录页Part 01…/内容页/结尾页）；导出 pptx 时以本文件为母版壳。给客户和合作伙伴的PPT须转PDF。",
  },
  {
    name: "Excel范本（员工情况登记表）", scenario: "office", kind: "excel_template",
    file_name: "附件6：excle范本.xlsx", stored_name: "att6-excel-sample.xlsx",
    version: "2020", sort: 9,
    tags: ["Excel", "登记表", "行政"],
    skeleton: { sheets: ["表格1", "表格2"], 说明: "智业软件员工返厦或新入厦情况登记表（疫情期行政台账范式，含填写说明）" },
    format_notes: "Excel 通用要求：超一屏冻结首行首列；打印设顶端标题行与页码；单元格垂直居中。",
    usage_notes: "场景：通用行政（office）。项目驻场人员登记等表格可参照此表式；与报价无关（报价用附件1的开标一览表/分项报价表 + 公司产品报价库）。",
  },
  {
    name: "智业软件文档编辑使用规范 V2.1", scenario: "spec", kind: "spec",
    file_name: "2022.07.25-智业软件文档编辑使用规范V2.1.pdf", stored_name: "spec-doc-editing-v2.1.pdf",
    version: "V2.1", sort: 5,
    tags: ["规范", "格式", "Word", "Excel", "PPT", "命名", "PDF"],
    skeleton: { 章节: ["一、目的", "二、使用要求", "三、Word文档格式规范（整体/纸张/封面/目录/标题/正文/编号/项目符号/表格/图片）", "四、Excel文档风格要求", "五、PowerPoint文档风格要求", "六、Office文档保存要求", "附件一：封面格式（正规/投标）"] },
    format_notes: COMPANY_FORMAT_SPEC,
    usage_notes: "场景：全站通用。系统内所有 Word/PPT/Excel 生成与导出以本规范为格式基准；给客户的交付物按规范转 PDF。",
  },
  {
    name: "建设规划方案封面示例", scenario: "solution", kind: "sample",
    file_name: "建设规划方案-智业软件-20220425.docx", stored_name: "solution-cover-example.docx",
    version: "2022.04.25", sort: 6,
    tags: ["方案", "封面", "示例"],
    skeleton: { 封面: ["******项目", "建设规划方案", "智业软件股份有限公司", "2022年04月25日"] },
    format_notes: "与附件4同壳，展示封面成稿效果。",
    usage_notes: "场景：方案编制。核对封面版式（标题黑体初号居中加粗、深色50%、1.5倍行距）时的样例。",
  },
  {
    name: "电子邮件签名规范", scenario: "email", kind: "spec",
    file_name: "智业软件电子邮件签名规范.docx", stored_name: "email-signature-spec.docx",
    version: "2022", sort: 7,
    tags: ["邮件", "签名", "商务沟通"],
    skeleton: { 签名要素: ["姓名", "职位", "智业软件股份有限公司", "总机：86-592-5205120", "传真：86-592-5393996", "直线：86-592-XXXXXXX", "手机", "地址：厦门市软件园二期观日路20号之2", "www.zoesoft.com.cn", "400-858-0996"] },
    format_notes: "签名图片无法直接复制的邮箱（如QQ邮箱）使用规范内提供的网络照片链接。",
    usage_notes: "场景：客户管理/商务沟通。给客户的邮件落款统一用此签名（直接复制、替换姓名职位后使用）。",
  },
  {
    name: "Word小技巧17则", scenario: "office", kind: "guide",
    file_name: "附件2：word小技巧.docx", stored_name: "att2-word-tips.docx",
    version: "2022", sort: 8,
    tags: ["Word", "技巧", "培训", "排版"],
    skeleton: { 目录: ["纸张方向切换", "纸张分页", "大章节文字复制", "表格标题重复出现", "表格插入索引页码", "快速清除错误的选择框", "自动调整表格大小", "精确的调整表格宽度", "精确删除不要的部分内容", "快速插入行", "快速拆分表格", "万能F4键", "一键文本分两边", "框架标题自动分页", "快速清除格式", "批量导出Word中的图片"] },
    format_notes: "",
    usage_notes: "场景：团队培训（office）。标书/方案排版遇到问题先查本技巧集（表格标题重复、拆分表格、批量导出图片等与规范条款直接相关）。",
  },
]

const MATCH_TABLE_DOC = [
  "公司标准化模版 · 场景匹配速查（智业软件标准库 03）",
  "",
  "【方案编制】新建方案用《附件4：智业项目方案word模板.dotx》（封面：{项目名}/建设规划方案/公司名/日期）；封面成稿效果参照《建设规划方案-智业软件-20220425.docx》。标题一律用模板内置「标题1-9」样式，编号由系统生成。",
  "【标书工作】样式壳用《附件3：智业投标文件word模板.dotx》（正本/招标编号/货物名称/投标人要素齐全）；编写体例与章节组织参照《附件1：word范本.dotx》：投标函→开标一览表→投标分项报价表→资质证明文件→技术规格偏离表→技术方案（技术性能详细描述+售后服务方案）。售后服务承诺/应急响应预案/故障响应时间等段落可直接复用范本内容。",
  "【报价】对外报价表式采用范本中的「开标一览表」「投标分项报价表」结构（序号/货物名称/规格/单位/数量/单价/金额/备注，首列自动编号，单价金额右对齐）；价格数据来源系统「产品报价库」（549 条，ONE-LINK 2025第4.1版）。",
  "【PPT】以智业名义的 PPT 一律基于《附件5：智业PPT模板.potx》（1母版+29版式，禁止新增版式）；品牌语「智慧医疗 · 健康天下」。给客户的 PPT 须转 PDF。",
  "【通用格式】所有文档遵循《2022.07.25-智业软件文档编辑使用规范V2.1》：A4、页边距左2.8右2.6上下2.5、正文宋体小四1.5倍行距首行缩进2字符、编号体系1.→1)→a)、表格标题行灰底五号加粗+重复标题行、图注表格编号「图/表格 章-序」、文件命名 日期-标题-版本号。",
  "【邮件】对外邮件签名用《智业软件电子邮件签名规范.docx》（复制后替换姓名/职位/直线/手机）。",
  "【排版答疑】Word 排版问题查《附件2：word小技巧.docx》（17则）。",
  "",
  "以上模板原件均可在系统「模版库 API」/api/doc_templates 按场景（solution/bid/ppt/quote/office/spec/email）查询并下载。",
].join("\n")

function loadKbSource() {
  try {
    return JSON.parse(fs.readFileSync(KB_JSON, "utf8"))
  } catch {
    console.warn("[warn] 缺 .diag/templates-kb-source.json（先运行 python .diag/extract_kb_json.py），文本类 kb 文档将跳过部分内容")
    return null
  }
}

async function api(p, init) {
  const res = await fetch(`${BASE}${p}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { /* 非 JSON */ }
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${p} → ${res.status}: ${text.slice(0, 200)}`)
  return data
}

async function main() {
  fs.mkdirSync(LIB_DIR, { recursive: true })
  const kbSrc = loadKbSource()

  // 1) 拷贝原件（ASCII 存储名）
  for (const t of TEMPLATES) {
    const src = path.join(SRC_DIR, t.file_name)
    const dst = path.join(LIB_DIR, t.stored_name)
    if (!fs.existsSync(src)) { console.warn(`[skip-copy] 原件不存在: ${t.file_name}`); continue }
    fs.copyFileSync(src, dst)
    console.log(`[copy] ${t.file_name} → template-library/${t.stored_name} (${fs.statSync(dst).size}B)`)
  }

  // 2) doc_templates 元数据（按 name 幂等）
  const existingT = await api("/api/doc_templates?perPage=200")
  const byName = new Map((existingT.items || []).map((r) => [r.name, r]))
  for (const t of TEMPLATES) {
    if (byName.has(t.name)) { console.log(`[kb-skip] 模版已存在: ${t.name}`); continue }
    await api("/api/doc_templates", { method: "POST", body: JSON.stringify(t) })
    console.log(`[kb-ok] 模版入库: ${t.name} (scenario=${t.scenario})`)
  }

  // 3) kb_docs 文本知识（按 title 幂等）
  const existingK = await api("/api/kb_docs?perPage=200")
  const kTitles = new Set((existingK.items || []).map((r) => r.title))
  const kbDocs = [
    {
      title: "智业软件文档编辑使用规范 V2.1（全文）",
      folder_path: "公司标准模版/规范制度", doc_format: "pdf转译", visibility: "team",
      doc_category: "其他", keywords: ["文档规范", "格式", "Word", "表格", "图注", "命名", "PDF交付"],
      source_file_name: "2022.07.25-智业软件文档编辑使用规范V2.1.pdf",
      summary: "公司文档格式权威规范：纸张页边距、标题样式、正文编号体系、表格图注、Excel/PPT风格、文件命名与对客PDF交付要求。",
      content: kbSrc ? kbSrc.spec_doc_norm : COMPANY_FORMAT_SPEC,
    },
    {
      title: "投标文件全文范本（附件1：word范本）",
      folder_path: "公司标准模版/标书范本", doc_format: "docx", visibility: "team",
      doc_category: "技术方案", keywords: ["投标文件", "投标函", "开标一览表", "技术偏离表", "售后服务", "应急响应"],
      source_file_name: "附件1：word范本.dotx",
      summary: "智业标准投标文件完整体例与示范正文：投标函、开标一览表、分项报价表、资质证明、技术偏离表、技术方案（含集成平台样例与售后服务/应急售后全文）。",
      content: kbSrc ? kbSrc.att1_bid_sample : JSON.stringify(BID_SKELETON),
    },
    {
      title: "Word小技巧17则（公司标准附件2）",
      folder_path: "公司标准模版/操作技巧", doc_format: "docx", visibility: "team",
      doc_category: "其他", keywords: ["Word技巧", "排版", "表格", "分页", "导出图片"],
      source_file_name: "附件2：word小技巧.docx",
      summary: "标书/方案排版常用 Word 操作技巧全集。",
      content: kbSrc ? kbSrc.att2_word_tips : "",
    },
    {
      title: "智业软件电子邮件签名规范",
      folder_path: "公司标准模版/规范制度", doc_format: "docx", visibility: "team",
      doc_category: "其他", keywords: ["邮件签名", "对外沟通", "联系方式"],
      source_file_name: "智业软件电子邮件签名规范.docx",
      summary: "对外邮件统一签名格式与示例（含QQ邮箱网络logo链接方案）。",
      content: kbSrc ? kbSrc.email_sig : "",
    },
    {
      title: "公司标准化模版·场景匹配速查",
      folder_path: "公司标准模版", doc_format: "md", visibility: "team",
      doc_category: "技术方案", keywords: ["模板", "场景匹配", "方案", "标书", "PPT", "报价", "规范"],
      source_file_name: "03公司标准化模版（目录整理）",
      summary: "哪类交付物用哪个模板：方案/标书/报价/PPT/邮件/排版的模版选择与格式基准速查表。",
      content: MATCH_TABLE_DOC,
    },
  ]
  for (const d of kbDocs) {
    if (!d.content) { console.warn(`[kb-skip] 无内容: ${d.title}`); continue }
    if (kTitles.has(d.title)) { console.log(`[kb-skip] 已存在: ${d.title}`); continue }
    await api("/api/kb_docs", {
      method: "POST",
      body: JSON.stringify({ rh_user_id: "local-user", uploader_name: "标准库导入", ai_context_mode: "", retrieval_weight: 1.2, is_sensitive: false, ...d }),
    })
    console.log(`[kb-ok] 知识入库: ${d.title} (${d.content.length}字)`)
  }

  // 4) 汇总
  const afterT = await api("/api/doc_templates?perPage=200")
  console.log(`\n完成：doc_templates 共 ${afterT.items.length} 条，模版目录 ${fs.readdirSync(LIB_DIR).length} 个文件。`)
}

main().catch((err) => { console.error(err); process.exit(1) })
