/* ==========================================================================
   LocalOTP · qr-export
   OTP 二维码缓存与展示小窗：
   - 同一账号首次生成后即缓存在本机（chrome.storage.local / localStorage），
     后续仅当账号的 OTP 相关信息改动时才重新生成二维码。
   - 账号删除或清空数据时同步清理对应缓存，不残留密钥图像。
   - 缓存保存在独立本机键（localotp:qr-cache:v1），不占用 storage.sync 配额。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const { el, icon } = OTP;

  const CACHE_KEY = "localotp:qr-cache:v1";
  const cache = new Map();
  let hydrated = false;
  let hydratePromise = null;
  let saveTimer = 0;
  let generatedCount = 0;
  let cacheHitCount = 0;

  /* ── 本机缓存持久化 ────────────────────────────────────────────────────── */

  function readStorage() {
    const area = global.chrome?.storage?.local;
    if (area) {
      return new Promise((resolve) => {
        try {
          const ret = area.get(CACHE_KEY, (res) => resolve(res ? res[CACHE_KEY] : null));
          if (ret && typeof ret.then === "function") ret.then((res) => resolve(res ? res[CACHE_KEY] : null), () => resolve(null));
        } catch (_) { resolve(null); }
      });
    }
    try {
      const raw = global.localStorage?.getItem(CACHE_KEY);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function writeStorage(obj) {
    const area = global.chrome?.storage?.local;
    if (area) {
      try {
        const ret = area.set({ [CACHE_KEY]: obj });
        if (ret && typeof ret.catch === "function") ret.catch(() => {});
      } catch (_) {}
      return;
    }
    try {
      global.localStorage?.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  function clearStorage() {
    const area = global.chrome?.storage?.local;
    if (area) {
      try {
        const ret = area.remove(CACHE_KEY);
        if (ret && typeof ret.catch === "function") ret.catch(() => {});
      } catch (_) {}
      return;
    }
    try {
      global.localStorage?.removeItem(CACHE_KEY);
    } catch (_) {}
  }

  async function ensureHydrated() {
    if (hydrated) return;
    if (!hydratePromise) {
      hydratePromise = readStorage().then((saved) => {
        if (saved && typeof saved === "object") {
          for (const [id, entry] of Object.entries(saved)) {
            if (entry && typeof entry.uri === "string" && typeof entry.dataUrl === "string" && !cache.has(id)) {
              cache.set(id, { uri: entry.uri, dataUrl: entry.dataUrl, createdAt: Number(entry.createdAt) || Date.now() });
            }
          }
        }
        hydrated = true;
      });
    }
    await hydratePromise;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const out = {};
      for (const [id, entry] of cache.entries()) out[id] = entry;
      writeStorage(out);
    }, 60);
  }

  function flushSave() {
    clearTimeout(saveTimer);
    const out = {};
    for (const [id, entry] of cache.entries()) out[id] = entry;
    writeStorage(out);
  }

  function pruneStale() {
    if (!OTP.store || !OTP.store.state?.ready) return;
    const validIds = new Set(OTP.store.accounts().map((a) => a.id));
    let changed = false;
    for (const [id, entry] of cache.entries()) {
      if (!validIds.has(id)) {
        cache.delete(id);
        changed = true;
        continue;
      }
      const acc = OTP.store.byId(id);
      if (acc) {
        try {
          const uri = OTP.totp.buildOtpauth(acc);
          if (entry.uri !== uri) {
            cache.delete(id);
            changed = true;
          }
        } catch (_) {
          cache.delete(id);
          changed = true;
        }
      }
    }
    if (changed) scheduleSave();
  }

  function clearAllCache() {
    cache.clear();
    clearStorage();
  }

  /* 订阅 store 变更：账号修改/删除/清空时自动失效或清理对应二维码缓存 */
  if (OTP.store && typeof OTP.store.subscribe === "function") {
    OTP.store.subscribe((reason) => {
      if (reason === "wipe") {
        clearAllCache();
      } else if (/^(account:|external$|sync:data$|reset$)/.test(reason)) {
        pruneStale();
      }
    });
  }

  /**
   * 获取指定账号的二维码条目（按 otpauth URI 指纹缓存，仅在改动时重新生成）。
   */
  async function getQrForAccount(account) {
    await ensureHydrated();
    const uri = OTP.totp.buildOtpauth(account);
    const existing = cache.get(account.id);
    if (existing && existing.uri === uri && existing.dataUrl) {
      cacheHitCount += 1;
      return { ...existing, cached: true };
    }
    const dataUrl = OTP.qrEncode.toPngDataUrl(uri, { size: 320, quiet: 4 });
    const entry = { uri, dataUrl, createdAt: Date.now() };
    cache.set(account.id, entry);
    generatedCount += 1;
    flushSave();
    return { ...entry, cached: false };
  }

  /* ── 二维码小窗展示 ────────────────────────────────────────────────────── */

  function sanitizeFilename(text) {
    return String(text || "localotp")
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "localotp";
  }

  async function open(account) {
    if (!account) return;
    const latest = OTP.store?.byId?.(account.id) || account;
    let entry;
    try {
      entry = await getQrForAccount(latest);
    } catch (err) {
      OTP.ui?.toast?.("生成二维码失败：" + (err?.message || "密钥无效"), "bad");
      return;
    }

    const title = latest.issuer || latest.email || "未命名 OTP";
    const subtitle = latest.issuer && latest.email ? latest.email : (latest.note || "TOTP 验证器导入二维码");
    const algoLabel = OTP.totp.ALGO_LABEL[latest.algorithm] || "SHA-1";
    const metaText = `${algoLabel} · ${latest.digits || 6} 位 · ${latest.period || 30} 秒`;

    const img = el("img", {
      class: "qr-modal-img",
      src: entry.dataUrl,
      alt: `${title} 的 OTP 导入二维码`,
      draggable: false,
    });

    const copyBtn = el(
      "button",
      {
        class: "btn btn-ghost btn-sm",
        type: "button",
        onclick: async () => {
          const ok = await OTP.copyText(entry.uri, OTP.ui.refs.dialog);
          if (ok) {
            copyBtn.innerHTML = icon("check", 13, "i-sm") + "<span>已复制链接</span>";
            OTP.ui.toast("已复制 OTP 链接");
            setTimeout(() => {
              if (copyBtn.isConnected) copyBtn.innerHTML = icon("copy", 13, "i-sm") + "<span>复制链接</span>";
            }, 1200);
          } else {
            OTP.ui.toast("剪贴板写入失败", "bad");
          }
        },
      },
      el("span", { html: icon("copy", 13, "i-sm") }),
      el("span", { text: "复制链接" })
    );

    const downloadBtn = el(
      "button",
      {
        class: "btn btn-primary btn-sm",
        type: "button",
        onclick: () => {
          const link = document.createElement("a");
          link.href = entry.dataUrl;
          link.download = `${sanitizeFilename(latest.issuer || latest.email || "otp")}-otp-qr.png`;
          link.click();
          OTP.ui.toast("已保存二维码图片");
        },
      },
      el("span", { html: icon("download", 13, "i-sm") }),
      el("span", { text: "保存图片" })
    );

    const closeBtn = el("button", {
      class: "ibtn ibtn-sm qr-modal-close",
      type: "button",
      "aria-label": "关闭二维码窗口",
      "data-tip": "关闭 · Esc",
      html: icon("x", 15),
      onclick: () => OTP.ui.closeModal(),
    });

    const content = el(
      "div",
      { class: "qr-modal-content", dataset: { accountId: latest.id, cached: String(entry.cached) } },
      el(
        "div",
        { class: "qr-modal-head" },
        OTP.avatar(latest),
        el(
          "div",
          { class: "qr-modal-titles" },
          el("div", { class: "qr-modal-title truncate", text: title }),
          el("div", { class: "qr-modal-sub truncate", text: subtitle })
        ),
        closeBtn
      ),
      el(
        "div",
        { class: "qr-modal-frame" },
        img
      ),
      el(
        "div",
        { class: "qr-modal-meta" },
        el("span", { class: "chip chip-brand", text: metaText }),
        el("span", { class: "qr-modal-hint", text: "使用其他验证器扫码即可快速导入" })
      ),
      el("div", { class: "qr-modal-acts" }, copyBtn, downloadBtn)
    );

    OTP.ui.openModal({
      content,
      className: "dialog-qr",
      ariaLabel: `${title} 的 OTP 二维码`,
      initialFocus: closeBtn,
    });
  }

  OTP.qrExport = {
    open,
    getQrForAccount,
    clearCache: clearAllCache,
    pruneStale,
    stats: () => ({
      size: cache.size,
      generatedCount,
      cacheHitCount,
    }),
  };
})(globalThis);
