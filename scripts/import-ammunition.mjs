// R-206 第二批：投标「弹药库」结构化速查入库（09-招投标培训学习库 / 05资质·06案例业绩·07人员）
//
// 素材原件几乎都是扫描件（pdf/jpg/证书图），逐个解析二进制不现实、也无必要。
// 本脚本扫描目录清单，为每一类弹药生成一份「速查清单」Markdown 入库：
//   - 文件名/有效期/覆盖区间本身即承载关键信息（我们有哪些证、哪些软著、哪些业绩、项目组有哪些人证）
//   - 只入清单（=对敏感原件的安全蒸馏），绝不把证书原件写进系统
// 口径（用户既定：敏感仅自己可见）：
//   - is_sensitive=true, visibility=personal（访问控制：仅本人）
//   - ai_context_mode=original（清单本身已脱敏蒸馏，可安全喂 AI）、retrieval_weight=1.2（投标高权重）
//   - doc_category：资质证书 / 项目案例
//   - 幂等键 source_file_name=ammunition:<id>，可反复重跑
// 用法：PocketBase 需在 127.0.0.1:7000 运行，node scripts/import-ammunition.mjs
import fs from "node:fs"
import path from "node:path"

const BASE = "http://127.0.0.1:7000"
const ROOT = "D:\\重要文件\\A重要客户情况\\09-招投标培训学习库"
const LOCAL_USER = "local-user" // 本地部署共享池身份（rhLogin.ts LOCAL_DEPLOY_USER_ID）

/** 递归列出目录内文件（跳过 Thumbs.db/desktop.ini 等系统噪声） */
function walk(dir) {
  const out = []
  let es
  try { es = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return out }
  for (const e of es) {
    const fp = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(fp))
    else if (!/^(Thumbs\.db|desktop\.ini)$/.test(e.name) && !e.name.endsWith(".db")) {
      out.push({ name: e.name, rel: path.relative(ROOT, fp), size: fs.statSync(fp).size })
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

const base = (f) => path.basename(f.name, path.extname(f.name))

// --- 五张速查清单 -----------------------------------------------------------

function buildQualification() {
  const files = walk(path.join(ROOT, "05公司资质（证书、著作权等）", "1、公司资质"))
  const bullets = files.map((f) => `- ${base(f)}`).join("\n")
  const content = [
    "# 投标弹药速查 · 公司资质证书清单",
    "",
    "> 本清单来自本机知识库 09-招投标培训学习库/05公司资质，仅登记「我们有什么证、有效期到何时、文件叫什么」，证书扫描件原件仍在本地，投标需要时按文件名取用。",
    "",
    "## 硬资质（资格审查常用）",
    "营业执照副本、开户许可证、软件企业证书、高新技术企业证书、CMMI5 软件能力成熟度五级、ISO9001/14001/45001/20000 四体系、ITSS 运维服务能力成熟度二级、公司名称变更证明。",
    "",
    "## ⚠️ 有效期预警（投标前务必核对扫描件在有效期内）",
    "- ISO20000 服务管理体系：**2026.07.28 到期（最紧）**",
    "- ITSS 运维二级：**2026.11.09 到期**",
    "- 软件企业证书：**2026.11.11 到期**",
    "- 高新技术企业证书：**2023.11.22–2026.11.22**",
    "- CMMI5：2024.10.20–2027.10.20",
    "- ISO14001 / ISO45001：至 2028.11.05",
    "- ISO9001 质量管理：至 2029.04.19",
    "",
    "## 荣誉证书（资信标 / 加分项）",
    "科技进步奖一等奖（单位，2021.04）、2023 福建省软件和信息技术服务业 50 强、基于互联网医疗的非接触式就医应用（实践责任效益优秀榜）。",
    "",
    "## 文件明细",
    bullets,
  ].join("\n")
  return {
    id: "company-qualification", title: "投标弹药库/公司资质证书", folder: "投标弹药库/公司资质证书",
    doc_category: "资质证书", content,
    summary: "公司硬资质证书清单：营业执照、软件企业、高新技术、CMMI5、ISO9001/14001/45001/20000、ITSS二级；含有效期预警与荣誉证书（资信标加分）。",
    keywords: ["资质证书", "营业执照", "CMMI5", "ISO", "ITSS", "高新技术企业", "软件企业", "荣誉证书", "资格审查"],
  }
}

function buildCopyright() {
  const files = walk(path.join(ROOT, "05公司资质（证书、著作权等）", "5、著作权"))
  const cr = files.filter((f) => /著作权/.test(f.name) && !/变更证明/.test(f.name))
  const bullets = cr.map((f) => {
    const m = f.name.match(/(\d+)\s*著作权/)
    const tag = /HIS、EMR4\.0/.test(f.rel) ? "【HIS/EMR 4.0旧版】" : /onelink6\.0/.test(f.rel) ? "【onelink 6.0版】" : ""
    return `- ${m ? m[1] + " " : ""}${base(f).replace(/^\d+\s*(（著作权）|著作权-?)/, "")}　${tag}`.replace(/\s+$/, "")
  }).join("\n")
  const content = [
    "# 投标弹药速查 · 软件著作权清单",
    "",
    "> 覆盖 HIS/EMR/移动医疗/集成平台/CDR/病历评级辅助/VTE/全资源预约/统一支付对账/BI/护理/双向转诊/区域卫生/智慧运维 等产品线，用于技术响应「自主知识产权」举证与软著加分。",
    "",
    "## 使用要点",
    "- 编号 **08 医院信息系统V4.5** 与 **24 区域卫生决策支持平台** 须同时附对应的「变更证明」，缺一不可。",
    "- HIS/EMR 分 **4.0 旧版** 与 **onelink 6.0 版** 两套著作权，投标按招标文件要求的技术版本对应选用。",
    "",
    `## 软著明细（共 ${cr.length} 项）`,
    bullets,
  ].join("\n")
  return {
    id: "software-copyright", title: "投标弹药库/软件著作权", folder: "投标弹药库/软件著作权",
    doc_category: "资质证书", content,
    summary: "公司软件著作权清单（约26项）：HIS/EMR、移动医护、集成平台、CDR、病历评级辅助、VTE、全资源预约、统一支付对账、BI、护理、区域卫生等；含版本选用与变更证明注意事项。",
    keywords: ["软件著作权", "软著", "自主知识产权", "HIS", "EMR", "onelink", "变更证明"],
  }
}

function buildFinance() {
  const audit = walk(path.join(ROOT, "05公司资质（证书、著作权等）", "2、财务审计报告（2023-2024年）"))
  const tax = walk(path.join(ROOT, "05公司资质（证书、著作权等）", "3、单位纳税证明"))
  const social = walk(path.join(ROOT, "05公司资质（证书、著作权等）", "4、单位社保证明"))
  const months = (arr) => arr.map((f) => { const m = f.name.match(/(20\d{2})年(\d{1,2})月/); return m ? (+m[1]) * 12 + (+m[2]) - 1 : null }).filter((x) => x != null).sort((a, b) => a - b)
  const lbl = (x) => `${Math.floor(x / 12)}.${(x % 12) + 1}`
  const span = (arr) => { const v = months(arr); if (!v.length) return "—"; const cont = v[v.length - 1] - v[0] + 1 === v.length ? "，连续" : "，有缺口"; return `${lbl(v[0])} 至 ${lbl(v[v.length - 1])}（共 ${v.length} 个月${cont}）` }
  const content = [
    "# 投标弹药速查 · 财务·纳税·社保证明",
    "",
    "> 资格审查高频材料。招标常要求「近 N 个月连续纳税/社保」「上一年度审计报告」，投标前按下表覆盖区间取最近的连续月份。",
    "",
    "## 财务审计报告",
    audit.map((f) => `- ${base(f)}`).join("\n"),
    "",
    "## 单位纳税证明",
    `- 覆盖：${span(tax)}`,
    "",
    "## 单位社保证明",
    `- 覆盖：${span(social)}`,
    "",
    "## 提示",
    "- 人员资质证书常需与**社保缴纳证明**配套，以证明持证人员属本单位在册——投标组建项目组时同步从本库取对应月份社保。",
  ].join("\n")
  return {
    id: "finance-tax-social", title: "投标弹药库/财务纳税社保", folder: "投标弹药库/财务纳税社保",
    doc_category: "资质证书", content,
    summary: "投标财务类资审材料：2023/2024 母公司审计报告（印章齐全）、单位纳税证明与社保证明的连续月份覆盖区间，供按招标要求取最近连续区间。",
    keywords: ["财务审计报告", "纳税证明", "社保证明", "资格审查", "连续缴纳"],
  }
}

function buildCases() {
  const dir = path.join(ROOT, "06公司客户案例&基础业绩合同", "业绩合同证明")
  const files = walk(dir)
  const projectKey = (f) => {
    let s = base(f)
    s = s.replace(/[（(][^（()）]*[)）]/g, "")          // 去括号内附注（含成交通知书 等）
    s = s.replace(/20\d{2}[-/.年]\d{1,2}([-/.月]\d{1,2}日?)?/g, "") // 去日期
    s = s.replace(/\d{6,8}/g, "")                        // 去 20210120 式日期
    s = s.replace(/-?\d+万/g, "")                        // 去金额（993万）
    s = s.replace(/(软件采购合同|服务类采购项目合同|售后维护服务协议|维护服务协议|服务协议|中标通知书|成交通知书|采购合同|验收报告|合同证明|合同|协议)$/g, "")
    s = s.replace(/[-_·\s]+$/g, "")
    const i = s.indexOf("项目")
    if (i >= 0) s = s.slice(0, i + 2)                    // 归一到「…项目」
    return s.replace(/[-_·\s]+$/g, "").trim()
  }
  const bundles = {}
  for (const f of files) {
    if (/评级案例|客户案例清单/.test(f.name)) continue
    const key = projectKey(f)
    if (!key) continue
    bundles[key] = bundles[key] || { 中标: false, 合同: false, 验收: false }
    if (/中标通知书|成交通知书/.test(f.name)) bundles[key].中标 = true
    if (/合同|协议/.test(f.name)) bundles[key].合同 = true
    if (/验收/.test(f.name)) bundles[key].验收 = true
  }
  const rows = Object.entries(bundles).map(([k, v]) =>
    `| ${k} | ${v.中标 ? "✅" : "—"} | ${v.合同 ? "✅" : "—"} | ${v.验收 ? "✅" : "—"} |`)
  const content = [
    "# 投标弹药速查 · 客户案例与业绩合同",
    "",
    "> 业绩标通常需「合同关键页 + 中标通知书 + 验收报告」三件套。下表按项目登记已具备的材料，投标选业绩时优先取三件套齐全者。",
    "",
    "| 项目 / 客户 | 中标通知书 | 合同 | 验收报告 |",
    "| --- | :-: | :-: | :-: |",
    ...rows,
    "",
    "## 补充材料",
    "- **《评级案例》docx**：电子病历过级 / 互联互通标准化成熟度过级 案例合集，视招标要求选用对应类型。",
    "- **《公司客户案例清单.xlsx》**：全量客户案例台账，做案例章节与业绩表时优先核对。",
    "",
    "## 亮点业绩",
    "- 电子病历评级：莆田学院附属医院（电子病历六级）、银川市第三人民医院（4级电子病历拓展）。",
    "- 大额新实施：鹿寨县人民医院医院信息系统项目（约 993 万）。",
    "- 维保续约：厦门市儿童医院/海沧医院、石河子市人民医院、福建漳州中医院、沈阳辽中区人民医院、鞍山市中心医院、福田二院（广东省社保平台对接）。",
  ].join("\n")
  return {
    id: "cases-performance", title: "投标弹药库/客户案例业绩", folder: "投标弹药库/客户案例业绩",
    doc_category: "项目案例", content,
    summary: "客户案例与业绩合同速查：按项目登记中标通知书/合同/验收报告三件套齐备情况，含电子病历评级（六级/四级）、大额新实施、维保续约等亮点，附评级案例与全量客户清单指引。",
    keywords: ["客户案例", "业绩合同", "中标通知书", "验收报告", "电子病历评级", "互联互通", "三件套"],
  }
}

function buildPersonnel() {
  const files = walk(path.join(ROOT, "07公司人员资质", "总部证书"))
  const rows = files
    .map((f) => {
      const n = base(f)
      let who, cert
      const i = n.search(/[:：]/)
      if (i >= 0) { who = n.slice(0, i); cert = n.slice(i + 1) }
      else { const j = n.indexOf("-"); if (j > 0 && j <= 4) { who = n.slice(0, j); cert = n.slice(j + 1) } else return null }
      who = who.trim(); cert = cert.trim().replace(/\s+/g, "")
      return who && cert ? `| ${who} | ${cert} |` : null
    })
    .filter(Boolean)
  const content = [
    "# 投标弹药速查 · 项目组人员资质",
    "",
    "> 人员证书用于项目组配置与资信分。规则：**优先使用所属业务群的人员证书，再配总部证书**（原始库说明）。人员证书常需配套社保证明（见财务纳税社保清单）。",
    "",
    "| 姓名 | 证书（职称/资格） |",
    "| --- | --- |",
    ...rows,
    "",
    "## 提示",
    "- 高级信息系统项目管理师、信息系统项目管理师（软考高级）可用于项目经理岗位与高分资信。",
    "- 中级系统集成项目管理工程师、软件设计师、网络工程师覆盖项目组常见岗位配置要求。",
  ].join("\n")
  return {
    id: "personnel-qualification", title: "投标弹药库/人员资质", folder: "投标弹药库/人员资质",
    doc_category: "资质证书", content,
    summary: "项目组人员资质证书速查（总部7人）：高级/信息系统项目管理师、中级系统集成项目管理工程师、软件设计师、网络工程师等；含优先用业务群人员证书、配套社保的规则。",
    keywords: ["人员资质", "项目经理", "信息系统项目管理师", "系统集成", "软件设计师", "网络工程师", "项目组"],
  }
}

// --- 入库 -------------------------------------------------------------------

async function api(pathname, options = {}) {
  const res = await fetch(BASE + pathname, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } })
  if (!res.ok) throw new Error(`${options.method || "GET"} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? null : res.json()
}

// 后端 q 为 LIKE 匹配，幂等键以 source_file_name 前缀本地精确判定
const have = new Set()
for (let page = 1; page <= 20; page++) {
  const o = await api(`/api/kb_docs?perPage=200&page=${page}`)
  for (const it of o.items || []) if (String(it.source_file_name || "").startsWith("ammunition:")) have.add(String(it.source_file_name))
  if (!o.items || o.items.length < 200) break
}

const docs = [buildQualification(), buildCopyright(), buildFinance(), buildCases(), buildPersonnel()]
console.log(`待入库弹药清单：${docs.length} 张`)
let ok = 0, skipped = 0
for (const d of docs) {
  const key = `ammunition:${d.id}`
  if (have.has(key)) { skipped++; console.log(`[skip] ${d.title} 已存在`); continue }
  await api("/api/kb_docs", {
    method: "POST",
    body: JSON.stringify({
      rh_user_id: LOCAL_USER,
      title: d.title,
      folder_path: d.folder,
      content: d.content,
      doc_format: "md",
      visibility: "personal",
      summary: d.summary,
      keywords: d.keywords,
      source_file_name: key,
      uploader_name: "弹药库导入",
      doc_category: d.doc_category,
      ai_context_mode: "original",
      retrieval_weight: 1.2,
      is_sensitive: true,
    }),
  })
  ok++
  console.log(`[personal/sensitive] ${d.title} (${d.doc_category}, ${d.content.length}字)`)
}
console.log(`\n完成：入库 ${ok}，已存在跳过 ${skipped}`)
