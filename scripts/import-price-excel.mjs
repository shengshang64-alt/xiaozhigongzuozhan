// 公司报价体系 Excel → product_library 导入脚本
// 用法：node scripts/import-price-excel.mjs <xlsx路径> [--commit]
//   不带 --commit 为 dry-run，仅输出前 10 条预览到 scripts/_import_preview.json
// 映射规则（源 sheet：智慧医院报价（按公司规范））：
//   item_name = 模块名称；spec = 标准名称 +（软著）+（评级√清单）
//   category = 产品类别（合并单元格向下填充）；unit = 套；ref_price = 0（该表无价格数字，待商务补）
import { createRequire } from "module";
import { writeFileSync } from "fs";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const file = process.argv[2];
const commit = process.argv.includes("--commit");
if (!file) {
  console.error("usage: node scripts/import-price-excel.mjs <xlsx> [--commit]");
  process.exit(1);
}

const wb = XLSX.readFile(file);
const SHEET = wb.SheetNames.find((n) => n.includes("公司规范")) ?? wb.SheetNames[1];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: "" });
const head = (rows[0] || []).map(String);

const col = (label) => head.findIndex((h) => h.trim() === label);
const C = {
  belong: col("产品归属"),
  pcat: col("产品类别"),
  pname: col("产品名称"),
  mcls: col("模块分类"),
  mname: col("模块名称"),
  sname: col("标准名称"),
  mattr: col("模块属性"),
  copyright: col("著作权名称"),
  desc: col("模块说明"),
};
// 评级列：病历/互联互通/智慧服务/五级/六级 等打 √ 的列
const ratingIdx = [];
head.forEach((h, i) => {
  const s = h.trim();
  if (/^(病历|互联互通|智慧服务|五级|六级|六五)/.test(s)) ratingIdx.push([i, s]);
});

const hit = (v) => {
  const s = String(v ?? "").trim();
  return s !== "" && s !== "0" && s !== "0.0";
};

const records = [];
let fill = { belong: "", pcat: "", pname: "", mcls: "" };
for (let r = 3; r < rows.length; r++) {
  const row = rows[r];
  if (!row) continue;
  const get = (i) => (i >= 0 ? String(row[i] ?? "").trim() : "");
  if (get(C.belong)) fill.belong = get(C.belong);
  if (get(C.pcat)) fill.pcat = get(C.pcat);
  if (get(C.pname)) fill.pname = get(C.pname);
  if (get(C.mcls)) fill.mcls = get(C.mcls);
  const mname = get(C.mname);
  if (!mname) continue; // 无模块名的行跳过（空行/小计行）
  // 模块名与分类行同名重复时（合并单元格首行即分类标题），仍保留为产品行
  const sname = get(C.sname);
  const copyright = get(C.copyright);
  const ratings = ratingIdx.filter(([i]) => hit(row[i])).map(([, label]) => label);
  let spec = sname || mname;
  if (copyright && copyright !== "0") spec += `｜软著：${copyright}`;
  if (ratings.length) spec += `｜评级：${ratings.join("、")}`;
  const desc = get(C.desc);
  if (desc && desc !== "0") spec += `｜${desc}`;
  records.push({
    rh_user_id: "local-user",
    item_name: mname,
    spec,
    unit: "套",
    ref_price: 0,
    category: fill.pcat || fill.mcls || "其他",
  });
}

writeFileSync(
  "scripts/_import_preview.json",
  JSON.stringify({ sheet: SHEET, count: records.length, first: records.slice(0, 10), last: records.slice(-3) }, null, 2),
  "utf-8",
);
console.log("parsed:", records.length, "preview written");

if (!commit) process.exit(0);

const BASE = "http://127.0.0.1:7000";
let ok = 0;
let fail = 0;
for (const rec of records) {
  try {
    const res = await fetch(`${BASE}/api/product_library`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Rh-User-Id": "local-user" },
      body: JSON.stringify(rec),
    });
    if (res.ok) ok++;
    else {
      fail++;
      console.error("FAIL", rec.item_name, res.status, (await res.text()).slice(0, 120));
    }
  } catch (err) {
    fail++;
    console.error("ERR", rec.item_name, String(err).slice(0, 120));
  }
}
console.log(`imported ok=${ok} fail=${fail}`);
