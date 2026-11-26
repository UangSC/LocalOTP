/* LocalOTP · ui 抽屉、对话框、菜单、Toast、气泡提示、波纹、倒计时环、分段控件。 这一层只关心"怎么表现"，不碰任何账号数据。 */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const { el, icon, clear, clamp } = OTP;

  const refs = {
    app: null,
    veil: null,
    sheet: null,
    sheetTitle: null,
    sheetSub: null,
    sheetBody: null,
    sheetFoot: null,
    dialogVeil: null,
    dialog: null,
    toasts: null,
    menu: null,
    tip: null,
    sheetOpen: false,
    dialogOpen: false,
    menuOpen: false,
    onSheetClose: null,
    dialogResolve: null,
    lastFocus: null,
    trapHandler: null,
    tipTimer: 0,
    tipTarget: null,
  };

  /* ── 挂载 ─────────────────────────────────────────────────────────────── */

  function mount(app) {
    refs.app = app;

    refs.veil = el("div", { class: "veil", "aria-hidden": "true" });
    refs.veil.addEventListener("click", () => closeSheet(true));

    refs.sheetTitle = el("h2", { class: "sheet-title", id: "sheet-title" });
    refs.sheetSub = el("p", { class: "sheet-sub", id: "sheet-sub", hidden: true });
    refs.sheetBody = el("div", { class: "sheet-body scroller", id: "sheet-body" });
    refs.sheetFoot = el("footer", { class: "sheet-foot", id: "sheet-foot", hidden: true });

    const closeBtn = el("button", {
      class: "ibtn",
      type: "button",
      "aria-label": "关闭",
      "data-tip": "关闭 · Esc",
      html: icon("x"),
      onclick: () => closeSheet(true),
    });

    refs.sheet = el(
      "section",
      {
        class: "sheet",
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": "sheet-title",
        "aria-hidden": "true",
      },
      el("div", { class: "sheet-grip", "aria-hidden": "true" }),
      el("header", { class: "sheet-head" }, el("div", { class: "sheet-titlewrap" }, refs.sheetTitle, refs.sheetSub), closeBtn),
      refs.sheetBody,
      refs.sheetFoot
    );

    refs.dialogVeil = el("div", { class: "veil", "data-layer": "dialog", "aria-hidden": "true" });
    refs.dialogVeil.addEventListener("click", () => resolveDialog(false));
    refs.dialog = el("div", {
      class: "dialog",
      role: "alertdialog",
      "aria-modal": "true",
      "aria-hidden": "true",
    });

    refs.toasts = el("div", { class: "toasts", role: "status", "aria-live": "polite" });
    refs.menu = el("div", { class: "menu", role: "menu" });
    refs.tip = el("div", { class: "tip", "aria-hidden": "true" });

    refs.app.append(
      refs.veil,
      refs.sheet,
      refs.dialogVeil,
      refs.dialog,
      refs.toasts,
      refs.menu,
      refs.tip
    );

    bindTooltips();

    document.addEventListener(
      "pointerdown",
      (e) => {
        if (refs.menuOpen && !refs.menu.contains(e.target)) closeMenu();
      },
      true
    );
  }

  /* ── 气泡提示 ─────────────────────────────────────────────────────────── */

  const { bindTooltips, hideTip } = OTP.createTooltips({ refs });

  function openSheet(opts) {
    OTP.ui.closeSelect?.();
    const o = opts || {};
    if (refs.onSheetClose) refs.onSheetClose();
    refs.lastFocus = document.activeElement;

    refs.sheetTitle.textContent = o.title || "";
    refs.sheetSub.textContent = o.subtitle || "";
    refs.sheetSub.hidden = !o.subtitle;

    clear(refs.sheetBody);
    if (o.body) OTP.appendAll(refs.sheetBody, [o.body]);

    clear(refs.sheetFoot);
    if (o.footer) {
      OTP.appendAll(refs.sheetFoot, [o.footer]);
      refs.sheetFoot.hidden = false;
    } else {
      refs.sheetFoot.hidden = true;
    }

    refs.sheetBody.scrollTop = 0;
    refs.onSheetClose = o.onClose || null;
    refs.sheetOpen = true;
    refs.veil.classList.add("is-on");
    refs.sheet.classList.add("is-open");
    refs.sheet.setAttribute("aria-hidden", "false");

    installFocusTrap(refs.sheet);

    requestAnimationFrame(() => {
      const first = refs.sheetBody.querySelector(
        "input:not([type=hidden]), textarea, select, .btn-primary"
      );
      if (first) {
        first.focus({ preventScroll: true });
        if (first.tagName === "INPUT" && first.select) first.select();
      } else {
        refs.sheet.setAttribute("tabindex", "-1");
        refs.sheet.focus({ preventScroll: true });
      }
    });
  }

  function closeSheet(restoreFocus) {
    OTP.ui.closeSelect?.();
    if (!refs.sheetOpen) return;
    refs.sheetOpen = false;
    refs.sheet.classList.remove("is-open");
    refs.sheet.setAttribute("aria-hidden", "true");
    refs.veil.classList.remove("is-on");
    removeFocusTrap();

    const cb = refs.onSheetClose;
    refs.onSheetClose = null;
    if (cb) cb();

    if (restoreFocus !== false && refs.lastFocus && refs.lastFocus.focus) {
      try {
        refs.lastFocus.focus({ preventScroll: true });
      } catch (err) {
        /* 元素可能已经被卸载 */
      }
    }
    refs.lastFocus = null;

    setTimeout(() => {
      if (!refs.sheetOpen) {
        clear(refs.sheetBody);
        clear(refs.sheetFoot);
        refs.sheetFoot.hidden = true;
      }
    }, 440);
  }

  function updateSheet(opts) {
    OTP.ui.closeSelect?.();
    const o = opts || {};
    if (o.title !== undefined) refs.sheetTitle.textContent = o.title;
    if (o.subtitle !== undefined) {
      refs.sheetSub.textContent = o.subtitle;
      refs.sheetSub.hidden = !o.subtitle;
    }
    if (o.body) {
      clear(refs.sheetBody);
      OTP.appendAll(refs.sheetBody, [o.body]);
    }
    if (o.footer) {
      clear(refs.sheetFoot);
      OTP.appendAll(refs.sheetFoot, [o.footer]);
      refs.sheetFoot.hidden = false;
    }
  }

  function isSheetOpen() {
    return refs.sheetOpen;
  }

  /* ── 焦点圈定 ─────────────────────────────────────────────────────────── */

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function installFocusTrap(container) {
    removeFocusTrap();
    refs.trapHandler = (e) => {
      if (e.key !== "Tab") return;
      const list = Array.from(container.querySelectorAll(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement
      );
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", refs.trapHandler, true);
  }

  function removeFocusTrap() {
    if (refs.trapHandler) {
      document.removeEventListener("keydown", refs.trapHandler, true);
      refs.trapHandler = null;
    }
  }

  /* ── 确认对话框 ───────────────────────────────────────────────────────── */

  function confirm(opts) {
    OTP.ui.closeSelect?.();
    const o = opts || {};
    if (refs.dialogOpen) resolveDialog(false);

    return new Promise((resolve) => {
      refs.dialogResolve = resolve;
      refs.dialogFocus = document.activeElement;

      const cancel = el("button", {
        class: "btn btn-ghost",
        type: "button",
        text: o.cancelText || "取消",
        onclick: () => resolveDialog(false),
      });
      const ok = el("button", {
        class: "btn " + (o.danger ? "btn-danger" : "btn-primary"),
        type: "button",
        text: o.confirmText || "确认",
        onclick: () => resolveDialog(true),
      });

      clear(refs.dialog);
      refs.dialog.className = "dialog";
      refs.dialog.setAttribute("role", "alertdialog");
      refs.dialog.removeAttribute("aria-label");
      refs.dialog.append(
        el("div", {
          class: o.danger ? "dialog-icon is-danger" : "dialog-icon",
          html: icon(o.icon || (o.danger ? "alert" : "info"), 20),
        }),
        el("div", { class: "dialog-title", text: o.title || "确认操作" }),
        el("div", { class: "dialog-msg", html: o.message || "" }),
        el("div", { class: "dialog-acts" }, cancel, ok)
      );

      refs.dialogOpen = true;
      refs.dialogVeil.classList.add("is-on");
      refs.dialog.classList.add("is-open");
      refs.dialog.setAttribute("aria-hidden", "false");
      installFocusTrap(refs.dialog);
      requestAnimationFrame(() => {
        (o.danger ? cancel : ok).focus({ preventScroll: true });
      });
    });
  }

  function openModal(opts) {
    OTP.ui.closeSelect?.();
    const o = opts || {};
    if (refs.dialogOpen) resolveDialog(false);
    refs.dialogFocus = document.activeElement;
    refs.dialogOnClose = o.onClose || null;

    clear(refs.dialog);
    refs.dialog.className = "dialog" + (o.className ? " " + o.className : "");
    refs.dialog.setAttribute("role", "dialog");
    if (o.ariaLabel) refs.dialog.setAttribute("aria-label", o.ariaLabel);
    else refs.dialog.removeAttribute("aria-label");
    if (o.content) OTP.appendAll(refs.dialog, [o.content]);

    refs.dialogOpen = true;
    refs.dialogVeil.classList.add("is-on");
    refs.dialog.classList.add("is-open");
    refs.dialog.setAttribute("aria-hidden", "false");
    installFocusTrap(refs.dialog);
    requestAnimationFrame(() => {
      const target = o.initialFocus || refs.dialog.querySelector(FOCUSABLE);
      if (target && target.focus) target.focus({ preventScroll: true });
    });
  }

  function closeModal() {
    resolveDialog(false);
  }

  function resolveDialog(value) {
    if (!refs.dialogOpen) return;
    refs.dialogOpen = false;
    refs.dialog.classList.remove("is-open");
    refs.dialog.setAttribute("aria-hidden", "true");
    refs.dialogVeil.classList.remove("is-on");
    removeFocusTrap();
    if (refs.sheetOpen) installFocusTrap(refs.sheet);

    const resolve = refs.dialogResolve;
    refs.dialogResolve = null;
    if (resolve) resolve(value);

    const onClose = refs.dialogOnClose;
    refs.dialogOnClose = null;
    if (onClose) onClose();

    if (refs.dialogFocus && refs.dialogFocus.focus) {
      try {
        refs.dialogFocus.focus({ preventScroll: true });
      } catch (err) {
        /* noop */
      }
    }
    refs.dialogFocus = null;
  }

  /* ── 菜单 ─────────────────────────────────────────────────────────────── */

  function openMenu(opts) {
    OTP.ui.closeSelect?.();
    const o = opts || {};
    clear(refs.menu);

    if (o.header) refs.menu.append(el("div", { class: "menu-head", text: o.header }));

    for (const item of o.items || []) {
      if (item.sep) {
        refs.menu.append(el("div", { class: "menu-sep" }));
        continue;
      }
      const btn = el(
        "button",
        {
          class: item.danger ? "is-danger" : "",
          type: "button",
          role: "menuitem",
          onclick: () => {
            closeMenu();
            if (item.onSelect) item.onSelect();
          },
        },
        el("span", { html: icon(item.icon || "check", 14, "i-sm") }),
        el("span", { text: item.label || "" }),
        item.checked
          ? el("span", {
              html: icon("check", 13, "i-sm"),
              style: { "margin-left": "auto", color: "var(--brand)" },
            })
          : item.key
            ? el("span", { class: "menu-k", text: item.key })
            : null
      );
      refs.menu.append(btn);
    }

    refs.menu.classList.add("is-open");
    refs.menuOpen = true;

    const box = refs.app.getBoundingClientRect();
    const menuRect = refs.menu.getBoundingClientRect();
    let x = o.x;
    let y = o.y;

    if (o.anchor) {
      const r = o.anchor.getBoundingClientRect();
      x = r.right - box.left - menuRect.width;
      y = r.bottom - box.top + 6;
      if (r.bottom + menuRect.height + 12 > box.bottom) {
        y = r.top - box.top - menuRect.height - 6;
        refs.menu.style.transformOrigin = "bottom right";
      } else {
        refs.menu.style.transformOrigin = "top right";
      }
    }

    x = clamp(x == null ? 12 : x, 8, Math.max(8, box.width - menuRect.width - 8));
    y = clamp(y == null ? 12 : y, 8, Math.max(8, box.height - menuRect.height - 8));
    refs.menu.style.left = Math.round(x) + "px";
    refs.menu.style.top = Math.round(y) + "px";
  }

  function closeMenu() {
    if (!refs.menuOpen) return;
    refs.menuOpen = false;
    refs.menu.classList.remove("is-open");
  }

  /* ── Toast ────────────────────────────────────────────────────────────── */

  let lastToast = { text: "", at: 0 };

  function toast(message, tone, opts) {
    const o = opts || {};
    const now = Date.now();
    // 双击等连续操作会重复触发同一条反馈，短时间内去重，避免叠成一片
    if (message === lastToast.text && now - lastToast.at < 340) return null;
    lastToast = { text: message, at: now };

    const t = el(
      "div",
      { class: "toast", dataset: { tone: tone || "ok" } },
      el("span", {
        class: "toast-ico",
        html: icon(
          o.icon ||
            (tone === "bad" ? "x-circle" : tone === "warn" ? "alert-circle" : "check-circle"),
          11,
          "i-sm"
        ),
      }),
      o.mono ? el("span", { class: "mono", text: message }) : el("span", { text: message })
    );

    refs.toasts.append(t);
    // 复制是高频动作：同一时间只留一条，新的直接顶掉旧的，避免叠成一片
    const all = Array.from(refs.toasts.children);
    if (all.length > 1) all.slice(0, all.length - 1).forEach((node) => node.remove());

    setTimeout(() => {
      t.classList.add("is-out");
      setTimeout(() => t.remove(), 320);
    }, o.duration || 1900);

    return t;
  }

  /* ── 波纹 ─────────────────────────────────────────────────────────────── */

  function ripple(host, event) {
    if (!host || OTP.reduceMotion()) return;
    const rect = host.getBoundingClientRect();
    const x = event && event.clientX ? event.clientX - rect.left : rect.width / 2;
    const y = event && event.clientY ? event.clientY - rect.top : rect.height / 2;
    const span = el("span", { class: "ripple", style: { left: x + "px", top: y + "px" } });
    host.append(span);
    span.addEventListener("animationend", () => span.remove(), { once: true });
    setTimeout(() => span.remove(), 720);
  }

  /* ── 倒计时环 ─────────────────────────────────────────────────────────── */

  const { createRing, swipeSwitch, segmented } = OTP.createUIControls({  });

  function handleEscape() {
    if (refs.dialogOpen) {
      resolveDialog(false);
      return true;
    }
    if (refs.menuOpen) {
      closeMenu();
      return true;
    }
    if (refs.sheetOpen) {
      closeSheet(true);
      return true;
    }
    return false;
  }

  function hasOverlay() {
    return refs.dialogOpen || refs.menuOpen || refs.sheetOpen;
  }

  OTP.ui = {
    mount,
    refs,
    openSheet,
    closeSheet,
    updateSheet,
    isSheetOpen,
    confirm,
    openModal,
    closeModal,
    openMenu,
    closeMenu,
    toast,
    ripple,
    hideTip,
    createRing,
    segmented,
    swipeSwitch,
    handleEscape,
    hasOverlay,
    closeAll() {
      resolveDialog(false);
      closeMenu();
      closeSheet(false);
      hideTip();
      clear(refs.toasts);
    },
  };
})(window);
