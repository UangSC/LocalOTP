/* 账号计数、分类导航与状态展示。 */
(function (global) {
  "use strict";
  global.OTP.createAccountViews = function ({ els, runtime, surface, applySearch }) {
    const OTP = global.OTP, store = OTP.store, list = OTP.list;
    const { el, icon } = OTP;
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
      els.statusText.textContent = !settings.syncEnabled ? "本地存储" : sync.error ? "缓存合并失败 · 设置中重试" : sync.busy ? "正在合并缓存…" : sync.lastResult?.remoteAccounts === 0 && sync.lastResult?.localAccounts === 0 ? "同步缓存为空" : "缓存自动合并 · 云端未确认";
      if (els.statusDot) els.statusDot.classList.toggle("is-live", !!settings.syncEnabled);
    }

    /* 分类筛选 */

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

    /* 复制 */


    return { renderAll, renderCategories, setCategory, updateSortLabel, updateStatusBar };
  };
})(globalThis);
