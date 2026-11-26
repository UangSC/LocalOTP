/* 多设备存储模拟：执行真实 store / sync 模块，不访问任何用户账号。 */
import vm from "node:vm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const clone = (v) => v === undefined ? v : JSON.parse(JSON.stringify(v));
const DATA = "localotp:data:v2";
let count = 0;
const check = (name, fn) => { fn(); count++; console.log("✓ " + name); };
function backend(initial = {}) {
  return { data: clone(initial), calls: [], failure: null, delay: 0, listeners: new Set(), chain: Promise.resolve() };
}
function device(remote, local = backend()) {
  const listeners = new Set();
  const sandbox = { console, crypto: globalThis.crypto, TextEncoder, TextDecoder, URL, URLSearchParams,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"), atob: (s) => Buffer.from(s, "base64").toString("binary"),
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout,
    matchMedia: () => ({ matches: false }), localStorage: { setItem() {}, getItem() {}, removeItem() {} },
    navigator: { locks: { request: (_, fn) => { const p = local.chain.then(fn); local.chain = p.catch(() => {}); return p; } } },
    document: {},
  };
  function area(source, name) {
    const result = { QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512 };
    for (const method of ["get", "set", "remove", "getBytesInUse"]) result[method] = async (payload) => {
      source.calls.push(method);
      if (source.delay) await new Promise((r) => setTimeout(r, source.delay));
      if (source.failure === method) throw new Error("模拟 " + method + " 失败");
      if (method === "get") return payload === null ? clone(source.data) : { [payload]: clone(source.data[payload]) };
      if (method === "getBytesInUse") return Buffer.byteLength(JSON.stringify(source.data));
      const changes = {};
      if (method === "set") for (const [k, v] of Object.entries(payload)) {
        if (JSON.stringify(source.data[k]) === JSON.stringify(v)) continue;
        changes[k] = { oldValue: clone(source.data[k]), newValue: clone(v) }; source.data[k] = clone(v);
      }
      else for (const k of Array.isArray(payload) ? payload : [payload]) {
        changes[k] = { oldValue: clone(source.data[k]) }; delete source.data[k];
      }
      if (Object.keys(changes).length) queueMicrotask(() => {
        for (const notify of source.listeners) notify(changes, name);
      });
    };
    return result;
  }
  sandbox.chrome = { runtime: {}, storage: { local: area(local, "local"), sync: area(remote, "sync"),
    onChanged: { addListener: (fn) => listeners.add(fn) } } };
  const notify = (changes, name) => listeners.forEach((fn) => fn(changes, name));
  local.listeners.add(notify); remote.listeners.add(notify);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ["util.js", "totp.js", "seed.js", "sync.js", "store/security.js", "store/search.js", "store/import.js", "store.js"]) {
    vm.runInContext(readFileSync(resolve("js", file), "utf8"), sandbox, { filename: file });
  }
  return { store: sandbox.OTP.store, model: sandbox.OTP.syncModel, sandbox, local,
    close() { sandbox.OTP.store.sync.cancel(); local.listeners.delete(notify); remote.listeners.delete(notify); } };
}
const payload = (email = "demo@example.com") => ({ email, secret: "JBSWY3DPEHPK3PXP", password: "demo-only" });
const remote = backend();
const a = device(remote), b = device(remote), offline = device(remote);
await Promise.all([a.store.init(), b.store.init(), offline.store.init()]);
check("扩展首次使用没有虚构账号参与同步", () => assert.equal(a.store.accounts().length, 0));
check("扩展首次使用预置 4 个默认平台分类", () => assert.deepEqual(Array.from(a.store.categories(), c => c.name), ["Google", "GitHub", "ChatGPT", "Microsoft"]));
const beforeInspect = JSON.stringify({ local: a.local.data, remote: remote.data });
const writesBeforeInspect = remote.calls.filter(call => call === "set" || call === "remove").length;
const emptyInspect = await a.store.sync.inspect();
check("只读诊断准确报告空缓存", () => assert.ok(emptyInspect.ok && emptyInspect.localAccounts === 0 && emptyInspect.cachedAccounts === 0));
check("诊断不写入或删除本机与同步记录", () => assert.ok(beforeInspect === JSON.stringify({ local: a.local.data, remote: remote.data }) && writesBeforeInspect === remote.calls.filter(call => call === "set" || call === "remove").length));
a.store.saveCategory({ name: "工作", icon: "code" });
const cat = a.store.categories().find(c => c.name === "工作");
const first = a.store.createAccount({ ...payload(), categoryId: cat.id });
await a.store.setPassword("test-password");
await a.store.sync.enable();
await b.store.sync.enable();
await offline.store.sync.enable();
check("新设备拉取账号", () => assert.equal(b.store.accounts()[0].id, first.id));
check("新设备拉取分类并保持关联", () => assert.ok(b.store.categories().some(c => c.id === b.store.accounts()[0].categoryId)));
check("管理密码与设置没有上传", () => assert.ok(Object.keys(remote.data).every((k) => /^(acc:|cat:)/.test(k))));
offline.close();
b.store.updateAccount(first.id, { note: "从另一台设备编辑" });
await b.store.sync.now(); await a.store.sync.now();
check("更新可以双向合并", () => assert.equal(a.store.byId(first.id).note, "从另一台设备编辑"));
a.store.saveCategory({ id: cat.id, name: "开发", icon: "code" });
await a.store.sync.now(); await b.store.sync.now();
check("分类重命名传播", () => assert.equal(b.store.categories().find(c => c.id === cat.id)?.name, "开发"));
a.store.deleteCategory(cat.id);
a.store.deleteCategory("cat_google");
await a.store.sync.now(); await b.store.sync.now();
check("自定义与默认分类均可删除并传播", () => assert.ok(!b.store.categories().some(c => c.id === cat.id || c.id === "cat_google")));
check("删除分类后账号移回未分类", () => assert.equal(b.store.byId(first.id).categoryId, ""));
a.store.deleteAccount(first.id);
await a.store.sync.now(); await b.store.sync.now();
check("删除账号传播", () => assert.equal(b.store.accounts().length, 0));
await b.store.sync.now();
check("没有本地账号的设备不会清掉墓碑", () => assert.ok(remote.data["tomb:" + first.id]));
await offline.store.sync.now();
check("离线设备旧数据不会复活", () => assert.equal(offline.store.accounts().length, 0));
check("离线旧分类与已删默认分类不会复活", () => assert.ok(!offline.store.categories().some(c => c.id === cat.id || c.id === "cat_google")));
const oldTomb = Date.now() - 60 * 86400000;
remote.data["tomb:ancient"] = oldTomb;
await a.store.sync.now();
check("长期离线的删除记录继续保留", () => assert.equal(remote.data["tomb:ancient"], oldTomb));
const second = a.store.createAccount(payload("retry@example.com"));
remote.failure = "set";
const failed = await a.store.sync.now();
check("Promise 存储错误不会被误报成功", () => assert.equal(failed.ok, false));
check("失败时本地账号仍保留", () => assert.ok(a.local.data[DATA].accounts.some((x) => x.id === second.id)));
check("同步失败状态可见", () => assert.match(a.store.sync.info().error, /失败/));
remote.failure = null;
const retry = await a.store.sync.now();
check("失败后可重试", () => assert.equal(retry.ok, true));
check("重试成功清除错误", () => assert.equal(a.store.sync.info().error, ""));
const setCount = remote.calls.filter((x) => x === "set").length;
await a.store.sync.now();
check("无变更时不重复写同步存储", () => assert.equal(remote.calls.filter((x) => x === "set").length, setCount));
// 真实 Chromium 存储会重排对象字段；JSON 字符串不同不代表记录变化。
const reorder = value => JSON.parse(JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
remote.data = reorder(remote.data);
const unchangedWrites = remote.calls.filter(method => method === "set").length;
const reordered = await a.store.sync.now();
check("存储字段重排不造成重复推送与虚假拉取", () => assert.ok(reordered.pushed === 0 && reordered.pulled === 0 && remote.calls.filter(method => method === "set").length === unchangedWrites));
remote.delay = 30;
const x = a.store.sync.now(), y = a.store.sync.now();
check("重复点击同步合并为同一个任务", () => assert.equal(x, y));
await x; remote.delay = 0;
a.store.updateAccount(second.id, { note: "字".repeat(4000) });
const tooBig = await a.store.sync.now();
check("单条配额超限有明确提示", () => assert.match(tooBig.error, /8 KB/));
check("配额失败不丢本机备注", () => assert.equal(a.store.byId(second.id).note.length, 4000));
a.store.updateAccount(second.id, { note: "" });
await a.store.sync.now();
remote.failure = "get";
const readFailed = await a.store.sync.now();
check("远端读取失败可见", () => assert.equal(readFailed.ok, false));
remote.failure = null;
await a.store.sync.disable();
const disabled = await a.store.sync.now();
check("关闭同步后手动调用不会上传", () => assert.equal(disabled.ok, false));
check("关闭同步不会删除远端数据", () => assert.ok(remote.data["acc:" + second.id]));

// 相同时间戳采用确定性排序，交换合并顺序仍收敛。
const base = { ...payload(), id: "tie", createdAt: 10, updatedAt: 20 };
const left = { accounts: [{ ...base, note: "a" }] }, right = { accounts: [{ ...base, note: "b" }] };
check("同时编辑时冲突结果确定且收敛", () => assert.equal(JSON.stringify(a.model.merge(left, right)), JSON.stringify(a.model.merge(right, left))));
check("仅一端字段重排也不改变同时间戳冲突的胜出记录", () => assert.ok(
  a.model.equal(a.model.merge(left, right), a.model.merge(left, reorder(right))) &&
  a.model.equal(a.model.merge(left, right), a.model.merge(reorder(left), right))));
check("账号数组的记录顺序仍有意义", () => assert.equal(a.model.equal([base, { ...base, id: "other" }], [{ ...base, id: "other" }, base]), false));
check("新增字段与缺失字段仍可区分", () => assert.equal(a.model.equal(base, { ...base, note: "changed" }), false));
const sameLocal = backend();
const tab1 = device(backend(), sameLocal), tab2 = device(backend(), sameLocal);
await tab1.store.init(); await tab2.store.init();
const one = tab1.store.createAccount(payload("one@example.com"));
const two = tab2.store.createAccount(payload("two@example.com"));
await Promise.all([tab1.store.persist(), tab2.store.persist()]);
check("同一浏览器多页面同时新增不覆盖", () => assert.equal(sameLocal.data[DATA].accounts.length, 2));
tab1.store.deleteAccount(one.id); tab2.store.updateAccount(two.id, { issuer: "修改" });
await Promise.all([tab1.store.persist(), tab2.store.persist()]);
check("多页面删除与更新同时保存", () => assert.deepEqual(sameLocal.data[DATA].accounts.map((v) => [v.id, v.issuer]), [[two.id, "修改"]]));
tab1.store.patchSettings({ theme: "dark" }); tab2.store.patchSettings({ view: "grid" });
await Promise.all([tab1.store.persist(), tab2.store.persist()]);
check("不同页面修改独立设置不互相覆盖", () => assert.equal(sameLocal.data[DATA].settings.theme + "/" + sameLocal.data[DATA].settings.view, "dark/grid"));
const quotaRemote = backend();
const quotaDevice = device(quotaRemote); await quotaDevice.store.init();
quotaDevice.store.createAccount(payload("quota@example.com"));
quotaDevice.sandbox.chrome.storage.sync.QUOTA_BYTES = 50;
try { await quotaDevice.store.sync.enable(); } catch (_) {}
check("总容量超限不会写入远端", () => assert.equal(Object.keys(quotaRemote.data).length, 0));
check("总容量超限会报告容量", () => assert.match(quotaDevice.store.sync.info().error, /100 KB/));
quotaDevice.sandbox.chrome.storage.sync.QUOTA_BYTES = 102400;
quotaDevice.sandbox.chrome.storage.sync.MAX_ITEMS = 0.5;
const itemLimit = await quotaDevice.store.sync.now();
check("条目数量超限可见", () => assert.match(itemLimit.error, /条目数量/));
quotaDevice.sandbox.chrome.storage.sync.MAX_ITEMS = 512;
await quotaDevice.store.sync.now();
quotaRemote.data.foreign = {keep: true};
await quotaDevice.store.sync.now();
check("同步不删除无关存储键", () => assert.equal(quotaRemote.data.foreign.keep, true));
quotaRemote.data['acc:bad'] = {id:'different', secret:'bad'};
const invalid = await quotaDevice.store.sync.now();
check("损坏的远端账号阻止写入而不删除", () => assert.ok(!invalid.ok && quotaRemote.data['acc:bad']));
delete quotaRemote.data['acc:bad'];
// 验证 Chrome callback lastError 分支，而不只是 Promise API。
quotaDevice.sandbox.chrome.storage.sync.get = (_, callback) => {
  quotaDevice.sandbox.chrome.runtime.lastError = {message:'callback-read-error'};
  callback(); delete quotaDevice.sandbox.chrome.runtime.lastError;
};
const callbackFailure = await quotaDevice.store.sync.now();
check("callback lastError 正确传播", () => assert.match(callbackFailure.error, /callback-read-error/));
const legacyRemote = backend({categories:[{id:'old-cat',name:'旧分类',icon:'folder',createdAt:1}],
  'acc:old':{...payload('old@example.com'), id:'old', categoryId:'old-cat',createdAt:1,updatedAt:1}});
const legacy = device(legacyRemote); await legacy.store.init(); await legacy.store.sync.enable();
check("旧分类数组迁移为逐条记录", () => assert.ok(legacyRemote.data['cat:old-cat'] && !legacyRemote.data.categories));
check("迁移保留账号与分类关联", () => assert.equal(legacy.store.accounts()[0].categoryId, 'old-cat'));
quotaDevice.close(); legacy.close();
// 1.5.0 使用的 acc:/cat: 逐项布局；版本升级不改变命名空间，扩展 ID 改变才会换空间。
const v150 = backend({ 'acc:v150': { ...payload('legacy@example.com'), id: 'v150', categoryId: 'group', createdAt: 1, updatedAt: 1 },
  'cat:group': { id: 'group', name: '旧版本分类', icon: 'folder', createdAt: 1, updatedAt: 1 } });
const upgraded = device(v150); await upgraded.store.init(); const upgradeResult = await upgraded.store.sync.enable();
check("同一同步空间可读取 1.5.0 的账号和分类", () => assert.ok(upgradeResult.remoteAccounts === 1 && upgraded.store.accounts()[0].id === 'v150' && upgraded.store.categories().some(c => c.id === 'group')));
const oldSpace = JSON.stringify(v150.data), newNamespace = backend(), freshInstall = device(newNamespace);
await freshInstall.store.init(); const newResult = await freshInstall.store.sync.enable();
check("新扩展 ID 的空空间明确返回 0 条而不是旧账号", () => assert.ok(newResult.remoteAccounts === 0 && newResult.localAccounts === 0 && newResult.pulled === 0));
check("新空间空同步不会清除另一个旧空间", () => assert.equal(JSON.stringify(v150.data), oldSpace));
upgraded.close(); freshInstall.close();
for (const d of [a, b, offline, tab1, tab2]) d.close();
console.log(`同步测试 ${count} 项通过`);
