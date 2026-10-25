// 用法：node --experimental-strip-types docs/evolution/_r64_intel_summary_scan.mjs（需 :7000 PocketBase 在跑）
// R64 真实数据取证：把库内 9 条「站点名 + JSON 元数据 + 正文」的 summary 跑一遍清洗，前后对照
import http from 'node:http';
import { cleanIntelSummary, stripIntelMetaBlobs, displayizeIntel } from '../../src/pages/IntelCenter/intelBodyClean.ts';

const get = (page) => new Promise((res) => {
  const req = http.request({ host: '127.0.0.1', port: 7000, path: `/api/intel_items?perPage=200&page=${page}`, headers: { 'X-Rh-User-Id': 'local-user' } }, (r) => {
    let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res(JSON.parse(s)); } catch { res(null); } });
  });
  req.on('error', () => res(null)); req.end();
});

const all = [];
for (let p = 1; p <= 4; p++) { const j = await get(p); if (!j || !j.items.length) break; all.push(...j.items); if (all.length >= j.totalItems) break; }

const withS = all.filter((x) => String(x.summary ?? '').trim());
const dirty = withS.filter((x) => /\{["'][\w-]+\s*["']\s*:/.test(String(x.summary)));
console.log(`库内情报 ${all.length} 条 / 有 summary ${withS.length} 条 / 含 JSON 元数据 ${dirty.length} 条`);

let beforeBad = 0, afterBad = 0, beforeEmpty = 0, afterEmpty = 0, gainChars = 0;
for (const d of dirty) {
  const raw = String(d.summary);
  const oldOut = displayizeIntel(raw, 600);           // 首页原口径
  const newOut = cleanIntelSummary(raw, 600);         // 本轮口径
  if (/\{|\}"?\s*:/.test(oldOut)) beforeBad++;
  if (/\{|\}"?\s*:/.test(newOut)) afterBad++;
  if (!oldOut) beforeEmpty++;
  if (!newOut) afterEmpty++;
  gainChars += newOut.length - oldOut.length;
}
console.log(`含花括号/JSON 残留：清洗前 ${beforeBad} 条 → 清洗后 ${afterBad} 条`);
console.log(`清洗后为空（首页原口径表现为「有摘要但空白」）：${beforeEmpty} 条 → ${afterEmpty} 条`);
console.log(`可见正文净增字符：${gainChars}`);

console.log('\n--- 逐条前后对照（前 3 条）---');
for (const d of dirty.slice(0, 3)) {
  const raw = String(d.summary);
  console.log('【' + d.id + '】' + String(d.title).slice(0, 30));
  console.log('  清洗前: ' + raw.slice(0, 120).replace(/\s+/g, ' '));
  console.log('  清洗后: ' + cleanIntelSummary(raw, 600).slice(0, 120));
  console.log('  旧口径: ' + (displayizeIntel(raw, 600) || '（空）'));
}

// 全量回归：非脏条目清洗后必须逐字不变（不误伤 618 条干净摘要）
let changedClean = 0;
const samples = [];
for (const s of withS) {
  const raw = String(s.summary);
  if (dirty.includes(s)) continue;
  const a = displayizeIntel(raw, 600);
  const b = cleanIntelSummary(raw, 600);
  if (a !== b) { changedClean++; if (samples.length < 3) samples.push({ id: s.id, a: a.slice(0, 60), b: b.slice(0, 60) }); }
}
console.log(`\n非脏摘要 ${withS.length - dirty.length} 条中，清洗结果发生变化的：${changedClean} 条`);
for (const s of samples) console.log('  ·', s.id, '| 旧:', s.a, '| 新:', s.b);
