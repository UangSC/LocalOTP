/* ==========================================================================
   LocalOTP · util
   只放"到处都要用，但不属于任何业务"的东西：
   DOM 构造、图标、剪贴板、格式化、缓动滚动、配色。
   ========================================================================== */

(function (global) {
  "use strict";

  const OTP = global.OTP || (global.OTP = {});

  /* ── 数值 ─────────────────────────────────────────────────────────────── */

  const clamp = (n, a, b) => (n < a ? a : n > b ? b : n);

  function uid(prefix) {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return (prefix || "a") + t + r;
  }

  /* ── DOM ──────────────────────────────────────────────────────────────── */

  /**
   * el("li", { class: "row", dataset: { id }, onclick }, child1, child2...)
   * - text: 纯文本（走 textContent，天然安全）
   * - html: 受信任的标记（只用于代码里写死的图标字符串）
   * - 其余键：带 on 前缀的当事件，aria-/data- 当属性，其它当 property
   */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    const p = props || {};

    for (const key of Object.keys(p)) {
      const value = p[key];
      if (value === null || value === undefined || value === false) continue;

      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key === "dataset") {
        for (const k of Object.keys(value)) node.dataset[k] = value[k];
      } else if (key === "style" && typeof value === "object") {
        for (const k of Object.keys(value)) node.style.setProperty(k, value[k]);
      } else if (key === "ref") {
        value.node = node;
      } else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2), value);
      } else if (key.startsWith("aria-") || key.startsWith("data-") || key === "role") {
        node.setAttribute(key, String(value));
      } else if (key in node) {
        try {
          node[key] = value;
        } catch (err) {
          node.setAttribute(key, String(value));
        }
      } else {
        node.setAttribute(key, String(value));
      }
    }

    appendAll(node, children);
    return node;
  }

  function appendAll(parent, children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) appendAll(parent, child);
      else if (child instanceof Node) parent.append(child);
      else parent.append(document.createTextNode(String(child)));
    }
    return parent;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function setChildren(node, children) {
    clear(node);
    appendAll(node, [children]);
    return node;
  }

  /* ── 图标（24×24 网格，统一线宽）────────────────────────────────────── */

  const ICONS = {
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.4 15.4 4.3 4.3"/>',
    x: '<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8"/>',
    plus: '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
    minus: '<path d="M5.4 12h13.2"/>',
    check: '<path d="m5.4 12.6 4.3 4.3L18.6 7.7"/>',
    "check-circle":
      '<circle cx="12" cy="12" r="8.4"/><path d="m8.3 12.2 2.5 2.5 4.9-5.2"/>',
    "x-circle": '<circle cx="12" cy="12" r="8.4"/><path d="m9.3 9.3 5.4 5.4M14.7 9.3l-5.4 5.4"/>',
    "alert-circle":
      '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.7v4.8"/><circle cx="12" cy="16.1" r=".85" fill="currentColor" stroke="none"/>',
    alert:
      '<path d="M10.8 5a1.4 1.4 0 0 1 2.4 0l7.1 12.3a1.4 1.4 0 0 1-1.2 2.1H4.9a1.4 1.4 0 0 1-1.2-2.1z"/><path d="M12 9.4v4"/><circle cx="12" cy="16.2" r=".85" fill="currentColor" stroke="none"/>',
    info: '<circle cx="12" cy="12" r="8.3"/><path d="M12 11.2v4.9"/><circle cx="12" cy="8.3" r=".9" fill="currentColor" stroke="none"/>',
    shield:
      '<path d="M12 3.6 19.3 6.4v5.1c0 4.2-3 7.4-7.3 9-4.3-1.6-7.3-4.8-7.3-9V6.4z"/><path d="m8.9 12 2.2 2.2 4-4.2"/>',
    lock:
      '<rect x="4.6" y="10.2" width="14.8" height="10" rx="2.9"/><path d="M8.2 10.2V7.6a3.8 3.8 0 0 1 7.6 0v2.6"/><circle cx="12" cy="15.1" r="1.15" fill="currentColor" stroke="none"/>',
    unlock:
      '<rect x="4.6" y="10.2" width="14.8" height="10" rx="2.9"/><path d="M8.2 10.2V7.6a3.8 3.8 0 0 1 7.2-1.6"/><circle cx="12" cy="15.1" r="1.15" fill="currentColor" stroke="none"/>',
    key: '<circle cx="8.6" cy="15.4" r="3.3"/><path d="M11 13 19.2 5M16.4 6.4l1.7 1.7M13.9 8.9l1.7 1.7"/>',
    mail:
      '<rect x="3.4" y="5.8" width="17.2" height="12.4" rx="2.5"/><path d="m4.7 7.9 6 4.4a2.1 2.1 0 0 0 2.6 0l6-4.4"/>',
    copy:
      '<rect x="8.8" y="8.8" width="10.8" height="10.8" rx="2.4"/><path d="M14.6 6.2A2.2 2.2 0 0 0 12.4 4H6.2A2.2 2.2 0 0 0 4 6.2v6.2a2.2 2.2 0 0 0 2.2 2.2"/>',
    eye:
      '<path d="M2.8 12S6.4 5.9 12 5.9 21.2 12 21.2 12 17.6 18.1 12 18.1 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.9"/>',
    "eye-off":
      '<path d="M4 4 20 20"/><path d="M9.9 5.2A9.4 9.4 0 0 1 12 5c5.6 0 9.2 6.1 9.2 6.1a17.4 17.4 0 0 1-3.1 3.8"/><path d="M6.3 6.9A17 17 0 0 0 2.8 11.1S6.4 17.2 12 17.2a9.3 9.3 0 0 0 3.4-.6"/><path d="M10.2 10.3a2.6 2.6 0 0 0 3.6 3.6"/>',
    trash:
      '<path d="M4.6 7.3h14.8"/><path d="M9.4 7.3V5.7a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.6"/><path d="M6.5 7.3l.8 11.1a1.8 1.8 0 0 0 1.8 1.7h5.8a1.8 1.8 0 0 0 1.8-1.7l.8-11.1"/><path d="M10.4 11v5.6M13.6 11v5.6"/>',
    edit: '<path d="M4.8 19.2h3.5L19 8.5a2.1 2.1 0 0 0 0-3l-.5-.5a2.1 2.1 0 0 0-3 0L4.8 15.7z"/><path d="M14.4 6.7l2.9 2.9"/>',
    upload:
      '<path d="M12 15.8V4.6"/><path d="m7.6 9 4.4-4.4L16.4 9"/><path d="M4.6 15v3.4a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8V15"/>',
    download:
      '<path d="M12 4.6v11.2"/><path d="m7.6 11.4 4.4 4.4 4.4-4.4"/><path d="M4.6 15v3.4a1.8 1.8 0 0 0 1.8 1.8h11.2a1.8 1.8 0 0 0 1.8-1.8V15"/>',
    "chevron-down": '<path d="m6.6 9.6 5.4 5.2 5.4-5.2"/>',
    "chevron-up": '<path d="m6.6 14.4 5.4-5.2 5.4 5.2"/>',
    "chevron-left": '<path d="M14.4 5.6 8 12l6.4 6.4"/>',
    "chevron-right": '<path d="M9.6 5.6 16 12l-6.4 6.4"/>',
    "arrow-right": '<path d="M4.8 12h13.4"/><path d="m13.4 7.2 4.8 4.8-4.8 4.8"/>',
    "arrow-left": '<path d="M19.2 12H5.8"/><path d="m10.6 7.2-4.8 4.8 4.8 4.8"/>',
    list: '<path d="M8.6 6.4h11.6M8.6 12h11.6M8.6 17.6h11.6"/><circle cx="4.2" cy="6.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.2" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.2" cy="17.6" r="1.1" fill="currentColor" stroke="none"/>',
    grid:
      '<rect x="4.3" y="4.3" width="6.4" height="6.4" rx="1.9"/><rect x="13.3" y="4.3" width="6.4" height="6.4" rx="1.9"/><rect x="4.3" y="13.3" width="6.4" height="6.4" rx="1.9"/><rect x="13.3" y="13.3" width="6.4" height="6.4" rx="1.9"/>',
    settings:
      '<path d="M3.9 7.4h9.3M17.5 7.4h2.6M3.9 16.6h2.6M10.9 16.6h9.2"/><circle cx="15.3" cy="7.4" r="2.2"/><circle cx="8.6" cy="16.6" r="2.2"/>',
    sort: '<path d="M4.8 6.6h8.4M4.8 12h5.8M4.8 17.4h3.2"/><path d="M17.2 8.6v10"/><path d="m14.4 15.8 2.8 2.8 2.8-2.8"/>',
    refresh: '<path d="M19.4 12a7.4 7.4 0 1 1-2.3-5.3"/><path d="M19.6 4.5v4.3h-4.3"/>',
    clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.6V12l3.1 1.9"/>',
    sun:
      '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.9v2.2M12 18.9v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.9 12H5.1M18.9 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    moon: '<path d="M20 14.6A8.5 8.5 0 0 1 9.4 4a8.5 8.5 0 1 0 10.6 10.6Z"/>',
    monitor:
      '<rect x="3.2" y="4.8" width="17.6" height="11.4" rx="2.2"/><path d="M9 20h6M12 16.4V20"/>',
    pin: '<path d="m9 3 6 0-1 5 4 4v2H6v-2l4-4z"/><path d="M12 14v7"/>',
    more: '<circle cx="6.2" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="17.8" cy="12" r="1.35" fill="currentColor" stroke="none"/>',
    paste:
      '<rect x="7.6" y="4.4" width="8.8" height="3.2" rx="1.3"/><path d="M8.6 6H6.4a2 2 0 0 0-2 2v9.6a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.2"/>',
    file: '<path d="M13.6 3.9H7.2a2 2 0 0 0-2 2v12.2a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V9z"/><path d="M13.4 3.9V9h5.2"/><path d="M8.7 13.2h6.6M8.7 16.4h4.4"/>',
    keyhole:
      '<path d="M12 3.9a5 5 0 0 0-2.7 9.2v4.6a1.4 1.4 0 0 0 1.4 1.4h2.6a1.4 1.4 0 0 0 1.4-1.4v-4.6A5 5 0 0 0 12 3.9Z"/><circle cx="12" cy="8.8" r="1.5" fill="currentColor" stroke="none"/>',
    sync: '<path d="M4.6 10.4a7.4 7.4 0 0 1 12.7-3.6l2.1 2"/><path d="M19.4 13.6a7.4 7.4 0 0 1-12.7 3.6l-2.1-2"/><path d="M19.4 4.6v4.2h-4.2M4.6 19.4v-4.2h4.2"/>',
    folder:
      '<path d="M3.8 8.2a2 2 0 0 1 2-2h3l2 2.4h7.4a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.8a2 2 0 0 1-2-2z"/>',
    tag: '<path d="M11.2 3.9 4 11.1v6.9a2 2 0 0 0 2 2h6.9l7.2-7.2a2 2 0 0 0 0-2.8l-5-5a2 2 0 0 0-2.8 0Z"/><circle cx="8.4" cy="15.6" r="1.4"/>',
    briefcase:
      '<rect x="3.6" y="7.6" width="16.8" height="11.6" rx="2.4"/><path d="M9 7.6V6a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 6v1.6"/><path d="M3.6 12.6h16.8"/>',
    gamepad:
      '<path d="M7.4 8.6h9.2a4.6 4.6 0 0 1 4.4 5.9l-.6 2a2.6 2.6 0 0 1-4.5 1l-1.5-1.6H9.6L8.1 17.5a2.6 2.6 0 0 1-4.5-1l-.6-2a4.6 4.6 0 0 1 4.4-5.9Z"/><path d="M8.4 11.6v2.2M7.3 12.7h2.2"/><circle cx="15.4" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="17.4" cy="13.6" r=".9" fill="currentColor" stroke="none"/>',
    cart:
      '<path d="M3.4 4.6h2.2l2.3 10.2h9.6"/><path d="M6.6 7.4h13.2l-1.6 6H7.9"/><circle cx="9.4" cy="18.4" r="1.5"/><circle cx="16.6" cy="18.4" r="1.5"/>',
    cloud:
      '<path d="M7 18a4.6 4.6 0 0 1-.6-9.2 6 6 0 0 1 11.4 1.2A4 4 0 0 1 17.4 18Z"/>',
    code: '<path d="m8.4 8-4 4 4 4m7.2-8 4 4-4 4"/>',
    bank: '<path d="M3.8 9.4 12 4.6l8.2 4.8"/><path d="M5.8 10.6v7M10 10.6v7M14 10.6v7M18.2 10.6v7"/><path d="M3.6 19.4h16.8"/>',
    star: '<path d="m12 4.4 2.5 5 5.5.8-4 3.9.95 5.5L12 17l-4.95 2.6L8 14.1l-4-3.9 5.5-.8z"/>',
    user: '<circle cx="12" cy="8.4" r="3.9"/><path d="M4.9 20a7.4 7.4 0 0 1 14.2 0"/>',
    users:
      '<circle cx="9.4" cy="8.6" r="3.5"/><path d="M3 19.4a6.6 6.6 0 0 1 12.8 0"/><path d="M16.4 5.4a3.5 3.5 0 0 1 0 6.9M17.6 14.2a6.6 6.6 0 0 1 3.4 5.2"/>',
    filter: '<path d="M4.6 6.6h14.8l-5.8 6.6v5.2l-3.2-1.8v-3.4z"/>',
    sparkle:
      '<path d="M12 3.8 13.7 9l5.2 1.7-5.2 1.7L12 17.6l-1.7-5.2L5.1 10.7 10.3 9z"/><path d="M18.6 16.4l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
    scissors:
      '<circle cx="7" cy="6.6" r="2.6"/><circle cx="7" cy="17.4" r="2.6"/><path d="M9.2 8.2 19.6 18M9.2 15.8 19.6 6"/>',
    layers:
      '<path d="M12 3.9 3.8 8.2 12 12.5l8.2-4.3z"/><path d="m3.8 12.4 8.2 4.3 8.2-4.3"/><path d="m3.8 16.4 8.2 4.3 8.2-4.3"/>',
    bell: '<path d="M17.4 10.6a5.4 5.4 0 1 0-10.8 0c0 4.2-1.6 5.4-1.6 5.4h14s-1.6-1.2-1.6-5.4Z"/><path d="M10.2 18.6a2 2 0 0 0 3.6 0"/>',
    gauge: '<path d="M4.2 17.4a8.6 8.6 0 1 1 15.6 0"/><path d="M12 12.6l3.6-3.6"/><circle cx="12" cy="13.8" r="1.6"/>',
    history: '<path d="M3.8 12a8.2 8.2 0 1 0 2.5-5.9"/><path d="M3.9 4.6V9h4.4"/><path d="M12 7.9V12l3 1.8"/>',
    template:
      '<rect x="3.8" y="4.4" width="16.4" height="15.2" rx="2.4"/><path d="M3.8 9.2h16.4M9 9.2v10.4"/>',
    bolt: '<path d="M13.4 3.8 5.9 13.4h5.3l-.6 6.8 7.5-9.6h-5.3z"/>',
  };

  function icon(name, size, className) {
    const body = ICONS[name] || ICONS.info;
    const s = size || 16;
    const cls = className ? "i " + className : "i";
    return (
      '<svg class="' + cls + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>"
    );
  }

  function svg(name, size, className) {
    const wrap = document.createElement("span");
    wrap.innerHTML = icon(name, size, className);
    return wrap.firstElementChild;
  }

  /* ── 剪贴板 ───────────────────────────────────────────────────────────── */

  async function copyText(text) {
    const value = String(text == null ? "" : text);
    try {
      if (navigator.clipboard && global.isSecureContext !== false) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (err) {
      /* 落到下面的兜底 */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      document.body.append(ta);
      ta.select();
      ta.setSelectionRange(0, value.length);
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  /* ── 格式化 ───────────────────────────────────────────────────────────── */

  /** 把 6/8 位码切成 "123 456" / "1234 5678"，读起来更快 */
  function group(code) {
    const s = String(code || "");
    if (!s) return "· · ·";
    if (s.length === 8) return s.slice(0, 4) + " " + s.slice(4);
    if (s.length === 6) return s.slice(0, 3) + " " + s.slice(3);
    return s;
  }

  function bytes(n) {
    if (!n) return "0 B";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }

  function clockText(ts) {
    if (!ts) return "从未";
    const d = new Date(ts);
    const pad = (v) => String(v).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function relativeText(ts) {
    if (!ts) return "从未";
    const diff = Date.now() - ts;
    if (diff < 60e3) return "刚刚";
    if (diff < 36e5) return Math.floor(diff / 60e3) + " 分钟前";
    if (diff < 864e5) return Math.floor(diff / 36e5) + " 小时前";
    const days = Math.floor(diff / 864e5);
    if (days < 30) return days + " 天前";
    return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }

  /* 头像只保存稳定的明度档位；实际颜色由当前色系提供。 */

  function hashStr(str) {
    let h = 2166136261;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  /** 头像仅使用拉丁字母；中文服务名回退到邮箱，纯数字账号回退到域名。 */
  function initials(email, issuer) {
    for (const source of [issuer, String(email || "").split("@")[0], String(email || "").split("@")[1]]) {
      const words = String(source || "").match(/[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|[A-Z]+/g) || [];
      if (!words.length) continue;
      return (words.length > 1 ? words.slice(0, 2).map(w => w[0]).join("") : words[0].slice(0, 2)).toUpperCase();
    }
    return "AC";
  }

  function avatar(account) {
    const key = account.issuer || account.email.split("@")[1] || account.email;
    const tone = hashStr(key.trim().toLowerCase()) % 3;
    return el("span", { class: "avatar", "aria-hidden": "true",
      dataset: { avatarTone: String(tone) } },
      el("span", { class: "avatar-letter", text: initials(account.email, account.issuer) }));
  }

  /* ── 缓动滚动 ─────────────────────────────────────────────────────────── */

  let scrollToken = 0;

  function animateScroll(node, to, duration) {
    if (!node) return;
    if (reduceMotion()) {
      node.scrollTop = to;
      return;
    }
    const start = node.scrollTop;
    const delta = to - start;
    if (Math.abs(delta) < 1) return;
    const dur = duration || 300;
    const t0 = performance.now();
    const token = ++scrollToken;

    const ease = (t) => 1 - Math.pow(1 - t, 4);

    function step(now) {
      if (token !== scrollToken) return;
      const p = clamp((now - t0) / dur, 0, 1);
      node.scrollTop = start + delta * ease(p);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function cancelScroll() {
    scrollToken += 1;
  }

  /* ── 其它 ─────────────────────────────────────────────────────────────── */

  function reduceMotion() {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function debounce(fn, wait) {
    let timer = 0;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  /** 给节点临时挂一个 class，到时间自动摘掉（用于一次性动画） */
  function flash(node, cls, ms) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth; // 强制回流，让动画能重播
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), ms || 620);
  }

  OTP.el = el;
  OTP.appendAll = appendAll;
  OTP.clear = clear;
  OTP.setChildren = setChildren;
  OTP.icon = icon;
  OTP.svg = svg;
  OTP.copyText = copyText;
  OTP.fmt = { group, bytes, clockText, relativeText };
  OTP.initials = initials;
  OTP.avatar = avatar;
  OTP.animateScroll = animateScroll;
  OTP.cancelScroll = cancelScroll;
  OTP.reduceMotion = reduceMotion;
  OTP.debounce = debounce;
  OTP.flash = flash;
  OTP.clamp = clamp;
  OTP.uid = uid;
})(window);
