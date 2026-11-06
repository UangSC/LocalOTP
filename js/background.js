/* MV3 后台：弹窗关闭后继续同步，失败后由 alarm 重试。 */
globalThis.window = globalThis;
importScripts("util.js", "totp.js", "seed.js", "sync.js", "store/security.js", "store/search.js", "store/import.js", "store.js");
importScripts("otp-input.js", "omnibox.js", "qr.js");
importScripts("access-service.js");
importScripts("scan-background.js");
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
let managementChain = Promise.resolve();
function openManagement(message, caller) {
  const task = managementChain.catch(() => {}).then(async () => {
    const result = await accessService.request({ ...message, action: "ticket" }, caller);
    if (!result.ok) return result;
    const url = chrome.runtime.getURL("index.html");
    const expected = new URL(url);
    try {
      // 查询自有扩展页面无需读取其他站点权限；并发打开也只创建一个管理页。
      const tabs = (await chrome.tabs.query({})).filter(tab => {
        try { const target = new URL(tab.pendingUrl || tab.url); return target.protocol === expected.protocol && target.hostname === expected.hostname && target.pathname === "/index.html"; }
        catch (_) { return false; }
      });
      const existing = tabs.find(tab => !tab.discarded) || tabs[0];
      if (existing) {
        // 不更新 URL、不刷新文档，也不自动解锁已经锁定的管理页。
        await chrome.tabs.update(existing.id, { active: true });
        await chrome.windows.update(existing.windowId, { focused: true });
        return { ok: true, reused: true, tabId: existing.id };
      }
      const tab = await chrome.tabs.create({ url: url + "#unlock=" + encodeURIComponent(result.ticket), active: true });
      return { ok: true, reused: false, tabId: tab.id };
    } catch (_) { return { ok: false, code: "PAGE_OPEN_FAILED", error: "浏览器未能打开管理页，请重试" }; }
  });
  managementChain = task;
  return task;
}
function openFloating(ticket) {
  const task = floatingChain.catch(() => {}).then(async () => {
    await OTP.rememberScanWindow();
    const key = "localotp:floating-window:v1";
    const id = (await chrome.storage.session.get(key))[key];
    if (Number.isInteger(id)) {
      try { await chrome.windows.update(id, { focused: true }); return { ok: true, reused: true }; } catch (_) {}
    }
    const window = await chrome.windows.create({ url: chrome.runtime.getURL("popup.html") + "?floating=1#unlock=" + encodeURIComponent(ticket), type: "popup", width: 430, height: 740, focused: true });
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
  if (message?.type === "localotp:scan-page") {
    OTP.scanPageRequest(message,sender,accessService).then(reply,()=>reply({ok:false,error:"扫码操作失败，请重试"}));
    return true;
  }
  if (message?.type === "localotp:access") {
    const caller = OTP.accessCaller(message, sender, chrome.runtime.id);
    if (!caller) { reply({ ok: false, code: "INVALID_CONTEXT", error: "无法识别当前扩展页面，请重新加载扩展" }); return; }
    const task = message.action === "scan-capture"
      ? OTP.scanBackground(message, caller, accessService, sender)
      : message.action === "page"
      ? openManagement(message, caller)
      : message.action === "float"
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
  const data = (v) => [v?.accounts, v?.categories, v?.tombstones, v?.categoryTombstones];
  if (!old?.settings?.syncEnabled || !OTP.syncModel.equal(data(old), data(next))) schedule();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "localotp:sync") synchronize();
});
chrome.runtime.onStartup.addListener(() => ready.then(() => {
  if (OTP.store.settings().syncEnabled) schedule();
}));
ready.then(() => { if (OTP.store.settings().syncEnabled) schedule(); });
