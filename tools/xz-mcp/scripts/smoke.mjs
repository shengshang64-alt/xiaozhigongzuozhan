// 只读冒烟：经 stdio 真实调用插件，检查返回是否脱敏。只打印统计，不打印任何记录内容。不调用 apply_change。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const PB = process.env.XZ_PB_URL || 'http://127.0.0.1:7000';
const UID = process.env.XZ_USER_ID || 'local-user';
const server = fileURLToPath(new URL('../src/server.js', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env, XZ_USER_ID: UID, XZ_PB_URL: PB } });
const client = new Client({ name: 'xz-smoke', version: '0' });
await client.connect(transport);

const outputs = [];
async function call(name, args) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text || '';
  outputs.push(text);
  console.log(`${name.padEnd(15)} ${r.isError ? 'ERROR ' + text.slice(0, 80) : 'ok ' + text.length + ' 字'}`);
  return r.isError ? null : JSON.parse(text);
}

const tools = (await client.listTools()).tools.map((t) => t.name);
console.log('工具:', tools.join(', '));
const cust = await call('list_records', { collection: 'customers', perPage: 5 });
const bids = await call('list_records', { collection: 'bid_projects', perPage: 5 });
await call('list_records', { collection: 'solutions' });
await call('list_records', { collection: 'quotes' });
const ph = cust?.items?.[0]?.hospital_name; // 应为 [医院N]
console.log('客户名是否为占位符:', /^\[医院\d+\]$/.test(ph || ''));
const s = await call('search_records', { q: ph });
console.log('用占位符搜索命中客户数:', Array.isArray(s?.customers) ? s.customers.length : s?.customers);
if (bids?.items?.[0]) await call('search_records', { q: String(bids.items[0].project_name || '').slice(0, 4), collections: ['bid_projects'] });
const cid = cust?.items?.[0]?.id;
const full = await call('get_record', { collection: 'customers', id: cid });
if (bids?.items?.[0]) await call('get_record', { collection: 'bid_projects', id: bids.items[0].id, fields: ['project_name', 'hospital', 'bid_amount', 'stage', 'tender_text'], maxChars: 3000 });
const p = await call('propose_update', { collection: 'customers', id: cid, changes: { notes: '【测试预览，不会写入】' + (full?.notes ? '' : '') } });
console.log('propose 确认码长度:', p?.confirm_code?.length, 'diff 字段:', p?.diff?.map((d) => d.field).join(','));
const n = await call('notify', { title: '测试', body: '测试' });
await client.close();

// 泄露检查：直接从 PocketBase 取原文敏感值，只在内存比对
const raw = new Set();
for (let page = 1; page <= 5; page++) {
  const d = await (await fetch(`${PB}/api/customers?perPage=200&page=${page}`, { headers: { 'X-Rh-User-Id': UID } })).json();
  for (const c of d.items || []) {
    for (const k of ['hospital_name', 'president', 'party_secretary', 'it_lead']) if (typeof c[k] === 'string' && c[k].trim().length >= 2) raw.add(c[k].trim());
    for (const arr of [c.contacts, c.leadership]) if (Array.isArray(arr)) for (const x of arr) if (x && typeof x.name === 'string' && x.name.trim().length >= 2) raw.add(x.name.trim());
  }
  if ((d.items || []).length < 200) break;
}
const all = outputs.join('\n');
let leaks = 0; for (const v of raw) if (all.includes(v)) leaks++;
const phones = (all.match(/(?<![0-9A-Za-z])1[3-9]\d{9}(?![0-9A-Za-z])/g) || []).length;
console.log(`泄露检查：原文敏感词 ${raw.size} 个，输出中出现 ${leaks} 个；输出中手机号 ${phones} 个；占位符 ${(all.match(/\[(医院|联系人|电话|金额)\d+\]/g) || []).length} 处`);
