/* ==========================================================================
   LocalOTP · app
   编排层：门禁、搜索、复制反馈、筛选、主题、快捷键、备份。
   只做"把数据接到界面上"这件事，业务规则都在 store 里。
   ========================================================================== */

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

  /* ==========================================================================
     主题
     ========================================================================== */

  function resolveTheme() {
    const pref = store.settings().theme;
    if (pref === "light" || pref === "dark") return pref;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  let themeTransition;
  let themeRevision = 0;
  function applyTheme(animate) {
    const next = resolveTheme();
    const colorScheme = store.settings().colorScheme;
    const revision = ++themeRevision;
    const changed = document.documentElement.dataset.theme !== next || document.documentElement.dataset.colorScheme !== colorScheme;
    themeTransition?.skipTransition();
    const commit = () => {
      if (revision !== themeRevision) return;
      document.documentElement.dataset.theme = next;
      document.body.dataset.theme = next;
      document.documentElement.dataset.colorScheme = colorScheme;
      document.body.dataset.colorScheme = colorScheme;
    };
    // 设置浮层中的预览直接提交，避免整页快照过渡挡住下一次色系点击。
    if (changed && animate && !ui.hasOverlay() && document.startViewTransition && !OTP.reduceMotion()) {
      themeTransition = document.startViewTransition(commit);
    } else {
      commit();
    }
  }

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (store.settings().theme === "auto") applyTheme(true);
  });

  /* ==========================================================================
     门禁
     ========================================================================== */

  function buildLock(mode) {
    const isCreate = mode === "create";

    const mark = el("div", {
      class: "lock-mark",
      html: icon("shield", 29, "i-lg"),
    });

    const title = el("h1", { text: isCreate ? "先设一个管理密码" : "LocalOTP" });
    const sub = el("p", {
      class: "lock-sub",
      text: isCreate ? "之后每次打开都要输入它，仅用于阻止他人随手查看" : "输入管理密码，解锁本地验证码库",
    });

    const firstWrap = pwWrap(isCreate ? "设置管理密码（至少 4 位）" : "管理密码", "lock");
    const secondWrap = isCreate ? pwWrap("再次输入确认", "lock2") : null;

    const errorLine = el("p", { class: "lock-err", role: "alert" });
    const strength = isCreate ? buildStrength() : null;

    const submitBtn = el("button", {
      class: "btn btn-primary btn-block",
      type: "submit",
      text: isCreate ? "创建并进入" : "解锁",
    });

    const cooldown = el("p", { class: "lock-cool", hidden: true });

    const form = el(
      "form",
      { class: "lock-form", autocomplete: "off" },
      firstWrap.node,
      secondWrap ? secondWrap.node : null,
      strength ? strength.node : null,
      errorLine,
      cooldown,
      submitBtn
    );

    const footLinks = el(
      "div",
      { class: "lock-foot-links" },
      el("button", {
        type: "button",
        text: "查看快捷键",
        onclick: () =>
          ui.confirm({
            title: "键盘快捷键",
            message:
              "<b>/</b> 或 <b>Ctrl / ⌘ K</b> 搜索 · <b>上下键</b> 定位 · <b>Enter</b> 复制验证码" +
              "<br><b>N</b> 新增 · <b>Q</b> 快速添加 · <b>F</b> 聚焦锁定 · <b>I</b> 导入 · <b>L</b> 锁定 · <b>Esc</b> 关闭",
            confirmText: "知道了",
            icon: "gauge",
          }),
      }),
      el("span", { class: "sep" }),
      el("button", {
        type: "button",
        text: "清空本机数据",
        onclick: async () => {
          const ok = await ui.confirm({
            title: "清空本机数据？",
            message: "账号、分类与管理密码都会被删除。若还记得密码，请先解锁后导出备份。",
            confirmText: "全部清空",
            danger: true,
            icon: "trash",
          });
          if (!ok) return;
          await store.wipe();
          applyTheme(false);
          rebuildLock("create");
        },
      })
    );

    const node = el(
      "section",
      { class: "lock", "aria-label": isCreate ? "设置管理密码" : "解锁" },
      el(
        "div",
        { class: "lock-card" },
        mark,
        title,
        sub,
        form,
        footLinks,
        el(
          "div",
          { class: "lock-foot" },
          el("span", { html: icon("lock", 12) }),
          el("span", {
            text: isCreate
              ? "密码只作界面门禁，不会加密存储中的密码与密钥"
              : "管理密码只用于界面解锁 · 同步按设置启用",
          })
        )
      )
    );

    if (isCreate) {
      firstWrap.input.addEventListener("input", () => strength.update(firstWrap.input.value));
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (runtime.submitting || runtime.transitioning || Date.now() < runtime.cooldownUntil) return;
      runtime.submitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = isCreate ? "正在创建…" : "正在解锁…";
      try {
        if (isCreate) await submitCreate(firstWrap, secondWrap, errorLine, submitBtn, node);
        else await submitUnlock(firstWrap, errorLine, node);
      } catch (err) {
        fail(errorLine, firstWrap, err.message || "操作失败，请重试");
      } finally {
        runtime.submitting = false;
        submitBtn.disabled = Date.now() < runtime.cooldownUntil;
        if (!submitBtn.disabled) submitBtn.textContent = isCreate ? "创建并进入" : "解锁";
      }
    });

    return node;
  }

  function pwWrap(placeholder, id) {
    const input = el("input", {
      id: "pw-" + id,
      type: "password",
      placeholder,
      autocomplete: id === "lock" ? "current-password" : "new-password",
      "aria-label": placeholder,
    });

    const eye = el("button", {
      class: "eye",
      type: "button",
      "aria-label": "显示密码",
      html: icon("eye", 16, "i-sm"),
      onclick: () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.innerHTML = icon(show ? "eye-off" : "eye", 16, "i-sm");
        input.focus();
      },
    });

    const node = el(
      "label",
      { class: "pw-wrap" },
      el("span", { html: icon("lock", 16) }),
      input,
      eye
    );

    return { node, input };
  }

  function buildStrength() {
    const bars = el("div", { class: "strength-bars" }, el("i"), el("i"), el("i"));
    const label = el("span", { class: "strength-label", text: "" });
    const node = el("div", { class: "strength", dataset: { level: "0" } }, bars, label);

    return {
      node,
      update(value) {
        let score = 0;
        if (value.length >= 4) score += 1;
        if (value.length >= 8) score += 1;
        if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
        if (/\d/.test(value)) score += 1;
        if (/[^\w\s]/.test(value)) score += 1;
        const level = value ? Math.min(3, Math.max(1, Math.round(score * 0.6))) : 0;
        node.dataset.level = String(level);
        label.textContent = level === 0 ? "" : level === 1 ? "弱" : level === 2 ? "中" : "强";
      },
    };
  }

  async function submitCreate(first, second, errorLine, button, lockNode) {
    const a = first.input.value;
    const b = second.input.value;

    if (a.length < 4) {
      fail(errorLine, first, "密码至少 4 位");
      return;
    }
    if (a !== b) {
      fail(errorLine, second, "两次输入不一致");
      return;
    }

    button.disabled = true;
    button.textContent = "正在生成摘要…";
    await store.setPassword(a);
    let authorized = false, authorizationError = "密码已保存，但后台授权未完成，请重新解锁";
    try { authorized = await OTP.access.unlock(a); } catch (error) { authorizationError = error.message; }
    if (!authorized) {
      rebuildLock("unlock", false);
      const message = runtime.lockNode.querySelector(".lock-err");
      message.textContent = authorizationError;
      message.classList.add("is-show");
      return;
    }
    button.textContent = "创建并进入";
    await markEntered(lockNode);
  }

  async function submitUnlock(first, errorLine, lockNode) {
    const value = first.input.value;
    if (!value) {
      fail(errorLine, first, "请输入管理密码");
      return;
    }

    const ok = await OTP.access.unlock(value);
    if (ok) {
      runtime.failCount = 0;
      await markEntered(lockNode);
      return;
    }

    runtime.failCount += 1;
    const left = 5 - runtime.failCount;
    fail(
      errorLine,
      first,
      left > 0 && left <= 2 ? `密码不正确，还可以再试 ${left} 次` : "密码不正确，请重试"
    );
    first.input.select();

    if (runtime.failCount >= 5) startCooldown(lockNode);
  }

  function fail(errorLine, wrap, message) {
    errorLine.innerHTML = icon("alert-circle", 12) + "<span></span>";
    errorLine.querySelector("span").textContent = message;
    errorLine.classList.add("is-show");
    wrap.node.classList.remove("is-bad");
    void wrap.node.offsetWidth;
    wrap.node.classList.add("is-bad");
  }

  function startCooldown(lockNode) {
    runtime.cooldownUntil = Date.now() + 20000;
    runtime.failCount = 0;

    const inputs = lockNode.querySelectorAll(".pw-wrap input");
    const button = lockNode.querySelector(".btn-primary");
    const label = lockNode.querySelector(".lock-cool");

    inputs.forEach((input) => (input.disabled = true));
    button.disabled = true;
    label.hidden = false;

    clearInterval(runtime.cooldownTimer);
    const tick = () => {
      const left = Math.ceil((runtime.cooldownUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(runtime.cooldownTimer);
        inputs.forEach((input) => (input.disabled = false));
        button.disabled = false;
        button.textContent = "解锁";
        label.hidden = true;
        inputs[0].focus();
        return;
      }
      label.textContent = `尝试次数过多，请 ${left} 秒后再试`;
      button.textContent = `等待 ${left}s`;
    };
    tick();
    runtime.cooldownTimer = setInterval(tick, 250);
  }

  function rebuildLock(mode, animate = true) {
    clearInterval(runtime.cooldownTimer);
    if (runtime.lockNode) runtime.lockNode.remove();

    const node = buildLock(mode);
    runtime.lockNode = node;
    els.app.append(node);
    node.style.opacity = animate ? "0" : "1";
    if (!animate) node.querySelector(".lock-card").style.animation = "none";

    // 管理页：标记"上锁"，让页面骨架先不出现（只剩环境光 + 那张卡片）
    if (surface === "page") document.body.dataset.locked = "1";

    // 用局部引用而不是 runtime.lockNode：解锁/导航可能在下一帧之前就把它清掉了
    if (!animate) return;
    requestAnimationFrame(() => {
      if (!node.isConnected) return;
      node.style.opacity = "";
      const input = node.querySelector("input");
      if (input) {
        setTimeout(() => {
          if (node.isConnected) input.focus();
        }, 120);
      }
    });
  }

  function setContentInert(value) {
    els.screen.inert = value;
    const sidebar = els.app.querySelector(".sidebar");
    if (sidebar) sidebar.inert = value;
  }

  async function markEntered(lockNode) {
    if (runtime.transitioning || runtime.lockNode !== lockNode) return;
    runtime.transitioning = true;
    lockNode.inert = true;
    runtime.lastActivity = Date.now();
    els.screen.classList.add("is-in");
    try {
      renderAll({ stagger: false });
      await list.refreshAll();
      await OTP.gateMotion.transition({ app: els.app, lock: lockNode, entering: true });
    } finally {
      lockNode.remove();
      runtime.lockNode = null;
      runtime.transitioning = false;
      document.body.dataset.locked = "";
      setContentInert(false);
      (els.searchInput || els.pageSearch)?.focus({ preventScroll: true });
    }
  }

  async function lock({ revoke = true } = {}) {
    if (runtime.lockNode || runtime.transitioning) return;
    runtime.transitioning = true;
    setContentInert(true);
    if (revoke) OTP.access.revoke().catch(() => ui.toast("会话清理失败，请关闭浏览器后重新打开", "bad"));
    ui.closeAll();
    runtime.quickOtp?.clear();
    OTP.totp.clearKeyCache();
    list.cancelMotion();
    list.stopTicker();
    rebuildLock(store.hasPassword() ? "unlock" : "create", false);
    const node = runtime.lockNode;
    node.inert = true;
    try {
      await OTP.gateMotion.transition({ app: els.app, lock: node, entering: false });
    } finally {
      els.screen.classList.remove("is-in");
      runtime.transitioning = false;
      node.inert = false;
      node.querySelector("input")?.focus({ preventScroll: true });
    }
  }

  function relockAfterWipe() {
    OTP.access.revoke().catch(() => {});
    runtime.quickOtp?.clear();
    els.screen.classList.remove("is-in");
    setContentInert(true);
    rebuildLock("create");
  }

  /* ==========================================================================
     渲染
     ========================================================================== */

  function renderAll(opts) {
    const o = opts || {};
    if (runtime.categoryId && runtime.categoryId !== "__none__" && !store.categoryOf(runtime.categoryId)) {
      runtime.categoryId = "";
      list.setCategory("");
    }
    if (els.pageTitle) els.pageTitle.textContent = runtime.categoryId === "__none__" ? "未分类"
      : store.categoryOf(runtime.categoryId)?.name || "全部账号";
    document.body.dataset.view = store.settings().view;
    list.render({ stagger: o.stagger });
    // 聚焦的那条如果被删了/被筛掉了，胶囊要跟着收起来
    if (els.focusPill && !list.getFocusLock()) els.focusPill.hidden = true;
    renderCategories();
    updateCounts();
    updateSortLabel();
    updateStatusBar();
    if (runtime.query) applySearch(runtime.query, { scroll: false });
  }

  function updateCounts() {
    const total = store.accounts().length;
    const shown = runtime.categoryId
      ? store.accounts().filter((a) => runtime.categoryId === "__none__" ? !a.categoryId : a.categoryId === runtime.categoryId).length
      : total;

    if (els.count) els.count.textContent = String(shown);
    if (els.pageCount) els.pageCount.textContent = String(shown);
    if (els.pageSub) {
      const cat = runtime.categoryId ? store.categoryOf(runtime.categoryId) : null;
      els.pageSub.textContent = runtime.categoryId === "__none__" ? `未分类 · 共 ${shown} 条记录` : cat
        ? `${cat.name} · 共 ${shown} 条记录`
        : `${total} 条记录 · 验证码每 30 秒自动刷新`;
    }
  }

  function updateSortLabel() {
    const sort = store.settings().sort;
    const label = sort === "email" ? "邮箱 A-Z" : sort === "issuer" ? "服务名" : "最近更新";
    if (els.sortLabel) els.sortLabel.textContent = label;
    if (els.pageSortLabel) els.pageSortLabel.textContent = label;
  }

  function updateStatusBar() {
    if (!els.statusText) return;
    const settings = store.settings();
    const sync = store.sync.info();
    // 条数由 #count 单独渲染，这里只说来源，避免"10 条 · 10 条"
    els.statusText.textContent = !settings.syncEnabled ? "本地存储" : sync.error ? "同步失败 · 设置中重试" : sync.busy ? "正在同步…" : sync.lastResult?.remoteAccounts === 0 && sync.lastResult?.localAccounts === 0 ? "同步缓存为空" : "自动同步已开启";
    if (els.statusDot) els.statusDot.classList.toggle("is-live", !!settings.syncEnabled);
  }

  /* ==========================================================================
     分类筛选
     ========================================================================== */

  function renderCategories() {
    const cats = store.categories();
    const counts = new Map();
    for (const account of store.accounts()) counts.set(account.categoryId, (counts.get(account.categoryId) || 0) + 1);

    // 弹窗形态：一排胶囊
    if (els.catRow) {
      OTP.clear(els.catRow);
      const all = store.accounts();
      els.catRow.append(
        catChip("", "全部", "layers", all.length),
        ...cats.map((cat) =>
          catChip(cat.id, cat.name, cat.icon, counts.get(cat.id) || 0)
        )
      );
    }

    // 宽屏页面：左侧导航
    if (els.nav) {
      OTP.clear(els.nav);
      const all = store.accounts();
      els.nav.append(
        navItem("", "全部账号", "layers", all.length, true),
        navItem("__none__", "未分类", "folder", counts.get("") || 0)
      );
      els.nav.append(el("div", { class: "nav-sep" }));

      const title = el("div", { class: "nav-title", text: "分类" });
      els.nav.append(title);

      for (const cat of cats) {
        els.nav.append(
          navItem(cat.id, cat.name, cat.icon, counts.get(cat.id) || 0)
        );
      }

      els.nav.append(
        el("button", {
          class: "nav-item",
          type: "button",
          html: icon("plus", 14) + '<span class="nav-label">新建分类</span>',
          onclick: () => OTP.sheets.openCategoryManager(),
        })
      );
    }
  }

  function catChip(id, label, iconName, count) {
    const active = id === runtime.categoryId;
    return el(
      "button",
      {
        class: "cat" + (active ? " is-on" : ""),
        type: "button",
        "aria-pressed": String(active),
        onclick: () => setCategory(id),
      },
      el("span", { html: icon(iconName, 12) }),
      el("span", { text: label }),
      el("span", { class: "cat-count", text: String(count) })
    );
  }

  function navItem(id, label, iconName, count) {
    const active = id === runtime.categoryId;
    return el(
      "button",
      {
        class: "nav-item" + (active ? " is-on" : ""),
        type: "button",
        "aria-pressed": String(active),
        onclick: () => setCategory(id),
      },
      el("span", { html: icon(iconName || "tag", 15) }),
      el("span", { class: "nav-label", text: label }),
      el("span", { class: "nav-count", text: String(count) })
    );
  }

  function setCategory(id) {
    list.transitionLayout(() => {
      runtime.categoryId = id || "";
      list.setCategory(runtime.categoryId);
      renderAll({ stagger: false });
      list.scrollToTop();
    });

    if (els.pageTitle) {
      const cat = runtime.categoryId === "__none__" ? null : store.categoryOf(runtime.categoryId);
      els.pageTitle.textContent =
        runtime.categoryId === "__none__" ? "未分类" : cat ? cat.name : "全部账号";
    }
  }

  /* ==========================================================================
     复制
     ========================================================================== */

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

  /* ==========================================================================
     搜索
     ========================================================================== */

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

  /* ==========================================================================
     打开宽屏管理页
     ========================================================================== */

  function openFullPage() {
    const chromeApi = global.chrome;
    try {
      // 扩展里优先走 options 页：会复用已打开的标签，不会每次新开一个
      if (chromeApi && chromeApi.runtime && chromeApi.runtime.openOptionsPage) {
        chromeApi.runtime.openOptionsPage();
        return;
      }
      if (chromeApi && chromeApi.tabs && chromeApi.runtime && chromeApi.runtime.getURL) {
        chromeApi.tabs.create({ url: chromeApi.runtime.getURL("index.html") });
        return;
      }
    } catch (err) {
      /* 落到下面的兜底 */
    }
    global.open("index.html", "_blank");
  }

  /* ==========================================================================
     备份
     ========================================================================== */

  function exportBackup() {
    const payload = store.exportPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const name =
      `localotp-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}.json`;

    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);

    store.patchSettings({ lastBackupAt: Date.now() });
    ui.toast(`已导出 ${payload.accounts.length} 个账号`);
  }

  function importBackup() {
    const input = el("input", { type: "file", accept: ".json,application/json", hidden: true });
    document.body.append(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        input.remove();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(String(reader.result || ""));
          const result = store.importPayload(payload);
          renderAll({ stagger: true });
          if (result.added) ui.toast(`已合并 ${result.added} 条记录${result.skipped ? `，跳过 ${result.skipped} 条` : ""}`);
          else ui.toast("没有新的可合并记录", "warn");
        } catch (err) {
          ui.toast("备份文件无法解析", "bad");
        }
        input.remove();
      };
      reader.readAsText(file, "utf-8");
    });
    input.click();
  }

  /* ==========================================================================
     聚焦锁定
     ========================================================================== */

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

  /* ==========================================================================
     行操作
     ========================================================================== */

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
          { label: "复制邮箱", icon: "mail", onSelect: () => copyField(account, "email") },
          { label: "复制密码", icon: "key", onSelect: () => copyField(account, "password") },
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

  /* ==========================================================================
     绑定
     ========================================================================== */

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
        else ui.toast(result ? "验证码已刷新，同步已完成" : "验证码已刷新");
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

  function bindKeyboard() {
    document.addEventListener("keydown", (event) => {
      if (document.body.dataset.pipOwner === "1") return;
      const target = document.activeElement;
      const tag = target ? target.tagName : "";
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag);

      if (event.key === "Escape") {
        if (ui.handleEscape()) {
          event.preventDefault();
          return;
        }
        if (clearFocus()) {
          event.preventDefault();
          return;
        }
        if (els.searchInput && target === els.searchInput) return;
        if (runtime.query) {
          clearSearch(false);
          event.preventDefault();
        }
        return;
      }

      if (event.key === "Tab" || event.metaKey || event.ctrlKey || event.altKey) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          if (runtime.lockNode) return;
          const input = els.searchInput || els.pageSearch;
          if (input) {
            input.focus();
            input.select();
          }
        }
        return;
      }

      if (typing || ui.hasOverlay() || runtime.transitioning || runtime.lockNode || !els.screen || els.screen.hasAttribute("inert")) return;

      if (event.key === "/") {
        event.preventDefault();
        const input = els.searchInput || els.pageSearch;
        if (input) input.focus();
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        OTP.sheets.openEditor(null);
      } else if (key === "q") {
        event.preventDefault();
        OTP.sheets.openQuickAdd();
      } else if (key === "f") {
        event.preventDefault();
        const order = list.getState().order || [];
        const id = list.getActiveId() || order[0];
        if (id) toggleFocus(store.byId(id));
      } else if (key === "i") {
        event.preventDefault();
        OTP.sheets.openImport();
      } else if (key === "l") {
        event.preventDefault();
        lock();
      } else if (key === "s") {
        event.preventDefault();
        OTP.sheets.openManage("settings");
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        list.moveActive(event.key === "ArrowDown" ? 1 : -1);
      }
    });
  }

  /* ==========================================================================
     自动锁定
     ========================================================================== */

  function bindActivity() {
    const touch = () => {
      runtime.lastActivity = Date.now();
    };
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart", "focusin"]) {
      document.addEventListener(type, touch, { passive: true });
    }

    runtime.ticker = setInterval(() => {
      if (OTP.access.graceActive || document.body.dataset.pipOwner === "1") return;
      const minutes = store.settings().lockAfter;
      if (!minutes) return;
      if (runtime.lockNode) return;
      if (document.hidden) return;
      if (Date.now() - runtime.lastActivity > minutes * 60000) lock();
    }, 4000);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (document.body.dataset.pipOwner === "1") return;
      const minutes = store.settings().lockAfter;
      if (!runtime.lockNode && !OTP.access.graceActive && minutes && Date.now() - runtime.lastActivity > minutes * 60000) {
        lock();
        return;
      }
      if (!runtime.lockNode) list.refreshAll();
    });
  }

  /* ==========================================================================
     启动
     ========================================================================== */

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
    OTP.access.onRevoked(() => { if (!runtime.lockNode && !runtime.transitioning) lock({ revoke: false }); });
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
