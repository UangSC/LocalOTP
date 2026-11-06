/* 验证真实算法与生命周期：参考码由 Node crypto 独立计算，不复用被测实现。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // RFC 公共密钥 12345678901234567890
const other = 'JBSWY3DPEHPK3PXP';
function sandbox(crypto = webcrypto) {
  const context = { OTP: {}, crypto, URL, URLSearchParams, setTimeout, clearTimeout };
  context.window = context;
  vm.createContext(context);
  for (const file of ['totp', 'otp-input', 'otp-session']) vm.runInContext(readFileSync(`js/${file}.js`, 'utf8'), context);
  return context;
}
const { OTP } = sandbox();
function reference(time, algorithm = 'SHA1', period = 30, digits = 6) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / period)));
  const hash = createHmac(algorithm.toLowerCase(), '12345678901234567890').update(counter).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const waitFor = async condition => { for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 2)); } assert.fail('状态等待超时'); };
function controlled(options = {}) {
  let time = 29_999, sequence = 0;
  const tasks = new Map(), states = [];
  const session = OTP.createOtpSession({ now: () => time, schedule: (fn, delay) => { tasks.set(++sequence, { fn, delay }); return sequence; },
    cancel: id => tasks.delete(id), onState: value => states.push(value), ...options });
  return { session, tasks, states, at: value => { time = value; },
    run: async () => { const entries = [...tasks.values()]; tasks.clear(); for (const task of entries) await task.fn(); await flush(); } };
}

await test('三种算法 × 自定义周期 × 6/8 位 × 边界与远期时间，与独立 HMAC 对照', async () => {
  for (const algorithm of ['SHA1', 'SHA256', 'SHA512']) for (const period of [1, 30, 45, 60, 86400]) for (const digits of [6, 8]) {
    for (const at of [0, period * 1000 - 1, period * 1000, period * 1000 + 1, 2_000_000_000_000, 20_000_000_000_000]) {
      const actual = await OTP.totp.generate({ secret, algorithm, period, digits }, at);
      assert.equal(actual.code, reference(at, algorithm, period, digits));
      assert.ok(actual.remaining > 0 && actual.remaining <= period);
    }
  }
});
await test('Web Crypto 缺失时拒绝返回伪验证码', async () => {
  const { OTP: insecure } = sandbox(undefined);
  // 默认形参会回填 webcrypto，因此明确传入不含 subtle 的对象。
  const absent = sandbox({}).OTP;
  await assert.rejects(absent.totp.generate({ secret }, 59000), /Web Crypto/);
  assert.ok(insecure.totp.hasSubtle());
});
await test('参数错误不会静默降级为 SHA-1 / 6 位 / 30 秒', async () => {
  for (const algorithm of ['MD5', '__proto__']) await assert.rejects(OTP.totp.hotp(secret, { algorithm }, 0));
  for (const digits of [0, 5, 7, 9, NaN]) await assert.rejects(OTP.totp.hotp(secret, { digits }, 0));
  for (const period of [0, -1, 1.5, 86401, Infinity]) assert.throws(() => OTP.totp.cycle(period));
  for (const at of [-1, NaN, Infinity]) assert.throws(() => OTP.totp.cycle(30, at));
  for (const counter of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(OTP.totp.hotp(secret, {}, counter));
});
await test('Base32 校验区分空值、非法字符、非法长度及错误填充', () => {
  for (const value of ['', '1234567890', 'A'.repeat(17), 'A'.repeat(19), 'A'.repeat(22), secret + '========', 'A'.repeat(2050)]) {
    assert.equal(OTP.totp.validateSecret(value).ok, false, value.slice(0, 30));
  }
  assert.equal(OTP.otpInput.parse(' gezd gnbv gy3t qojq gezd gnbv gy3t qojq ').account.secret, secret);
  assert.ok(OTP.otpInput.parse('MZXW6YTBOI3W64TMMQ======').account);
});
await test('otpauth 保留 SHA-512 / 8 位 / 45 秒，拒绝 HOTP、重复或损坏的参数', () => {
  const uri = `otpauth://totp/Example:demo?secret=${secret}&algorithm=SHA512&digits=8&period=45`;
  const parsed = OTP.otpInput.parse(uri);
  assert.equal(parsed.account.period, 45); assert.equal(parsed.account.digits, 8); assert.equal(parsed.account.algorithm, 'SHA512');
  for (const raw of [uri + '&period=30', uri.replace('totp', 'hotp'), uri.replace('SHA512', 'MD5'), uri.replace('digits=8', 'digits=7'), uri.replace('period=45', 'period=0'), uri.replace('Example:demo', '%FF')]) assert.ok(OTP.otpInput.parse(raw).error);
  assert.ok(OTP.otpInput.parse(uri, { period: 30 }).error);
});
await test('URL 契约：片段、查询、直接密钥和编码后的 otpauth', () => {
  const base = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/api.html';
  for (const suffix of [`#${secret}`, `#otp=${secret}`, `?secret=${secret}`, `#uri=${secret}`]) assert.equal(OTP.otpInput.readLocation(base + suffix).raw, secret);
  const uri = `otpauth://totp/Test?secret=${secret}&period=45`;
  assert.equal(OTP.otpInput.readLocation(OTP.otpInput.entryUrl(base, uri)).raw, uri);
  assert.equal(OTP.otpInput.readLocation(base + '#' + encodeURIComponent(uri)).raw, uri);
  const entry = OTP.otpInput.readLocation(base + `#otp=${secret}&digits=8&period=45&algorithm=SHA256`);
  assert.equal(OTP.otpInput.parse(entry.raw, entry.options).account.period, 45);
  for (const suffix of [`?otp=${secret}#otp=${other}`, `#otp=${secret}&secret=${other}`, '#otp=', '#otp=%GZ', `#otp=${secret}&otp=${secret}`, `#otp=${secret}&callback=alert`, '#digits=8']) assert.ok(OTP.otpInput.readLocation(base + suffix).error, suffix);
});
await test('跨周期计算：29.999 秒开始、30 秒完成时只发布新周期码', async () => {
  let c, calls = 0;
  c = controlled({ generate: async (account, at) => { calls++; const result = await OTP.totp.generate(account, at); if (calls === 1) c.at(30000); return result; } });
  c.session.setInput(secret);
  await waitFor(() => c.session.snapshot().status === 'ready');
  assert.equal(c.session.snapshot().code, reference(30000)); assert.equal(calls, 2);
  assert.equal(c.states.some(s => s.code === reference(29999)), false); c.session.destroy();
});
await test('同周期只更新倒计时，不每秒重复执行 HMAC；新周期恰好计算一次', async () => {
  let calls = 0;
  const c = controlled({ generate: async (...args) => { calls++; return OTP.totp.generate(...args); } });
  c.at(1000); c.session.setInput(secret); await waitFor(() => c.session.snapshot().status === 'ready');
  for (const at of [2000, 5000, 29000]) { c.at(at); await c.run(); }
  assert.equal(calls, 1); assert.equal(c.session.snapshot().remaining, 1); assert.equal(c.tasks.size, 1);
  c.at(30000); await c.run(); await waitFor(() => c.session.snapshot().status === 'ready');
  assert.equal(calls, 2); assert.equal(c.session.snapshot().remaining, 30); c.session.destroy();
});
await test('新输入立即清除旧码；旧 Promise 后完成或失败均不能覆盖新值', async () => {
  const pending = [];
  const c = controlled({ generate: (...args) => new Promise((resolve, reject) => pending.push({ args, resolve, reject })) });
  c.session.setInput(secret); c.session.setInput(other); assert.equal(c.session.snapshot().code, '');
  pending[1].resolve(await OTP.totp.generate(...pending[1].args)); await flush();
  const latest = c.session.snapshot().code;
  pending[0].reject(new Error('旧请求失败')); await flush();
  assert.equal(c.session.snapshot().code, latest); assert.equal(c.session.snapshot().status, 'ready');
  assert.ok(!JSON.stringify(c.session.snapshot()).includes(other)); c.session.destroy();
});
await test('清除、锁屏式清除和销毁不会被挂起计算重新填充', async () => {
  for (const action of ['clear', 'destroy']) {
    let finish;
    const c = controlled({ generate: () => new Promise(resolve => { finish = resolve; }) });
    c.session.setInput(secret); c.session[action]();
    finish({ code: '123456', counter: 0 }); await flush();
    assert.equal(c.session.snapshot().code, ''); assert.equal(c.tasks.size, 0);
    assert.equal(await c.session.copy(() => assert.fail('不得复制')), false);
  }
});
await test('后台暂停停掉定时器并隐藏过期码，恢复按当前系统时间计算', async () => {
  const c = controlled(); c.session.setInput(secret); await waitFor(() => c.session.snapshot().status === 'ready');
  c.session.pause(); assert.equal(c.tasks.size, 0); assert.equal(c.session.snapshot().code, '');
  c.at(180000); c.session.resume(); await waitFor(() => c.session.snapshot().status === 'ready');
  assert.equal(c.session.snapshot().code, reference(180000)); c.session.destroy();
});
await test('复制不依赖缓存显示码：点击时重新取当前周期；写入失败可恢复', async () => {
  const c = controlled(); c.session.setInput(secret); await waitFor(() => c.session.snapshot().status === 'ready');
  c.at(30000); let copied;
  assert.ok(await c.session.copy(value => { copied = value; return true; })); assert.equal(copied, reference(30000));
  assert.equal(await c.session.copy(() => { throw new Error('denied'); }), false);
  assert.ok(await c.session.copy(() => true)); c.session.destroy();
});
await test('复制计算期间换密钥不会把旧验证码写进剪贴板', async () => {
  let release, hold = false;
  const c = controlled({ generate: (...args) => hold ? new Promise(resolve => { release = () => OTP.totp.generate(...args).then(resolve); }) : OTP.totp.generate(...args) });
  c.session.setInput(secret); await waitFor(() => c.session.snapshot().status === 'ready');
  hold = true; const pendingCopy = c.session.copy(() => assert.fail('过期输入不应写入剪贴板'));
  hold = false; c.session.setInput(other); await release(); assert.equal(await pendingCopy, false); c.session.destroy();
});
await test('系统时钟反向调整后重新计算，不维持旧周期', async () => {
  const c = controlled(); c.at(90000); c.session.setInput(secret); await waitFor(() => c.session.snapshot().status === 'ready');
  c.at(59000); await c.run(); await waitFor(() => c.session.snapshot().status === 'ready');
  assert.equal(c.session.snapshot().code, reference(59000)); c.session.destroy();
});
await test('输入错误会取消已有调度；计算错误不会形成无限重试', async () => {
  const c = controlled(); c.session.setInput(secret); await waitFor(() => c.session.snapshot().status === 'ready');
  c.session.setInput('invalid!'); assert.equal(c.session.snapshot().status, 'error'); assert.equal(c.tasks.size, 0); c.session.destroy();
  const broken = controlled({ generate: async () => { throw new Error('crypto unavailable'); } });
  broken.session.setInput(secret); await flush(); assert.equal(broken.session.snapshot().status, 'error'); assert.equal(broken.tasks.size, 0); broken.session.destroy();
});
await test('Omnibox 不回显密钥、正确处理当前/前台/后台标签，且不保存数据', () => {
  const events = {}, tabs = [], suggestions = [];
  const context = sandbox(); context.chrome = { runtime: { getURL: name => 'chrome-extension://test/' + name },
    omnibox: { setDefaultSuggestion: value => suggestions.push(value), onInputChanged: { addListener: fn => { events.changed = fn; } }, onInputEntered: { addListener: fn => { events.entered = fn; } } },
    tabs: { update: (value, done) => { tabs.push(['update', value]); done(); }, create: (value, done) => { tabs.push(['create', value]); done(); } } };
  vm.runInContext(readFileSync('js/omnibox.js', 'utf8'), context);
  events.changed(secret, value => suggestions.push(value)); assert.ok(!JSON.stringify(suggestions).includes(secret));
  for (const disposition of ['currentTab', 'newForegroundTab', 'newBackgroundTab']) events.entered(secret, disposition);
  assert.equal(tabs[0][0], 'update'); assert.equal(tabs[1][1].active, true); assert.equal(tabs[2][1].active, false);
  assert.equal(tabs[0][1].url, 'chrome-extension://test/api.html#otp=' + secret);
});
