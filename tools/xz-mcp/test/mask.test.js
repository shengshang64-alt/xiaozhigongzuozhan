// 脱敏单元测试：全部用虚构样例，不含真实数据
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Masker } from '../src/mask.js';

const HOSP = '示例市第一人民医院';
const PERSON = '张三';
const MOBILE = '13800001234';
const LANDLINE = '010-12345678';

test('同值同占位符', () => {
  const m = new Masker();
  const r1 = m.mask({ hospital: HOSP });
  const r2 = m.mask({ hospital: HOSP });
  assert.equal(r1.hospital, '[医院1]');
  assert.equal(r2.hospital, r1.hospital);
});

test('嵌套对象里其它字段文本中出现的医院名被替换', () => {
  const m = new Masker();
  const out = m.mask({
    hospital: HOSP,
    nested: { note: `今天拜访了${HOSP}`, list: [`再次联系${HOSP}`] },
    arr: [HOSP, '不相关'],
  });
  assert.equal(out.hospital, '[医院1]');
  assert.equal(out.nested.note, '今天拜访了[医院1]');
  assert.equal(out.nested.list[0], '再次联系[医院1]');
  assert.equal(out.arr[0], '[医院1]');
  assert.equal(out.arr[1], '不相关');
});

test('手机号/座机/金额替换', () => {
  const m = new Masker();
  const out = m.mask({
    contact: PERSON,
    phone: MOBILE,
    office_phone: LANDLINE,
    note: '预算约 ¥120万元 左右',
    bid_amount: 3500000,
  });
  assert.equal(out.contact, '[联系人1]');
  assert.match(out.phone, /^\[电话\d+\]$/);
  assert.match(out.office_phone, /^\[电话\d+\]$/);
  assert.match(out.note, /\[金额\d+\]/);
  assert.match(out.bid_amount, /^\[金额\d+\]$/);
});

test('unmask 往返一致（含 number 还原）', () => {
  const m = new Masker();
  const orig = {
    hospital: HOSP,
    contact: PERSON,
    phone: MOBILE,
    bid_amount: 3500000,
    note: `${PERSON}联系${HOSP}`,
  };
  const masked = m.mask(orig);
  const restored = m.unmask(masked);
  assert.equal(restored.hospital, HOSP);
  assert.equal(restored.contact, PERSON);
  assert.equal(restored.phone, MOBILE);
  assert.equal(restored.note, orig.note);
  assert.equal(restored.bid_amount, 3500000);
  assert.equal(typeof restored.bid_amount, 'number');
});

test('持久化文件重新加载后占位符稳定', () => {
  const dir = mkdtempSync(join(tmpdir(), 'xz-mcp-'));
  const file = join(dir, 'mask.json');
  try {
    const m1 = new Masker({ file });
    const r1 = m1.mask({ hospital: HOSP, contact: PERSON });
    const m2 = new Masker({ file });
    const r2 = m2.mask({ contact: PERSON, hospital: HOSP });
    assert.equal(r1.hospital, '[医院1]');
    assert.equal(r1.contact, '[联系人1]');
    assert.equal(r2.hospital, r1.hospital);
    assert.equal(r2.contact, r1.contact);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('name 只在 contacts/leadership 下当人名；科室名不脱敏', () => {
  const m = new Masker();
  const out = m.mask({ contacts: [{ name: '李四', phone: '13900002222' }], key_departments: [{ name: '心内科' }], notes: '李四说心内科要扩建' });
  assert.equal(out.contacts[0].name, '[联系人1]');
  assert.equal(out.key_departments[0].name, '心内科');
  assert.equal(out.notes, '[联系人1]说心内科要扩建');
  assert.match(out.contacts[0].phone, /^\[电话\d+\]$/);
});

test('长数字编号里的片段不当电话；占位符不会被二次登记', () => {
  const m = new Masker();
  const out = m.mask({ tender_no: 'ZB2026138000012345', id: 'a01012345678xyz' });
  assert.equal(out.tender_no, 'ZB2026138000012345');
  assert.equal(out.id, 'a01012345678xyz');
  const first = m.mask({ hospital: HOSP }).hospital;
  const again = m.mask({ hospital: first });
  assert.equal(again.hospital, first);
  assert.equal(m.addTerm('hospital', '[医院1]'), null);
});
