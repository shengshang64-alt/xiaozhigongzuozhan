// 脱敏：医院/客户名、联系人、电话、金额 -> 稳定占位符；映射只在内存（可选本地文件），不出网。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HOSPITAL_KEYS = new Set(['hospital', 'hospital_name', 'ref_name', 'opportunity_name']);
const PERSON_KEYS = new Set([
  'contact', 'contact_name', 'contact_person', 'president', 'party_secretary',
  'it_lead', 'leader', 'owner_name',
]);
// name 只在这些父字段下视为人名（避免把科室名等当人名）
const PERSON_PARENTS = new Set(['contacts', 'leadership', 'contact', 'people', 'persons', 'leaders']);
const MONEY_KEYS = new Set([
  'bid_amount', 'annual_revenue', 'amount', 'price', 'unit_price',
  'total', 'total_price', 'budget', 'subtotal',
]);

const PHONE_RE = /(?<![0-9A-Za-z])1[3-9]\d{9}(?![0-9A-Za-z])/g;
const LANDLINE_RE = /(?<![0-9A-Za-z])0\d{2,3}-?\d{7,8}(?![0-9A-Za-z])/g;
const MONEY_TEXT_RE = /(?:¥|￥)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:亿元|万元|元|亿|万))?|\d[\d,]*(?:\.\d+)?\s*(?:亿元|万元|元)/g;
const PLACEHOLDER_RE = /\[(医院|联系人|电话|金额)(\d+)\]/g;
export const ANY_PLACEHOLDER = /\[(医院|联系人|电话|金额)\d+\]/;

const isNumericString = (v) => typeof v === 'string' && /^\d[\d,]*(?:\.\d+)?$/.test(v.trim());

export class Masker {
  constructor({ file } = {}) {
    this.file = file || null;
    this.maps = {
      hospital: new Map(), // original -> placeholder
      person: new Map(),
      phone: new Map(),
      money: new Map(),    // 'n:xxx' | 's:xxx' -> placeholder
    };
    this.counters = { hospital: 0, person: 0, phone: 0, money: 0 };
    this.reverse = new Map(); // placeholder -> { kind, original, isNumber? }
    this._dirty = false;
    if (this.file && existsSync(this.file)) this._load();
  }

  _load() {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      if (data.counters) Object.assign(this.counters, data.counters);
      for (const item of data.items || []) {
        const { ph, kind, original, isNumber } = item;
        this.reverse.set(ph, { kind, original, isNumber });
        if (kind === 'hospital') this.maps.hospital.set(original, ph);
        else if (kind === 'person') this.maps.person.set(original, ph);
        else if (kind === 'phone') this.maps.phone.set(original, ph);
        else if (kind === 'money') {
          const key = (isNumber ? 'n:' : 's:') + original;
          this.maps.money.set(key, ph);
        }
      }
    } catch { /* 忽略损坏文件 */ }
  }

  _save() {
    if (!this.file || !this._dirty) return;
    this._dirty = false;
    try {
      const items = [...this.reverse.entries()].map(([ph, info]) => ({ ph, ...info }));
      writeFileSync(this.file, JSON.stringify({ counters: this.counters, items }, null, 2));
    } catch { /* 忽略 IO 错误 */ }
  }

  addTerm(kind, value) {
    if (kind !== 'hospital' && kind !== 'person') return null;
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (v.length < 2 || ANY_PLACEHOLDER.test(v)) return null; // 已是占位符的不再登记
    const map = this.maps[kind];
    if (map.has(v)) return map.get(v);
    const n = ++this.counters[kind];
    const ph = kind === 'hospital' ? `[医院${n}]` : `[联系人${n}]`;
    map.set(v, ph);
    this.reverse.set(ph, { kind, original: v });
    this._dirty = true;
    return ph;
  }

  _phonePlaceholder(original) {
    if (this.maps.phone.has(original)) return this.maps.phone.get(original);
    const n = ++this.counters.phone;
    const ph = `[电话${n}]`;
    this.maps.phone.set(original, ph);
    this.reverse.set(ph, { kind: 'phone', original });
    this._dirty = true;
    return ph;
  }

  _moneyPlaceholder(original, isNumber) {
    const key = (isNumber ? 'n:' : 's:') + original;
    if (this.maps.money.has(key)) return this.maps.money.get(key);
    const n = ++this.counters.money;
    const ph = `[金额${n}]`;
    this.maps.money.set(key, ph);
    this.reverse.set(ph, { kind: 'money', original, isNumber: !!isNumber });
    this._dirty = true;
    return ph;
  }

  // ---------- 第一遍：收集词条 ----------
  _collect(value, parent = '') {
    if (value == null) return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) { for (const v of value) this._collect(v, parent); return; }
    if (typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string') {
        if (HOSPITAL_KEYS.has(k)) this.addTerm('hospital', v);
        else if (PERSON_KEYS.has(k) || (k === 'name' && PERSON_PARENTS.has(parent))) this.addTerm('person', v);
        else if (MONEY_KEYS.has(k) && isNumericString(v)) this._moneyPlaceholder(v, false);
      } else if (typeof v === 'number' && MONEY_KEYS.has(k)) {
        this._moneyPlaceholder(v, true);
      }
      this._collect(v, k);
    }
  }

  _replaceText(text) {
    if (!text) return text;
    let s = text;
    // 1) 已登记词条（长度降序，先长后短，避免短名截断长名）
    const size = this.maps.hospital.size + this.maps.person.size;
    if (!this._terms || this._termsSize !== size) {
      this._terms = [...this.maps.hospital, ...this.maps.person].sort((a, b) => b[0].length - a[0].length);
      this._termsSize = size;
    }
    for (const [orig, ph] of this._terms) if (s.includes(orig)) s = s.split(orig).join(ph);
    // 2) 手机 / 座机
    s = s.replace(PHONE_RE, (m) => this._phonePlaceholder(m));
    s = s.replace(LANDLINE_RE, (m) => this._phonePlaceholder(m));
    // 3) 文本金额
    s = s.replace(MONEY_TEXT_RE, (m) => this._moneyPlaceholder(m.trim(), false));
    return s;
  }

  _replace(value) {
    if (value == null) return value;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return this._replaceText(value);
    if (Array.isArray(value)) return value.map((v) => this._replace(v));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const isMoney = MONEY_KEYS.has(k);
        if (isMoney && typeof v === 'number') out[k] = this._moneyPlaceholder(v, true);
        else if (isMoney && typeof v === 'string' && isNumericString(v)) out[k] = this._moneyPlaceholder(v, false);
        else if (typeof v === 'string') out[k] = this._replaceText(v);
        else out[k] = this._replace(v);
      }
      return out;
    }
    return value;
  }

  mask(value) {
    this._collect(value);
    const result = this._replace(value);
    this._save();
    return result;
  }

  _unmaskText(text) {
    return text.replace(PLACEHOLDER_RE, (m) => {
      const info = this.reverse.get(m);
      return info ? String(info.original) : m;
    });
  }

  unmask(value) {
    if (value == null) return value;
    if (typeof value === 'string') {
      const m = value.match(/^\[金额(\d+)\]$/);
      if (m) {
        const info = this.reverse.get(value);
        if (info && info.isNumber) return info.original;
      }
      return this._unmaskText(value);
    }
    if (Array.isArray(value)) return value.map((v) => this.unmask(v));
    if (typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.unmask(v);
      return out;
    }
    return value;
  }
}
