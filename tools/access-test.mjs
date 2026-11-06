import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const context = { OTP: {} }; vm.createContext(context);
vm.runInContext(readFileSync('js/access-service.js', 'utf8'), context);
function fixture(minutes = 0) {
  let time = 1000000, sequence = 0, session;
  const local = { security: { salt: 'one', hash: 'test-hash', createdAt: 1 }, settings: { rememberMinutes: minutes } };
  const build = () => context.OTP.createAccessService({ readLocal: async () => structuredClone(local), readSession: async () => structuredClone(session),
    writeSession: async next => { session = structuredClone(next); }, verify: async password => password === 'valid', now: () => time, random: () => 'random-' + ++sequence });
  let service = build();
  return { local, request: (message, caller = 'page-1') => service.request(message, caller), at: value => { time = value; },
    restartWorker: () => { service = build(); }, restartBrowser: () => { session = undefined; service = build(); }, session: () => session };
}
await test('默认关闭：正确解锁只授权当前文档，重开仍要密码', async () => {
  const f = fixture(); const auth = await f.request({ action: 'unlock', password: 'valid' });
  assert.ok(auth.ok); assert.equal(auth.expires, 0); assert.equal((await f.request({ action: 'restore' }, 'page-2')).ok, false);
});
await test('错误密码与缺少密码不能签发会话', async () => {
  const f = fixture(5);
  for (const password of ['wrong', undefined, 'a'.repeat(4097)]) assert.equal((await f.request({ action: 'unlock', password })).ok, false);
  assert.equal((await f.request({ action: 'restore' })).ok, false);
});
await test('5 分钟免密固定到期；重开不会续期；准确边界拒绝', async () => {
  const f = fixture(5), start = await f.request({ action: 'unlock', password: 'valid' });
  assert.equal(start.expires, 1300000);
  f.at(1299999); const reopened = await f.request({ action: 'restore' }, 'page-2');
  assert.ok(reopened.ok); assert.equal(reopened.expires, start.expires);
  f.at(1300000); assert.equal((await f.request({ action: 'restore' }, 'page-3')).ok, false);
});
await test('会话跨后台休眠重启保留，浏览器重启后清除', async () => {
  const f = fixture(5); await f.request({ action: 'unlock', password: 'valid' });
  f.restartWorker(); assert.ok((await f.request({ action: 'restore' }, 'page-2')).ok);
  f.restartBrowser(); assert.equal((await f.request({ action: 'restore' }, 'page-3')).ok, false);
});
await test('手动锁定撤销所有会话及窗口票据', async () => {
  const f = fixture(5); const auth = await f.request({ action: 'unlock', password: 'valid' });
  const ticket = await f.request({ action: 'ticket', proof: auth.proof });
  const epoch = f.session().epoch; await f.request({ action: 'revoke' });
  assert.notEqual(f.session().epoch, epoch);
  assert.equal((await f.request({ action: 'restore' }, 'page-2')).ok, false);
  assert.equal((await f.request({ action: 'restore', ticket: ticket.ticket }, 'page-2')).ok, false);
});
await test('改变密码或清空密码后旧凭证、租约和票据全部失效', async () => {
  for (const security of [{ salt: 'new', hash: 'new-hash', createdAt: 2 }, null]) {
    const f = fixture(5); const auth = await f.request({ action: 'unlock', password: 'valid' });
    f.local.security = security;
    assert.equal((await f.request({ action: 'restore' }, 'page-2')).ok, false);
    assert.equal((await f.request({ action: 'ticket', proof: auth.proof })).ok, false);
  }
});
await test('关闭免密立刻拒绝重开；非法时长不会放宽期限', async () => {
  for (const value of [0, -1, 60, '5', NaN]) {
    const f = fixture(5); await f.request({ action: 'unlock', password: 'valid' });
    f.local.settings.rememberMinutes = value;
    assert.equal((await f.request({ action: 'restore' }, 'page-2')).ok, false);
  }
});
await test('缺失、伪造或跨文档使用证明均不能签发授权', async () => {
  const f = fixture(5); const auth = await f.request({ action: 'unlock', password: 'valid' });
  for (const action of ['ticket', 'remember']) {
    for (const proof of [undefined, '', 'forged']) assert.equal((await f.request({ action, proof }, 'unknown')).ok, false);
    assert.equal((await f.request({ action, proof: auth.proof }, 'page-2')).ok, false);
  }
});
await test('常驻小窗仅消费一次性 10 秒票据，默认关闭免密仍可显式交接', async () => {
  const f = fixture(); const auth = await f.request({ action: 'unlock', password: 'valid' });
  const ticket = await f.request({ action: 'ticket', proof: auth.proof });
  assert.ok((await f.request({ action: 'restore', ticket: ticket.ticket }, 'window-1')).ok);
  assert.equal((await f.request({ action: 'restore', ticket: ticket.ticket }, 'window-2')).ok, false);
  const expired = await f.request({ action: 'ticket', proof: auth.proof }); f.at(1010000);
  assert.equal((await f.request({ action: 'restore', ticket: expired.ticket }, 'window-2')).ok, false);
});
await test('票据拒绝原型属性键与伪造值，即使免密租约有效也不降级放行', async () => {
  const f = fixture(5); await f.request({ action: 'unlock', password: 'valid' });
  for (const ticket of ['__proto__', 'constructor', 'forged']) assert.equal((await f.request({ action: 'restore', ticket }, 'page-2')).ok, false);
});
await test('并发消费同一票据只能有一个成功', async () => {
  const f = fixture(); const auth = await f.request({ action: 'unlock', password: 'valid' });
  const ticket = await f.request({ action: 'ticket', proof: auth.proof });
  const results = await Promise.all([f.request({ action: 'restore', ticket: ticket.ticket }, 'one'), f.request({ action: 'restore', ticket: ticket.ticket }, 'two')]);
  assert.equal(results.filter(result => result.ok).length, 1);
});
await test('开启免密按最近密码验证时间起算，不凭设置操作延长窗口', async () => {
  const f = fixture(); const auth = await f.request({ action: 'unlock', password: 'valid' });
  f.at(1120000); f.local.settings.rememberMinutes = 5;
  const remembered = await f.request({ action: 'remember', proof: auth.proof });
  assert.equal(remembered.expires, 1300000);
});
await test('时钟回拨不会延长会话或窗口票据', async () => {
  const f = fixture(5); const auth = await f.request({ action: 'unlock', password: 'valid' });
  const ticket = await f.request({ action: 'ticket', proof: auth.proof }); f.at(999999);
  assert.equal((await f.request({ action: 'restore' }, 'one')).ok, false);
  assert.equal((await f.request({ action: 'restore', ticket: ticket.ticket }, 'two')).ok, false);
});
await test('会话存储中没有明文密码或密码摘要', async () => {
  const f = fixture(5); await f.request({ action: 'unlock', password: 'valid' });
  const stored = JSON.stringify(f.session()); assert.ok(!stored.includes('valid') && !stored.includes('test-hash'));
});
await test('校验密码期间改密，旧校验结果不能签发新授权', async () => {
  const local = { security: { salt: 'old', hash: 'hash', createdAt: 1 }, settings: { rememberMinutes: 5 } };
  let saved;
  const service = context.OTP.createAccessService({ readLocal: async () => structuredClone(local), readSession: async () => undefined, writeSession: async state => { saved = state; },
    verify: async () => { local.security.salt = 'new'; return true; }, now: () => 1000, random: () => 'random' });
  assert.equal((await service.request({ action: 'unlock', password: 'valid' }, 'one')).ok, false);
  assert.equal(saved.lease, null);
});
await test('密码校验期间关闭免密，不再按旧设置签发租约', async () => {
  const local = { security: { salt: 'old', hash: 'hash', createdAt: 1 }, settings: { rememberMinutes: 5 } };
  const service = context.OTP.createAccessService({ readLocal: async () => structuredClone(local), readSession: async () => undefined, writeSession: async () => {},
    verify: async () => { local.settings.rememberMinutes = 0; return true; }, now: () => 1000, random: () => 'random' });
  const result = await service.request({ action: 'unlock', password: 'valid' }, 'one');
  assert.ok(result.ok); assert.equal(result.expires, 0);
});
await test('会话存储写入失败不返回成功授权', async () => {
  const service = context.OTP.createAccessService({ readLocal: async () => ({ security: { salt: 'one', hash: 'hash', createdAt: 1 }, settings: { rememberMinutes: 5 } }),
    readSession: async () => undefined, writeSession: async () => { throw new Error('storage failed'); }, verify: async () => true, now: () => 1000, random: () => 'random' });
  await assert.rejects(service.request({ action: 'unlock', password: 'valid' }, 'one'), /storage failed/);
});
await test('兼容既有长密码，不在后台新增长度限制导致锁定', async () => {
  const password = 'x'.repeat(5000);
  const service = context.OTP.createAccessService({ readLocal: async () => ({ security: { salt: 'one', hash: 'hash', createdAt: 1 }, settings: {} }),
    readSession: async () => undefined, writeSession: async () => {}, verify: async value => value === password, now: () => 1000, random: () => 'random' });
  assert.ok((await service.request({ action: 'unlock', password }, 'one')).ok);
});
