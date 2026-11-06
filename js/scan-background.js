/* 网页蒙版扫码。仅向主动授权的顶层文档注入，消息绑定文档和已有解锁凭证。 */
(function (global) {
  "use strict";
  const OTP = global.OTP,
    KEY = "localotp:scan:v2",
    WINDOW_KEY = "localotp:scan-windows:v1",
    ALARM = "localotp:scan-cleanup";
  let starting = false,
    queue = Promise.resolve();
  let focusQueue = Promise.resolve();
  // 只记最近聚焦的窗口 ID；画中画也属于 normal，选目标时用 sender 排除。
  // 不能按标签创建时间猜目标，否则后台新开的网页会抢走当前扫码目标。
  OTP.rememberScanWindow = function (id) {
    focusQueue = focusQueue.catch(() => {}).then(async () => {
      const window = Number.isInteger(id)
        ? await chrome.windows.get(id)
        : await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      if (window.type === "normal") {
        const previous = (await chrome.storage.session.get(WINDOW_KEY))[WINDOW_KEY] || [];
        await chrome.storage.session.set({ [WINDOW_KEY]: [window.id, ...previous.filter(value => value !== window.id)].slice(0, 20) });
      }
    }).catch(() => {});
    return focusQueue;
  };
  chrome.windows.onFocusChanged.addListener(id => {
    if (id >= 0) OTP.rememberScanWindow(id);
  });
  const read = async () => (await chrome.storage.session.get(KEY))[KEY];
  const write = (job) => chrome.storage.session.set({ [KEY]: job });
  async function discard(job, notify = true) {
    const current = await read();
    if (current?.token !== job?.token) return;
    await chrome.storage.session.remove(KEY);
    if (notify)
      await chrome.tabs
        .sendMessage(
          job.tabId,
          { type: "localotp:scan-close", token: job.token },
          { documentId: job.documentId },
        )
        .catch(() => {});
  }
  OTP.scanBackground = async function (message, caller, service, sender = {}) {
    const auth = await service.request({ ...message, action: "check" }, caller);
    if (!auth.ok) return auth;
    if (starting) return { ok: false, error: "正在准备扫码，请稍候" };
    starting = true;
    let job;
    try {
      // 常驻 / 置顶小窗也截取最近使用的普通浏览器窗口，不能把扩展自身当成目标。
      const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
      let [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
      // Chromium 把 Document PiP 也报告为 normal；用可信 sender 排除本次调用的小窗。
      if (window.id === sender.tab?.windowId) {
        await focusQueue;
        const ids = (await chrome.storage.session.get(WINDOW_KEY))[WINDOW_KEY] || [];
        const candidates = (await chrome.tabs.query({ active: true, windowType: "normal" }))
          .filter(item => item.windowId !== sender.tab.windowId);
        tab = ids.map(id => candidates.find(item => item.windowId === id)).find(Boolean)
          || (candidates.length === 1 ? candidates[0] : null);
      } else await OTP.rememberScanWindow(window.id);
      if (!tab || !/^https?:\/\//i.test(tab.url || ""))
        return { ok: false, error: "请在需要扫码的普通网页上点击扩展图标后重试；浏览器内部页面请使用本地图片" };
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const [current] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (current?.id !== tab.id || current.url !== tab.url)
        return { ok: false, error: "页面已切换，请重新扫码" };
      if (image.length > 10 * 1024 * 1024) return { ok: false, error: "画面过大，请缩小窗口后重试" };
      const previous = await read();
      if (previous) await discard(previous);
      const [{ documentId }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["js/util.js", "js/vendor/jsQR.js", "js/qr.js", "js/qr-crop.js", "js/scan-page.js"],
      });
      const live = await service.request({ ...message, action: "check" }, caller);
      if (!live.ok) return live;
      job = {
        token: crypto.randomUUID(),
        tabId: tab.id,
        documentId,
        caller,
        proof: message.proof,
        epoch: live.epoch,
        expires: Date.now() + 300000,
      };
      await write(job);
      await chrome.alarms.create(ALARM, { delayInMinutes: 5 });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, documentIds: [documentId] },
        func: (image, options) => {
          OTP.scanPage.start(image, options);
        },
        args: [image, { token: job.token, expires: job.expires, theme: message.theme || {} }],
      });
      await chrome.windows.update(tab.windowId, { focused: true });
      return { ok: true, inPage: true };
    } catch (_) {
      if (job) await discard(job);
      return { ok: false, error: "请先在目标网页点击一次扩展图标以授予本次截图权限，再重试；受保护网页可使用本地图片" };
    } finally {
      starting = false;
    }
  };
  async function pageRequest(message, sender, service) {
    const job = await read();
    if (
      !job ||
      sender.id !== chrome.runtime.id ||
      sender.tab?.id !== job.tabId ||
      sender.frameId !== 0 ||
      sender.documentId !== job.documentId ||
      message.token !== job.token
    )
      return { ok: false, error: "扫描授权已失效，请重新扫码" };
    if (message.action === "cancel") {
      await discard(job, false);
      return { ok: true };
    }
    if (job.expires <= Date.now()) {
      await discard(job);
      return { ok: false, error: "扫描已超时，请重新扫码" };
    }
    const auth = await service.request({ action: "check", proof: job.proof }, job.caller);
    if (!auth.ok || auth.epoch !== job.epoch) {
      await discard(job);
      return { ok: false, error: "账号库已锁定，请重新解锁后扫码" };
    }
    if (message.action === "preview") {
      if (typeof message.raw !== "string" || message.raw.length > 24576)
        return { ok: false, error: "二维码内容过长" };
      const parsed = OTP.qr.parse(message.raw);
      if (!parsed.account) return { ok: false, error: parsed.error || "二维码中没有 OTP" };
      const a = parsed.account;
      job.account = {
        secret: a.secret,
        algorithm: a.algorithm,
        digits: a.digits,
        period: a.period,
        email: a.email || a.account || "",
        issuer: a.issuer || "",
      };
      await write(job);
    }
    if (!job.account) return { ok: false, error: "请先识别二维码" };
    if (message.action === "save") {
      const email = typeof message.email === "string" ? message.email.trim() : "",
        issuer = typeof message.issuer === "string" ? message.issuer.trim() : "";
      if (email.length > 256 || issuer.length > 256) return { ok: false, error: "账号或服务名称过长" };
      const a = job.account,
        duplicate = OTP.store
          .accounts()
          .some(
            (item) =>
              item.secret === a.secret &&
              item.algorithm === a.algorithm &&
              item.digits === a.digits &&
              item.period === a.period,
          );
      if (!duplicate) OTP.store.createAccount({ ...a, email, issuer, password: "" });
      await OTP.store.persist();
      await discard(job, false);
      return { ok: true, saved: true, duplicate };
    }
    if (!["preview", "code"].includes(message.action)) return { ok: false, error: "不支持的扫码操作" };
    const { secret, ...meta } = job.account,
      result = await OTP.totp.generate({ ...job.account, cache: false });
    return {
      ok: true,
      account: meta,
      code: result.code,
      expires: (result.counter + 1) * job.account.period * 1000,
    };
  }
  OTP.scanPageRequest = (message, sender, service) => {
    const task = queue.catch(() => {}).then(() => pageRequest(message, sender, service));
    queue = task;
    return task;
  };
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM) return;
    const job = await read();
    if (job && job.expires <= Date.now()) await discard(job);
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    const change = area === "session" && changes["localotp:access:v1"];
    if (!change || change.oldValue?.epoch === change.newValue?.epoch) return;
    const job = await read();
    if (job && job.epoch !== change.newValue?.epoch) await discard(job);
  });
  chrome.tabs.onRemoved.addListener(async (id) => {
    const job = await read();
    if (job?.tabId === id) await discard(job, false);
  });
})(globalThis);
