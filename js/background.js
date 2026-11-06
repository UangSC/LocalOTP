/* MV3 后台：弹窗关闭后继续同步，失败后由 alarm 重试。 */
globalThis.window = globalThis;
importScripts("util.js", "totp.js", "seed.js", "sync.js", "store.js");
importScripts("otp-input.js", "omnibox.js");
importScripts("access-service.js");
const ready = OTP.store.init();
const ACCESS_KEY = "localotp:access:v1";
const accessService = OTP.createAccessService({
  async readLocal() {
    await ready;
    const data = await chrome.storage.local.get(["localotp:data:v2", "localotp:security:v2"]);
    return { settings: data["localotp:data:v2"]?.settings, security: data["localotp:security:v2"] };
  },
  readSession: async () => (await chrome.storage.session.get(ACCESS_KEY))[ACCESS_KEY],
  writeSession: state => chrome.storage.session.set({ [ACCESS_KEY]: state }),
  verify: (password, record) => OTP.store.verifyPassword(password, record),
});
const DATA_KEY = "localotp:data:v2";
let timer;
let syncing = false;
let again = false;
let floatingChain = Promise.resolve();
function openFloating(ticket) {
  const task = floatingChain.catch(() => {}).then(async () => {
    const key = "localotp:floating-window:v1";
    const id = (await chrome.storage.session.get(key))[key];
    if (Number.isInteger(id)) {
      try { await chrome.windows.update(id, { focused: true }); return { ok: true, reused: true }; } catch (_) {}
    }
    const window = await chrome.windows.create({ url: chrome.runtime.getURL("popup.html") + "?floating=1#unlock=" + encodeURIComponent(ticket), type: "popup", width: 430, height: 680, focused: true });
    await chrome.storage.session.set({ [key]: window.id });
    return { ok: true };
  });
  floatingChain = task; return task;
}

async function synchronize() {
  await ready;
  if (syncing) { again = true; return OTP.store.sync.now(); }
  if (!OTP.store.settings().syncEnabled) return { ok: false, error: "同步尚未开启" };
  syncing = true;
  try { return await OTP.store.sync.now(); }
  finally {
    syncing = false;
    if (again) { again = false; schedule(); }
  }
}
function schedule() {
  // alarm 持久化重试意图；定时器只用于缩短正常编辑后的等待。
  chrome.alarms.create("localotp:sync", { delayInMinutes: 1, periodInMinutes: 5 });
  clearTimeout(timer);
  timer = setTimeout(synchronize, 1100);
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === "localotp:access") {
    const caller = OTP.accessCaller(message, sender, chrome.runtime.id);
    if (!caller) { reply({ ok: false, code: "INVALID_CONTEXT", error: "无法识别当前扩展页面，请重新加载扩展" }); return; }
    const task = message.action === "float"
      ? accessService.request({ ...message, action: "ticket" }, caller).then(result => result.ok ? openFloating(result.ticket).catch(() => ({ ok: false, code: "WINDOW_CREATE_FAILED", error: "浏览器未能创建独立窗口，请检查浏览器策略后重试" })) : result)
      : accessService.request(message, caller);
    task.then(reply, () => reply({ ok: false, code: "SESSION_FAILED", error: "浏览器会话存储操作失败，请重新加载扩展" }));
    return true;
  }
  if (message?.type !== "localotp:sync") return;
  synchronize().then(reply, (error) => reply({ ok: false, error: error.message }));
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[DATA_KEY] || changes["localotp:security:v2"])) accessService.request({ action: "refresh" }, "background").catch(() => {});
  if (area === "sync" && Object.keys(changes).some(OTP.syncModel.ownedKey)) schedule();
  if (area !== "local" || !changes[DATA_KEY]) return;
  const { oldValue: old, newValue: next } = changes[DATA_KEY];
  if (!next?.settings?.syncEnabled) {
    clearTimeout(timer);
    chrome.alarms.clear("localotp:sync");
    return;
  }
  const data = (v) => JSON.stringify([v?.accounts, v?.categories, v?.tombstones, v?.categoryTombstones]);
  if (!old?.settings?.syncEnabled || data(old) !== data(next)) schedule();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "localotp:sync") synchronize();
});
chrome.runtime.onStartup.addListener(() => ready.then(() => {
  if (OTP.store.settings().syncEnabled) schedule();
}));
ready.then(() => { if (OTP.store.settings().syncEnabled) schedule(); });
