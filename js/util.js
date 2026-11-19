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
    scan: '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M3 12h18"/><path d="M7 7h3v3H7zm7 7h3v3h-3z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
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

  /* 平台实心标识与通用线框图标共享 24px 网格；来源见 docs/third-party.md。 */
  const BRAND_ICONS = Object.freeze({
    "brand-google": { label: "Google", body: "<g transform=\"translate(3 3)\" stroke=\"none\"><path fill=\"#4285F4\" d=\"M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.258h2.909c1.702-1.567 2.683-3.875 2.683-6.614z\"/><path fill=\"#34A853\" d=\"M9 18c2.43 0 4.468-.806 5.957-2.181l-2.909-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.583-5.036-3.71H.957v2.332C2.438 15.983 5.482 18 9 18z\"/><path fill=\"#FBBC05\" d=\"M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A9 9 0 0 0 0 9c0 1.452.347 2.827.957 4.042l3.007-2.332z\"/><path fill=\"#EA4335\" d=\"M9 3.58c1.321 0 2.507.454 3.44 1.346l2.581-2.581C13.464.892 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z\"/></g>" },
    "brand-microsoft": { label: "Microsoft（微软）", body: "<g stroke=\"none\"><path fill=\"#F25022\" d=\"M3 3h8.5v8.5H3z\"/><path fill=\"#7FBA00\" d=\"M12.5 3H21v8.5h-8.5z\"/><path fill=\"#00A4EF\" d=\"M3 12.5h8.5V21H3z\"/><path fill=\"#FFB900\" d=\"M12.5 12.5H21V21h-8.5z\"/></g>" },
    "brand-chatgpt": { label: "ChatGPT", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z\"/></g>" },
    "brand-github": { label: "GitHub", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12\"/></g>" },
    "brand-apple": { label: "Apple", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701\"/></g>" },
    "brand-youtube": { label: "YouTube", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z\"/></g>" },
    "brand-discord": { label: "Discord", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z\"/></g>" },
    "brand-telegram": { label: "Telegram", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z\"/></g>" },
    "brand-x": { label: "X", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z\"/></g>" },
    "brand-amazon": { label: "Amazon", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.525.13.12.174.09.336-.12.48-.256.19-.6.41-1.006.654-1.244.743-2.64 1.316-4.185 1.726a17.617 17.617 0 01-10.951-.577 17.88 17.88 0 01-5.43-3.35c-.1-.074-.151-.15-.151-.22 0-.047.021-.09.051-.13zm6.565-6.218c0-1.005.247-1.863.743-2.577.495-.71 1.17-1.25 2.04-1.615.796-.335 1.756-.575 2.912-.72.39-.046 1.033-.103 1.92-.174v-.37c0-.93-.105-1.558-.3-1.875-.302-.43-.78-.65-1.44-.65h-.182c-.48.046-.896.196-1.246.46-.35.27-.575.63-.675 1.096-.06.3-.206.465-.435.51l-2.52-.315c-.248-.06-.372-.18-.372-.39 0-.046.007-.09.022-.15.247-1.29.855-2.25 1.82-2.88.976-.616 2.1-.975 3.39-1.05h.54c1.65 0 2.957.434 3.888 1.29.135.15.27.3.405.48.12.165.224.314.283.45.075.134.15.33.195.57.06.254.105.42.135.51.03.104.062.3.076.615.01.313.02.493.02.553v5.28c0 .376.06.72.165 1.036.105.313.21.54.315.674l.51.674c.09.136.136.256.136.36 0 .12-.06.226-.18.314-1.2 1.05-1.86 1.62-1.963 1.71-.165.135-.375.15-.63.045a6.062 6.062 0 01-.526-.496l-.31-.347a9.391 9.391 0 01-.317-.42l-.3-.435c-.81.886-1.603 1.44-2.4 1.665-.494.15-1.093.227-1.83.227-1.11 0-2.04-.343-2.76-1.034-.72-.69-1.08-1.665-1.08-2.94l-.05-.076zm3.753-.438c0 .566.14 1.02.425 1.364.285.34.675.512 1.155.512.045 0 .106-.007.195-.02.09-.016.134-.023.166-.023.614-.16 1.08-.553 1.424-1.178.165-.28.285-.58.36-.91.09-.32.12-.59.135-.8.015-.195.015-.54.015-1.005v-.54c-.84 0-1.484.06-1.92.18-1.275.36-1.92 1.17-1.92 2.43l-.035-.02zm9.162 7.027c.03-.06.075-.11.132-.17.362-.243.714-.41 1.05-.5a8.094 8.094 0 011.612-.24c.14-.012.28 0 .41.03.65.06 1.05.168 1.172.33.063.09.099.228.099.39v.15c0 .51-.149 1.11-.424 1.8-.278.69-.664 1.248-1.156 1.68-.073.06-.14.09-.197.09-.03 0-.06 0-.09-.012-.09-.044-.107-.12-.064-.24.54-1.26.806-2.143.806-2.64 0-.15-.03-.27-.087-.344-.145-.166-.55-.257-1.224-.257-.243 0-.533.016-.87.046-.363.045-.7.09-1 .135-.09 0-.148-.014-.18-.044-.03-.03-.036-.047-.02-.077 0-.017.006-.03.02-.063v-.06z\"/></g>" },
    "brand-facebook": { label: "Facebook", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z\"/></g>" },
    "brand-instagram": { label: "Instagram", body: "<g transform=\"translate(3 3) scale(.75)\" fill=\"currentColor\" stroke=\"none\"><path d=\"M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077\"/></g>" },
  });

  function icon(name, size, className) {
    const body = BRAND_ICONS[name]?.body || ICONS[name] || ICONS.info;
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

  async function copyText(text, container) {
    const value = String(text == null ? "" : text);
    try {
      if (navigator.clipboard && global.isSecureContext !== false) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (err) {
      /* 落到下面的兜底 */
    }
    let ta;
    try {
      ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      // 网页扫码结果位于模态对话框内，后备复制控件也必须放在可交互的模态区域。
      (container || document.body).append(ta);
      ta.focus({ preventScroll: true });
      ta.select();
      ta.setSelectionRange(0, value.length);
      const ok = document.execCommand("copy");
      return ok;
    } catch (err) {
      return false;
    } finally {
      ta?.remove();
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
  OTP.brandIconLabels = Object.freeze(Object.fromEntries(Object.entries(BRAND_ICONS).map(([key, value]) => [key, value.label])));
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
