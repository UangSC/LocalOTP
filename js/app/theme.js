/* 主题更新与系统主题监听。 */
(function (global) {
  "use strict";
  global.OTP.createThemeController = function ({  } = {}) {
    const OTP = global.OTP;
    const store = OTP.store, ui = OTP.ui;
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

    /* 门禁 */


    return { applyTheme };
  };
})(globalThis);
