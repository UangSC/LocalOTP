/* ==========================================================================
   LocalOTP · ui
   抽屉、对话框、菜单、Toast、气泡提示、波纹、倒计时环、分段控件。
   这一层只关心"怎么表现"，不碰任何账号数据。
   ========================================================================== */

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

  function hostOf(event) {
    return event.target instanceof Element ? event.target.closest("[data-tip]") : null;
  }

  function bindTooltips() {
    document.addEventListener("pointerover", (e) => {
      const host = hostOf(e);
      if (!host || host === refs.tipTarget) return;
      refs.tipTarget = host;
      clearTimeout(refs.tipTimer);
      refs.tipTimer = setTimeout(() => showTip(host), 320);
    });

    document.addEventListener("pointerout", (e) => {
      const host = hostOf(e);
      if (!host || host !== refs.tipTarget) return;
      if (e.relatedTarget instanceof Node && host.contains(e.relatedTarget)) return;
      clearTimeout(refs.tipTimer);
      refs.tipTarget = null;
      hideTip();
    });

    document.addEventListener("focusin", (e) => {
      const host = hostOf(e);
      if (!host) return;
      refs.tipTarget = host;
      clearTimeout(refs.tipTimer);
      showTip(host);
    });

    document.addEventListener("focusout", () => {
      refs.tipTarget = null;
      clearTimeout(refs.tipTimer);
      hideTip();
    });

    document.addEventListener(
      "pointerdown",
      () => {
        refs.tipTarget = null;
        clearTimeout(refs.tipTimer);
        hideTip();
      },
      true
    );

    document.addEventListener("scroll", hideTip, true);
  }

  function showTip(host) {
    if (!refs.tip || !host || !host.isConnected) return;
    const text = host.getAttribute("data-tip");
    if (!text) return;

    refs.tip.textContent = text;
    refs.tip.classList.add("is-on");

    const box = refs.app.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const tipRect = refs.tip.getBoundingClientRect();
    const gap = 7;

    let top = hostRect.top - box.top - tipRect.height - gap;
    if (top < 4) top = hostRect.bottom - box.top + gap;
    if (top + tipRect.height > box.height - 4) {
      top = Math.max(4, hostRect.top - box.top - tipRect.height - gap);
    }

    const alignEnd = host.getAttribute("data-tip-align") === "end";
    let left = alignEnd
      ? hostRect.right - box.left - tipRect.width
      : hostRect.left - box.left + hostRect.width / 2 - tipRect.width / 2;

    left = clamp(left, 6, Math.max(6, box.width - tipRect.width - 6));
    top = clamp(top, 4, Math.max(4, box.height - tipRect.height - 4));

    refs.tip.style.left = Math.round(left) + "px";
    refs.tip.style.top = Math.round(top) + "px";
  }

  function hideTip() {
    if (refs.tip) refs.tip.classList.remove("is-on");
  }

  /* ── 抽屉 ─────────────────────────────────────────────────────────────── */

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

    if (refs.dialogFocus && refs.dialogFocus.focus) {
      try {
        refs.dialogFocus.focus({ preventScroll: true });
      } catch (err) {
        /* noop */
      }
    }
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

  const SVG_NS = "http://www.w3.org/2000/svg";

  function circle(cls, r) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "20");
    c.setAttribute("cy", "20");
    c.setAttribute("r", String(r));
    c.setAttribute("pathLength", "100");
    return c;
  }

  /**
   * 三层环：轨道 / 光晕 / 进度。
   * paint() 可以在 rAF 里高频调用 —— 只有数值真的变了才写 DOM。
   */
  function createRing(opts) {
    const o = opts || {};
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 40 40");
    svg.setAttribute("aria-hidden", "true");

    const track = circle("ring-track", 16.6);
    const glow = circle("ring-glow", 16.6);
    const bar = circle("ring-bar", 16.6);
    for (const node of [glow, bar]) {
      node.setAttribute("stroke-dasharray", "100");
      node.setAttribute("stroke-dashoffset", "0");
    }
    svg.append(track, glow, bar);

    const num = el("b", { class: "ring-num", text: String(o.period || 30) });
    const node = el("span", {
      class: o.cls ? "ring " + o.cls : "ring",
      dataset: { state: "calm" },
    });
    node.append(svg, num);

    // 呼吸动画的相位统一从墙钟推出来：凡是在同一毫秒创建的环、
    // 或者后续重渲染新建的环，都会落在同一个呼吸相位上，不会各pulse各的。
    node.style.setProperty("--pulse-delay", `-${Date.now() % 1150}ms`);

    let lastOffset = null;
    let lastSeconds = -1;
    let lastState = "";
    let snapTimer = 0;

    return {
      node,
      /**
       * 两种喂法：
       *   paint({ seconds, period })  → 弧长严格等于"显示的那个整数秒"，和数字永远一致
       *   paint({ progress })         → 直接给 0..1（编辑抽屉里的实时预览用）
       */
      paint(state) {
        let offset;
        if (typeof state.seconds === "number") {
          const period = state.period || o.period || 30;
          offset = 100 - (clamp(state.seconds, 0, period) / period) * 100;
        } else {
          offset = 100 - clamp(state.progress, 0, 1) * 100;
        }
        offset = Math.round(clamp(offset, 0, 100) * 10) / 10;

        // 跨周期时要"瞬切"回满格，而不是反向扫一圈
        if (state.snap) {
          node.classList.add("is-snap");
          clearTimeout(snapTimer);
          snapTimer = setTimeout(() => node.classList.remove("is-snap"), 60);
        }

        if (offset !== lastOffset) {
          bar.setAttribute("stroke-dashoffset", String(offset));
          glow.setAttribute("stroke-dashoffset", String(offset));
          lastOffset = offset;
        }
        if (state.seconds !== undefined && state.seconds !== lastSeconds) {
          num.textContent = String(state.seconds);
          lastSeconds = state.seconds;
        }
        if (state.state !== lastState) {
          node.dataset.state = state.state;
          lastState = state.state;
        }
      },
      setPeriod(period) {
        num.textContent = String(period);
      },
      destroy() {
        clearTimeout(snapTimer);
        node.remove();
      },
    };
  }

  /* ── 滑动开关（列表 ⇄ 卡片）──────────────────────────────────────────── */

  /**
   * 一个可以"推"的开关：拖动滑块到另一边就切换，点一下也能切，
   * 键盘 ← → / 空格 / 回车同样管用。
   */
  function swipeSwitch(opts) {
    const o = opts || {};
    const items = o.items || [];
    const onChange = o.onChange;
    const node = el("div", {
      class: "sw-switch",
      role: "group",
      "aria-label": o.label || "切换视图",
    });
    const track = el("span", { class: "sw-track" });
    const thumb = el("span", { class: "sw-thumb" });
    const icos = items.map((it) =>
      el("button", { class: "sw-ico", type: "button", "aria-label": it.id === "list" ? "列表视图" : "卡片视图", html: icon(it.icon, 16), dataset: { id: it.id }, onclick: () => set(it.id, true) })
    );
    track.append(...icos, thumb);
    node.append(track);

    let value = o.value || items[0].id;
    const indexOf = (v) => {
      const i = items.findIndex((it) => it.id === v);
      return i < 0 ? 0 : i;
    };
    const maxPx = () => track.clientWidth / 2;

    function place(px, animate) {
      thumb.classList.toggle("is-instant", !animate);
      thumb.style.setProperty("--x", px + "px");
      if (!animate) requestAnimationFrame(() => thumb.classList.remove("is-instant"));
    }

    function sync(animate) {
      const idx = indexOf(value);
      place(idx * maxPx(), animate);
      for (const ico of icos) {
        ico.classList.toggle("is-on", ico.dataset.id === value);
        ico.setAttribute("aria-pressed", String(ico.dataset.id === value));
      }
      node.dataset.value = value;

    }

    function set(next, animate) {
      if (!items.some((it) => it.id === next)) return value;
      if (next === value) {
        sync(animate);
        return value;
      }
      value = next;
      sync(animate);
      if (onChange) onChange(value);
      return value;
    }

    node.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        set(items[0].id, true);
        icos[0].focus();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        set(items[items.length - 1].id, true);
        icos[items.length - 1].focus();
      }
    });

    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => sync(false)).observe(track);
    }
    requestAnimationFrame(() => sync(false));

    return {
      node,
      sync: () => sync(false),
      set: (next) => set(next, true),
      /** 外部直接改值（不触发 onChange），用于回填设置 */
      update(next) {
        if (!items.some((it) => it.id === next)) return value;
        value = next;
        sync(false);
        return value;
      },
      get value() {
        return value;
      },
    };
  }

  /* ── 分段控件 ─────────────────────────────────────────────────────────── */

  /**
   * items: [{ id, label, icon?, count? }]
   * 返回 { node, setActive(id) }，滑块位置通过测量真实宽度得出，
   * 因此按钮文字长短不一也能严丝合缝。
   */
  function segmented(opts) {
    const o = opts || {};
    const pill = el("span", { class: "seg-pill", "aria-hidden": "true" });
    const node = el("div", { class: "seg" + (o.className ? " " + o.className : ""), role: "tablist" }, pill);
    const buttons = [];
    let active = o.active || (o.items[0] && o.items[0].id);

    for (const item of o.items || []) {
      const btn = el("button", {
        class: "seg-btn",
        type: "button",
        role: "tab",
        dataset: { id: item.id },
        "aria-selected": String(item.id === active),
        text: item.label,
        onclick: () => {
          if (item.id === active) return;
          setActive(item.id);
          if (o.onChange) o.onChange(item.id);
        },
      });
      buttons.push(btn);
      node.append(btn);
    }

    function place() {
      const btn = buttons.find((b) => b.dataset.id === active);
      if (!btn || !btn.offsetWidth) return;
      pill.style.width = btn.offsetWidth + "px";
      pill.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
    }

    function setActive(id) {
      active = id;
      for (const btn of buttons) {
        const on = btn.dataset.id === id;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-selected", String(on));
      }
      place();
    }

    setActive(active);
    requestAnimationFrame(place);
    return { node, setActive, get value() { return active; } };
  }

  /* ── Escape / 浮层状态 ────────────────────────────────────────────────── */

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
