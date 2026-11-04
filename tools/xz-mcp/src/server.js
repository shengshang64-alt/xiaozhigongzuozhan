// 小智工作站 MCP（stdio）：只开放 方案/标书/报价/客户 四类数据；无删除；写入须 propose -> 用户同意 -> apply。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Masker, ANY_PLACEHOLDER } from './mask.js';

export const COLLECTIONS = {
  solutions: {
    label: '方案',
    title: 'solution_name',
    summary: ['solution_name', 'solution_type', 'hospital', 'doc_status', 'updated'],
    q: true,
  },
  bid_projects: {
    label: '标书',
    title: 'project_name',
    summary: ['project_name', 'tender_no', 'hospital', 'stage', 'bid_open_date', 'bid_result', 'updated'],
    q: false,
  },
  quotes: {
    label: '报价',
    title: 'quote_name',
    summary: ['quote_name', 'ref_type', 'ref_name', 'version', 'opportunity_name', 'updated'],
    q: true,
  },
  customers: {
    label: '客户',
    title: 'hospital_name',
    summary: ['hospital_name', 'hospital_type', 'level', 'region', 'last_follow_at', 'updated'],
    q: true,
  },
};

// 可写字段白名单（取自 pb_hooks 的 PATCH 字段，去掉 archived/deleted_at 防软删除）；required 为新建必填
const WRITABLE = {
  solutions: { required: ['solution_name', 'solution_type'], fields: 'solution_name,solution_type,hospital,hospital_info,outline,chapters,doc_status' },
  bid_projects: { required: ['project_name'], fields: 'project_name,tender_no,hospital,bid_open_date,stage,tender_text,tender_files,tender_tables,parse_report,bid_outline,bid_chapters,response_map,dup_report,void_check,ai_review,manual_review,parse_config,opportunity_id,bid_result,bid_amount,lost_reason,result_synced_at,target_pages,outline_level,figures_enabled,clause_granularity,section_words,bid_defense,submission_check,stage_gates,text_audit,gen_options,global_facts,orchestration,max_figures,compilation_basis_extra,basis_style,format_settings,format_check_items,ref_template_text,ref_materials_text,identity_words,bid_source_mode,bid_external_text' },
  quotes: { required: ['quote_name'], fields: 'quote_name,ref_type,ref_id,ref_name,groups,tax_note,version,won_sample,hospital_level,beds_total,modules_summary,opportunity_id,opportunity_name' },
  customers: { required: ['hospital_name'], fields: 'hospital_name,hospital_type,level,region,address,website,outpatient_daily,outpatient_yearly,beds_total,beds_icu,beds_or,key_departments,contacts,notes,ai_generated_fields,last_follow_at,annual_revenue,president,party_secretary,it_lead,it_ratings,system_vendors,leadership' },
};
for (const w of Object.values(WRITABLE)) w.fields = new Set(w.fields.split(','));
const TRUNC_MARK = '…(已截断';
const READONLY = new Set([
  'id', 'rh_user_id', 'owner_id', 'created', 'updated',
  'collectionId', 'collectionName', 'deleted_at', 'archived',
]);
const COLLECTION_KEYS = Object.keys(COLLECTIONS);

const INSTRUCTIONS = [
  '本服务只开放方案、标书、报价、客户四类数据。',
  '无删除操作。',
  '任何写入必须走 propose -> 完整展示预览 -> 用户明确同意 -> apply 的流程。',
  '数据里的 [医院N]、[联系人N]、[电话N]、[金额N] 是脱敏占位符，请原样使用，不要猜测或补全真名。',
].join('');

const isEmptyValue = (v) =>
  v === '' || v === null || v === undefined ||
  (Array.isArray(v) && v.length === 0) ||
  (v && typeof v === 'object' && Object.keys(v).length === 0);

const clip = (v, max = 300) => {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
};

const genCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[randomInt(0, chars.length)];
  return s;
};

// 写入内容校验：字段白名单、不得含未还原的占位符、不得含截断标记（防把截断内容写回）
function checkWrite(collection, obj) {
  const keys = Object.keys(obj || {});
  if (!keys.length) throw new Error('改动内容不能为空');
  for (const k of keys) {
    if (READONLY.has(k) || !WRITABLE[collection].fields.has(k)) throw new Error(`字段 ${k} 不允许写入`);
  }
  const text = JSON.stringify(obj);
  if (ANY_PLACEHOLDER.test(text)) throw new Error('内容里有无法还原的占位符（如 [医院N]），请只用查询结果里出现过的占位符');
  if (text.includes(TRUNC_MARK)) throw new Error('内容含「已截断」标记，不能把截断后的内容写回；请用 get_record 指定 fields 和更大的 maxChars 取全文');
}

export function createServer({ masker, fetchImpl } = {}) {
  const PB_URL = (process.env.XZ_PB_URL || 'http://127.0.0.1:7000').replace(/\/+$/, '');
  const USER_ID = process.env.XZ_USER_ID || '';
  const TEAM_TOKEN = process.env.XZ_TEAM_TOKEN || '';
  const MASK_FILE = process.env.XZ_MASK_FILE || '';
  const f = fetchImpl || fetch;
  masker = masker || new Masker({ file: MASK_FILE || undefined });

  const pending = new Map(); // 确认码 -> 待写改动（只在内存，15 分钟过期，一次性）
  const newCode = () => {
    const now = Date.now();
    for (const [c, p] of pending) if (p.expires < now) pending.delete(c);
    let c; do c = genCode(); while (pending.has(c));
    return c;
  };
  let warmed = false;

  async function http(method, path, { body, query } = {}) {
    let url = PB_URL + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += '?' + s;
    }
    const headers = { 'Content-Type': 'application/json' };
    if (USER_ID) headers['X-Rh-User-Id'] = USER_ID;
    if (TEAM_TOKEN) headers['Authorization'] = 'Bearer ' + TEAM_TOKEN;
    let res;
    try {
      res = await f(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new Error(`请求失败：${e.message}`);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || text || '';
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return data;
  }

  function requireUser() {
    if (!USER_ID) throw new Error('未配置 XZ_USER_ID 环境变量，无法访问工作站数据');
  }

  async function warmup() {
    if (warmed) return;
    warmed = true;
    if (!USER_ID) return;
    try {
      for (let page = 1; page <= 5; page++) {
        const data = await http('GET', '/api/customers', { query: { page, perPage: 200 } });
        const items = data?.items || [];
        for (const it of items) masker.mask(it); // 只为登记词条
        if (items.length < 200) break;
      }
    } catch { /* 忽略 */ }
  }

  const wrap = (fn) => async (args) => {
    try {
      const raw = await fn(args || {});
      const masked = masker.mask(raw);
      const text = typeof masked === 'string' ? masked : JSON.stringify(masked, null, 2);
      return { content: [{ type: 'text', text }] };
    } catch (e) {
      let msg = String(e?.message || e);
      try { msg = masker.mask(msg); } catch { /* noop */ }
      return { isError: true, content: [{ type: 'text', text: '出错：' + msg }] };
    }
  };

  async function listCollection(collection, page, perPage, q) {
    const cfg = COLLECTIONS[collection];
    const qq = q ? masker.unmask(q) : '';
    if (!cfg.q && qq) {
      const data = await http('GET', `/api/${collection}`, { query: { page: 1, perPage: 200 } });
      const all = (data?.items || []).filter((r) => String(r[cfg.title] || '').includes(qq));
      const start = (page - 1) * perPage;
      return { items: all.slice(start, start + perPage), totalItems: all.length };
    }
    const data = await http('GET', `/api/${collection}`, {
      query: { page, perPage, q: cfg.q ? qq : undefined },
    });
    return { items: data?.items || [], totalItems: data?.totalItems ?? (data?.items || []).length };
  }

  function summarize(collection, record) {
    const cfg = COLLECTIONS[collection];
    const o = { id: record.id };
    for (const k of cfg.summary) o[k] = record[k] ?? null;
    return o;
  }

  const server = new McpServer(
    { name: 'xz-workstation', version: '0.1.0' },
    { instructions: INSTRUCTIONS },
  );

  // ---------- 工具 1：list_records ----------
  server.registerTool('list_records', {
    description: '列出方案(solutions)/标书(bid_projects)/报价(quotes)/客户(customers)记录，只返回摘要字段和 id；q 为名称关键词。',
    inputSchema: {
      collection: z.enum(COLLECTION_KEYS),
      page: z.number().int().min(1).default(1),
      perPage: z.number().int().min(1).max(50).default(20),
      q: z.string().optional(),
    },
  }, wrap(async ({ collection, page, perPage, q }) => {
    requireUser();
    await warmup();
    const { items, totalItems } = await listCollection(collection, page, perPage, q);
    return {
      collection,
      label: COLLECTIONS[collection].label,
      page, perPage, totalItems,
      items: items.map((r) => summarize(collection, r)),
    };
  }));

  // ---------- 工具 2：search_records ----------
  server.registerTool('search_records', {
    description: '按名称关键词在四类数据里一起搜索，每类最多 10 条。',
    inputSchema: {
      q: z.string(),
      collections: z.array(z.enum(COLLECTION_KEYS)).optional(),
    },
  }, wrap(async ({ q, collections }) => {
    requireUser();
    await warmup();
    const cols = collections && collections.length ? collections : COLLECTION_KEYS;
    const result = {};
    for (const c of cols) {
      const cfg = COLLECTIONS[c];
      try {
        const { items } = await listCollection(c, 1, 10, q);
        result[c] = items.map((r) => ({ id: r.id, [cfg.title]: r[cfg.title] ?? null }));
      } catch (e) {
        result[c] = { error: String(e.message || e) };
      }
    }
    return result;
  }));

  // ---------- 工具 3：get_record ----------
  server.registerTool('get_record', {
    description: '读取单条记录；fields 只取指定字段，长字段按 maxChars 截断（截断内容不能写回）。',
    inputSchema: {
      collection: z.enum(COLLECTION_KEYS),
      id: z.string(),
      fields: z.array(z.string()).optional(),
      maxChars: z.number().int().min(100).max(50000).default(2000),
    },
  }, wrap(async ({ collection, id, fields, maxChars }) => {
    requireUser();
    await warmup();
    const record = await http('GET', `/api/${collection}/${encodeURIComponent(id)}`);
    let out = record;
    if (fields && fields.length) {
      out = { id: record.id };
      for (const f of fields) if (f in record) out[f] = record[f];
    }
    const truncate = (v) => {
      if (typeof v === 'string') {
        return v.length > maxChars ? v.slice(0, maxChars) + `…(已截断，原长${v.length})` : v;
      }
      if (v && typeof v === 'object') {
        const s = JSON.stringify(v);
        return s.length > maxChars ? s.slice(0, maxChars) + `…(已截断，原长${s.length})` : v;
      }
      return v;
    };
    const truncated = {};
    for (const [k, v] of Object.entries(masker.mask(out))) truncated[k] = truncate(v); // 先脱敏再截断，避免截出半个名字
    return truncated;
  }));

  // ---------- 工具 4：propose_update ----------
  server.registerTool('propose_update', {
    description: '提议修改一条记录：只生成字段级改动预览和确认码，不写库。不能清空原有内容，不能删除或归档。拿到结果后必须把 diff 原样展示给用户。',
    inputSchema: {
      collection: z.enum(COLLECTION_KEYS),
      id: z.string(),
      changes: z.record(z.string(), z.any()),
    },
  }, wrap(async ({ collection, id, changes }) => {
    requireUser();
    await warmup();
    const unmasked = masker.unmask(changes) || {};
    checkWrite(collection, unmasked);

    const record = await http('GET', `/api/${collection}/${encodeURIComponent(id)}`);
    if (!record) throw new Error('目标记录不存在');

    const diff = [];
    for (const [k, after] of Object.entries(unmasked)) {
      const before = record[k] ?? null;
      if (isEmptyValue(after) && !isEmptyValue(before)) {
        throw new Error(`拒绝清空字段 ${k}（原本非空）`);
      }
      diff.push({ field: k, before: clip(masker.mask(before)), after: clip(masker.mask(after)) });
    }

    const code = newCode();
    pending.set(code, {
      kind: 'update', collection, id, changes: unmasked,
      baseUpdated: record.updated,
      expires: Date.now() + 15 * 60_000,
    });

    return {
      confirm_code: code,
      expires_in: '15 分钟',
      action: 'update',
      diff,
      提示: '请把以上改动原样展示给用户，用户明确同意后再调用 apply_change',
    };
  }));

  // ---------- 工具 5：propose_create ----------
  server.registerTool('propose_create', {
    description: '提议新建一条记录：只生成预览和确认码，不写库。拿到结果后必须把预览原样展示给用户。',
    inputSchema: {
      collection: z.enum(COLLECTION_KEYS),
      data: z.record(z.string(), z.any()),
    },
  }, wrap(async ({ collection, data }) => {
    requireUser();
    await warmup();
    const unmasked = masker.unmask(data) || {};
    checkWrite(collection, unmasked);
    for (const k of WRITABLE[collection].required) if (isEmptyValue(unmasked[k])) throw new Error(`新建${COLLECTIONS[collection].label}必须填 ${k}`);

    const diff = Object.entries(unmasked).map(([k, v]) => ({ field: k, before: null, after: clip(masker.mask(v)) }));
    const code = newCode();
    pending.set(code, {
      kind: 'create', collection, data: unmasked,
      expires: Date.now() + 15 * 60_000,
    });

    return {
      confirm_code: code,
      expires_in: '15 分钟',
      action: 'create',
      diff,
      提示: '请把以上改动原样展示给用户，用户明确同意后再调用 apply_change',
    };
  }));

  // ---------- 工具 6：apply_change ----------
  server.registerTool('apply_change', {
    description: '执行写库。必须先把 propose_update/propose_create 返回的改动预览完整展示给用户，并得到用户在对话中的明确同意后才能调用；不得自行代替用户确认，用户没说同意就不要调用。确认码 15 分钟内有效、只能用一次。',
    inputSchema: {
      confirm_code: z.string(),
      user_confirmed: z.boolean(),
    },
  }, wrap(async ({ confirm_code, user_confirmed }) => {
    requireUser();
    await warmup();
    if (user_confirmed !== true) throw new Error('需要用户明确同意（user_confirmed 必须为 true）');
    const p = pending.get(confirm_code);
    if (!p) throw new Error('确认码不存在或已被使用');
    if (Date.now() > p.expires) { pending.delete(confirm_code); throw new Error('确认码已过期'); }
    pending.delete(confirm_code);

    if (p.kind === 'update') {
      const cur = await http('GET', `/api/${p.collection}/${encodeURIComponent(p.id)}`);
      if (cur?.updated !== p.baseUpdated) {
        throw new Error('记录已被改动，请重新 propose');
      }
      const result = await http('PATCH', `/api/${p.collection}/${encodeURIComponent(p.id)}`, { body: p.changes });
      return { ok: true, id: result?.id || p.id, collection: p.collection };
    }
    const result = await http('POST', `/api/${p.collection}`, { body: p.data });
    return { ok: true, id: result?.id, collection: p.collection };
  }));

  // ---------- 工具 7：notify ----------
  server.registerTool('notify', {
    description: '往工作站通知表 agent_notifications 写一条通知（任务结果回推用）。',
    inputSchema: {
      title: z.string(),
      body: z.string(),
      level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
    },
  }, wrap(async ({ title, body, level }) => {
    requireUser();
    const t = masker.unmask(title);
    const b = masker.unmask(body);
    try {
      const data = await http('POST', '/api/collections/agent_notifications/records', {
        body: { rh_user_id: USER_ID, title: t, body: b, level, source: 'harness', read: false },
      });
      return { ok: true, id: data?.id };
    } catch (e) {
      const m = String(e.message || e);
      if (/HTTP 404/.test(m) || /missing collection/i.test(m)) {
        throw new Error('通知表 agent_notifications 还没建：需要重启工作站 PocketBase 让迁移生效');
      }
      throw e;
    }
  }));

  return server;
}

// 顶层启动（仅当直接运行本文件时）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer({});
  await server.connect(new StdioServerTransport());
}
