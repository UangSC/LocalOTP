/* 同步提交整套配色，避免前景与背景各自补间而短暂失去对比度。 */
(function (global) {
  "use strict";
  global.OTP.createThemeController = function () {
    const OTP = global.OTP,
      store = OTP.store;
    let themeFrame;
    function applyTheme() {
      const settings = store.settings();
      const next = ["light", "dark"].includes(settings.theme)
        ? settings.theme
        : matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      const root = document.documentElement,
        changed = root.dataset.theme !== next || root.dataset.colorScheme !== settings.colorScheme;
      if (changed) {
        cancelAnimationFrame(themeFrame);
        root.classList.add("theme-switching");
      }
      root.dataset.theme = document.body.dataset.theme = next;
      root.dataset.colorScheme = document.body.dataset.colorScheme = settings.colorScheme;
      if (changed) {
        // 让浏览器先按完整的新配色提交样式，再恢复控件悬停过渡。
        void root.offsetWidth;
        themeFrame = requestAnimationFrame(() => root.classList.remove("theme-switching"));
      }
    }
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (store.settings().theme === "auto") applyTheme();
    });
    return { applyTheme };
  };
})(globalThis);
