// 服务端工具测试：假 fetch + 内存传输，虚构数据，不连真实工作站
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';

process.env.XZ_USER_ID = 'test-user';
const db = {
  customers: [{ id: 'c1', hospital_name: '示例市第一人民医院', president: '王五', contacts: [{ name: '赵六', phone: '13700001111' }], notes: '', annual_revenue: 880000000, updated: 't1' }],
  solutions: [{ id: 's1', solution_name: '示例市第一人民医院智慧病房方案', solution_type: 'x', hospital: '示例市第一人民医院', doc_status: 'draft', updated: 't1' }],
  bid_projects: [], quotes: [],
};
const calls = [];
async function fakeFetch(url, opt) {
  const u = new URL(url); const parts = u.pathname.split('/').filter(Boolean); // api, coll, id?
  calls.push(`${opt.method} ${u.pathname}`);
  assert.equal(opt.headers['X-Rh-User-Id'], 'test-user');
  const json = (status, data) => ({ ok: status < 300, status, text: async () => JSON.stringify(data) });
  if (parts[1] === 'collections') return json(404, { message: 'Missing collection context.' });
  const rows = db[parts[1]];
  if (opt.method === 'GET' && parts[2]) return json(200, rows.find((r) => r.id === parts[2]));
  if (opt.method === 'GET') return json(200, { items: rows, page: 1, perPage: 50, totalItems: rows.length });
  if (opt.method === 'PATCH') { const r = rows.find((x) => x.id === parts[2]); Object.assign(r, JSON.parse(opt.body), { updated: 't2' }); return json(200, r); }
  if (opt.method === 'POST') { const r = { id: 'n1', ...JSON.parse(opt.body) }; rows.push(r); return json(200, r); }
  return json(405, { message: 'no' });
}

async function connect() {
  const server = createServer({ fetchImpl: fakeFetch });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { err: !!r.isError, text: r.content[0].text };
  };
  return { client, call };
}

test('工具清单没有删除类工具', async () => {
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['apply_change', 'get_record', 'list_records', 'notify', 'propose_create', 'propose_update', 'search_records']);
});

test('读取结果已脱敏', async () => {
  const { call } = await connect();
  const r = await call('get_record', { collection: 'customers', id: 'c1' });
  for (const s of ['示例市第一人民医院', '王五', '赵六', '13700001111', '880000000']) assert.ok(!r.text.includes(s), s);
  const l = await call('list_records', { collection: 'solutions' });
  assert.ok(l.text.includes('[医院1]智慧病房方案'));
});

test('propose 只预览不写库；apply 需同意且一次性；占位符还原', async () => {
  const { call } = await connect();
  await call('list_records', { collection: 'customers' });
  const before = calls.filter((c) => c.startsWith('PATCH')).length;
  const p = await call('propose_update', { collection: 'customers', id: 'c1', changes: { notes: '[联系人1]约了下周见面' } });
  assert.equal(p.err, false);
  const code = JSON.parse(p.text).confirm_code;
  assert.equal(calls.filter((c) => c.startsWith('PATCH')).length, before);
  assert.equal((await call('apply_change', { confirm_code: code, user_confirmed: false })).err, true);
  const ok = await call('apply_change', { confirm_code: code, user_confirmed: true });
  assert.equal(ok.err, false, ok.text);
  assert.equal(db.customers[0].notes, '王五约了下周见面');
  assert.equal((await call('apply_change', { confirm_code: code, user_confirmed: true })).err, true); // 一次性
});

test('拒绝清空、只读字段、软删除、未知占位符、截断内容、集合外', async () => {
  const { call } = await connect();
  const bad = [
    { collection: 'customers', id: 'c1', changes: { president: '' } },
    { collection: 'customers', id: 'c1', changes: { rh_user_id: 'x' } },
    { collection: 'bid_projects', id: 'b1', changes: { archived: true } },
    { collection: 'customers', id: 'c1', changes: { notes: '[医院99]' } },
    { collection: 'customers', id: 'c1', changes: { notes: 'abc…(已截断，原长9999)' } },
  ];
  for (const a of bad) assert.equal((await call('propose_update', a)).err, true, JSON.stringify(a));
  assert.equal((await call('list_records', { collection: 'users' })).err, true);
});

test('通知表不存在时友好报错', async () => {
  const { call } = await connect();
  const r = await call('notify', { title: 't', body: 'b' });
  assert.equal(r.err, true);
  assert.match(r.text, /agent_notifications 还没建/);
});
