/* input 应用控制器。 */
(function (global) {
  "use strict";
  global.OTP.createInputController = function ({ els, runtime, lock, clearSearch, toggleFocus, clearFocus } = {}) {
    const OTP = global.OTP;
    const store = OTP.store, ui = OTP.ui, list = OTP.list;
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

    /* 自动锁定 */

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

    /* 启动 */


    return { bindKeyboard, bindActivity };
  };
})(globalThis);
