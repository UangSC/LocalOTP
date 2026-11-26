/* LocalOTP · store 状态、持久化、检索、导入解析、备份、访问门禁摘要、跨设备同步。 这一层不碰 DOM，界面层只通过这里的方法读写数据。 */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const { uid } = OTP;
  const totp = OTP.totp;

  const DATA_KEY = "localotp:data:v2";
  const SEC_KEY = "localotp:security:v2";
  const VERSION = 2;

  /* ── 存储后端：扩展里用 chrome.storage，直接开页面时退化到 localStorage ── */

  function pickArea(name) {
    const c = global.chrome;
    if (!c || !c.storage || !c.storage[name]) return null;
    return c.storage[name];
  }

  const areaLocal = pickArea("local");
  const areaSync = pickArea("sync");

  function callArea(area, method, payload) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        const err = global.chrome && global.chrome.runtime && global.chrome.runtime.lastError;
        if (err) reject(new Error(err.message || "storage error"));
        else resolve(value);
      };
      try {
        const ret = area[method](payload, done);
        if (ret && typeof ret.then === "function") ret.then(done, (err) => {
          if (!settled) { settled = true; reject(err); }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function readKey(key) {
    if (areaLocal) {
      const res = await callArea(areaLocal, "get", key);
      return res ? res[key] : undefined;
    }
    try {
      const raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      return undefined;
    }
  }

  async function writeKey(key, value) {
    if (areaLocal) {
      await callArea(areaLocal, "set", { [key]: value });
      return;
    }
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      throw new Error("本机存储写入失败：" + (err.message || "存储空间不足"));
    }
  }

  async function removeKey(key) {
    if (areaLocal) {
      await callArea(areaLocal, "remove", key);
      return;
    }
    try {
      global.localStorage.removeItem(key);
    } catch (err) {
      /* noop */
    }
  }

  /* ── 状态 ─────────────────────────────────────────────────────────────── */

  const DEFAULTS = {
    theme: "light",
    colorScheme: "ocean",
    view: "list",
    sort: "recent",
    lockAfter: 15,
    rememberMinutes: 15,
    passwordRequired: true,
    accessPolicyVersion: 1,
    defaultCategoriesSeeded: false,
    syncEnabled: false,
    lastSyncAt: 0,
    lastBackupAt: 0,
  };

  const COLOR_SCHEMES = [
    { id: "ocean", mode: "light", pair: "midnight", label: "晨曦蓝青", description: "钴蓝与湖青双色渐变" },
    { id: "aurora", mode: "light", pair: "nebula", label: "极光紫樱", description: "靛紫与樱粉双色渐变" },
    { id: "sunset", mode: "light", pair: "ember", label: "暖阳珊瑚", description: "玫红与暖橙双色渐变" },
    { id: "midnight", mode: "dark", pair: "ocean", label: "深海极光", description: "冰蓝与翠青双色渐变" },
    { id: "nebula", mode: "dark", pair: "aurora", label: "星云暮紫", description: "星紫与玫粉双色渐变" },
    { id: "ember", mode: "dark", pair: "sunset", label: "暮焰流金", description: "流金与珊瑚双色渐变" },
  ];
  const LEGACY_COLOR_MAP = {
    blue: "ocean",
    green: "ocean",
    purple: "aurora",
    pink: "sunset",
    mono: "ocean",
  };
  const normalizeColor = (value) => {
    if (COLOR_SCHEMES.some(item => item.id === value)) return value;
    if (Object.prototype.hasOwnProperty.call(LEGACY_COLOR_MAP, value)) return LEGACY_COLOR_MAP[value];
    return "ocean";
  };
  const pairColorForTheme = (colorId, resolvedTheme) => {
    const scheme = COLOR_SCHEMES.find(item => item.id === normalizeColor(colorId)) || COLOR_SCHEMES[0];
    if (resolvedTheme === "dark" && scheme.mode === "light") return scheme.pair;
    if (resolvedTheme === "light" && scheme.mode === "dark") return scheme.pair;
    return scheme.id;
  };
  const normalizeRemember = value => [1, 5, 15].includes(value) ? value : 0;

  const state = {
    ready: false,
    accounts: [],
    categories: [],
    settings: { ...DEFAULTS },
    security: null,
    tombstones: {},
    categoryTombstones: {},
    rev: 0,
  };

  const listeners = new Set();

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function emit(reason) {
    state.rev += 1;
    if (/^(account:|category$|reset$)/.test(reason)) sync?.schedule();
    for (const fn of listeners) {
      try {
        fn(reason, state);
      } catch (err) {
        /* 单个订阅者出错不影响其它人 */
      }
    }
  }

  /* ── 读 / 写 ──────────────────────────────────────────────────────────── */

  function serialize() {
    return {
      version: VERSION,
      updatedAt: Date.now(),
      accounts: state.accounts,
      categories: state.categories,
      settings: state.settings,
      tombstones: state.tombstones,
      categoryTombstones: state.categoryTombstones,
    };
  }

  let saveChain = Promise.resolve();
  let dirtySettings = {};
  let sync;
  let storageBound = false;
  const model = OTP.syncModel;
  const withLock = (fn) => global.navigator?.locks
    ? global.navigator.locks.request("localotp:storage", fn) : fn();
  const readData = () => readKey(DATA_KEY);
  const writeData = () => writeKey(DATA_KEY, serialize());

  function adopt(data) {
    if (!data || data.version !== VERSION) return;
    const merged = model.merge(state, data);
    const changed = !model.equal(state.accounts, merged.accounts) || !model.equal(state.categories, merged.categories);
    Object.assign(state, merged);
    state.settings = { ...DEFAULTS, ...data.settings, ...dirtySettings };
    state.settings.colorScheme = normalizeColor(state.settings.colorScheme);
    state.settings.rememberMinutes = normalizeRemember(state.settings.rememberMinutes);
    mirrorTheme(state.settings.theme);
    if (changed) emit("external");
  }

  function persist() {
    // 立即排队写入；弹窗关闭前不再等待 120ms 的防抖定时器。
    saveChain = saveChain.catch(() => {}).then(() => withLock(async () => {
      const data = await readData();
      adopt(data);
      const patch = dirtySettings;
      dirtySettings = {};
      try {
        await writeData();
        state.storageError = "";
      } catch (err) {
        dirtySettings = { ...patch, ...dirtySettings };
        state.storageError = err.message;
        emit("storage:error");
        throw err;
      }
    }));
    // 调用方可等待结果；没有等待的普通编辑也不会造成未处理的拒绝。
    saveChain.catch(() => {});
    return saveChain;
  }

  function bindStorage() {
    if (storageBound) return;
    storageBound = true;
    const receive = (data) => {
      if (data) adopt(data);
      emit("external:settings");
    };
    if (global.chrome?.storage?.onChanged) {
      global.chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[DATA_KEY]?.newValue) receive(changes[DATA_KEY].newValue);
        if (area === "local" && changes[DATA_KEY] && !changes[DATA_KEY].newValue) {
          state.accounts = [];
          state.categories = [];
          state.tombstones = {};
          state.categoryTombstones = {};
          state.settings = { ...DEFAULTS };
          emit("external");
        }
        if (area === "local" && changes["localotp:sync-status:v1"]) sync.receiveStatus(changes["localotp:sync-status:v1"].newValue);
        if (area === "sync" && Object.keys(changes).some(model.ownedKey)) sync.schedule();
        if (area === "local" && changes[SEC_KEY]) {
          state.security = changes[SEC_KEY].newValue || null;
          emit("security:external");
        }
      });
    } else if (global.addEventListener) {
      global.addEventListener("storage", (event) => {
        if (event.key === DATA_KEY && event.newValue) {
          try { receive(JSON.parse(event.newValue)); } catch (_) { /* 忽略损坏的外部写入 */ }
        }
      });
    }
  }

  async function init() {
    const data = await readKey(DATA_KEY);
    const sec = await readKey(SEC_KEY);

    if (data && data.version === VERSION && Array.isArray(data.accounts)) {
      state.accounts = data.accounts.map(normalizeAccount).filter(Boolean);
      state.categories = Array.isArray(data.categories) ? data.categories : [];
      state.settings = { ...DEFAULTS, ...(data.settings || {}) };
      state.settings.colorScheme = normalizeColor(state.settings.colorScheme);
      state.settings.rememberMinutes = normalizeRemember(state.settings.rememberMinutes);
      state.tombstones = data.tombstones && typeof data.tombstones === "object" ? data.tombstones : {};
      state.categoryTombstones = data.categoryTombstones || {};
    } else {
      state.accounts = areaLocal ? [] : OTP.seed.accounts();
      state.categories = areaLocal ? OTP.seed.defaultCategories() : OTP.seed.categories();
      state.settings = { ...DEFAULTS, defaultCategoriesSeeded: true };
      await persist(true);
    }

    state.security = sec && sec.hash ? sec : null;
    let needsMigration = false;
    // 将旧版的默认关闭升级为 15 分钟；之后显式选择关闭仍会保留。
    if (data && !data.settings?.accessPolicyVersion) {
      dirtySettings = { ...dirtySettings, accessPolicyVersion: 1, rememberMinutes: state.settings.rememberMinutes || 15 };
      Object.assign(state.settings, dirtySettings);
      needsMigration = true;
    }
    // 一次性补齐默认平台分类（Google、GitHub、ChatGPT、Microsoft），后续允许自由编辑与删除。
    if (data && !data.settings?.defaultCategoriesSeeded) {
      const existingIds = new Set(state.categories.map((c) => c.id));
      const existingNames = new Set(state.categories.map((c) => String(c.name || "").trim().toLowerCase()));
      for (const def of OTP.seed.defaultCategories()) {
        if (existingIds.has(def.id) || existingNames.has(def.name.toLowerCase()) || state.categoryTombstones[def.id]) continue;
        state.categories.push(def);
      }
      dirtySettings = { ...dirtySettings, defaultCategoriesSeeded: true };
      state.settings.defaultCategoriesSeeded = true;
      needsMigration = true;
    }
    if (needsMigration) await persist();
    state.ready = true;
    mirrorTheme(state.settings.theme);
    bindStorage();
    if (areaLocal && typeof document !== "undefined") sync.receiveStatus(await readKey("localotp:sync-status:v1"));
    sync.schedule();
    emit("init");
    return state;
  }

  /* ── 账号 ─────────────────────────────────────────────────────────────── */

  function normalizeAccount(a) {
    if (!a || typeof a !== "object") return null;
    const secret = String(a.secret || "").trim().toUpperCase();
    if (!secret) return null;
    return {
      id: a.id || uid("acc_"),
      email: String(a.email || "").trim(),
      password: String(a.password == null ? "" : a.password),
      secret,
      issuer: String(a.issuer || "").trim(),
      note: String(a.note || "").trim(),
      categoryId: String(a.categoryId || ""),
      algorithm: ["SHA1", "SHA256", "SHA512"].includes(a.algorithm) ? a.algorithm : "SHA1",
      digits: Number(a.digits) === 8 ? 8 : 6,
      period: Number.isInteger(Number(a.period)) && Number(a.period) >= 1 && Number(a.period) <= 86400 ? Number(a.period) : 30,
      createdAt: Number(a.createdAt) || Date.now(),
      updatedAt: Number(a.updatedAt) || Number(a.createdAt) || Date.now(),
    };
  }

  function accounts() {
    return state.accounts.slice();
  }

  function byId(id) {
    return state.accounts.find((a) => a.id === id) || null;
  }

  function createAccount(payload) {
    const account = normalizeAccount({ ...payload, id: uid("acc_"), createdAt: Date.now(), updatedAt: Date.now() });
    if (!account) throw new Error("账号数据不完整");
    state.accounts.unshift(account);
    delete state.tombstones[account.id];
    persist();
    emit("account:create");
    return account;
  }

  function updateAccount(id, patch) {
    const index = state.accounts.findIndex((a) => a.id === id);
    if (index < 0) return null;
    const merged = normalizeAccount({ ...state.accounts[index], ...patch, id, updatedAt: Math.max(Date.now(), state.accounts[index].updatedAt + 1) });
    if (!merged) return null;
    state.accounts[index] = merged;
    persist();
    emit("account:update");
    return merged;
  }

  function deleteAccount(id) {
    const before = state.accounts.length;
    const previous = byId(id);
    state.accounts = state.accounts.filter((a) => a.id !== id);
    if (state.accounts.length === before) return false;
    state.tombstones[id] = Math.max(Date.now(), (previous?.updatedAt || 0) + 1);
    persist();
    emit("account:delete");
    return true;
  }

  function replaceAccounts(list) {
    const next = (list || []).map(normalizeAccount).filter(Boolean);
    const ids = new Set(next.map((a) => a.id));
    for (const old of state.accounts) if (!ids.has(old.id)) state.tombstones[old.id] = Math.max(Date.now(), old.updatedAt + 1);
    state.accounts = next;
    persist();
    emit("account:replace");
  }

  /* ── 分类 ─────────────────────────────────────────────────────────────── */

  const CATEGORY_ICONS = [
    "briefcase", "gamepad", "cart", "code", "cloud", "bank",
    "mail", "tag", "star", "users", "folder", "shield",
    "brand-google", "brand-chatgpt", "brand-github", "brand-microsoft",
    "brand-apple", "brand-youtube", "brand-discord", "brand-telegram",
    "brand-x", "brand-amazon", "brand-facebook", "brand-instagram",
  ];

  function categories() {
    return state.categories.slice();
  }

  function saveCategory(input) {
    const name = String(input.name || "").trim();
    if (!name) throw new Error("分类名称不能为空");
    if (name.length > 16) throw new Error("分类名称最多 16 个字");
    const icon = CATEGORY_ICONS.includes(input.icon) ? input.icon : "folder";

    if (input.id) {
      const cat = state.categories.find((c) => c.id === input.id);
      if (!cat) throw new Error("分类已不存在");
      const dup = state.categories.some(
        (c) => c.id !== input.id && c.name.toLowerCase() === name.toLowerCase()
      );
      if (dup) throw new Error("已有同名分类");
      cat.name = name;
      cat.icon = icon;
      cat.updatedAt = Math.max(Date.now(), (cat.updatedAt || 0) + 1);
    } else {
      if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        throw new Error("已有同名分类");
      }
      state.categories.push({ id: uid("cat_"), name, icon, createdAt: Date.now(), updatedAt: Date.now() });
    }
    persist();
    emit("category");
    return true;
  }

  function deleteCategory(id) {
    state.categoryTombstones[id] = Math.max(Date.now(), (categoryOf(id)?.updatedAt || 0) + 1);
    state.categories = state.categories.filter((c) => c.id !== id);
    let moved = 0;
    for (const a of state.accounts) {
      if (a.categoryId === id) {
        a.categoryId = "";
        a.updatedAt = Math.max(Date.now(), a.updatedAt + 1);
        moved += 1;
      }
    }
    persist();
    emit("category");
    return moved;
  }

  function categoryOf(id) {
    return state.categories.find((c) => c.id === id) || null;
  }

  /* ── 设置 ─────────────────────────────────────────────────────────────── */

  function settings() {
    return { ...state.settings };
  }

  function patchSettings(patch) {
    if (Object.hasOwn(patch, "rememberMinutes")) patch = { ...patch, rememberMinutes: normalizeRemember(patch.rememberMinutes) };
    if (Object.prototype.hasOwnProperty.call(patch, "colorScheme")) patch = { ...patch, colorScheme: normalizeColor(patch.colorScheme) };
    dirtySettings = { ...dirtySettings, ...patch };
    state.settings = { ...state.settings, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "theme") || Object.prototype.hasOwnProperty.call(patch, "colorScheme")) mirrorTheme(state.settings.theme);
    persist();
    emit("settings");
    return state.settings;
  }

  /** 主题镜像到 localStorage：下一次打开时 theme-boot.js 能同步读到，避免白闪 */
  function mirrorTheme(pref) {
    try {
      const resolved =
        pref === "light" || pref === "dark"
          ? pref
          : global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      global.localStorage.setItem("localotp:theme", resolved);
      global.localStorage.setItem("localotp:theme-preference", pref);
      global.localStorage.setItem("localotp:color-scheme", normalizeColor(state.settings.colorScheme));
    } catch (err) {
      /* localStorage 不可用时忽略 */
    }
  }

  /* ── 访问门禁：加盐摘要 ───────────────────────────────────────────────── */

  const { setPassword, verifyPassword, hasPassword, securityInfo, clearPassword } = OTP.createSecurityStore({ state, SEC_KEY, writeKey, removeKey, emit });

  const { sortAccounts, search } = OTP.createAccountSearch({ state, accounts });

  const { parseImport, parseQuick, applyImport, exportPayload, importPayload } = OTP.createAccountImporter({ state, VERSION, persist, emit, normalizeAccount, byId });

  function stats() {
    const payload = JSON.stringify(state.accounts);
    const bytes = new TextEncoder().encode(payload).length;
    return {
      count: state.accounts.length,
      categories: state.categories.length,
      bytes,
      withCodes: state.accounts.length,
    };
  }

  /* ── 重置 ─────────────────────────────────────────────────────────────── */

  function resetDemo() {
    for (const c of state.categories) state.categoryTombstones[c.id] = Math.max(Date.now(), (c.updatedAt || 0) + 1);
    state.categories = OTP.seed.categories().map((c) => ({ ...c, updatedAt: Date.now() + 2 }));
    replaceAccounts(OTP.seed.accounts());
    emit("reset");
  }

  async function wipe() {
    await sync.disable();
    await saveChain.catch(() => {});
    await withLock(async () => {
      state.accounts = [];
      state.categories = [];
      state.tombstones = {};
      state.categoryTombstones = {};
      state.security = null;
      state.settings = { ...DEFAULTS };
      dirtySettings = {};
      mirrorTheme(state.settings.theme);
      await removeKey(SEC_KEY);
      await removeKey(DATA_KEY);
    });
    emit("wipe");
  }

  sync = OTP.createSync({ state, area: areaSync, call: callArea, persist, emit,
    normalize: normalizeAccount, withLock, readData, writeData, adopt });

  /* ── 对外 ─────────────────────────────────────────────────────────────── */

  OTP.store = {
    init,
    subscribe,
    get state() {
      return state;
    },
    accounts,
    byId,
    createAccount,
    updateAccount,
    deleteAccount,
    replaceAccounts,
    categories,
    categoryOf,
    saveCategory,
    deleteCategory,
    CATEGORY_ICONS,
    COLOR_SCHEMES,
    pairColorForTheme,
    settings,
    patchSettings,
    setPassword,
    verifyPassword,
    hasPassword,
    securityInfo,
    clearPassword,
    search,
    sortAccounts,
    parseImport,
    parseQuick,
    applyImport,
    exportPayload,
    importPayload,
    stats,
    resetDemo,
    wipe,
    sync,
    persist,
  };
})(window);
