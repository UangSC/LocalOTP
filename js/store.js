/* ==========================================================================
   LocalOTP · store
   状态、持久化、检索、导入解析、备份、访问门禁摘要、跨设备同步。
   这一层不碰 DOM，界面层只通过这里的方法读写数据。
   ========================================================================== */

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
    theme: "auto",
    colorScheme: "blue",
    view: "list",
    sort: "recent",
    lockAfter: 5,
    rememberMinutes: 0,
    syncEnabled: false,
    lastSyncAt: 0,
    lastBackupAt: 0,
  };

  const COLOR_SCHEMES = [
    { id: "purple", label: "经典紫", description: "鸢尾紫与柔雾灰" },
    { id: "green", label: "清新绿", description: "薄荷绿与暖白" },
    { id: "blue", label: "天空蓝", description: "CPAMP 蓝与通透白" },
    { id: "pink", label: "少女粉", description: "玫瑰粉与奶油白" },
    { id: "mono", label: "黑白", description: "浅色黑主调 · 深色白主调" },
  ];
  const normalizeColor = (value) => COLOR_SCHEMES.some(item => item.id === value) ? value : "blue";
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
      state.categories = areaLocal ? [] : OTP.seed.categories();
      state.settings = { ...DEFAULTS };
      await persist(true);
    }

    state.security = sec && sec.hash ? sec : null;
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

  const PBKDF2_ITERATIONS = 210000;
  const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

  async function derive(password, salt, iterations) {
    const subtle = global.crypto && global.crypto.subtle;
    const enc = new TextEncoder();
    if (subtle) {
      const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        key,
        256
      );
      return new Uint8Array(bits);
    }
    // 无 Web Crypto 时退化为单轮 SHA-256(salt + password)，并明确标注
    throw new Error("当前环境不支持安全密码校验，请通过扩展或 localhost 打开");
  }

  async function setPassword(password) {
    const salt = new Uint8Array(16);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(salt);
    else for (let i = 0; i < salt.length; i++) salt[i] = Math.floor(Math.random() * 256);

    const hasSubtle = !!(global.crypto && global.crypto.subtle);
    const iterations = hasSubtle ? PBKDF2_ITERATIONS : 0;
    const hash = await derive(password, salt, iterations);

    const record = {
      v: 1,
      algo: hasSubtle ? "PBKDF2-SHA256" : "none",
      iterations,
      salt: b64(salt),
      hash: b64(hash),
      createdAt: Date.now(),
    };
    state.security = record;
    await writeKey(SEC_KEY, record);
    emit("security");
    return record;
  }

  async function verifyPassword(password, record = state.security) {
    if (!record || !record.hash || record.algo === "none") return false;
    const salt = unb64(record.salt);
    const hash = await derive(password, salt, record.iterations || 0);
    const expected = unb64(record.hash);
    if (hash.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
    return diff === 0;
  }

  function hasPassword() {
    return !!(state.security && state.security.hash);
  }

  function securityInfo() {
    if (!state.security) return null;
    return {
      algorithm: state.security.algo,
      iterations: state.security.iterations,
      createdAt: state.security.createdAt,
    };
  }

  async function clearPassword() {
    state.security = null;
    await removeKey(SEC_KEY);
    emit("security");
  }

  /* ── 检索 ─────────────────────────────────────────────────────────────── */

  function rangesOf(text, query) {
    const hay = String(text || "");
    const q = String(query || "");
    if (!q) return [];
    const lower = hay.toLowerCase();
    const target = q.toLowerCase();
    const out = [];
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(target, from);
      if (idx < 0) break;
      out.push([idx, idx + target.length]);
      from = idx + target.length;
      if (out.length > 12) break;
    }
    return out;
  }

  function sortAccounts(list, sort) {
    const arr = list.slice();
    if (sort === "email") {
      arr.sort((a, b) => a.email.localeCompare(b.email, "zh-Hans-CN"));
    } else if (sort === "issuer") {
      arr.sort((a, b) => (a.issuer || "未命名").localeCompare(b.issuer || "未命名", "zh-Hans-CN"));
    } else {
      arr.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    }
    return arr;
  }

  /**
   * 检索。codes 是界面层算好的 id → 当前验证码映射，
   * 传进来才能支持"直接搜验证码数字"。
   */
  function search(query, options) {
    const o = options || {};
    const q = String(query == null ? "" : query).trim();
    const scope = o.categoryId;
    const list = accounts().filter((a) => {
      if (!scope) return true;
      if (scope === "__none__") return !a.categoryId;
      return a.categoryId === scope;
    });

    if (!q) {
      return { query: "", hits: [], total: list.length, empty: list.length === 0 };
    }

    const lower = q.toLowerCase();
    const digits = q.replace(/\s/g, "");
    const digitQuery = digits.length > 0 && /^\d+$/.test(digits);
    const codes = o.codes || null;

    const hits = [];
    for (const account of list) {
      const emailRanges = rangesOf(account.email, q);
      const issuerRanges = rangesOf(account.issuer, q);
      const noteRanges = rangesOf(account.note, q);

      let codeRanges = [];
      if (digitQuery && codes && codes.get(account.id)) {
        codeRanges = rangesOf(codes.get(account.id), digits);
      }

      const matched =
        emailRanges.length ||
        issuerRanges.length ||
        noteRanges.length ||
        codeRanges.length ||
        (lower && `${account.email} ${account.issuer} ${account.note}`.toLowerCase().includes(lower));

      if (matched) {
        hits.push({
          account,
          ranges: { email: emailRanges, issuer: issuerRanges, note: noteRanges, code: codeRanges },
        });
      }
    }
    return { query: q, hits, total: list.length, empty: false };
  }

  /* ── 导入解析 ─────────────────────────────────────────────────────────── */

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /**
   * 支持两种行：
   *   1) 邮箱----密码----密钥
   *   2) otpauth://totp/...   （二维码内容）
   * 密码原样保留（可含 ----、空格、引号、$），首尾空白不裁剪。
   */
  function parseImport(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const lines = source.split(/\r?\n/);
    const rows = [];
    const seen = new Map();
    const existing = new Map(
      state.accounts.map((a) => [a.email.trim().toLowerCase(), a])
    );

    lines.forEach((raw, index) => {
      const line = raw.replace(/\s+$/, "");
      const lineNo = index + 1;
      if (!line.trim()) return;

      // ---- otpauth:// ----
      const otpIndex = line.toLowerCase().indexOf("otpauth://");
      if (otpIndex >= 0) {
        const parsed = totp.parseOtpauth(line.slice(otpIndex).trim());
        if (!parsed) {
          rows.push({ line: lineNo, kind: "bad", reason: "otpauth 链接无法解析" });
          return;
        }
        if (parsed.error) {
          rows.push({ line: lineNo, kind: "bad", reason: parsed.error });
          return;
        }
        const email = parsed.email || parsed.account || "";
        if (!email) {
          rows.push({ line: lineNo, kind: "bad", reason: "链接里没有邮箱或账号名" });
          return;
        }
        const key = email.toLowerCase();
        const dupOf = existing.get(key);
        const row = {
          line: lineNo,
          kind: dupOf ? "dup" : "new",
          email,
          password: "",
          secret: parsed.secret,
          issuer: parsed.issuer || parsed.account || "",
          note: "",
          categoryId: "",
          algorithm: parsed.algorithm,
          digits: parsed.digits,
          period: parsed.period,
          reason: dupOf ? "与已有账号重复" : "",
          dupOf: dupOf ? dupOf.id : null,
          fromUri: true,
        };
        if (seen.has(key)) {
          row.kind = "dup";
          row.reason = "同一批次内重复";
          row.dupOf = null;
        }
        seen.set(key, row);
        rows.push(row);
        return;
      }

      // ---- email----password----secret ----
      const first = line.indexOf("----");
      const last = line.lastIndexOf("----");
      if (first < 0 || last <= first) {
        rows.push({
          line: lineNo,
          kind: "bad",
          reason: first < 0 ? "缺少 ---- 分隔符" : "字段不足，需要 邮箱----密码----密钥",
        });
        return;
      }

      rows.push(
        classifyRow(
          lineNo,
          line.slice(0, first).trim(),
          line.slice(first + 4, last),
          line.slice(last + 4).trim(),
          seen,
          existing
        )
      );
    });

    return finishRows(rows);
  }

  /** 把一行的三个字段变成统一的行对象（含错误与重复判定） */
  function classifyRow(lineNo, emailRaw, password, secretRaw, seen, existing, extras) {
    const email = String(emailRaw || "").trim();
    if (!EMAIL_RE.test(email)) {
      return { line: lineNo, kind: "bad", reason: "邮箱格式不正确", email };
    }
    if (!password.length) {
      return { line: lineNo, kind: "bad", reason: "密码为空", email };
    }

    const check = totp.validateSecret(secretRaw);
    if (!check.ok) {
      return { line: lineNo, kind: "bad", reason: check.error, email };
    }

    const key = email.toLowerCase();
    const dupOf = existing.get(key);
    const extra = extras || {};
    const row = {
      line: lineNo,
      kind: dupOf ? "dup" : "new",
      email,
      password,
      secret: check.normalized,
      issuer: extra.issuer || "",
      note: "",
      categoryId: "",
      algorithm: extra.algorithm || "SHA1",
      digits: extra.digits || 6,
      period: extra.period || 30,
      reason: dupOf ? "与已有账号重复" : "",
      dupOf: dupOf ? dupOf.id : null,
      fromUri: !!extra.fromUri,
    };
    if (seen.has(key)) {
      row.kind = "dup";
      row.reason = "同一批次内重复";
      row.dupOf = null;
    }
    seen.set(key, row);
    return row;
  }

  function finishRows(rows) {
    const stats = {
      total: rows.length,
      fresh: rows.filter((r) => r.kind === "new").length,
      dup: rows.filter((r) => r.kind === "dup").length,
      bad: rows.filter((r) => r.kind === "bad").length,
    };
    const replaceable = rows.filter((r) => r.kind === "dup" && r.dupOf).length;
    return { rows, stats, replaceable };
  }

  /* ── 快速添加：一行搞定，容忍 -- / Tab / | 分隔 ───────────────────────── */

  /**
   * 小窗里的"快速添加"要的是手速，所以除规范写法外还接受几种常见分隔。
   * 注意取舍：用 `--` 分隔时，密码里不能再出现 `--`（那种情况请用 `----`）。
   */
  function splitQuick(line) {
    const firstDash = line.indexOf("----");
    if (firstDash >= 0) {
      const lastDash = line.lastIndexOf("----");
      if (lastDash > firstDash) {
        return [
          line.slice(0, firstDash),
          line.slice(firstDash + 4, lastDash),
          line.slice(lastDash + 4),
        ];
      }
    }
    if (line.includes("\t")) {
      const parts = line.split("\t");
      if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join("\t")];
    }
    if (line.includes("|")) {
      const parts = line.split("|");
      if (parts.length >= 3) return [parts[0], parts[1], parts.slice(2).join("|")];
    }
    const segments = line.split("--");
    if (segments.length === 3) return segments;
    return null;
  }

  function parseQuick(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const rows = [];
    const seen = new Map();
    const existing = new Map(state.accounts.map((a) => [a.email.trim().toLowerCase(), a]));

    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return;
      const parts = splitQuick(line);
      if (!parts) {
        rows.push({
          line: index + 1,
          kind: "bad",
          reason: "认不出分隔符：用 邮箱----密码----密钥，或 邮箱--密码--密钥",
        });
        return;
      }
      rows.push(classifyRow(index + 1, parts[0], parts[1], parts[2], seen, existing));
    });

    return finishRows(rows);
  }

  /**
   * 执行导入。
   * mode = skip | replace | keep（keep 表示重复项也作为独立账号插入）
   */
  function applyImport(rows, mode) {
    const m = mode === "replace" ? "replace" : mode === "keep" ? "keep" : "skip";
    let added = 0;
    let replaced = 0;

    for (const row of rows) {
      if (row.kind === "bad") continue;

      if (row.kind === "new" || (row.kind === "dup" && m === "keep")) {
        state.accounts.unshift(
          normalizeAccount({
            id: uid("acc_"),
            email: row.email,
            password: row.password || "",
            secret: row.secret,
            issuer: row.issuer || "",
            note: row.note || "",
            categoryId: row.categoryId || "",
            algorithm: row.algorithm,
            digits: row.digits,
            period: row.period,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        );
        added += 1;
        continue;
      }

      if (row.kind === "dup" && m === "replace" && row.dupOf) {
        const target = byId(row.dupOf);
        if (target) {
          target.password = row.password || target.password;
          target.secret = row.secret || target.secret;
          if (row.issuer) target.issuer = row.issuer;
          target.algorithm = row.algorithm || target.algorithm;
          target.digits = row.digits || target.digits;
          target.period = row.period || target.period;
          target.updatedAt = Date.now();
          replaced += 1;
        }
      }
    }

    if (added || replaced) {
      persist();
      emit("account:import");
    }
    return { added, replaced };
  }

  /* ── 备份 ─────────────────────────────────────────────────────────────── */

  function exportPayload() {
    return {
      format: "localotp.backup",
      version: VERSION,
      exportedAt: new Date().toISOString(),
      app: "LocalOTP",
      categories: state.categories,
      accounts: state.accounts,
    };
  }

  /** 按邮箱合并恢复；不覆盖已有账号，除非 payload 里带 replace */
  function importPayload(payload) {
    if (!payload || typeof payload !== "object") throw new Error("备份文件格式不正确");
    if (!Array.isArray(payload.accounts)) throw new Error("备份里没有账号列表");

    const known = new Set(state.accounts.map((a) => a.email.toLowerCase()));
    const catMap = new Map();
    if (Array.isArray(payload.categories)) {
      for (const cat of payload.categories) {
        if (!cat || !cat.name) continue;
        catMap.set(cat.id, cat.name);
      }
    }
    const localCats = new Map(state.categories.map((c) => [c.name.toLowerCase(), c.id]));

    let added = 0;
    let skipped = 0;

    for (const raw of payload.accounts) {
      const account = normalizeAccount(raw);
      if (!account) {
        skipped += 1;
        continue;
      }
      const key = account.email.toLowerCase();
      if (known.has(key)) {
        skipped += 1;
        continue;
      }
      const check = totp.validateSecret(account.secret);
      if (!check.ok) {
        skipped += 1;
        continue;
      }
      // 把备份里的分类名映射到本地分类 id
      if (catMap.has(account.categoryId)) {
        const name = catMap.get(account.categoryId).toLowerCase();
        account.categoryId = localCats.get(name) || "";
      }
      known.add(key);
      state.accounts.push(account);
      added += 1;
    }

    if (added) {
      persist();
      emit("account:import");
    }
    return { added, skipped };
  }

  /* ── 统计 ─────────────────────────────────────────────────────────────── */

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
