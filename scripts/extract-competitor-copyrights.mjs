// 竞品软件著作权明细抽取：《医疗信息化公司软件著作权汇总.xlsx》「汇总总表」→ public/data/competitor-copyrights.json
// 用法：node scripts/extract-competitor-copyrights.mjs [xlsx路径]
//   默认 xlsx = C:\Users\Administrator\Desktop\医疗信息化公司软件著作权汇总.xlsx
// 输出为紧凑列式结构 { cols, rows }，前端 copyrightCore 懒加载后本地检索（13.5k 行量级，零后端改动）。
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const __root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || "C:\\Users\\Administrator\\Desktop\\医疗信息化公司软件著作权汇总.xlsx";

const wb = XLSX.readFile(file);
const sheetName = wb.SheetNames.find((n) => n.includes("汇总总表")) ?? wb.SheetNames[1];
if (!sheetName) {
  console.error("未找到「汇总总表」sheet，现有:", wb.SheetNames.join(","));
  process.exit(1);
}
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
const head = (rows[0] || []).map((h) => String(h).trim());
console.log("sheet:", sheetName, "| header:", JSON.stringify(head));

// 按表头名定位列；「序号」列即使存在也不导出。
// 坑（2026-09-21 实测）：表头含「序号」共 11 列，但数据行只有 10 列（序号无值），
// 直接按表头索引取数会整体左移一位。用登记号格式（20XXSR数字）探测真实列位偏差。
const want = [
  ["公司", "company"],
  ["软件名称", "name"],
  ["简称", "short"],
  ["版本号", "version"],
  ["软件分类", "swClass"],
  ["行业分类", "indClass"],
  ["登记号", "regNo"],
  ["登记批准日期", "regDate"],
  ["首次发表日期", "pubDate"],
  ["著作权人", "owner"],
];
const headIdx = want.map(([label]) => head.findIndex((h) => h === label || h.startsWith(label)));
if (headIdx.some((i) => i < 0)) {
  console.error("表头缺列 | 实际表头:", JSON.stringify(head));
  process.exit(1);
}
// 探测：在前 500 行里找哪一列的多数值形如登记号，以登记号为锚点向两侧展开。
// want 列在数据区是连续的（序号列在数据行里整体缺失），锚点法对含/不含序号两种布局都正确。
const SR = /^\d{4}SR\d+$/;
const regHeadIdx = headIdx[want.findIndex((w) => w[1] === "regNo")];
const regWantPos = want.findIndex((w) => w[1] === "regNo");
let regActualIdx = regHeadIdx;
{
  const probeRows = rows.slice(1, 501);
  let best = -1;
  let bestHit = 0;
  for (let c = Math.max(0, regHeadIdx - 2); c <= Math.min(head.length, regHeadIdx + 2); c++) {
    const hitN = probeRows.filter((r) => SR.test(String(r[c] ?? "").trim())).length;
    if (hitN > bestHit) { bestHit = hitN; best = c; }
  }
  if (best >= 0 && bestHit > probeRows.length * 0.5) regActualIdx = best;
  if (regActualIdx !== regHeadIdx) console.log(`列错位探测：登记号实际在第 ${regActualIdx} 列（表头声明第 ${regHeadIdx} 列）`);
}
const idx = want.map(([label, key], pos) => ({ key, i: Math.max(0, regActualIdx - (regWantPos - pos)) }));

const out = [];
let badReg = 0;
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (!row) continue;
  const get = (i) => (i >= 0 ? String(row[i] ?? "").trim() : "");
  const company = get(idx[0].i);
  const name = get(idx[1].i);
  if (!company && !name) continue; // 空行
  if (!SR.test(get(idx[6].i))) badReg++;
  out.push(idx.map((c) => get(c.i)));
}
if (badReg > out.length * 0.05) {
  console.error(`登记号列校验失败：${badReg}/${out.length} 行不符合 20XXSR 格式，列定位可能有误，已中止`);
  process.exit(1);
}

// 与「公司概览」sheet 的软著总数交叉核对
const ov = XLSX.utils.sheet_to_json(wb.Sheets["公司概览"], { header: 1, defval: "" });
const ovHead = (ov[0] || []).map(String);
const oiName = ovHead.findIndex((h) => h.trim() === "公司");
const oiCount = ovHead.findIndex((h) => h.trim() === "软著总数");
const expect = {};
for (let r = 1; r < ov.length; r++) {
  const n = String(ov[r]?.[oiName] ?? "").trim();
  if (n) expect[n] = Number(ov[r][oiCount]) || 0;
}
const actual = {};
for (const rec of out) actual[rec[0]] = (actual[rec[0]] || 0) + 1;
let mismatch = 0;
for (const [co, exp] of Object.entries(expect)) {
  const act = actual[co] || 0;
  if (act !== exp) {
    mismatch++;
    console.warn(`数量不一致 ${co}: 概览=${exp} 明细=${act}`);
  }
}
console.log(`明细 ${out.length} 行 / ${Object.keys(actual).length} 家；与概览核对 ${mismatch === 0 ? "全部一致" : `${mismatch} 家不一致`}`);

const json = {
  generated: new Date().toISOString().slice(0, 10),
  source: path.basename(file),
  cols: idx.map((c) => c.key),
  rows: out,
};
mkdirSync(path.join(__root, "public", "data"), { recursive: true });
const dest = path.join(__root, "public", "data", "competitor-copyrights.json");
writeFileSync(dest, JSON.stringify(json), "utf-8");
console.log("written:", dest, `${(readFileSync(dest).length / 1024 / 1024).toFixed(2)}MB`);
