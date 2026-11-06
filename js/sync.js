/* 同步模型与执行器。账号、分类分别合并；设置与门禁摘要始终留在本机。 */
(function (global) {
  "use strict";
  const OTP = global.OTP;
  // Chromium 的存储往返可能重排对象字段；字段顺序不是账号内容的一部分。
  function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && a.length !== b.length) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key =>
      Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
  }
  const canonical = value => JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const stamp = (record) => Number(record?.updatedAt || record?.createdAt) || 0;
  const validTime = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  const newer = (a, b) => !a || stamp(b) > stamp(a) ||
    (stamp(a) === stamp(b) && canonical(b) > canonical(a)) ? b : a;
  function tombs(a = {}, b = {}) {
    const result = Object.create(null);
    for (const map of [a, b]) for (const [id, time] of Object.entries(map)) {
      if (validTime(time)) result[id] = Math.max(result[id] || 0, Number(time));
    }
    return result;
  }
  function records(a = [], b = [], deleted = {}) {
    const map = new Map();
    for (const item of [...a, ...b]) {
      if (!item || typeof item.id !== "string" || !item.id) continue;
      map.set(item.id, newer(map.get(item.id), item));
    }
    return [...map.values()].filter((item) => !deleted[item.id] || stamp(item) > deleted[item.id]);
  }
  function merge(a, b) {
    const tombstones = tombs(a.tombstones, b.tombstones);
    const categoryTombstones = tombs(a.categoryTombstones, b.categoryTombstones);
    const categories = records(a.categories, b.categories, categoryTombstones);
    const accounts = records(a.accounts, b.accounts, tombstones).map((item) =>
      categoryTombstones[item.categoryId] && !categories.some((c) => c.id === item.categoryId)
        ? { ...item, categoryId: "", updatedAt: Math.max(stamp(item), categoryTombstones[item.categoryId]) }
        : item);
    return { accounts, categories, tombstones, categoryTombstones };
  }
  function decode(remote, normalize) {
    const data = { accounts: [], categories: [], tombstones: {}, categoryTombstones: {} };
    for (const [key, value] of Object.entries(remote)) {
      if (key.startsWith("acc:")) {
        const account = normalize(value);
        if (!account || account.id !== key.slice(4) || !OTP.totp.validateSecret(account.secret).ok) {
          throw new Error("同步缓存账号格式无效，已停止写入，请检查备份");
        }
        data.accounts.push(account);
      } else if (key.startsWith("cat:") && value?.id === key.slice(4) && typeof value.name === "string") {
        data.categories.push(value);
      } else if (key.startsWith("tomb:") && validTime(value)) data.tombstones[key.slice(5)] = Number(value);
      else if (key.startsWith("ctomb:") && validTime(value)) data.categoryTombstones[key.slice(6)] = Number(value);
    }
    // 兼容旧版整体 categories 数组；新的逐条记录优先。
    const known = new Set(data.categories.map((c) => c.id));
    if (Array.isArray(remote.categories)) for (const cat of remote.categories) {
      if (cat?.id && typeof cat.name === "string" && !known.has(cat.id)) data.categories.push(cat);
    }
    return data;
  }
  function encode(data) {
    const result = {};
    for (const a of data.accounts) result["acc:" + a.id] = a;
    for (const c of data.categories) result["cat:" + c.id] = c;
    for (const [id, time] of Object.entries(data.tombstones)) result["tomb:" + id] = time;
    for (const [id, time] of Object.entries(data.categoryTombstones)) result["ctomb:" + id] = time;
    return result;
  }
  const ownedKey = (key) => /^(acc:|cat:|tomb:|ctomb:)/.test(key) || key === "categories";
  const byteSize = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length;
  OTP.syncModel = { merge, equal, stamp, decode, encode, ownedKey };
  // storage.sync 只有本机缓存操作的回执，不能用它确认云端上传或另一台收件。
  OTP.syncFeedback = function (result) {
    if (!result?.ok) return { text: result?.error || "缓存合并失败", kind: "bad" };
    if (result.remoteAccounts === 0 && result.localAccounts === 0) {
      return { text: "本机同步缓存为空，尚未收到账号；两端 ID 一致时，请检查浏览器的 Extension Settings 同步状态", kind: "warn" };
    }
    return { text: `本机缓存合并完成 · 合入 ${result.pulled} 条，写入缓存 ${result.pushed} 条；未确认云端传输`, kind: "warn" };
  };

  OTP.createSync = function ({ state, area, call, persist, emit, normalize, withLock, readData, writeData, adopt }) {
    let pending = null;
    let status = { busy: false, error: "" };
    let timer;
    const isPage = typeof document !== "undefined";
    const useWorker = isPage && !!global.chrome?.runtime?.id;
    const info = () => ({ available: !!area, enabled: !!state.settings.syncEnabled,
      lastSyncAt: state.settings.lastSyncAt || 0, ...status, cloudStatus: "unverified" });
    function report(patch) {
      status = { ...status, ...patch };
      emit("sync:status");
      if (!isPage && global.chrome?.storage?.local) {
        global.chrome.storage.local.set({ "localotp:sync-status:v1": { ...status, at: Date.now() } }).catch(() => {});
      }
    }

    async function run() {
      await persist(true);
      if (useWorker) {
        const result = await global.chrome.runtime.sendMessage({ type: "localotp:sync" });
        if (!result) throw new Error("后台同步未响应，请重新加载扩展");
        const latest = await readData();
        if (latest) adopt(latest);
        return result;
      }
      return withLock(async () => {
        const disk = await readData();
        if (disk) adopt(disk);
        if (!state.settings.syncEnabled) return { ok: false, error: "同步尚未开启" };
        const remote = await call(area, "get", null) || {};
        const before = { accounts: state.accounts, categories: state.categories };
        const remoteData = decode(remote, normalize);
        const merged = merge(state, remoteData);
        const wanted = encode(merged);
        const push = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => !equal(remote[k], v)));
        const remove = Object.keys(remote).filter((k) => ownedKey(k) && !(k in wanted));
        const final = { ...remote, ...wanted };
        remove.forEach((k) => delete final[k]);
        const quota = area.QUOTA_BYTES || 102400;
        const itemQuota = area.QUOTA_BYTES_PER_ITEM || 8192;
        for (const [key, value] of Object.entries(push)) {
          if (byteSize(key, value) > itemQuota) throw new Error("单条记录超过 8 KB，请缩短备注后重试");
        }
        if (Object.values(final).length > (area.MAX_ITEMS || 512)) throw new Error("同步条目数量已满（包含删除记录），请导出备份后整理数据");
        const bytes = Object.entries(final).reduce((sum, [k, v]) => sum + byteSize(k, v), 0);
        if (bytes > quota) throw new Error("同步容量超过 100 KB，本机数据仍保留，请减少记录后重试");

        // 先落盘合并结果；失败时保留待推送数据与墓碑，下一次可重试。
        Object.assign(state, merged);
        await writeData();
        // 先写墓碑再删远端实体；中途失败也不会把删除当成新增。
        if (Object.keys(push).length) await call(area, "set", push);
        if (remove.length) await call(area, "remove", remove);
        state.settings.lastSyncAt = Date.now();
        await writeData();
        const pulled = merged.accounts.filter((a) => !before.accounts.some((b) => equal(a, b))).length;
        const pushed = Object.keys(push).filter((k) => k.startsWith("acc:")).length;
        const deleted = before.accounts.filter((a) => !merged.accounts.some((b) => a.id === b.id)).length;
        if (!equal(before, { accounts: state.accounts, categories: state.categories })) emit("sync:data");
        return { ok: true, pulled, pushed, deleted, remoteAccounts: remoteData.accounts.length,
          localAccounts: merged.accounts.length, scope: "browser-cache", cloudStatus: "unverified" };
      });
    }
    function now() {
      if (pending) return pending;
      if (!area) return Promise.resolve({ ok: false, error: "请在已加载的扩展中使用浏览器同步" });
      if (!state.settings.syncEnabled) return Promise.resolve({ ok: false, error: "同步尚未开启" });
      clearTimeout(timer);
      report({ busy: true, error: "" });
      pending = run().catch((err) => ({ ok: false, error: err.message || "同步失败" })).then((result) => {
        report({ busy: false, error: result.ok ? "" : result.error,
          lastResult: result.ok ? { pulled: result.pulled, pushed: result.pushed, remoteAccounts: result.remoteAccounts, localAccounts: result.localAccounts } : null });
        return result;
      }).finally(() => { pending = null; });
      return pending;
    }
    function schedule() {
      if (!area || !state.settings.syncEnabled || useWorker) return;
      clearTimeout(timer);
      timer = setTimeout(() => now(), 900);
    }
    async function enable() {
      if (!area) throw new Error("请先把本目录加载为浏览器扩展");
      state.settings.syncEnabled = true;
      // 设置由 store 的持久化边界记录，不能传到其他设备。
      OTP.store.patchSettings({ syncEnabled: true });
      await persist(true);
      const result = await now();
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    async function disable() {
      clearTimeout(timer);
      OTP.store.patchSettings({ syncEnabled: false });
      await persist(true);
      if (pending) await pending;
      report({ busy: false, error: "" });
      return true;
    }
    async function usage() {
      if (!area) return { used: 0, quota: 102400, error: "当前环境不可用" };
      try { return { used: await call(area, "getBytesInUse", null), quota: area.QUOTA_BYTES || 102400 }; }
      catch (err) { return { used: 0, quota: 102400, error: err.message }; }
    }
    async function inspect() {
      if (!area) return { ok: false, error: "请在实际扩展中检查同步存储" };
      try {
        const remote = await call(area, "get", null) || {};
        const keys = Object.keys(remote);
        return { ok: true, extensionId: global.chrome?.runtime?.id || "",
          extensionVersion: global.chrome?.runtime?.getManifest?.().version || "",
          enabled: !!state.settings.syncEnabled, scope: "browser-cache", cloudStatus: "unverified",
          localAccounts: state.accounts.length, cachedAccounts: keys.filter(key => key.startsWith("acc:")).length,
          cachedCategories: keys.filter(key => key.startsWith("cat:")).length,
          cachedDeletions: keys.filter(key => key.startsWith("tomb:")).length, lastMergeAt: state.settings.lastSyncAt || 0 };
      } catch (error) { return { ok: false, error: error.message || "读取失败" }; }
    }
    return { available: () => !!area, info, now, enable, disable, usage, inspect, schedule,
      receiveStatus(value) { if (isPage && value) report({ busy: !!value.busy && Date.now() - value.at < 60000, error: value.error || "", lastResult: value.lastResult || null }); },
      cancel: () => clearTimeout(timer) };
  };
})(typeof window === "undefined" ? globalThis : window);
