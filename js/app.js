/* LocalOTP · app 编排层：门禁、搜索、复制反馈、筛选、主题、快捷键、备份。 只做"把数据接到界面上"这件事，业务规则都在 store 里。 */

(function (global) {
  "use strict";

  const OTP = global.OTP;
  const store = OTP.store;
  const ui = OTP.ui;
  const list = OTP.list;
  const { el, icon } = OTP;

  const surface = document.body.dataset.surface === "page" ? "page" : "popup";

  const els = {};
  const runtime = {
    failCount: 0,
    cooldownUntil: 0,
    cooldownTimer: 0,
    lockNode: null,
    lastActivity: Date.now(),
    categoryId: "",
    query: "",
    ticker: 0,
  };

  const $ = (id) => document.getElementById(id);

  /* 主题 */

  const { applyTheme } = OTP.createThemeController();

  const { renderAll, renderCategories, setCategory, updateSortLabel, updateStatusBar } = OTP.createAccountViews({ els, runtime, surface, applySearch });

  const { rebuildLock, setContentInert, lock, relockAfterWipe } = OTP.createGateController({ els, runtime, surface, applyTheme, renderAll });

  async function copyCode(account, node, event) {
    if (runtime.lockNode || runtime.transitioning) return false;
    if (node && event) ui.ripple(node, event);

    let result;
    try {
      result = await list.codeFor(account);
    } catch (err) {
      ui.toast("验证码计算失败", "bad");
      return false;
    }

    const soon = result.remaining < 2.5;
    if (runtime.lockNode || runtime.transitioning) return false;
    const ok = await OTP.copyText(result.code);
    if (runtime.lockNode || runtime.transitioning) return false;
    if (!ok) {
      ui.toast("剪贴板写入被拒绝，请检查权限后重试", "bad", { duration: 2600 });
      return false;
    }

    if (node) OTP.flash(node, "is-copied", 640);
    ui.toast((soon ? "已复制 · 即将刷新 " : "已复制 ") + OTP.fmt.group(result.code), soon ? "warn" : "ok", {
      mono: true,
      icon: soon ? "refresh" : "check-circle",
    });
    runtime.lastActivity = Date.now();
    return true;
  }

  async function copyField(account, which) {
    if (runtime.lockNode || runtime.transitioning) return false;
    const value = which === "email" ? account.email : account.password;
    if (which === "password" && !await OTP.sensitive.ensure("复制账号密码")) return false;
    if (runtime.lockNode || runtime.transitioning) return false;
    const ok = await OTP.copyText(value);
    if (runtime.lockNode || runtime.transitioning) return false;
    if (!ok) {
      ui.toast("剪贴板写入失败", "bad");
      return false;
    }
    // 弹窗里的按钮自己会变成「已复制」，不再多弹一条 Toast 挡住列表
    if (surface === "page") ui.toast(which === "email" ? "已复制邮箱" : "已复制密码");
    runtime.lastActivity = Date.now();
    return true;
  }

  /* 搜索 */

  function applySearch(query, opts) {
    runtime.query = query;
    const result = list.applySearch(query, opts);
    const hasQuery = !!String(query).trim();

    if (els.app) {
      els.app.classList.toggle("is-focus", hasQuery);
      els.app.classList.toggle("is-zero", hasQuery && result.count === 0);
    }
    if (els.searchBox) els.searchBox.classList.toggle("has-q", hasQuery);
    if (els.matchPill) {
      els.matchPill.textContent = result.count + "/" + result.total;
      els.matchPill.classList.toggle("is-on", hasQuery);
      els.matchPill.classList.toggle("is-zero", hasQuery && result.count === 0);
    }
    if (els.metaMatch) els.metaMatch.textContent = result.count + " 项匹配";
    if (els.statusHint) {
      els.statusHint.textContent = hasQuery ? "上下键定位 · Enter 复制" : "单击卡片复制验证码";
    }
    return result;
  }

  function clearSearch(focus) {
    if (els.searchInput) els.searchInput.value = "";
    if (els.pageSearch) els.pageSearch.value = "";
    applySearch("");
    list.resetSpotlight();
    if (focus && els.searchInput) els.searchInput.focus();
  }

  /* 打开宽屏管理页 */

  const { openFullPage, exportBackup, importBackup } = OTP.createNavigation({ runtime, renderAll });

  function toggleFocus(account) {
    if (!account) return;
    const current = list.getFocusLock();
    const next = current === account.id ? null : account.id;
    list.setFocusLock(next);
    runtime.focusId = next;

    if (els.focusPill) {
      if (next) {
        if (els.focusName) {
          els.focusName.textContent = account.issuer || account.email;
        }
        els.focusPill.hidden = false;
      } else {
        els.focusPill.hidden = true;
      }
    }
    runtime.lastActivity = Date.now();
  }

  function clearFocus() {
    if (!list.getFocusLock()) return false;
    list.setFocusLock(null);
    runtime.focusId = null;
    if (els.focusPill) els.focusPill.hidden = true;
    return true;
  }

  /* 行操作 */

  const rowActions = {
    copyCode,
    copyField,
    toggleFocus,
    edit: (account) => OTP.sheets.openEditor(account),
    add: () => OTP.sheets.openEditor(null),
    import: () => OTP.sheets.openImport(),
    remove: async (account) => {
      const syncOn = store.settings().syncEnabled;
      const ok = await ui.confirm({
        title: "删除这个账号？",
        message:
          `<b>${escapeHtml(account.email)}</b> 将被永久移除。` +
          (syncOn ? "同步已开启，删除会传播到其他设备。" : "此操作不可撤销。"),
        confirmText: "删除",
        danger: true,
        icon: "trash",
      });
      if (!ok) return;
      store.deleteAccount(account.id);
      renderAll({ stagger: false });
      ui.toast("已删除 1 个账号", "warn");
    },
    menu: (account, node, event) => {
      const box = els.app.getBoundingClientRect();
      ui.openMenu({
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        header: account.email,
        items: [
          { label: "复制验证码", icon: "shield", key: "↵", onSelect: () => copyCode(account, node, null) },
          ...(account.email ? [{ label: "复制邮箱", icon: "mail", onSelect: () => copyField(account, "email") }] : []),
          ...(account.password ? [{ label: "复制密码", icon: "key", onSelect: () => copyField(account, "password") }] : []),
          { sep: true },
          { label: "编辑", icon: "edit", key: "E", onSelect: () => OTP.sheets.openEditor(account) },
          {
            label: "删除",
            icon: "trash",
            danger: true,
            onSelect: () => rowActions.remove(account),
          },
        ],
      });
    },
  };

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[ch]);
  }

  /* 绑定 */

  function bindShell() {
    if (els.searchInput) {
      els.searchInput.addEventListener("input", () => {
        applySearch(els.searchInput.value);
      });

      els.searchInput.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          list.moveActive(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          list.moveActive(-1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          const id = list.getActiveId();
          const account = id ? store.byId(id) : null;
          if (account) {
            const ref = list.getRef(id);
            copyCode(account, ref && ref.node, null);
          }
        } else if (event.key === "Escape") {
          if (els.searchInput.value) clearSearch(false);
          else els.searchInput.blur();
        }
      });
    }

    if (els.searchClear) {
      els.searchClear.addEventListener("click", () => clearSearch(true));
    }

    if (els.viewBtn) {
      els.viewBtn.addEventListener("click", toggleView);
      updateViewButton();
    }

    if (els.sortBtn) {
      els.sortBtn.addEventListener("click", () => openSortMenu(els.sortBtn));
    }

    if (els.addBtn) els.addBtn.addEventListener("click", () => OTP.sheets.openEditor(null));
    if (els.quickAddBtn) els.quickAddBtn.addEventListener("click", () => OTP.sheets.openQuickAdd());
    if (els.focusExit) els.focusExit.addEventListener("click", () => clearFocus());
    if (els.manageBtn) els.manageBtn.addEventListener("click", () => OTP.sheets.openImport());
    if (els.openPageBtn) els.openPageBtn.addEventListener("click", () => openFullPage());
    if (els.settingsBtn) els.settingsBtn.addEventListener("click", () => OTP.sheets.openManage("settings"));
    if (els.lockBtn) els.lockBtn.addEventListener("click", () => lock());
    if (els.importBtn) els.importBtn.addEventListener("click", () => OTP.sheets.openImport());
    if (els.optionsBtn) els.optionsBtn.addEventListener("click", () => OTP.sheets.openManage("settings"));

    if (els.sideImport) els.sideImport.addEventListener("click", () => OTP.sheets.openImport());
    if (els.sideSettings) els.sideSettings.addEventListener("click", () => OTP.sheets.openManage("settings"));
    if (els.sideLock) els.sideLock.addEventListener("click", () => lock());
    $("compact-settings")?.addEventListener("click", () => OTP.sheets.openManage("settings"));
    $("compact-import")?.addEventListener("click", () => OTP.sheets.openImport());
    $("compact-lock")?.addEventListener("click", () => lock());
    if (els.pageAdd) els.pageAdd.addEventListener("click", () => OTP.sheets.openEditor(null));
    if (els.pageSearch) {
      els.pageSearch.addEventListener("input", () => applySearch(els.pageSearch.value));
      els.pageSearch.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          list.moveActive(event.key === "ArrowDown" ? 1 : -1);
        } else if (event.key === "Enter") {
          event.preventDefault();
          const id = list.getActiveId();
          const account = id && store.byId(id);
          if (account) copyCode(account, list.getRef(id)?.node, null);
        } else if (event.key === "Escape") {
          els.pageSearch.value = "";
          applySearch("");
        }
      });
    }
    if (els.pageViewSlot) {
      runtime.viewSwitch = OTP.ui.swipeSwitch({
        label: "切换列表 / 卡片",
        value: store.settings().view,
        items: [
          { id: "list", icon: "list" },
          { id: "grid", icon: "grid" },
        ],
        onChange: (next) => switchView(next),
      });
      els.pageViewSlot.append(runtime.viewSwitch.node);
    }
    if (els.pageSortBtn) {
      els.pageSortBtn.addEventListener("click", () => openSortMenu(els.pageSortBtn));
    }
    if (els.pageRefresh) {
      els.pageRefresh.addEventListener("click", () => refreshCodes());
    }

    // 列表空白处点击取消活动项
    els.list.addEventListener("click", (event) => {
      if (event.target === els.list) list.resetSpotlight();
    });
  }

  function openSortMenu(anchor) {
    const current = store.settings().sort;
    const options = [
      { id: "recent", label: "最近更新", icon: "history" },
      { id: "email", label: "邮箱 A-Z", icon: "sort" },
      { id: "issuer", label: "服务名", icon: "tag" },
    ];

    ui.openMenu({
      anchor,
      header: "排序方式",
      items: options.map((option) => ({
        label: option.label,
        icon: option.icon,
        checked: option.id === current,
        onSelect: () => {
          if (option.id === current) return;
          store.patchSettings({ sort: option.id });
          updateSortLabel();
          renderAll({ stagger: true });
          list.scrollToTop();
        },
      })),
    });
  }

  function toggleView() {
    switchView(store.settings().view === "grid" ? "list" : "grid");
  }

  /** 切换视图：旧内容先滑出，新内容再从另一侧滑进来（点击触发，不是拖拽） */
  function switchView(next) {
    if (!["list", "grid"].includes(next) || runtime.lockNode) return;
    if (next === store.settings().view) return;
    list.transitionLayout(() => {
      store.patchSettings({ view: next });
      runtime.viewSwitch?.update(next);
      renderAll({ stagger: false });
    });
  }

  function updateViewButton() {
    if (runtime.viewSwitch) runtime.viewSwitch.update(store.settings().view);
  }

  /**
   * 刷新：重算一遍验证码/进度环，若开了同步就先拉一次远端。
   * 图标转一圈只是"我在干活"的即时反馈，不会挡住任何操作。
   */
  async function refreshCodes() {
    if (runtime.refreshing || runtime.lockNode) return;
    runtime.refreshing = true;
    const btn = els.pageRefresh;
    if (btn) {
      btn.classList.add("is-busy");
      btn.setAttribute("aria-busy", "true");
      if (!OTP.reduceMotion()) {
        const glyph = btn.querySelector(".i");
        glyph.getAnimations().forEach(a => a.cancel());
        glyph.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
          { duration: 620, easing: "cubic-bezier(.22,1,.36,1)" });
      }
    }
    try {
      // 本地验证码立即刷新，不等待云端网络。
      await list.refreshAll();
      const result = store.settings().syncEnabled ? await store.sync.now() : null;
      if (!runtime.lockNode) {
        if (result && !result.ok) ui.toast("验证码已刷新；同步失败：" + result.error, "warn");
        else if (result) { const feedback = OTP.syncFeedback(result); ui.toast("验证码已刷新；" + feedback.text, feedback.kind, { duration: 6500 }); }
        else ui.toast("验证码已刷新");
      }
      runtime.lastActivity = Date.now();
    } catch (err) {
      ui.toast("刷新失败：" + err.message, "bad");
    } finally {
      btn?.classList.remove("is-spinning", "is-busy");
      btn?.removeAttribute("aria-busy");
      runtime.refreshing = false;
    }
  }

  const { bindKeyboard, bindActivity } = OTP.createInputController({ els, runtime, lock, clearSearch, toggleFocus, clearFocus });

  async function boot() {
    els.app = $("app");
    els.shell = $("shell");
    els.screen = $("screen");
    els.list = $("list");
    els.viewport = $("viewport");
    els.searchInput = $("search-input");
    els.searchBox = $("search-box");
    els.searchClear = $("search-clear");
    els.matchPill = $("match-pill");
    els.metaMatch = $("meta-match");
    els.count = $("count");
    els.sortBtn = $("sort-btn");
    els.sortLabel = $("sort-label");
    els.viewBtn = $("view-btn");
    els.settingsBtn = $("settings-btn");
    els.lockBtn = $("lock-btn");
    els.addBtn = $("add-btn");
    els.manageBtn = $("manage-btn");
    els.importBtn = $("import-btn");
    els.optionsBtn = $("options-btn");
    els.catRow = $("cat-row");
    els.statusText = $("status-text");
    els.statusDot = $("status-dot");
    els.statusHint = $("status-hint");
    els.openPageBtn = $("open-page-btn");
    els.quickAddBtn = $("quick-add-btn");
    els.focusPill = $("focus-pill");
    els.focusName = $("focus-name");
    els.focusExit = $("focus-exit");

    // 宽屏页面的元素
    els.nav = $("nav");
    els.pageTitle = $("page-title");
    els.pageCount = $("page-count");
    els.pageSub = $("page-sub");
    els.pageAdd = $("page-add");
    els.pageSearch = $("page-search");
    els.pageViewSlot = $("page-view-slot");
    els.pageSortBtn = $("page-sort-btn");
    els.pageRefresh = $("page-refresh-btn");
    els.pageSortLabel = $("page-sort-label");
    els.sideImport = $("side-import");
    els.sideSettings = $("side-settings");
    els.sideLock = $("side-lock");

    await store.init();
    applyTheme(false);

    ui.mount(els.app);
    if ($("quick-generator")) runtime.quickOtp = OTP.mountOtpWidget($("quick-generator"), { collapsible: true });
    if ($("pin-window-btn")) OTP.mountPinWindow($("pin-window-btn"));
    OTP.access.onRevoked(() => {
      if (store.settings().passwordRequired === false) { OTP.access.restore(); return; }
      if (!runtime.lockNode && !runtime.transitioning) lock({ revoke: false });
    });
    $("scan-btn")?.addEventListener("click", () => { if (!runtime.lockNode && !runtime.transitioning) OTP.scan.open(); });
    // macOS 使用系统惯用的 Command 提示，键盘处理同时兼容 Ctrl / Meta。
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || "");
    for (const hint of document.querySelectorAll("kbd")) {
      if (hint.textContent === "Ctrl K") hint.textContent = mac ? "⌘ K" : "Ctrl K";
    }
    list.mount({
      container: els.list,
      viewport: els.viewport,
      actions: rowActions,
    });

    let renderFrame = 0;
    const scheduleRender = () => {
      if (runtime.lockNode || runtime.transitioning || renderFrame) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        if (runtime.lockNode || runtime.transitioning) return;
        renderAll({ stagger: false });
        updateViewButton();
      });
    };
    OTP.sheets.setOnChanged(scheduleRender);
    store.subscribe((reason) => {
      if (reason === "security:external" && !runtime.lockNode) lock();
      if (reason === "storage:error") ui.toast("保存失败：" + store.state.storageError, "bad", { duration: 5000 });
      if (reason === "external:settings") { applyTheme(false); scheduleRender(); }
      updateStatusBar();
      if (reason === "external" || reason === "sync:data") scheduleRender();
    });

    bindShell();

    bindKeyboard();
    bindActivity();
    updateSortLabel();

    // 校验通过前不渲染任何账号数据（连分类里的条数也不显示）
    setContentInert(true);
    const ticket = global.localOtpWindowTicket;
    delete global.localOtpWindowTicket;
    if (store.hasPassword() && await OTP.access.restore(ticket)) {
      document.body.dataset.locked = "";
      els.screen.classList.add("is-in");
      setContentInert(false);
      renderAll({ stagger: false });
      await list.refreshAll();
      if (ticket && document.documentElement.dataset.floating === "1") ui.toast("已打开常驻小窗，再点右上角图钉可始终置顶", "ok", { duration: 4200 });
    } else rebuildLock(store.hasPassword() ? "unlock" : "create");

    // 让首帧先把锁屏画出来，再做重活
    requestAnimationFrame(() => {
      if (surface === "page") document.title = "LocalOTP · 账号管理";
    });
  }

  global.OTP.app = {
    boot,
    lock,
    relockAfterWipe,
    applyTheme,
    exportBackup,
    importBackup,
    openFullPage,
    renderAll,
    renderCategories,
    get categoryId() {
      return runtime.categoryId;
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
